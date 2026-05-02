type UserFactSource =
    | 'seed'
    | 'instance'
    | 'playerSnapshot'
    | 'friend'
    | 'profile'
    | 'realtime'
    | 'currentUser'
    | 'gameRuntime';

type UserStateBucket = 'online' | 'active' | 'offline' | '';

interface UserFactMergeOptions {
    endpoint?: unknown;
    source?: UserFactSource;
    receivedAt?: unknown;
    isCurrentUser?: boolean;
    isFriend?: boolean;
    stateBucket?: unknown;
}

interface UserFact {
    id: string;
    endpoint: string;
    username?: string;
    displayName?: string;
    userIcon?: string;
    profilePicOverride?: string;
    profilePicOverrideThumbnail?: string;
    thumbnailUrl?: string;
    currentAvatar?: string;
    currentAvatarImageUrl?: string;
    currentAvatarThumbnailImageUrl?: string;
    currentAvatarName?: string;
    status?: string;
    statusDescription?: string;
    state?: string;
    stateBucket?: UserStateBucket;
    location?: string;
    travelingToLocation?: string;
    locationAt?: unknown;
    travelingToTime?: unknown;
    friendNumber?: number;
    isCurrentUser?: boolean;
    isFriend?: boolean;
    isBoopingEnabled?: boolean;
    hasSharedConnectionsOptOut?: boolean;
    tags?: unknown[];
    platform?: string;
    last_platform?: string;
    developerType?: string;
    updatedAt: string;
    fieldRanks: Record<string, number>;
    fieldSources: Record<string, string>;
}

const PROFILE_FIELDS = new Set([
    'username',
    'displayName',
    'userIcon',
    'profilePicOverride',
    'profilePicOverrideThumbnail',
    'thumbnailUrl',
    'currentAvatar',
    'currentAvatarImageUrl',
    'currentAvatarThumbnailImageUrl',
    'currentAvatarName',
    'friendNumber',
    'tags',
    'platform',
    'last_platform',
    'developerType'
]);

const PRESENCE_FIELDS = new Set([
    'status',
    'statusDescription',
    'state',
    'stateBucket',
    'location',
    'travelingToLocation',
    'locationAt',
    'travelingToTime'
]);

const SELF_FIELDS = new Set([
    'isBoopingEnabled',
    'hasSharedConnectionsOptOut'
]);

const BASE_SOURCE_RANK: Record<UserFactSource, number> = {
    seed: 10,
    instance: 20,
    playerSnapshot: 35,
    friend: 50,
    profile: 70,
    realtime: 75,
    currentUser: 85,
    gameRuntime: 90
};

const PROFILE_SOURCE_RANK: Record<UserFactSource, number> = {
    seed: 10,
    instance: 20,
    playerSnapshot: 30,
    realtime: 40,
    friend: 55,
    profile: 80,
    currentUser: 90,
    gameRuntime: 50
};

const PRESENCE_SOURCE_RANK: Record<UserFactSource, number> = {
    seed: 10,
    instance: 45,
    playerSnapshot: 60,
    profile: 40,
    currentUser: 65,
    friend: 70,
    realtime: 80,
    gameRuntime: 90
};

const USER_FIELD_ALIASES: Record<string, keyof UserFact> = {
    display_name: 'displayName',
    name: 'displayName',
    user_id: 'id',
    userId: 'id',
    profilePicOverride: 'profilePicOverride',
    profilePicOverrideThumbnail: 'profilePicOverrideThumbnail',
    currentAvatarImageUrl: 'currentAvatarImageUrl',
    currentAvatarThumbnailImageUrl: 'currentAvatarThumbnailImageUrl',
    currentAvatarName: 'currentAvatarName',
    travelingToLocation: 'travelingToLocation',
    $travelingToLocation: 'travelingToLocation',
    locationAt: 'locationAt',
    location_at: 'locationAt',
    $location_at: 'locationAt',
    joinedAt: 'locationAt',
    joined_at: 'locationAt',
    $online_for: 'locationAt',
    $travelingToTime: 'travelingToTime',
    friendNumber: 'friendNumber',
    $friendNumber: 'friendNumber'
};

const USER_FACT_FIELDS = new Set([
    'id',
    'username',
    'displayName',
    'userIcon',
    'profilePicOverride',
    'profilePicOverrideThumbnail',
    'thumbnailUrl',
    'currentAvatar',
    'currentAvatarImageUrl',
    'currentAvatarThumbnailImageUrl',
    'currentAvatarName',
    'status',
    'statusDescription',
    'state',
    'stateBucket',
    'location',
    'travelingToLocation',
    'locationAt',
    'travelingToTime',
    'friendNumber',
    'isBoopingEnabled',
    'hasSharedConnectionsOptOut',
    'tags',
    'platform',
    'last_platform',
    'developerType'
]);

