import { commands } from '@/platform/tauri/bindings';
import type { RegistryBackupMaintenanceResult } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import { clearFavoriteRemoteDetailsCache } from '@/services/favoriteRemoteDetailsCacheService';
import { isHostCapabilityAvailable } from '@/services/hostCapabilityService';
import i18n from '@/services/i18nService';
import {
    canInstallUpdatesOnPlatform,
    checkInstallableUpdate,
    defaultBranchForVersion,
    fetchLatestBranchRelease,
    formatReleaseDisplayVersion,
    hasUpdateForBranch,
    sanitizeBranch,
    type InstallableUpdateRelease,
    type NormalizedRelease
} from '@/services/updateService';
import { useModalStore } from '@/state/modalStore';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { buildAvatarWearSnapshotUpdate } from './avatarWearTimeService';
import { recordCurrentUserSnapshot } from './domainIngestionService';
import { bootstrapFavorites } from './favoriteBootstrapService';
import { bootstrapFriendRoster } from './friendBootstrapService';
import { refreshModerationSync } from './moderationSyncService';
import { resetPresenceAutomationExecutor } from './presence-automation/index';
import {
    recordRuntimeJobTelemetry,
    runRuntimeTelemetryJob
} from './runtimeJobTelemetryService';

// 3hr
const APP_UPDATE_CHECK_INTERVAL_SECONDS = 3 * 3600;

let running = false;

type RuntimeAuthSnapshot = {
    currentUserId: string | null;
    currentUserEndpoint: string;
    currentUserWebsocket: string;
    currentUserSnapshot: Record<string, unknown> | null;
};

type RuntimeAuthTarget = {
    currentUserId: string;
    currentUserEndpoint: string;
    currentUserWebsocket: string;
};

type CurrentUserRefreshRecord = {
    target: RuntimeAuthTarget;
    overlayPatch: Record<string, unknown> | null;
    promise: Promise<Record<string, unknown> | null>;
};

type RefreshCurrentUserOptions = {
    expectedUserId?: unknown;
    expectedEndpoint?: unknown;
    expectedWebsocket?: unknown;
    overlayPatch?: unknown;
};

type RefreshPlayerModerationsOptions = {
    isCurrent?: (() => boolean) | null;
};

type AppUpdateCheckOptions = {
    includeRegistryBackup?: boolean;
};

type RuntimeScheduledTask = () => Promise<unknown>;

type UpdaterReleaseSnapshotSource =
    | NormalizedRelease
    | InstallableUpdateRelease
    | null;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function resetTimers() {
    commands.appRuntimeFrontendScheduleSchedulesReset()
        .catch((error: unknown) => {
            console.warn(
                'Failed to reset runtime maintenance scheduler:',
                error
            );
        });
}

function toUpdaterReleaseSnapshot(release: UpdaterReleaseSnapshotSource) {
    if (!release) {
        return null;
    }
    return {
        title: release.displayName || release.tagName || '',
        currentVersion:
            // oxlint-disable-next-line no-undef
            formatReleaseDisplayVersion(VERSION || '') || String(VERSION || ''),
        latestVersion:
            release.displayVersion ||
            formatReleaseDisplayVersion(release.canonicalVersion) ||
            String(release.tagName || ''),
        publishedAt:
            release.publishedAt ||
            ('date' in release && release.date ? release.date : '')
    };
}

function setUpdaterCheckResult(
    hasAvailableUpdate: boolean,
    detail: string = '',
    release: UpdaterReleaseSnapshotSource = null
) {
    useRuntimeStore.getState().setUpdateLoopState({
        hasAvailableUpdate: Boolean(hasAvailableUpdate),
        lastUpdaterCheckAt: new Date().toISOString(),
        lastUpdaterCheckDetail: detail,
        latestUpdaterRelease: hasAvailableUpdate
            ? toUpdaterReleaseSnapshot(release)
            : null
    });
}

