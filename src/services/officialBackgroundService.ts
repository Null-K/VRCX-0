import configRepository from '@/repositories/configRepository';
import {
    communityThemeControlsAppearance,
    useCommunityThemeStore
} from '@/state/communityThemeStore';
import { useOfficialBackgroundStore } from '@/state/officialBackgroundStore';

import type {
    OfficialBackgroundProviderId,
    OfficialBackgroundSnapshot
} from './official-background-providers/officialBackgroundProviderTypes';
import {
    officialImageProviders,
    resolveOfficialBackgroundProvider
} from './official-background-providers/officialImageProviders';
import {
    applyThemeColor,
    resolveThemeColor,
    resolveThemeMode,
    setCommunityThemeAppearanceControl
} from './themeService';
import {
    type VrcxCssLayer,
    setVrcxCssLayer,
    setVrcxCssLayersSuppressed
} from './vrcxCssLayerService';

const OFFICIAL_BACKGROUND_LAYER = 'official-background';
const COMMUNITY_CSS_LAYERS: VrcxCssLayer[] = [
    'installed-theme',
    'local-theme-preview',
    'user-override'
];
const DEFAULT_PROVIDER_ID: OfficialBackgroundProviderId = 'nasa-epic';
let officialBackgroundOperationId = 0;

const CONFIG_KEYS = {
    enabled: 'VRCX_officialBackgroundEnabled',
    providerId: 'VRCX_officialBackgroundProviderId',
    snapshots: 'VRCX_officialBackgroundSnapshots'
};

type SnapshotMap = Partial<
    Record<OfficialBackgroundProviderId, OfficialBackgroundSnapshot>
>;

function normalizeProviderId(value: unknown): OfficialBackgroundProviderId {
    return resolveOfficialBackgroundProvider(value).id;
}

function normalizeSnapshot(
    value: unknown,
    expectedProviderId?: OfficialBackgroundProviderId
): OfficialBackgroundSnapshot | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const entry = value as Record<string, unknown>;
    const providerId = normalizeProviderId(entry.providerId);
    if (expectedProviderId && providerId !== expectedProviderId) {
        return null;
    }
    const imageUrl = String(entry.imageUrl || '').trim();
    if (!imageUrl) {
        return null;
    }

    return {
        providerId,
        imageUrl,
        title: String(entry.title || ''),
        author: String(entry.author || ''),
        license: String(entry.license || ''),
        source: String(entry.source || ''),
        resolvedAt: String(entry.resolvedAt || ''),
        resolvedForDate: String(entry.resolvedForDate || '')
    };
}

function normalizeSnapshots(value: unknown): SnapshotMap {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const snapshots: SnapshotMap = {};
    officialImageProviders.forEach((provider) => {
        const snapshot = normalizeSnapshot(
            (value as Record<string, unknown>)[provider.id],
            provider.id
        );
        if (snapshot) {
            snapshots[provider.id] = snapshot;
        }
    });
    return snapshots;
}

function isSnapshotFresh(snapshot: OfficialBackgroundSnapshot | null): boolean {
    if (!snapshot?.resolvedAt) {
        return false;
    }

    const provider = resolveOfficialBackgroundProvider(snapshot.providerId);
    const resolvedAt = Date.parse(snapshot.resolvedAt);
    if (!Number.isFinite(resolvedAt)) {
        return false;
    }

    const ageMs = Date.now() - resolvedAt;
    return ageMs >= 0 && ageMs < provider.cacheTtlHours * 60 * 60 * 1000;
}

function toCssString(value: string): string {
    return `"${String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\A ')}"`;
}

function buildOfficialBackgroundCss(
    snapshot: OfficialBackgroundSnapshot
): string {
    return `:root {
  --vrcx-0-wallpaper-image: url(${toCssString(snapshot.imageUrl)});
  --vrcx-0-wallpaper-size: cover;
  --vrcx-0-wallpaper-position: center;
  --vrcx-0-wallpaper-repeat: no-repeat;
  --vrcx-0-wallpaper-opacity: 1;
  --vrcx-0-wallpaper-filter: saturate(1.08) contrast(0.96);
  --vrcx-0-app-surface: transparent;
  --vrcx-0-titlebar-surface: color-mix(in oklch, var(--background) 44%, transparent);
  --vrcx-0-main-surface: transparent;
  --vrcx-0-main-content-surface: color-mix(in oklch, var(--background) 24%, transparent);
  --vrcx-0-sidebar-surface: color-mix(in oklch, var(--sidebar) 46%, transparent);
  --vrcx-0-sidebar-inset-surface: color-mix(in oklch, var(--background) 26%, transparent);
  --vrcx-0-side-panel-surface: color-mix(in oklch, var(--background) 44%, transparent);
  --vrcx-0-statusbar-surface: color-mix(in oklch, var(--background) 42%, transparent);
  --vrcx-0-table-surface: color-mix(in oklch, var(--background) 52%, transparent);
  --vrcx-0-table-header-surface: color-mix(in oklch, var(--background) 58%, transparent);
}

[data-slot='dialog-content'],
[data-slot='popover-content'] {
  background: color-mix(in oklch, var(--popover) 68%, transparent);
  backdrop-filter: blur(18px) saturate(1.05);
}

[data-slot='dialog-footer'],
[data-slot='card-footer'] {
  background: color-mix(in oklch, var(--muted) 44%, transparent);
}

[data-slot='card'] {
  background: color-mix(in oklch, var(--card) 58%, transparent);
  backdrop-filter: blur(14px) saturate(1.03);
}
`;
}

