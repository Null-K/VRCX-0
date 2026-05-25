import configRepository from '@/repositories/configRepository';
import { useFeedLiveStore } from '@/state/feedLiveStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

import {
    recordCurrentUserSnapshot,
    recordFriendPatch
} from './domainIngestionService';
import { syncFriendRosterStateFromCurrentUserSnapshot } from './friendBootstrapService';
import { handleInviteAutomationNotification } from './inviteAutomationService';
import {
    handleRealtimeInstanceQueueProjection
} from './realtimeInstanceQueueService';
import { deliverRuntimeNotification } from './notificationDeliveryService';
import { pushSharedFeedNotification } from './sharedFeedFilterService';

type AnyRecord = Record<string, any>;
const CURRENT_USER_FRIEND_ARRAY_FIELDS = [
    'friends',
    'onlineFriends',
    'activeFriends',
    'offlineFriends'
];

function isRecord(value: unknown): value is AnyRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asRecord(value: unknown): AnyRecord {
    return isRecord(value) ? value : {};
}

function hasOwn(record: AnyRecord, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function getCurrentUserSnapshot(
    runtimeState: any = useRuntimeStore.getState()
) {
    return isRecord(runtimeState.auth.currentUserSnapshot)
        ? runtimeState.auth.currentUserSnapshot
        : null;
}

function currentUserDisplayName(snapshot: AnyRecord, fallback: any = '') {
    return (
        normalizeUserId(snapshot.displayName) ||
        normalizeUserId(snapshot.username) ||
        normalizeUserId(snapshot.id) ||
        fallback
    );
}

function hasCompleteCurrentUserFriendBucketSnapshot(source: AnyRecord) {
    return CURRENT_USER_FRIEND_ARRAY_FIELDS.every((field) =>
        Array.isArray(source[field])
    );
}

function getCurrentUserProjectionFriendBucketSource(projection: AnyRecord) {
    const patch = asRecord(projection.patch);
    if (hasCompleteCurrentUserFriendBucketSnapshot(patch)) {
        return patch;
    }
    const snapshot = asRecord(projection.snapshot);
    if (
        Object.keys(patch).length === 0 &&
        hasCompleteCurrentUserFriendBucketSnapshot(snapshot)
    ) {
        return snapshot;
    }
    return null;
}

function mergeCurrentUserProjectionSnapshot(
    runtimeState: ReturnType<typeof useRuntimeStore.getState>,
    projection: AnyRecord
) {
    const currentSnapshot = getCurrentUserSnapshot(runtimeState);
    const patch = asRecord(projection.patch);
    const snapshotSource = isRecord(projection.snapshot)
        ? projection.snapshot
        : {};
    const source = Object.keys(patch).length
        ? patch
        : snapshotSource;
    const completeFriendBucketSource =
        getCurrentUserProjectionFriendBucketSource(projection);
    const nextSnapshot: any = {
        ...(currentSnapshot || {}),
        ...source
    };

    if (completeFriendBucketSource) {
        for (const field of CURRENT_USER_FRIEND_ARRAY_FIELDS) {
            nextSnapshot[field] = completeFriendBucketSource[field];
        }
    }

    if (currentSnapshot) {
        for (const field of CURRENT_USER_FRIEND_ARRAY_FIELDS) {
            if (
                !completeFriendBucketSource &&
                Array.isArray(currentSnapshot[field])
            ) {
                nextSnapshot[field] = currentSnapshot[field];
            }
        }
    }

    return nextSnapshot;
}

function applyFriendPatch(
    userId: string,
    patch: AnyRecord,
    stateBucket: string,
    stateBucketAuthority: string
) {
    const normalizedUserId = normalizeUserId(
        userId || patch.id || patch.userId
    );
    if (!normalizedUserId) {
        return;
    }
    useFriendRosterStore.getState().applyFriendPatch({
        userId: normalizedUserId,
        patch,
        stateBucket,
        stateBucketAuthority
    });
    recordFriendPatch({
        endpoint: useRuntimeStore.getState().auth.currentUserEndpoint,
        userId: normalizedUserId,
        patch,
        stateBucket,
        stateBucketAuthority
    });
}

function pushProjectionFeedEntry(entry: unknown) {
    const feedEntry = asRecord(entry);
    if (!Object.keys(feedEntry).length) {
        return;
    }
    useFeedLiveStore.getState().pushEntry(feedEntry, {
        ownerUserId: useRuntimeStore.getState().auth.currentUserId
    });
    pushSharedFeedNotification(feedEntry).catch((error: any) => {
        console.warn('Failed to publish realtime feed notification:', error);
    });
}

function clearNotificationMenuIfNoUnseen() {
    if (useVrcNotificationStore.getState().unseenCount === 0) {
        useShellStore.getState().removeNotify('notification');
    }
}

function notifyNotificationMenu(notification: AnyRecord) {
    if (notification.version === 2 && notification.seen !== false) {
        return;
    }
    useShellStore.getState().notifyMenu('notification');
}

async function runInviteAutomation(notification: AnyRecord) {
    return handleInviteAutomationNotification(notification).catch(
        (error: any) => {
            console.warn(
                'Failed to handle invite automation notification:',
                error
            );
            return { handled: false, reason: 'error' };
        }
    );
}

function parseStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((entry: any) => normalizeUserId(entry))
            .filter(Boolean);
    }
    if (typeof value !== 'string') {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.map((entry: any) => normalizeUserId(entry)).filter(Boolean)
            : [];
    } catch {
        return [];
    }
}