function getRuntimeAuth(): RuntimeAuthSnapshot {
    const runtimeState = useRuntimeStore.getState();
    return {
        currentUserId: runtimeState.auth.currentUserId,
        currentUserEndpoint: runtimeState.auth.currentUserEndpoint,
        currentUserWebsocket: runtimeState.auth.currentUserWebsocket,
        currentUserSnapshot: isRecord(runtimeState.auth.currentUserSnapshot)
            ? runtimeState.auth.currentUserSnapshot
            : null
    };
}

function normalizeRuntimeAuthValue(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function getRuntimeAuthTargetKey(target: RuntimeAuthTarget) {
    return `${target.currentUserEndpoint}\u0000${target.currentUserId}\u0000${target.currentUserWebsocket}`;
}

const currentUserRefreshes = new Map<string, CurrentUserRefreshRecord>();
const CURRENT_USER_LOCAL_AUTHORITY_FIELDS = [
    'friends',
    'onlineFriends',
    'activeFriends',
    'offlineFriends',
    'status',
    'statusDescription',
    'state',
    'stateBucket',
    'pendingOffline',
    'location',
    '$location',
    '$location_at',
    'locationUpdatedAt',
    'worldId',
    'instanceId',
    'travelingToLocation',
    'travelingToWorld',
    'travelingToInstance',
    '$travelingToLocation',
    '$travelingToTime',
    'travelingToTime',
    '$previousLocation',
    '$previousLocation_at'
];
const CURRENT_USER_FRIEND_ARRAY_FIELDS = new Set([
    'friends',
    'onlineFriends',
    'activeFriends',
    'offlineFriends'
]);

function mergeCurrentUserRefreshOverlayPatch(
    record: CurrentUserRefreshRecord,
    patch: unknown
) {
    if (!isRecord(patch)) {
        return;
    }

    record.overlayPatch = {
        ...(record.overlayPatch || {}),
        ...patch
    };
}

function areCurrentUserSnapshotValuesEqual(left: unknown, right: unknown) {
    if (Object.is(left, right)) {
        return true;
    }

    if (
        (left && typeof left === 'object') ||
        (right && typeof right === 'object')
    ) {
        try {
            return JSON.stringify(left) === JSON.stringify(right);
        } catch {
            return false;
        }
    }

    return false;
}

function hasCurrentUserSnapshotField(source: unknown, field: string) {
    return (
        isRecord(source) &&
        Object.prototype.hasOwnProperty.call(source, field)
    );
}

function mergeCurrentUserRefreshSnapshot({
    responseUser,
    baseSnapshot,
    currentSnapshot,
    overlayPatch
}: {
    responseUser: Record<string, unknown>;
    baseSnapshot: Record<string, unknown> | null;
    currentSnapshot: unknown;
    overlayPatch: Record<string, unknown> | null;
}): Record<string, unknown> {
    const currentSnapshotRecord = isRecord(currentSnapshot)
        ? currentSnapshot
        : null;
    let user: Record<string, unknown> = currentSnapshotRecord
        ? { ...currentSnapshotRecord, ...responseUser }
        : { ...responseUser };

    for (const field of CURRENT_USER_LOCAL_AUTHORITY_FIELDS) {
        if (
            CURRENT_USER_FRIEND_ARRAY_FIELDS.has(field) &&
            hasCurrentUserSnapshotField(responseUser, field)
        ) {
            continue;
        }
        if (hasCurrentUserSnapshotField(currentSnapshot, field)) {
            user[field] = currentSnapshot[field];
        }
    }

    if (
        baseSnapshot &&
        normalizeRuntimeAuthValue(baseSnapshot.id) ===
            normalizeRuntimeAuthValue(currentSnapshotRecord?.id)
    ) {
        const keys = new Set([
            ...Object.keys(baseSnapshot),
            ...Object.keys(currentSnapshotRecord || {})
        ]);
        keys.delete('id');
        for (const key of keys) {
            if (
                CURRENT_USER_FRIEND_ARRAY_FIELDS.has(key) &&
                hasCurrentUserSnapshotField(responseUser, key)
            ) {
                continue;
            }
            if (
                !areCurrentUserSnapshotValuesEqual(
                    baseSnapshot[key],
                    currentSnapshotRecord?.[key]
                )
            ) {
                user[key] = currentSnapshotRecord?.[key];
            }
        }
    }

    if (overlayPatch) {
        user = { ...user, ...overlayPatch };
    }

    return user;
}

export async function refreshCurrentUser({
    expectedUserId = '',
    expectedEndpoint = '',
    expectedWebsocket = '',
    overlayPatch = null
}: RefreshCurrentUserOptions = {}) {
    const initialAuth = getRuntimeAuth();
    const target: RuntimeAuthTarget = {
        currentUserId: normalizeRuntimeAuthValue(
            expectedUserId || initialAuth.currentUserId
        ),
        currentUserEndpoint: normalizeRuntimeAuthValue(
            expectedEndpoint || initialAuth.currentUserEndpoint
        ),
        currentUserWebsocket: normalizeRuntimeAuthValue(
            expectedWebsocket || initialAuth.currentUserWebsocket
        )
    };

    if (!target.currentUserId) {
        return null;
    }

    const key = getRuntimeAuthTargetKey(target);
    const activeRecord = currentUserRefreshes.get(key);
    if (activeRecord) {
        mergeCurrentUserRefreshOverlayPatch(activeRecord, overlayPatch);
        return activeRecord.promise;
    }

    const record: CurrentUserRefreshRecord = {
        target,
        overlayPatch: null,
        promise: Promise.resolve(null)
    };
    mergeCurrentUserRefreshOverlayPatch(record, overlayPatch);
    record.promise = refreshCurrentUserForTarget({
        target,
        record
    }).finally(() => {
        if (currentUserRefreshes.get(key) === record) {
            currentUserRefreshes.delete(key);
        }
    });
    currentUserRefreshes.set(key, record);

    return record.promise;
}

async function refreshCurrentUserForTarget({
    target,
    record
}: {
    target: RuntimeAuthTarget;
    record: CurrentUserRefreshRecord;
}) {
    const {
        currentUserId,
        currentUserEndpoint,
        currentUserWebsocket,
        currentUserSnapshot: baseSnapshot
    } = getRuntimeAuth();
    if (
        target.currentUserEndpoint !==
            normalizeRuntimeAuthValue(currentUserEndpoint) ||
        target.currentUserId !== normalizeRuntimeAuthValue(currentUserId) ||
        target.currentUserWebsocket !==
            normalizeRuntimeAuthValue(currentUserWebsocket)
    ) {
        return null;
    }

    const response = await vrchatAuthRepository.getCurrentUser({
        endpoint: target.currentUserEndpoint
    });
    const responseUser =
        response.json && isRecord(response.json) ? response.json : null;
    if (!responseUser?.id) {
        return null;
    }
    if (normalizeRuntimeAuthValue(responseUser.id) !== target.currentUserId) {
        return null;
    }

    const runtimeStore = useRuntimeStore.getState();
    if (
        normalizeRuntimeAuthValue(runtimeStore.auth.currentUserId) !==
            target.currentUserId ||
        normalizeRuntimeAuthValue(runtimeStore.auth.currentUserEndpoint) !==
            target.currentUserEndpoint ||
        normalizeRuntimeAuthValue(runtimeStore.auth.currentUserWebsocket) !==
            target.currentUserWebsocket
    ) {
        return null;
    }
    const user = mergeCurrentUserRefreshSnapshot({
        responseUser,
        baseSnapshot,
        currentSnapshot: runtimeStore.auth.currentUserSnapshot,
        overlayPatch: record.overlayPatch
    });

    import('./realtimeTransportService')
        .then(({ syncRuntimeRealtimeCurrentUserSnapshot }) =>
            syncRuntimeRealtimeCurrentUserSnapshot(user, record.overlayPatch)
        )
        .catch((error: unknown) => {
            console.warn(
                'Failed to sync current user snapshot to runtime:',
                error
            );
        });

    const { snapshot } = buildAvatarWearSnapshotUpdate({
        previousSnapshot: runtimeStore.auth.currentUserSnapshot,
        nextSnapshot: user,
        isGameRunning: runtimeStore.gameState.isGameRunning
    });
    const nextSnapshot = isRecord(snapshot) ? snapshot : user;

    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: normalizeRuntimeAuthValue(nextSnapshot.id),
        currentUserDisplayName:
            normalizeRuntimeAuthValue(nextSnapshot.displayName) ||
            normalizeRuntimeAuthValue(nextSnapshot.username) ||
            normalizeRuntimeAuthValue(nextSnapshot.id),
        currentUserEndpoint: target.currentUserEndpoint,
        currentUserWebsocket: target.currentUserWebsocket,
        currentUserSnapshot: nextSnapshot
    });
    recordCurrentUserSnapshot(nextSnapshot, {
        endpoint: target.currentUserEndpoint
    });
    return nextSnapshot;
}