function beginOfficialBackgroundOperation(): number {
    officialBackgroundOperationId += 1;
    return officialBackgroundOperationId;
}

function isCurrentOfficialBackgroundOperation(operationId: number): boolean {
    return operationId === officialBackgroundOperationId;
}

async function applySavedThemeMode(): Promise<void> {
    const savedThemeMode = await configRepository.getString('ThemeMode', 'system');
    await setCommunityThemeAppearanceControl(false, resolveThemeMode(savedThemeMode));
}

async function applySavedThemeColor(): Promise<void> {
    const savedThemeColor = await configRepository.getString(
        'VRCX_themeColor',
        'default'
    );
    applyThemeColor(resolveThemeColor(savedThemeColor));
}

function isCommunityAppearanceActive(): boolean {
    const state = useCommunityThemeStore.getState();
    return communityThemeControlsAppearance(
        state.enabled,
        state.installedTheme,
        state.localPreview
    );
}

async function syncOfficialBackgroundAppearance(
    restoreAppTheme = true
): Promise<void> {
    const state = useOfficialBackgroundStore.getState();
    const suppressCommunityLayers = Boolean(state.enabled);
    const shouldApply = Boolean(state.enabled && state.snapshot);
    setVrcxCssLayer(
        OFFICIAL_BACKGROUND_LAYER,
        shouldApply && state.snapshot
            ? buildOfficialBackgroundCss(state.snapshot)
            : ''
    );
    setVrcxCssLayersSuppressed(
        COMMUNITY_CSS_LAYERS,
        suppressCommunityLayers
    );

    if (shouldApply) {
        await setCommunityThemeAppearanceControl(true);
        return;
    }

    if (restoreAppTheme && !isCommunityAppearanceActive()) {
        await applySavedThemeMode();
        await applySavedThemeColor();
    }
}

async function loadSnapshots(): Promise<SnapshotMap> {
    return normalizeSnapshots(
        await configRepository.getObject(CONFIG_KEYS.snapshots, null)
    );
}

async function persistSnapshot(
    snapshot: OfficialBackgroundSnapshot
): Promise<void> {
    const snapshots = await loadSnapshots();
    snapshots[snapshot.providerId] = snapshot;
    await configRepository.setObject(CONFIG_KEYS.snapshots, snapshots);
}

async function resolveProviderSnapshot(
    providerId: OfficialBackgroundProviderId,
    forceRefresh = false
): Promise<OfficialBackgroundSnapshot | null> {
    const snapshots = await loadSnapshots();
    const cached = snapshots[providerId] ?? null;
    if (!forceRefresh && isSnapshotFresh(cached)) {
        return cached;
    }

    try {
        const provider = resolveOfficialBackgroundProvider(providerId);
        const snapshot = await provider.resolveSnapshot();
        await persistSnapshot(snapshot);
        return snapshot;
    } catch (error) {
        if (cached) {
            console.warn(
                'Unable to refresh Daily Background; using cached snapshot.',
                error
            );
            return cached;
        }
        throw error;
    }
}

export async function initializeOfficialBackgrounds(): Promise<void> {
    const enabled = await configRepository.getBool(CONFIG_KEYS.enabled, false);
    const providerId = normalizeProviderId(
        await configRepository.getString(CONFIG_KEYS.providerId, DEFAULT_PROVIDER_ID)
    );
    const snapshots = await loadSnapshots();
    const snapshot = enabled
        ? await resolveProviderSnapshot(providerId).catch((error) => {
              console.warn('Unable to initialize Daily Background:', error);
              return snapshots[providerId] ?? null;
          })
        : (snapshots[providerId] ?? null);

    const nextEnabled = Boolean(
        enabled && snapshot && !isCommunityAppearanceActive()
    );
    useOfficialBackgroundStore.getState().hydrate({
        enabled: nextEnabled,
        providerId,
        snapshot
    });
    if (enabled !== nextEnabled) {
        await configRepository.setBool(CONFIG_KEYS.enabled, nextEnabled);
    }
    await syncOfficialBackgroundAppearance(false);
}

