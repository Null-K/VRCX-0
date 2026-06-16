import { getNotificationTs } from '@/shared/utils/notificationCategory';

export type NotificationLifecycleBucket = 'action' | 'activity' | 'system';

export type NotificationDrawerEntry = {
    notification: any;
    isUnseen: boolean;
};

export type NotificationDrawerGroups = Record<
    NotificationLifecycleBucket,
    NotificationDrawerEntry[]
>;

export const NOTIFICATION_LIFECYCLE_ORDER: NotificationLifecycleBucket[] = [
    'action',
    'activity',
    'system'
];

const ACTION_TYPES = new Set<string>([
    'friendRequest',
    'invite',
    'requestInvite',
    'boop',
    'group.invite',
    'group.joinRequest',
    'group.transfer',
    'group.queueReady'
]);

const ACTIVITY_TYPES = new Set<string>([
    'inviteResponse',
    'requestInviteResponse',
    'message',
    'ignoredFriendRequest'
]);

export function getNotificationLifecycleBucket(
    type: unknown
): NotificationLifecycleBucket {
    const normalized = String(type || '');
    if (ACTION_TYPES.has(normalized)) {
        return 'action';
    }
    if (ACTIVITY_TYPES.has(normalized)) {
        return 'activity';
    }
    return 'system';
}

export function groupDrawerEntries(
    entries: NotificationDrawerEntry[]
): NotificationDrawerGroups {
    const groups: NotificationDrawerGroups = {
        action: [],
        activity: [],
        system: []
    };
    for (const entry of Array.isArray(entries) ? entries : []) {
        const bucket = getNotificationLifecycleBucket(
            entry?.notification?.type
        );
        groups[bucket].push(entry);
    }
    for (const bucket of NOTIFICATION_LIFECYCLE_ORDER) {
        groups[bucket].sort((left: any, right: any) => {
            if (bucket === 'action') {
                const leftQueue =
                    left.notification?.type === 'group.queueReady' ? 0 : 1;
                const rightQueue =
                    right.notification?.type === 'group.queueReady' ? 0 : 1;
                if (leftQueue !== rightQueue) {
                    return leftQueue - rightQueue;
                }
            }
            return (
                getNotificationTs(right.notification) -
                getNotificationTs(left.notification)
            );
        });
    }
    return groups;
}