async function refreshFriendsAndFavorites() {
    const auth = getRuntimeAuth();
    if (!auth.currentUserId || !auth.currentUserSnapshot) {
        return;
    }

    const results = await Promise.allSettled([
        bootstrapFriendRoster({
            userId: auth.currentUserId,
            endpoint: auth.currentUserEndpoint,
            websocket: auth.currentUserWebsocket,
            currentUserSnapshot: auth.currentUserSnapshot,
            preserveLoadedState: true
        }),
        bootstrapFavorites({
            userId: auth.currentUserId,
            endpoint: auth.currentUserEndpoint,
            currentUserSnapshot: auth.currentUserSnapshot
        })
    ]);
    const failed = results.find(
        (result): result is PromiseRejectedResult =>
            result.status === 'rejected'
    );
    if (failed) {
        throw failed.reason;
    }
}

export async function refreshFriendAndFavoriteSnapshots(
    _options: { syncRealtime?: boolean } = {}
) {
    void _options;
    let refreshError: unknown = null;
    try {
        await refreshFriendsAndFavorites();
    } catch (error) {
        refreshError = error;
    }
    if (refreshError) {
        throw refreshError;
    }
}

export async function refreshPlayerModerations({
    isCurrent = null
}: RefreshPlayerModerationsOptions = {}) {
    const { currentUserId, currentUserEndpoint } = getRuntimeAuth();
    if (!currentUserId) {
        return;
    }

    await refreshModerationSync({
        userId: currentUserId,
        endpoint: currentUserEndpoint
    });

    const latestAuth = getRuntimeAuth();
    if (
        latestAuth.currentUserId !== currentUserId ||
        latestAuth.currentUserEndpoint !== currentUserEndpoint ||
        (typeof isCurrent === 'function' && !isCurrent())
    ) {
        return;
    }
}

