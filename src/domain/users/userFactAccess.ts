import { useUserFactsStore } from '@/state/userFactsStore.js';

import {
    normalizeEndpoint,
    normalizeUserId,
    userFactKey,
    type UserFact,
    type UserFactMergeOptions
} from './userFacts.js';

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
}

function userIdFromRecord(source: Record<string, unknown>): string {
    return normalizeUserId(
        source.id ||
            source.userId ||
            source.user_id ||
            source.targetUserId ||
            source.target_user_id
    );
}

function getKnownUserFact(endpoint: unknown, userId: unknown): UserFact | null {
    const key = userFactKey(endpoint, userId);
    return key ? useUserFactsStore.getState().usersByKey[key] || null : null;
}

function recordUserProfile(
    profile: Record<string, unknown> | null | undefined,
    options: UserFactMergeOptions = {}
): UserFact | null {
    const source = asRecord(profile);
    if (!source) {
        return null;
    }

    const id = userIdFromRecord(source);
    if (!id) {
        return null;
    }

    const endpoint = normalizeEndpoint(options.endpoint);
    useUserFactsStore.getState().upsertUserFact(
        {
            ...source,
            id
        },
        {
            source: 'profile',
            ...options,
            endpoint
        }
    );

    return getKnownUserFact(endpoint, id);
}

function recordUserProfiles(
    profiles: Array<Record<string, unknown> | null | undefined>,
    options: UserFactMergeOptions = {}
): void {
    for (const profile of Array.isArray(profiles) ? profiles : []) {
        recordUserProfile(profile, options);
    }
}

export {
    getKnownUserFact,
    normalizeEndpoint,
    normalizeUserId,
    recordUserProfile,
    recordUserProfiles,
    userFactKey
};
