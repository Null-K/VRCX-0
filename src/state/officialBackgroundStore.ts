import { create } from 'zustand';

import type {
    OfficialBackgroundProviderId,
    OfficialBackgroundSnapshot
} from '@/services/official-background-providers/officialBackgroundProviderTypes';

interface OfficialBackgroundStore {
    enabled: boolean;
    providerId: OfficialBackgroundProviderId;
    snapshot: OfficialBackgroundSnapshot | null;
    loading: boolean;
    error: string | null;
    hydrate(options: {
        enabled: boolean;
        providerId: OfficialBackgroundProviderId;
        snapshot: OfficialBackgroundSnapshot | null;
    }): void;
    setStateSnapshot(options: {
        enabled: boolean;
        providerId: OfficialBackgroundProviderId;
        snapshot: OfficialBackgroundSnapshot | null;
    }): void;
    setLoading(loading: boolean): void;
    setError(error: string | null): void;
}

export const useOfficialBackgroundStore = create<OfficialBackgroundStore>(
    (set: any) => ({
        enabled: false,
        providerId: 'nasa-epic',
        snapshot: null,
        loading: false,
        error: null,
        hydrate({ enabled, providerId, snapshot }) {
            set({
                enabled: Boolean(enabled),
                providerId,
                snapshot
            });
        },
        setStateSnapshot({ enabled, providerId, snapshot }) {
            set({
                enabled: Boolean(enabled),
                providerId,
                snapshot
            });
        },
        setLoading(loading) {
            set({ loading: Boolean(loading) });
        },
        setError(error) {
            set({ error });
        }
    })
);