async function runClearVrcxCache() {
    const frequency = Number(
        await configRepository.getInt('clearVRCXCacheFrequency', 172800)
    );
    if (!frequency || frequency <= 0) {
        await deferRuntimeScheduledFrontendJob('clearVRCXCacheCheck', 3600);
        return;
    }

    await deferRuntimeScheduledFrontendJob(
        'clearVRCXCacheCheck',
        Math.max(60, Math.floor(frequency / 2))
    );
    const cleared = clearFavoriteRemoteDetailsCache();
    useRuntimeStore.getState().setUpdateLoopState({
        lastCacheCleanupAt: new Date().toISOString(),
        lastCacheCleanupDetail: `Cleared ${cleared.detailCacheCount} remote favorite detail cache entries.`
    });
}

async function runRegistryBackupMaintenance(reason: string) {
    if (!isHostCapabilityAvailable('registryPrefs')) {
        return;
    }

    let result: RegistryBackupMaintenanceResult;
    try {
        result = await commands.appRegistryBackupMaintenanceRun(reason);
    } catch (error) {
        console.warn(
            'Failed to run VRChat registry backup maintenance:',
            error
        );
        return;
    }

    if (!result?.restorePromptNeeded) {
        return;
    }

    await commands.appEnsureMainWindow()
        .catch(() => commands.appFocusWindow().catch(() => {}));
    await useModalStore.getState().alert({
        title: i18n.t(
            'service.background_maintenance.label.vrchat_registry_backup'
        ),
        description: i18n.t(
            'service.background_maintenance.description.registry_backup_restore_description'
        )
    });
    useRuntimeStore.getState().setSystemHostOpen('registryBackupOpen', true);
    await commands.appFocusWindow().catch(() => {});
    if (result.restorePromptBackupDate) {
        await configRepository.setString(
            'VRChatRegistryLastRestoreCheck',
            result.restorePromptBackupDate
        );
    }
}

