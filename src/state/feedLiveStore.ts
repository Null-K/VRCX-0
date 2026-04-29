import { create } from 'zustand';

interface FeedLiveEntry {
    sequence: number;
    ownerUserId: string;
    entry: Record<string, unknown>;
}

interface FeedLiveStoreState {
    version: number;
    entries: FeedLiveEntry[];
    pushEntry: (
        entry: Record<string, unknown> | null | undefined,
        options?: { ownerUserId?: string }
    ) => void;
    resetFeedLive: () => void;
}

const initialState: Pick<FeedLiveStoreState, 'version' | 'entries'> = {
    version: 0,
    entries: []
};

export const useFeedLiveStore = create<FeedLiveStoreState>((set) => ({
    ...initialState,
    pushEntry(entry, { ownerUserId = '' } = {}) {
        if (!entry || typeof entry !== 'object') {
            return;
        }
        set((state) => ({
            version: state.version + 1,
            entries: [
                ...state.entries,
                {
                    sequence: state.version + 1,
                    ownerUserId,
                    entry: { ...entry, ownerUserId }
                }
            ].slice(-100)
        }));
    },
    resetFeedLive() {
        set(initialState);
    }
}));
export type { FeedLiveEntry, FeedLiveStoreState };
