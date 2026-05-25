import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    recordFriendPatch: vi.fn(),
    recordFriendRosterFacts: vi.fn()
}));

vi.mock('./domainIngestionService', () => ({
    recordFriendPatch: serviceMocks.recordFriendPatch,
    recordFriendRosterFacts: serviceMocks.recordFriendRosterFacts
}));

describe('friendBootstrapService snapshot state sync', () => {
    beforeEach(async () => {
        vi.clearAllMocks();

        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');

        useFriendRosterStore.getState().resetRoster();
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test',
            currentUserSnapshot: {
                id: 'usr_self'
            }
        });
    });

    it('uses a complete current-user bucket snapshot as roster state authority', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { syncFriendRosterStateFromCurrentUserSnapshot } = await import(
            './friendBootstrapService'
        );

        useFriendRosterStore.getState().applyFriendPatches([
            {
                userId: 'usr_friend',
                stateBucket: 'online',
                patch: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    state: 'online',
                    location: 'wrld_live:123'
                }
            }
        ]);

        syncFriendRosterStateFromCurrentUserSnapshot(
            {
                id: 'usr_self',
                friends: ['usr_friend'],
                offlineFriends: ['usr_friend'],
                activeFriends: [],
                onlineFriends: []
            },
            'snapshot refresh'
        );

        const state = useFriendRosterStore.getState();
        expect(state.onlineIds).toEqual([]);
        expect(state.offlineIds).toEqual(['usr_friend']);
        expect(state.friendsById.usr_friend).toMatchObject({
            state: 'offline',
            stateBucket: 'offline',
            location: 'wrld_live:123'
        });
        expect(serviceMocks.recordFriendPatch).toHaveBeenLastCalledWith(
            expect.objectContaining({
                userId: 'usr_friend',
                stateBucket: 'offline',
                patch: expect.objectContaining({
                    state: 'offline'
                })
            })
        );
    });

    it('ignores partial current-user bucket snapshots', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { syncFriendRosterStateFromCurrentUserSnapshot } = await import(
            './friendBootstrapService'
        );

        useFriendRosterStore.getState().applyFriendPatches([
            {
                userId: 'usr_friend',
                stateBucket: 'online',
                patch: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    state: 'online'
                }
            }
        ]);

        const synced = syncFriendRosterStateFromCurrentUserSnapshot(
            {
                id: 'usr_self',
                friends: ['usr_friend']
            },
            'partial snapshot refresh'
        );

        const state = useFriendRosterStore.getState();
        expect(synced).toBe(false);
        expect(state.onlineIds).toEqual(['usr_friend']);
        expect(state.offlineIds).toEqual([]);
        expect(serviceMocks.recordFriendPatch).not.toHaveBeenCalled();
    });
});
