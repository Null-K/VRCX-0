import { normalizeLanguageCode } from '@/localization/locales';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { DEFAULT_TIME_UNIT_LABELS, useShellStore } from '@/state/shellStore';

import { bootstrapActivityCache } from './activityCacheService';
import { startRuntimeAuthFailureRecovery } from './authSessionRecoveryService';
import { bindRuntimeEvents } from './runtimeEventBridgeService';
import { bootstrapFavorites } from './favoriteBootstrapService';
import { bootstrapFriendRoster } from './friendBootstrapService';
import { startRuntimeGameClientSync } from './gameClientLifecycle';
import { stopGameStateService } from './gameStateService';
import { getTimeUnitLabels, setI18nLanguage } from './i18nService';
import {
    startRealtimeTransport,
    stopRealtimeTransport
} from './realtimeTransportService';
import { initializeReactRuntime } from './startupService';
import { syncStartupServicesTask } from './startupServicesStatus';
import { applyThemeMode } from './themeService';
import { startRuntimeUpdateLoop } from './updateLoopService';
import { startVrcStatusPolling } from './vrcStatusService';

const BOOTSTRAP_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

function pushRuntimeNotification({ level, title, error }: any) {
    useNotificationStore.getState().pushNotification({
        level,
        title,
        message: error instanceof Error ? error.message : String(error)
    });
}

function isSameAuthenticatedContext(left: any, right: any) {
    return (
        left?.userId === right?.userId &&
        left?.endpoint === right?.endpoint &&
        left?.websocket === right?.websocket
    );
}

function getAuthenticatedRuntimeContext() {
    const sessionState = useSessionStore.getState();
    const runtimeState = useRuntimeStore.getState();

    if (
        sessionState.sessionPhase !== 'ready' ||
        !runtimeState.auth.currentUserId ||
        !runtimeState.auth.currentUserSnapshot
    ) {
        return null;
    }

    return {
        userId: runtimeState.auth.currentUserId,
        endpoint: runtimeState.auth.currentUserEndpoint,
        websocket: runtimeState.auth.currentUserWebsocket,
        currentUserSnapshot: runtimeState.auth.currentUserSnapshot
    };
}

function isCurrentAuthenticatedContext(context: any) {
    return isSameAuthenticatedContext(
        context,
        getAuthenticatedRuntimeContext()
    );
}

let reactRuntimeConsumerCount = 0;
let reactRuntimeStartPromise = null;
let reactRuntimeCleanup = null;

function isBackendRuntimeOwningRealtime(context: any): boolean {
    const snapshot: any = useRuntimeStore.getState().backendRuntime;
    return Boolean(
        snapshot?.phase === 'running' &&
            snapshot?.authStatus === 'authenticated' &&
            snapshot?.authUserId === context?.userId &&
            snapshot?.wsStatus !== 'authFailure' &&
            snapshot?.mode === 'background'
    );
}

function cleanupReactRuntimeServices() {
    const cleanup = reactRuntimeCleanup;
    reactRuntimeCleanup = null;
    reactRuntimeStartPromise = null;
    cleanup?.();
}

function createReactRuntimeStartPromise() {
    const cleanups = [startRuntimeAuthFailureRecovery()];

    return initializeReactRuntime()
        .then(() => bindRuntimeEvents())
        .then((cleanup: any) => {
            cleanups.push(cleanup ?? null);
            cleanups.push(startRuntimeGameClientSync());
            cleanups.push(startRuntimeUpdateLoop());
            cleanups.push(startVrcStatusPolling());
            reactRuntimeCleanup = () => {
                for (const entry of cleanups) {
                    entry?.();
                }
                stopGameStateService();
            };

            if (reactRuntimeConsumerCount === 0) {
                cleanupReactRuntimeServices();
            }
        })
        .catch((error: any) => {
            for (const entry of cleanups) {
                entry?.();
            }
            reactRuntimeStartPromise = null;
            reactRuntimeCleanup = null;
            useRuntimeStore.getState().setShellState({
                backendRuntimeSnapshotHydrated: true,
                backendRuntimeSessionHydrating: false
            });
            if (reactRuntimeConsumerCount > 0) {
                pushRuntimeNotification({
                    level: 'error',
                    title: 'Runtime bootstrap failed',
                    error
                });
            }
        });
}

