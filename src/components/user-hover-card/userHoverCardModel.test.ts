import { describe, expect, it } from 'vitest';

import {
    buildUserHoverCardModel,
    normalizeInstanceCounts
} from './userHoverCardModel';

const NOW = 1_700_000_600_000;
const REAL_INSTANCE = 'wrld_12345678-1234-1234-1234-123456789012:99999';

describe('buildUserHoverCardModel', () => {
    it('marks a friend in a real instance and exposes the join epoch', () => {
        const model = buildUserHoverCardModel({
            seed: {
                id: 'usr_1',
                displayName: 'Alice',
                stateBucket: 'online',
                status: 'join me',
                location: REAL_INSTANCE,
                $location_at: 1_700_000_000_000
            },
            profile: null,
            nowMs: NOW
        });

        expect(model.variant).toBe('in-instance');
        expect(model.statusKey).toBe('join_me');
        expect(model.displayName).toBe('Alice');
        expect(model.location.isRealInstance).toBe(true);
        expect(model.location.worldId).toBe(
            'wrld_12345678-1234-1234-1234-123456789012'
        );
        expect(model.location.instanceId).toBe('99999');
        expect(model.instanceEpoch).toBe(1_700_000_000_000);
    });

    it('treats an online friend in a private world as the private variant', () => {
        const model = buildUserHoverCardModel({
            seed: {
                id: 'usr_2',
                stateBucket: 'online',
                status: 'active',
                location: 'private'
            },
            profile: null,
            nowMs: NOW
        });

        expect(model.variant).toBe('private');
        expect(model.instanceEpoch).toBe(0);
        expect(model.statusKey).toBe('online');
    });

    it('uses the active variant when online with no resolvable instance', () => {
        const seed = {
            id: 'usr_3',
            stateBucket: 'active',
            status: 'active',
            location: ''
        };
        const model = buildUserHoverCardModel({
            seed,
            profile: null,
            nowMs: NOW
        });

        expect(model.variant).toBe('active');
        expect(model.statusKey).toBe('active');
        expect(model.statusDotClassName).toBe(
            'border-[var(--status-online)] bg-background'
        );
        expect(model.instanceEpoch).toBe(0);
    });

    it('computes last-online for offline friends and hides online duration', () => {
        const model = buildUserHoverCardModel({
            seed: {
                id: 'usr_4',
                stateBucket: 'offline',
                location: 'offline',
                last_login: 1_699_999_000_000
            },
            profile: { status: 'active', last_login: 1_699_999_000_000 },
            nowMs: NOW
        });

        expect(model.variant).toBe('offline');
        expect(model.statusKey).toBe('');
        expect(model.statusDotClassName).toBe('bg-[var(--status-offline)]');
        expect(model.lastOnlineAgoMs).toBe(NOW - 1_699_999_000_000);
        expect(model.onlineForMs).toBe(0);
    });

    it('falls back to profile-only when there is no presence seed', () => {
        const model = buildUserHoverCardModel({
            seed: null,
            profile: { id: 'usr_5', displayName: 'Cara', status: 'busy' },
            nowMs: NOW
        });

        expect(model.variant).toBe('profile-only');
        expect(model.statusKey).toBe('');
        expect(model.statusDotClassName).toBe('');
        expect(model.onlineForMs).toBe(0);
    });

    it('estimates online duration from last_login while fully online', () => {
        const model = buildUserHoverCardModel({
            seed: {
                id: 'usr_6',
                stateBucket: 'online',
                status: 'active',
                location: REAL_INSTANCE,
                last_login: 1_700_000_000_000
            },
            profile: null,
            nowMs: NOW
        });

        expect(model.onlineForMs).toBe(NOW - 1_700_000_000_000);
    });
});

describe('normalizeInstanceCounts', () => {
    it('reads occupant and capacity counts', () => {
        expect(normalizeInstanceCounts({ n_users: 18, capacity: 40 })).toEqual({
            nUsers: 18,
            capacity: 40
        });
    });

    it('defaults capacity to 0 when only occupants are known', () => {
        expect(normalizeInstanceCounts({ n_users: 5 })).toEqual({
            nUsers: 5,
            capacity: 0
        });
    });

    it('returns null when occupant count is missing', () => {
        expect(normalizeInstanceCounts({})).toBeNull();
        expect(normalizeInstanceCounts(null)).toBeNull();
    });
});
