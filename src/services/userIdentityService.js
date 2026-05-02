import {
    gameLogRepository as defaultGameLogRepository,
    vrchatSearchRepository as defaultVrchatSearchRepository
} from '@/repositories/index.js';
import {
    getKnownUserFact,
    normalizeEndpoint,
    normalizeUserId,
    recordUserProfile
} from '@/domain/users/userFactAccess.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useUserFactsStore } from '@/state/userFactsStore.js';

function text(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function displayNameOf(user) {
    return text(user?.displayName || user?.username || user?.name);
}

function titleForUser(user, fallback = '') {
    return (
        displayNameOf(user) ||
        text(fallback) ||
        normalizeUserId(user?.id || user?.userId)
    );
}

function displayNameMatches(user, targetDisplayName) {
    const name = displayNameOf(user).toLowerCase();
    return Boolean(name && name === targetDisplayName);
}

function resolvedEndpoint(endpoint) {
    return normalizeEndpoint(
        endpoint || useRuntimeStore.getState().auth.currentUserEndpoint
    );
}

function resolvedUser(user, source, fallbackTitle = '') {
    const userId = normalizeUserId(user?.id || user?.userId);
    if (!userId) {
        return null;
    }
    return {
        userId,
        title: titleForUser(user, fallbackTitle),
        user,
        seedData: user,
        source
    };
}

function findKnownUserByDisplayName(displayName, { endpoint = '' } = {}) {
    const targetDisplayName = text(displayName).toLowerCase();
    if (!targetDisplayName) {
        return null;
    }

    const normalizedEndpoint = resolvedEndpoint(endpoint);
    const state = useUserFactsStore.getState();
    const userIds = state.userIdsByEndpoint[normalizedEndpoint] || [];
    for (const userId of userIds) {
        const fact = getKnownUserFact(normalizedEndpoint, userId);
        if (displayNameMatches(fact, targetDisplayName)) {
            return fact;
        }
    }
    return null;
}

function findFriendByDisplayName(displayName) {
    const targetDisplayName = text(displayName).toLowerCase();
    if (!targetDisplayName) {
        return null;
    }

    const { friendsById } = useFriendRosterStore.getState();
    return (
        Object.values(friendsById || {}).find((friend) =>
            displayNameMatches(friend, targetDisplayName)
        ) || null
    );
}

async function resolveUserByDisplayName(
    displayName,
    { endpoint = '', repositories = {}, search = true } = {}
) {
    const normalizedDisplayName = text(displayName);
    if (!normalizedDisplayName) {
        return null;
    }

    const normalizedEndpoint = resolvedEndpoint(endpoint);
    const targetDisplayName = normalizedDisplayName.toLowerCase();
    const runtimeUser = useRuntimeStore.getState().auth.currentUserSnapshot;
    if (displayNameMatches(runtimeUser, targetDisplayName)) {
        recordUserProfile(runtimeUser, {
            endpoint: normalizedEndpoint,
            source: 'currentUser',
            isCurrentUser: true
        });
        return resolvedUser(runtimeUser, 'currentUser', normalizedDisplayName);
    }

    const knownUser = findKnownUserByDisplayName(normalizedDisplayName, {
        endpoint: normalizedEndpoint
    });
    if (knownUser) {
        return resolvedUser(knownUser, 'known', normalizedDisplayName);
    }

    const friend = findFriendByDisplayName(normalizedDisplayName);
    if (friend) {
        recordUserProfile(friend, {
            endpoint: normalizedEndpoint,
            source: 'friend',
            isFriend: true,
            stateBucket: friend.stateBucket || friend.state
        });
        return resolvedUser(friend, 'friend', normalizedDisplayName);
    }

    const gameLog = repositories.gameLogRepository || defaultGameLogRepository;
    const loggedUserId = normalizeUserId(
        gameLog?.getUserIdFromDisplayName
            ? await gameLog
                  .getUserIdFromDisplayName(normalizedDisplayName)
                  .catch(() => '')
            : ''
    );
    if (loggedUserId) {
        const user =
            getKnownUserFact(normalizedEndpoint, loggedUserId) ||
            useFriendRosterStore.getState().friendsById?.[loggedUserId] || {
                id: loggedUserId,
                displayName: normalizedDisplayName
            };
        recordUserProfile(user, {
            endpoint: normalizedEndpoint,
            source: user.isFriend ? 'friend' : 'seed',
            isFriend: Boolean(user.isFriend)
        });
        return resolvedUser(user, 'gameLog', normalizedDisplayName);
    }

    if (!search) {
        return null;
    }

    const searchRepository =
        repositories.vrchatSearchRepository || defaultVrchatSearchRepository;
    const response = await searchRepository?.getUsers?.(
        {
            search: normalizedDisplayName,
            n: 5,
            offset: 0
        },
        { endpoint: normalizedEndpoint }
    );
    const rows = Array.isArray(response?.json) ? response.json : [];
    const match =
        rows.find((user) => displayNameMatches(user, targetDisplayName)) ||
        rows.find((user) => normalizeUserId(user?.id) === normalizedDisplayName);
    if (!match?.id) {
        return null;
    }

    const recorded =
        recordUserProfile(match, {
            endpoint: normalizedEndpoint,
            source: 'profile'
        }) || match;
    return resolvedUser(recorded, 'search', normalizedDisplayName);
}

export {
    findKnownUserByDisplayName,
    resolveUserByDisplayName,
    resolvedUser
};
