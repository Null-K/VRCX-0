import { beforeEach, describe, expect, it } from 'vitest';

import { useUserFactsStore } from './userFactsStore';

function rustUser(overrides: Record<string, unknown> = {}) {
    return {
        id: 'usr_test',
        endpoint: 'api',
        displayName: 'Mirror User',
        stateBucket: 'online',
        location: 'wrld_live:123',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides
    };
}

describe('userFactsStore', () => {
    beforeEach(() => {
        useUserFactsStore.getState().resetUserFacts();
    });

    it('mirrors Rust user objects verbatim, bumps version, and tracks ids by endpoint', () => {
        const store = useUserFactsStore.getState();
        const user = rustUser();

        store.replaceUserFacts([user]);

        const state = useUserFactsStore.getState();
        expect(state.usersByKey['api::usr_test']).toBe(user);
        expect(state.version).toBe(1);
        expect(state.userIdsByEndpoint.api).toEqual(['usr_test']);

        const replacement = rustUser({ displayName: 'Mirror User v2' });
        store.replaceUserFacts([replacement]);

        const nextState = useUserFactsStore.getState();
        expect(nextState.usersByKey['api::usr_test']).toBe(replacement);
        expect(nextState.version).toBe(2);
    });

    it('ignores empty arrays and skips entries without an id', () => {
        const store = useUserFactsStore.getState();

        store.replaceUserFacts([]);
        expect(useUserFactsStore.getState().version).toBe(0);
        expect(useUserFactsStore.getState().usersByKey).toEqual({});

        store.replaceUserFacts([
            rustUser(),
            { endpoint: 'api', displayName: 'No Id' } as any
        ]);

        const state = useUserFactsStore.getState();
        expect(state.version).toBe(1);
        expect(Object.keys(state.usersByKey)).toEqual(['api::usr_test']);
        expect(state.userIdsByEndpoint.api).toEqual(['usr_test']);
    });

    it('resets user facts on auth boundary changes', () => {
        useUserFactsStore.getState().replaceUserFacts([rustUser()]);

        useUserFactsStore.getState().resetUserFacts();

        expect(useUserFactsStore.getState().usersByKey).toEqual({});
        expect(useUserFactsStore.getState().userIdsByEndpoint).toEqual({});
    });
});
