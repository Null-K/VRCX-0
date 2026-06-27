import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type FriendRosterStoreState = {
    friendsById: Record<string, Record<string, unknown>>;
};
type RuntimeStoreState = {
    auth: { currentUserEndpoint: string };
};
type PreferencesStoreState = {
    trustColor: boolean;
};
type ProbeProps = {
    userId: string;
    seed?: Record<string, unknown> | null;
};

const storeMocks = vi.hoisted(() => ({
    friendRosterState: {
        friendsById: {}
    } as FriendRosterStoreState
}));

vi.mock('@tanstack/react-query', () => ({
    QueryClient: class QueryClient {
        constructor() {}
    },
    useQuery: () => ({ data: null })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: Object.assign(
        <T,>(selector: (state: RuntimeStoreState) => T): T =>
            selector({
                auth: { currentUserEndpoint: 'https://api.vrchat.cloud' }
            }),
        {
            getState: () => ({
                auth: { currentUserEndpoint: 'https://api.vrchat.cloud' }
            })
        }
    )
}));

vi.mock('@/state/preferencesStore', () => ({
    usePreferencesStore: <T,>(
        selector: (state: PreferencesStoreState) => T
    ): T => selector({ trustColor: false })
}));

vi.mock('@/state/shellStore', () => ({
    useShellStore: {
        getState: () => ({ displayVRCPlusIconsAsAvatar: false })
    }
}));

vi.mock('@/state/friendRosterStore', () => ({
    useFriendRosterStore: Object.assign(
        <T,>(selector: (state: FriendRosterStoreState) => T): T =>
            selector(storeMocks.friendRosterState),
        {
            getState: () => storeMocks.friendRosterState,
            subscribe: () => () => {}
        }
    )
}));

import { useUserHoverCardData } from './useUserHoverCardData';

function Probe({ userId, seed = null }: ProbeProps) {
    const { model } = useUserHoverCardData({ userId, seed });
    return (
        <div
            data-variant={model.variant}
            data-status-dot={model.statusDotClassName}
        />
    );
}

describe('useUserHoverCardData', () => {
    beforeEach(() => {
        storeMocks.friendRosterState = {
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Alice',
                    state: 'offline',
                    stateBucket: 'offline',
                    location: 'offline'
                }
            }
        };
    });

    it('falls back to the friend roster seed when only userId is supplied', () => {
        const html = renderToStaticMarkup(<Probe userId="usr_friend" />);

        expect(html).toContain('data-variant="offline"');
        expect(html).toContain('data-status-dot="bg-[var(--status-offline)]"');
    });
});