export function startReactRuntimeServices() {
    let disposed = false;
    reactRuntimeConsumerCount += 1;

    if (!reactRuntimeStartPromise && !reactRuntimeCleanup) {
        reactRuntimeStartPromise = createReactRuntimeStartPromise();
    }

    return () => {
        if (disposed) {
            return;
        }
        disposed = true;
        reactRuntimeConsumerCount = Math.max(0, reactRuntimeConsumerCount - 1);

        if (reactRuntimeConsumerCount > 0) {
            return;
        }

        if (reactRuntimeCleanup) {
            cleanupReactRuntimeServices();
        }
    };
}

export function startThemeModeSync() {
    const syncThemeMode = (themeMode: any, title: any) => {
        applyThemeMode(themeMode).catch((error: any) => {
            pushRuntimeNotification({
                level: 'warning',
                title,
                error
            });
        });
    };

    syncThemeMode(useShellStore.getState().themeMode, 'Theme sync failed');

    const unsubscribeThemeMode = useShellStore.subscribe(
        (state: any, previousState: any) => {
            if (state.themeMode !== previousState.themeMode) {
                syncThemeMode(state.themeMode, 'Theme sync failed');
            }
        }
    );

    if (!window.matchMedia) {
        return unsubscribeThemeMode;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
        if (useShellStore.getState().themeMode === 'system') {
            syncThemeMode('system', 'System theme sync failed');
        }
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => {
        unsubscribeThemeMode();
        mediaQuery.removeEventListener('change', handleChange);
    };
}

export function startI18nLanguageSync() {
    const syncLanguage = (locale: any) => {
        const nextLocale = normalizeLanguageCode(locale);
        if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('lang', nextLocale);
        }
        useShellStore
            .getState()
            .setTimeUnitLabels(
                getTimeUnitLabels(nextLocale, DEFAULT_TIME_UNIT_LABELS)
            );
        setI18nLanguage(nextLocale).catch((error: any) => {
            pushRuntimeNotification({
                level: 'warning',
                title: 'Language sync failed',
                error
            });
        });
    };

    syncLanguage(useShellStore.getState().locale);

    return useShellStore.subscribe((state: any, previousState: any) => {
        if (state.locale !== previousState.locale) {
            syncLanguage(state.locale);
        }
    });
}