async function checkForAppUpdate({
    includeRegistryBackup = true
}: AppUpdateCheckOptions = {}) {
    const hostCapabilities = useRuntimeStore.getState().hostCapabilities;
    const hostPlatform = hostCapabilities.platform;
    const hostArch = hostCapabilities.arch;
    const linuxPackageKind = hostCapabilities.linuxPackageKind;
    const canInstallUpdates = canInstallUpdatesOnPlatform(hostPlatform);
    let autoUpdateMode = await configRepository.getString(
        'autoUpdateVRCX',
        'Auto Download'
    );
    if (
        autoUpdateMode === 'Auto Install' ||
        autoUpdateMode === 'Auto Download'
    ) {
        autoUpdateMode = 'Notify';
        await configRepository.setString('autoUpdateVRCX', autoUpdateMode);
    }

    if (autoUpdateMode === 'Off') {
        useRuntimeStore.getState().setUpdateLoopState({
            hasAvailableUpdate: false
        });
    } else {
        try {
            const savedBranch = await configRepository.getString('branch', '');
            const defaultBranch = defaultBranchForVersion(VERSION || '');
            const sanitizedSavedBranch = sanitizeBranch(savedBranch);
            const branch =
                defaultBranch !== 'Stable'
                    ? defaultBranch
                    : savedBranch
                      ? sanitizedSavedBranch
                      : defaultBranch;
            if (branch !== savedBranch) {
                await configRepository.setString('branch', branch);
            }

            if (canInstallUpdates) {
                const update = await checkInstallableUpdate(branch, {
                    hostArch,
                    linuxPackageKind,
                    hostPlatform
                });
                if (update) {
                    const displayVersion = formatReleaseDisplayVersion(
                        update.version
                    );
                    const message = i18n.t(
                        'service.background_maintenance_service.dynamic.version_value_is_available_on_the_value_branch',
                        { value: displayVersion, value2: branch }
                    );
                    useNotificationStore.getState().pushNotification({
                        level: 'info',
                        title: i18n.t(
                            'service.background_maintenance.label.vrcx_update_available'
                        ),
                        message
                    });
                    setUpdaterCheckResult(true, message, update);
                    useRuntimeStore
                        .getState()
                        .setSystemHostOpen('updaterOpen', true);
                } else {
                    setUpdaterCheckResult(false);
                }
            } else {
                const latestRelease = await fetchLatestBranchRelease(branch, {
                    hostArch,
                    linuxPackageKind,
                    hostPlatform,
                    requireInstallerAsset: false
                });
                const hasUpdate =
                    latestRelease &&
                    hasUpdateForBranch(
                        branch,
                        VERSION || '',
                        latestRelease.canonicalVersion
                    );
                if (hasUpdate) {
                    const displayVersion = formatReleaseDisplayVersion(
                        latestRelease.canonicalVersion
                    );
                    const message = i18n.t(
                        'service.background_maintenance_service.dynamic.version_value_is_available_on_the_value_branch',
                        { value: displayVersion, value2: branch }
                    );
                    useNotificationStore.getState().pushNotification({
                        level: 'info',
                        title: i18n.t(
                            'service.background_maintenance.label.vrcx_update_available'
                        ),
                        message
                    });
                    setUpdaterCheckResult(true, message, latestRelease);
                    useRuntimeStore
                        .getState()
                        .setSystemHostOpen('updaterOpen', true);
                } else {
                    setUpdaterCheckResult(false);
                }
            }
        } catch (error) {
            console.warn('Failed to check for VRCX-0 updates:', error);
            useRuntimeStore.getState().setUpdateLoopState({
                lastUpdaterCheckAt: new Date().toISOString(),
                lastUpdaterCheckDetail:
                    error instanceof Error ? error.message : String(error)
            });
        }
    }

    if (includeRegistryBackup) {
        await runRegistryBackupMaintenance('foreground-update');
    }
}

