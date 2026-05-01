import { beforeEach, describe, expect, it, vi } from 'vitest';

import sqliteRepository from './sqliteRepository.js';
import { getCurrentInstanceSnapshot } from './playerListRepository.js';

vi.mock('./sqliteRepository.js', () => ({
    default: {
        all: vi.fn()
    }
}));

describe('playerListRepository', () => {
    beforeEach(() => {
        vi.mocked(sqliteRepository.all).mockReset();
    });

    it('does not include join rows from earlier visits to the same instance', async () => {
        vi.mocked(sqliteRepository.all)
            .mockResolvedValueOnce([
                {
                    created_at: '2026-04-30T10:00:00.000Z',
                    location: 'wrld_live:123',
                    world_id: 'wrld_live',
                    world_name: 'Live World',
                    time: 0,
                    group_name: ''
                }
            ])
            .mockResolvedValueOnce([
                {
                    id: '1',
                    created_at: '2026-01-01T10:00:00.000Z',
                    type: 'OnPlayerJoined',
                    display_name: 'Old Player',
                    user_id: 'usr_old',
                    time: 0
                },
                {
                    id: '2',
                    created_at: '2026-04-30T10:01:00.000Z',
                    type: 'OnPlayerJoined',
                    display_name: 'Current Player',
                    user_id: 'usr_current',
                    time: 0
                }
            ]);

        await expect(
            getCurrentInstanceSnapshot({
                currentLocation: 'wrld_live:123'
            })
        ).resolves.toMatchObject({
            players: [
                {
                    userId: 'usr_current',
                    displayName: 'Current Player'
                }
            ]
        });
    });

    it('uses the runtime location start time over stale database location rows', async () => {
        vi.mocked(sqliteRepository.all)
            .mockResolvedValueOnce([
                {
                    created_at: '2026-01-01T10:00:00.000Z',
                    location: 'wrld_live:123',
                    world_id: 'wrld_live',
                    world_name: 'Live World',
                    time: 0,
                    group_name: ''
                }
            ])
            .mockResolvedValueOnce([
                {
                    id: '1',
                    created_at: '2026-01-01T10:01:00.000Z',
                    type: 'OnPlayerJoined',
                    display_name: 'Old Player',
                    user_id: 'usr_old',
                    time: 0
                },
                {
                    id: '2',
                    created_at: '2026-04-30T10:01:00.000Z',
                    type: 'OnPlayerJoined',
                    display_name: 'Current Player',
                    user_id: 'usr_current',
                    time: 0
                }
            ]);

        const snapshot = await getCurrentInstanceSnapshot({
            currentLocation: 'wrld_live:123',
            currentLocationStartedAt: '2026-04-30T10:00:00.000Z'
        });

        expect(snapshot.context.createdAt).toBe('2026-04-30T10:00:00.000Z');
        expect(snapshot.players).toEqual([
            expect.objectContaining({
                userId: 'usr_current',
                displayName: 'Current Player'
            })
        ]);
    });
});