async function shouldNotifyInstanceClosed(): Promise<boolean> {
    try {
        const filters = parseStringArray(
            await configRepository.getString(
                'VRCX_notificationTableFilters',
                '[]'
            )
        );
        return !filters.length || filters.includes('instance.closed');
    } catch {
        return true;
    }
}

function handleRealtimeFriendProjection(payload: unknown) {
    const projection = asRecord(payload);
    for (const userId of Array.isArray(projection.removals)
        ? projection.removals
        : []) {
        const normalizedUserId = normalizeUserId(userId);
        if (!normalizedUserId) {
            continue;
        }
        useFriendRosterStore.getState().removeFriend(normalizedUserId);
    }

    for (const entry of Array.isArray(projection.patches)
        ? projection.patches
        : []) {
        const patchEntry = asRecord(entry);
        const patch = asRecord(patchEntry.patch);
        applyFriendPatch(
            normalizeUserId(patchEntry.userId || patch.id || patch.userId),
            patch,
            normalizeUserId(
                patchEntry.stateBucket || patch.stateBucket || patch.state
            ),
            normalizeUserId(patchEntry.stateBucketAuthority || 'explicit')
        );
    }

    for (const entry of Array.isArray(projection.feedEntries)
        ? projection.feedEntries
        : []) {
        pushProjectionFeedEntry(entry);
    }

    if (projection.friendLogChanged) {
        useShellStore.getState().notifyMenu('friend-log');
    }
}

async function handleRealtimeNotificationProjection(payload: unknown) {
    const projection = asRecord(payload);
    const store = useVrcNotificationStore.getState();

    if (Array.isArray(projection.expiredIds) && projection.expiredIds.length) {
        store.expireNotifications(projection.expiredIds);
    }
    if (Array.isArray(projection.seenIds) && projection.seenIds.length) {
        store.markNotificationsSeen(projection.seenIds);
    }

    for (const upsert of Array.isArray(projection.upserts)
        ? projection.upserts
        : []) {
        const item = asRecord(upsert);
        let notification = asRecord(item.notification);
        if (!notification.id) {
            continue;
        }
        const existingNotification = store.rows.find(
            (row: any) => row.id === notification.id
        );
        const insertDefaults = asRecord(item.insertDefaults);
        if (!existingNotification && Object.keys(insertDefaults).length) {
            notification = {
                ...insertDefaults,
                ...notification
            };
        }
        store.upsertNotification(notification);
        const mergedNotification =
            useVrcNotificationStore
                .getState()
                .rows.find((row: any) => row.id === notification.id) ||
            notification;
        const automationResult = item.runAutomation
            ? await runInviteAutomation(mergedNotification)
            : { handled: false };
        if (automationResult.handled) {
            clearNotificationMenuIfNoUnseen();
            continue;
        }
        if (item.notifyMenu) {
            notifyNotificationMenu(mergedNotification);
        }
        if (item.deliverRuntime) {
            deliverRuntimeNotification(mergedNotification).catch(
                (error: any) => {
                    console.warn(
                        'Failed to deliver runtime notification:',
                        error
                    );
                }
            );
        }
    }

    if (projection.clearMenuIfNoUnseen) {
        clearNotificationMenuIfNoUnseen();
    }
}

function handleRealtimeCurrentUserProjection(payload: unknown) {
    const projection = asRecord(payload);
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = mergeCurrentUserProjectionSnapshot(
        runtimeStore,
        projection
    );
    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: snapshot,
        currentUserDisplayName: currentUserDisplayName(
            snapshot,
            runtimeStore.auth.currentUserDisplayName
        )
    });
    const patch = asRecord(projection.patch);
    if (hasOwn(patch, 'queuedInstance')) {
        const queuedInstance = normalizeUserId(patch.queuedInstance);
        if (queuedInstance) {
            handleRealtimeInstanceQueueProjection({
                kind: 'update',
                instanceLocation: queuedInstance
            });
        } else if (useRuntimeStore.getState().instanceQueue.active) {
            useRuntimeStore.getState().clearInstanceQueueState();
        }
    }
    if (isRecord(projection.gameStatePatch)) {
        runtimeStore.setGameState(projection.gameStatePatch);
    }
    recordCurrentUserSnapshot(snapshot, {
        endpoint: runtimeStore.auth.currentUserEndpoint,
        source: 'currentUser'
    });
    if (getCurrentUserProjectionFriendBucketSource(projection)) {
        syncFriendRosterStateFromCurrentUserSnapshot(
            snapshot,
            `Friend roster states refreshed for ${currentUserDisplayName(
                snapshot,
                runtimeStore.auth.currentUserDisplayName
            )}.`
        );
    }
}

async function handleRealtimeInstanceClosedProjection(payload: unknown) {
    const projection = asRecord(payload);
    const notification = asRecord(projection.notification);
    if (!notification.id) {
        return;
    }
    useVrcNotificationStore.getState().upsertNotification(notification);
    if (await shouldNotifyInstanceClosed()) {
        useShellStore.getState().notifyMenu('notification');
    }
    useFeedLiveStore.getState().pushEntry(asRecord(projection.feedEntry), {
        ownerUserId: useRuntimeStore.getState().auth.currentUserId
    });
    pushSharedFeedNotification(notification).catch((error: any) => {
        console.warn(
            'Failed to publish instance-closed shared feed notification:',
            error
        );
    });
}

export {
    handleRealtimeCurrentUserProjection,
    handleRealtimeFriendProjection,
    handleRealtimeInstanceClosedProjection,
    handleRealtimeNotificationProjection
};