export async function runStartupMaintenance() {
    await runRuntimeTelemetryJob(
        {
            name: 'startupMaintenance',
            detail: 'Running startup update and registry maintenance.'
        },
        () =>
            Promise.all([
                checkForAppUpdate({ includeRegistryBackup: false }),
                runRegistryBackupMaintenance('foreground-startup')
            ])
    );
}

async function deferRuntimeScheduledFrontendJob(
    timerName: string,
    delaySeconds: number
) {
    await commands.appRuntimeFrontendScheduleJobDefer({
            name: timerName,
            delaySeconds
        })
        .catch((error: unknown) => {
            console.warn(
                `Failed to defer runtime maintenance task ${timerName}:`,
                error
            );
        });
}

async function getDueRuntimeScheduledFrontendJobs() {
    const dueJobs = await commands.appRuntimeFrontendScheduleDueJobsGet()
        .catch((error: unknown) => {
            console.warn('Failed to read runtime maintenance due jobs:', error);
            return [];
        });
    return new Set(Array.isArray(dueJobs) ? dueJobs : []);
}

async function runRuntimeScheduledTask(
    timerName: string,
    intervalSeconds: number,
    task: RuntimeScheduledTask
) {
    await runRuntimeTelemetryJob(
        {
            name: timerName,
            cadenceSeconds: intervalSeconds,
            detail: `Running Rust-scheduled frontend maintenance task ${timerName}.`
        },
        task
    );
}

export async function runBackgroundMaintenanceTick() {
    if (running || !useSessionStore.getState().isLoggedIn) {
        return;
    }

    running = true;
    const dueJobs = await getDueRuntimeScheduledFrontendJobs();
    const hasDueJobs = dueJobs.size > 0;
    if (hasDueJobs) {
        recordRuntimeJobTelemetry({
            name: 'backgroundMaintenanceTick',
            owner: 'frontend',
            status: 'running',
            detail: 'Frontend executor is running Rust-scheduled maintenance.'
        });
    }

    try {
        if (dueJobs.has('appUpdateCheck')) {
            await runRuntimeScheduledTask(
                'appUpdateCheck',
                APP_UPDATE_CHECK_INTERVAL_SECONDS,
                checkForAppUpdate
            );
        }
        if (dueJobs.has('clearVRCXCacheCheck')) {
            await runRuntimeScheduledTask(
                'clearVRCXCacheCheck',
                86400,
                runClearVrcxCache
            );
        }
    } finally {
        running = false;
        if (hasDueJobs) {
            recordRuntimeJobTelemetry({
                name: 'backgroundMaintenanceTick',
                owner: 'frontend',
                status: 'completed',
                detail: 'Rust-scheduled frontend maintenance tick completed.'
            });
        }
    }
}

export function resetBackgroundMaintenance() {
    resetTimers();
    resetPresenceAutomationExecutor();
}