export function startAuthenticatedRuntimeServices() {
    let disposed = false;
    let activeContext = null;
    let activeRunId = 0;
    let friendBootstrapStarted = false;
    let favoritesBootstrapStarted = false;
    let activityWarmupStarted = false;
    let realtimeTransportStarted = false;
    let realtimeTransportOwner = 'none';
    const bootstrapRetryState: any = {
        friends: { timer: null, attempt: 0 },
        favorites: { timer: null, attempt: 0 }
    };
    let requestBootstrapUpdate = () => {};

    const clearBootstrapRetry = (key: any) => {
        const state = bootstrapRetryState[key];
        if (!state) {
            return;
        }
        if (state.timer !== null) {
            window.clearTimeout(state.timer);
            state.timer = null;
        }
        state.attempt = 0;
    };

    const clearBootstrapRetries = () => {
        clearBootstrapRetry('friends');
        clearBootstrapRetry('favorites');
    };

    const resetContext = (context: any) => {
        activeContext = context;
        activeRunId += 1;
        friendBootstrapStarted = false;
        favoritesBootstrapStarted = false;
        activityWarmupStarted = false;
        realtimeTransportStarted = false;
        realtimeTransportOwner = 'none';
        clearBootstrapRetries();
        stopRealtimeTransport({ updateStatus: false });
    };

    const isActiveRun = (runId: any, context: any) =>
        !disposed &&
        activeRunId === runId &&
        isCurrentAuthenticatedContext(context);

    const scheduleBootstrapRetry = (key: any, runId: any, context: any) => {
        const state = bootstrapRetryState[key];
        if (!state || state.timer !== null || !isActiveRun(runId, context)) {
            return;
        }

        const delay =
            BOOTSTRAP_RETRY_DELAYS_MS[
                Math.min(state.attempt, BOOTSTRAP_RETRY_DELAYS_MS.length - 1)
            ];
        state.attempt += 1;
        state.timer = window.setTimeout(() => {
            state.timer = null;
            if (isActiveRun(runId, context)) {
                requestBootstrapUpdate();
            }
        }, delay);
    };

    const runFriendBootstrap = (context: any, runId: any) => {
        friendBootstrapStarted = true;
        bootstrapFriendRoster({
            userId: context.userId,
            endpoint: context.endpoint,
            currentUserSnapshot: context.currentUserSnapshot
        })
            .then(() => {
                if (isActiveRun(runId, context)) {
                    clearBootstrapRetry('friends');
                }
            })
            .catch((error: any) => {
                if (!isActiveRun(runId, context)) {
                    return;
                }

                friendBootstrapStarted = false;
                scheduleBootstrapRetry('friends', runId, context);
                pushRuntimeNotification({
                    level: 'warning',
                    title: 'Friend bootstrap failed',
                    error
                });
            });
    };

    const runFavoritesBootstrap = (context: any, runId: any) => {
        favoritesBootstrapStarted = true;
        bootstrapFavorites({
            userId: context.userId,
            endpoint: context.endpoint,
            currentUserSnapshot: context.currentUserSnapshot
        })
            .then(() => {
                if (isActiveRun(runId, context)) {
                    clearBootstrapRetry('favorites');
                }
            })
            .catch((error: any) => {
                if (!isActiveRun(runId, context)) {
                    return;
                }

                favoritesBootstrapStarted = false;
                scheduleBootstrapRetry('favorites', runId, context);
                pushRuntimeNotification({
                    level: 'warning',
                    title: 'Favorites hydration failed',
                    error
                });
            });
    };

    const runActivityWarmup = (context: any, runId: any) => {
        activityWarmupStarted = true;
        bootstrapActivityCache({
            userId: context.userId,
            currentUserSnapshot: context.currentUserSnapshot
        }).catch((error: any) => {
            if (!isActiveRun(runId, context)) {
                return;
            }

            pushRuntimeNotification({
                level: 'warning',
                title: 'Activity warm-up failed',
                error
            });
        });
    };

    const runRealtimeTransport = (context: any, runId: any) => {
        realtimeTransportStarted = true;
        realtimeTransportOwner = 'frontend';
        startRealtimeTransport({
            userId: context.userId,
            endpoint: context.endpoint,
            websocket: context.websocket,
            currentUserSnapshot: context.currentUserSnapshot
        }).catch((error: any) => {
            if (isActiveRun(runId, context)) {
                console.warn('Realtime transport bootstrap failed:', error);
            }
        });
    };

    const update = () => {
        if (disposed) {
            return;
        }

        const context = getAuthenticatedRuntimeContext();
        if (!context) {
            if (activeContext) {
                resetContext(null);
            }
            return;
        }

        if (!isSameAuthenticatedContext(activeContext, context)) {
            resetContext(context);
        }

        const runId = activeRunId;
        const sessionState = useSessionStore.getState();

        if (
            !sessionState.isFriendsLoaded &&
            !friendBootstrapStarted &&
            bootstrapRetryState.friends.timer === null
        ) {
            runFriendBootstrap(context, runId);
        }

        if (
            !sessionState.isFavoritesLoaded &&
            !favoritesBootstrapStarted &&
            bootstrapRetryState.favorites.timer === null
        ) {
            runFavoritesBootstrap(context, runId);
        }

        if (!activityWarmupStarted) {
            runActivityWarmup(context, runId);
        }

        if (!sessionState.isFriendsLoaded) {
            if (realtimeTransportStarted) {
                realtimeTransportStarted = false;
                if (realtimeTransportOwner === 'frontend') {
                    stopRealtimeTransport({ updateStatus: false });
                }
                realtimeTransportOwner = 'none';
            }
            return;
        }

        const backendOwnsRealtime = isBackendRuntimeOwningRealtime(context);
        if (!backendOwnsRealtime && realtimeTransportOwner === 'backend') {
            realtimeTransportStarted = false;
            realtimeTransportOwner = 'none';
        }

        if (backendOwnsRealtime) {
            if (realtimeTransportOwner === 'frontend') {
                stopRealtimeTransport({ updateStatus: false });
            }
            realtimeTransportStarted = true;
            if (realtimeTransportOwner !== 'backend') {
                realtimeTransportOwner = 'backend';
                useSessionStore
                    .getState()
                    .setTransportStatus('pipeline-connected');
                syncStartupServicesTask(['Backend realtime transport is active.']);
            }
            return;
        }

        if (!realtimeTransportStarted) {
            runRealtimeTransport(context, runId);
        }
    };

    const unsubscribeSession = useSessionStore.subscribe(update);
    const unsubscribeRuntime = useRuntimeStore.subscribe(update);

    requestBootstrapUpdate = update;
    update();

    return () => {
        disposed = true;
        unsubscribeSession();
        unsubscribeRuntime();
        activeContext = null;
        activeRunId += 1;
        clearBootstrapRetries();
        stopRealtimeTransport();
    };
}
