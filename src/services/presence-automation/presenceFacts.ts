import playerListPersistenceRepository from '@/repositories/playerListPersistenceRepository';
import { checkCanInvite, type InviteInstanceCache } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/locationParser';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';

type RuntimeState = ReturnType<typeof useRuntimeStore.getState>;
type GameState = RuntimeState['gameState'];
type CurrentUserSnapshot = RuntimeState['auth']['currentUserSnapshot'];
type LocationLike = {
    accessType?: unknown;
    groupAccessType?: unknown;
};
type PresencePlayer = Record<string, unknown> & {
    id: string;
    userId: string;
    displayName: string;
};
type PresenceFactsOptions = {
    now?: Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeInstanceType(location: LocationLike): string {
    if (!location?.accessType) {
        return '';
    }
    if (location.accessType !== 'group') {
        return String(location.accessType || '').trim();
    }
    if (location.groupAccessType === 'members') {
        return 'groupOnly';
    }
    if (location.groupAccessType === 'plus') {
        return 'groupPlus';
    }
    return 'groupPublic';
}

function getCachedInstanceLocation(instance: Record<string, unknown>) {
    return String(
        instance?.location ||
            instance?.$location ||
            instance?.instanceLocation ||
            instance?.instanceId ||
            ''
    ).trim();
}

function getCachedInviteInstance(instance: unknown) {
    const record = isRecord(instance) ? instance : {};
    const nested = isRecord(record.instance) ? record.instance : record;
    return {
        closedAt: nested.closedAt
    };
}

function buildCachedInstanceMap(instances: unknown): InviteInstanceCache {
    const map: InviteInstanceCache = new Map();
    for (const instance of Array.isArray(instances) ? instances : []) {
        if (!isRecord(instance)) {
            continue;
        }
        const location = getCachedInstanceLocation(instance);
        if (location) {
            map.set(location, getCachedInviteInstance(instance));
        }
    }
    return map;
}

function collectPresentFavoriteGroupKeys(players: PresencePlayer[]): string[] {
    const favoriteState = useFavoriteStore.getState();
    const presentUserIds = new Set(
        (players || []).map((player) => player.userId).filter(Boolean)
    );
    const keys = new Set<string>();

    for (const [groupKey, userIds] of Object.entries(
        favoriteState.groupedFavoriteFriendIdsByGroupKey || {}
    )) {
        if (
            Array.isArray(userIds) &&
            userIds.some((userId) => presentUserIds.has(String(userId)))
        ) {
            keys.add(groupKey);
        }
    }

    for (const [groupName, userIds] of Object.entries(
        favoriteState.localFriendFavorites || {}
    )) {
        if (
            Array.isArray(userIds) &&
            userIds.some((userId) => presentUserIds.has(String(userId)))
        ) {
            keys.add(`local:${groupName}`);
        }
    }

    return Array.from(keys);
}

function resolveCurrentLocation(
    gameState: GameState,
    currentUser: CurrentUserSnapshot
): string {
    return String(
        gameState.currentLocation ||
        gameState.currentDestination ||
        currentUser?.$locationTag ||
        currentUser?.location ||
        ''
    ).trim();
}

function getVerifiedCurrentLocation(gameState: GameState) {
    const currentLocation = String(gameState?.currentLocation || '').trim();
    return currentLocation && currentLocation !== 'traveling'
        ? currentLocation
        : '';
}

function normalizePlayer(player: unknown, index: number = 0): PresencePlayer {
    const source =
        player && typeof player === 'object'
            ? player
            : {
                  id: player,
                  userId: player
              };
    const record = source as Record<string, unknown>;
    const userId = String(record.userId || record.id || '').trim();
    const displayName = String(
        record.displayName || record.name || userId || ''
    ).trim();
    const id = String(record.id || userId || `runtime:${index}`).trim();
    return {
        ...record,
        id,
        userId,
        displayName
    };
}

function getRuntimePlayers(gameState: GameState): PresencePlayer[] {
    const players = Array.isArray(gameState?.currentLocationPlayers)
        ? gameState.currentLocationPlayers
              .map((player, index) => normalizePlayer(player, index))
              .filter(
                  (player) => player.id && (player.userId || player.displayName)
              )
        : [];
    if (players.length) {
        return players;
    }

    return Array.isArray(gameState?.currentLocationPlayerIds)
        ? gameState.currentLocationPlayerIds
              .map((userId, index) =>
                  normalizePlayer({ id: userId, userId }, index)
              )
              .filter((player) => player.userId)
        : [];
}

function isLiveCurrentLocation(location: unknown) {
    const normalizedLocation = String(location || '').trim();
    return Boolean(
        normalizedLocation &&
            normalizedLocation !== 'offline' &&
            normalizedLocation !== 'private' &&
            normalizedLocation !== 'traveling'
    );
}

export async function buildPresenceFacts({
    now = new Date()
}: PresenceFactsOptions = {}) {
    const runtimeState = useRuntimeStore.getState();
    const auth = runtimeState.auth;
    const gameState = runtimeState.gameState;
    const currentUser = auth.currentUserSnapshot || null;
    const currentUserId = String(
        auth.currentUserId || currentUser?.id || ''
    ).trim();
    const endpoint = auth.currentUserEndpoint || '';
    const currentLocation = resolveCurrentLocation(gameState, currentUser);
    const parsedLocation = parseLocation(currentLocation);
    const instanceType = normalizeInstanceType(parsedLocation);
    const hasLiveCurrentLocation = isLiveCurrentLocation(currentLocation);

    const snapshot = hasLiveCurrentLocation
        ? await playerListPersistenceRepository.getCurrentInstanceSnapshot({
              currentUserId,
              currentLocation,
              currentLocationStartedAt: gameState.currentLocationStartedAt || ''
          })
        : {
              context: {
                  location: currentLocation,
                  playerFactsKnown: false,
                  observedPlayerEventCount: 0,
                  source: 'runtime'
              },
              players: []
          };
    const runtimePlayers = hasLiveCurrentLocation
        ? getRuntimePlayers(gameState)
        : [];
    const players: PresencePlayer[] = runtimePlayers.length
        ? runtimePlayers
        : Array.isArray(snapshot.players)
          ? snapshot.players.map((player, index) => normalizePlayer(player, index))
          : [];
    const playerFactsKnown = Boolean(
        snapshot.context?.playerFactsKnown || runtimePlayers.length
    );
    const friendsById = useFriendRosterStore.getState().friendsById || {};
    const presentFriendIds = players
        .map((player) => player.userId)
        .filter((userId) => userId && friendsById[userId]);
    const groupInstances =
        runtimeState.groupInstances.userId === currentUserId &&
        runtimeState.groupInstances.endpoint === endpoint
            ? runtimeState.groupInstances.instances
            : [];
    const currentInviteLocation = getVerifiedCurrentLocation(gameState);
    const canInviteFromCurrentLocation = checkCanInvite(
        currentInviteLocation,
        {
            currentUserId,
            lastLocationStr: getVerifiedCurrentLocation(gameState),
            cachedInstances: buildCachedInstanceMap(groupInstances)
        }
    );

    return {
        now,
        currentUser,
        currentUserId,
        endpoint,
        isGameRunning: Boolean(gameState.isGameRunning),
        isTraveling:
            currentLocation === 'traveling' || Boolean(parsedLocation.isTraveling),
        currentLocation,
        currentDestination: gameState.currentDestination || '',
        currentLocationStartedAt: gameState.currentLocationStartedAt || '',
        parsedLocation,
        instanceType,
        players,
        playerCount: players.length,
        playerFactsKnown,
        observedPlayerEventCount:
            Number(snapshot.context?.observedPlayerEventCount) || 0,
        friendCount: presentFriendIds.length,
        presentFriendIds,
        presentFavoriteGroupKeys: collectPresentFavoriteGroupKeys(players),
        canInviteFromCurrentLocation
    };
}

export { normalizeInstanceType };