export async function setOfficialBackgroundProvider(
    providerIdInput: unknown
): Promise<void> {
    const providerId = normalizeProviderId(providerIdInput);
    await configRepository.setString(CONFIG_KEYS.providerId, providerId);
    const state = useOfficialBackgroundStore.getState();
    const snapshots = await loadSnapshots();
    useOfficialBackgroundStore.getState().setStateSnapshot({
        enabled: state.enabled,
        providerId,
        snapshot:
            state.snapshot?.providerId === providerId
                ? state.snapshot
                : (snapshots[providerId] ?? null)
    });
    if (state.enabled) {
        await enableOfficialBackground(providerId);
    } else {
        await syncOfficialBackgroundAppearance();
    }
}

export async function enableOfficialBackground(
    providerIdInput?: unknown
): Promise<boolean> {
    const operationId = beginOfficialBackgroundOperation();
    const providerId = normalizeProviderId(
        providerIdInput || useOfficialBackgroundStore.getState().providerId
    );
    const store = useOfficialBackgroundStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
        const snapshot = await resolveProviderSnapshot(providerId);
        if (!isCurrentOfficialBackgroundOperation(operationId)) {
            return false;
        }
        const enabled = Boolean(snapshot);
        await configRepository.setString(CONFIG_KEYS.providerId, providerId);
        await configRepository.setBool(CONFIG_KEYS.enabled, enabled);
        useOfficialBackgroundStore.getState().setStateSnapshot({
            enabled,
            providerId,
            snapshot
        });
        await syncOfficialBackgroundAppearance();
        return true;
    } catch (error) {
        if (!isCurrentOfficialBackgroundOperation(operationId)) {
            return false;
        }
        const message =
            error instanceof Error
                ? error.message
                : 'Failed to enable Daily Background.';
        store.setError(message);
        throw error;
    } finally {
        if (isCurrentOfficialBackgroundOperation(operationId)) {
            store.setLoading(false);
        }
    }
}

export async function disableOfficialBackground({
    restoreAppTheme = true
}: {
    restoreAppTheme?: boolean;
} = {}): Promise<void> {
    beginOfficialBackgroundOperation();
    const state = useOfficialBackgroundStore.getState();
    await configRepository.setBool(CONFIG_KEYS.enabled, false);
    useOfficialBackgroundStore.getState().setStateSnapshot({
        enabled: false,
        providerId: state.providerId,
        snapshot: state.snapshot
    });
    await syncOfficialBackgroundAppearance(restoreAppTheme);
    useOfficialBackgroundStore.getState().setLoading(false);
}

export async function refreshOfficialBackground(): Promise<boolean> {
    const operationId = beginOfficialBackgroundOperation();
    const state = useOfficialBackgroundStore.getState();
    const store = useOfficialBackgroundStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
        const snapshot = await resolveProviderSnapshot(state.providerId, true);
        if (!isCurrentOfficialBackgroundOperation(operationId)) {
            return false;
        }
        await configRepository.setBool(CONFIG_KEYS.enabled, Boolean(snapshot));
        useOfficialBackgroundStore.getState().setStateSnapshot({
            enabled: Boolean(snapshot),
            providerId: state.providerId,
            snapshot
        });
        await syncOfficialBackgroundAppearance();
        return true;
    } catch (error) {
        if (!isCurrentOfficialBackgroundOperation(operationId)) {
            return false;
        }
        const message =
            error instanceof Error
                ? error.message
                : 'Failed to refresh Daily Background.';
        store.setError(message);
        throw error;
    } finally {
        if (isCurrentOfficialBackgroundOperation(operationId)) {
            store.setLoading(false);
        }
    }
}

export async function migrateLegacyNasaApodCommunityTheme(): Promise<void> {
    const snapshot = useOfficialBackgroundStore.getState().snapshot;
    await configRepository.setString(
        CONFIG_KEYS.providerId,
        'nasa-apod-safe'
    );
    await configRepository.setBool(CONFIG_KEYS.enabled, true);
    useOfficialBackgroundStore.getState().setStateSnapshot({
        enabled: true,
        providerId: 'nasa-apod-safe',
        snapshot: snapshot?.providerId === 'nasa-apod-safe' ? snapshot : null
    });
}

export function isOfficialBackgroundActive(): boolean {
    return useOfficialBackgroundStore.getState().enabled;
}

export function getOfficialBackgroundProviderLabel(
    providerId: OfficialBackgroundProviderId
): string {
    return resolveOfficialBackgroundProvider(providerId).name;
}

export { officialImageProviders };