function normalizeText(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeUserId(value: unknown): string {
    return normalizeText(value);
}

function normalizeEndpoint(value: unknown): string {
    return normalizeText(value) || 'default';
}

function userFactKey(endpoint: unknown, userId: unknown): string {
    const normalizedUserId = normalizeUserId(userId);
    return normalizedUserId
        ? `${normalizeEndpoint(endpoint)}::${normalizedUserId}`
        : '';
}

function normalizeStateBucket(value: unknown): UserStateBucket {
    const normalized = normalizeText(value).toLowerCase();
    return normalized === 'online' ||
        normalized === 'active' ||
        normalized === 'offline'
        ? normalized
        : '';
}

function isPresent(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
}

function rankForField(field: string, source: UserFactSource): number {
    if (PRESENCE_FIELDS.has(field)) {
        return PRESENCE_SOURCE_RANK[source];
    }
    if (PROFILE_FIELDS.has(field)) {
        return PROFILE_SOURCE_RANK[source];
    }
    if (SELF_FIELDS.has(field)) {
        return source === 'currentUser' || source === 'gameRuntime'
            ? 95
            : BASE_SOURCE_RANK[source];
    }
    return BASE_SOURCE_RANK[source];
}

function normalizeFactPatch(input: Record<string, unknown>): Partial<UserFact> {
    const patch: Partial<UserFact> = {};
    for (const [rawKey, value] of Object.entries(input || {})) {
        const key = (USER_FIELD_ALIASES[rawKey] || rawKey) as keyof UserFact;
        if (!USER_FACT_FIELDS.has(key)) {
            continue;
        }
        if (key === 'id') {
            const id = normalizeUserId(value);
            if (id) {
                patch.id = id;
            }
            continue;
        }
        if (key === 'stateBucket') {
            const stateBucket = normalizeStateBucket(value);
            if (stateBucket) {
                patch.stateBucket = stateBucket;
            }
            continue;
        }
        if (key === 'friendNumber') {
            const friendNumber = Number.parseInt(String(value ?? ''), 10);
            if (Number.isFinite(friendNumber) && friendNumber > 0) {
                patch.friendNumber = friendNumber;
            }
            continue;
        }
        if (key === 'tags') {
            if (Array.isArray(value)) {
                patch.tags = value;
            }
            continue;
        }
        if (isPresent(value)) {
            (patch as Record<string, unknown>)[key] = value;
        }
    }
    return patch;
}

function valuesMatch(left: unknown, right: unknown): boolean {
    if (Array.isArray(left) || Array.isArray(right)) {
        return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
    }
    return left === right;
}

function mergeUserFact(
    existing: UserFact | null | undefined,
    input: Record<string, unknown>,
    {
        endpoint = existing?.endpoint || '',
        source = 'seed',
        receivedAt = new Date().toISOString(),
        isCurrentUser = false,
        isFriend = false,
        stateBucket
    }: UserFactMergeOptions = {}
): UserFact {
    const patch = normalizeFactPatch(input);
    const id = normalizeUserId(patch.id || existing?.id);
    const normalizedEndpoint = normalizeEndpoint(endpoint || existing?.endpoint);
    const normalizedStateBucket = normalizeStateBucket(
        stateBucket || patch.stateBucket
    );
    const next: UserFact = existing
        ? {
              ...existing,
              fieldRanks: { ...existing.fieldRanks },
              fieldSources: { ...existing.fieldSources }
          }
        : {
              id,
              endpoint: normalizedEndpoint,
              updatedAt: normalizeText(receivedAt) || new Date().toISOString(),
              fieldRanks: {},
              fieldSources: {}
          };
    let changed = !existing;

    if (id && next.id !== id) {
        next.id = id;
        changed = true;
    }
    if (normalizedEndpoint && next.endpoint !== normalizedEndpoint) {
        next.endpoint = normalizedEndpoint;
        changed = true;
    }
    if (isCurrentUser && !next.isCurrentUser) {
        next.isCurrentUser = true;
        changed = true;
    }
    if (isFriend && !next.isFriend) {
        next.isFriend = true;
        changed = true;
    }
    if (normalizedStateBucket) {
        patch.stateBucket = normalizedStateBucket;
    }

    for (const [field, value] of Object.entries(patch)) {
        if (field === 'id' || !isPresent(value)) {
            continue;
        }
        const rank = rankForField(field, source);
        const existingRank = next.fieldRanks[field] ?? 0;
        if (rank < existingRank) {
            continue;
        }
        const nextRecord = next as unknown as Record<string, unknown>;
        if (!valuesMatch(nextRecord[field], value)) {
            nextRecord[field] = value;
            changed = true;
        }
        if (next.fieldRanks[field] !== rank) {
            next.fieldRanks[field] = rank;
            next.fieldSources[field] = source;
            changed = true;
        }
    }

    const updatedAt = normalizeText(receivedAt) || new Date().toISOString();
    if (changed && next.updatedAt !== updatedAt) {
        next.updatedAt = updatedAt;
    }
    return changed ? next : (existing as UserFact);
}

export {
    mergeUserFact,
    normalizeEndpoint,
    normalizeStateBucket,
    normalizeUserId,
    userFactKey
};
export type { UserFact, UserFactMergeOptions, UserFactSource, UserStateBucket };
