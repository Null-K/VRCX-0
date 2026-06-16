import { tauriClient } from '@/platform/tauri/client';

import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    unwrapErrorMessage
} from './vrchatRequest';

const PAGE_SIZE = 50;
const MAX_OFFSET = 7500;

type FriendRecord = Record<string, unknown> & { id: string };

interface FriendsPageInput {
    endpoint?: string;
    offline?: boolean;
    n?: number;
    offset?: number;
}

interface FriendEndpointInput {
    userId?: unknown;
    endpoint?: string;
    isFriend?: boolean | null;
}

interface CancelFriendRequestInput extends FriendEndpointInput {
    notificationId?: unknown;
}

function isValidFriendUser(user: unknown): user is FriendRecord {
    return Boolean(
        user &&
        typeof user === 'object' &&
        'id' in user &&
        typeof user.id === 'string' &&
        user.id.trim()
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapVrchatFriendResponse<TJson = unknown>(
    response: { status: number; data: unknown; raw: unknown },
    path: string
) {
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const requestError = createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage: 'VRChat friend request failed'
            }),
            response.status,
            path,
            json
        );
        notifyVrchatAuthFailure(requestError);
        throw requestError;
    }

    return {
        json: json as TJson,
        status: response.status,
        raw: response.raw
    };
}

async function getFriends({
    endpoint = '',
    offline = false,
    n = PAGE_SIZE,
    offset = 0
}: FriendsPageInput = {}) {
    const response = await tauriClient.app.VrchatFriendsGet({
        endpoint,
        offline: Boolean(offline),
        n,
        offset
    });
    return unwrapVrchatFriendResponse<FriendRecord[]>(
        response,
        'auth/user/friends'
    );
}

async function getAllFriends({
    endpoint = '',
    offline = false
}: Pick<FriendsPageInput, 'endpoint' | 'offline'> = {}) {
    const friends: FriendRecord[] = [];

    for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
        const response = await getFriends({
            endpoint,
            offline,
            n: PAGE_SIZE,
            offset
        });
        const page = Array.isArray(response.json)
            ? response.json.filter(isValidFriendUser)
            : [];
        friends.push(...page);

        if (page.length < PAGE_SIZE) {
            break;
        }
    }

    return friends;
}

async function getUser({
    userId,
    endpoint = '',
    isFriend = null
}: FriendEndpointInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error('VrchatFriendRepository.getUser requires a user id.');
    }

    const response = await tauriClient.app.VrchatUserGet({
        userId: normalizedUserId,
        endpoint,
        isFriend
    });
    return unwrapVrchatFriendResponse<FriendRecord>(
        response,
        `users/${encodeURIComponent(normalizedUserId)}`
    );
}

async function deleteFriend({ userId, endpoint = '' }: FriendEndpointInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'VrchatFriendRepository.deleteFriend requires a user id.'
        );
    }

    const response = await tauriClient.app.VrchatFriendDelete({
        userId: normalizedUserId,
        endpoint
    });
    return unwrapVrchatFriendResponse<Record<string, unknown>>(
        response,
        `auth/user/friends/${encodeURIComponent(normalizedUserId)}`
    );
}

async function getFriendStatus({ userId, endpoint = '' }: FriendEndpointInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'VrchatFriendRepository.getFriendStatus requires a user id.'
        );
    }

    const response = await tauriClient.app.VrchatFriendStatusGet({
        userId: normalizedUserId,
        endpoint
    });
    return unwrapVrchatFriendResponse<Record<string, unknown>>(
        response,
        `user/${encodeURIComponent(normalizedUserId)}/friendStatus`
    );
}

async function sendFriendRequest({
    userId,
    endpoint = ''
}: FriendEndpointInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'VrchatFriendRepository.sendFriendRequest requires a user id.'
        );
    }

    const response = await tauriClient.app.VrchatFriendRequestSend({
        userId: normalizedUserId,
        endpoint
    });
    return unwrapVrchatFriendResponse<Record<string, unknown>>(
        response,
        `user/${encodeURIComponent(normalizedUserId)}/friendRequest`
    );
}

async function cancelFriendRequest({
    userId,
    notificationId = '',
    endpoint = ''
}: CancelFriendRequestInput) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error(
            'VrchatFriendRepository.cancelFriendRequest requires a user id.'
        );
    }

    const params =
        typeof notificationId === 'string' && notificationId.trim()
            ? { notificationId: notificationId.trim() }
            : null;

    const response = await tauriClient.app.VrchatFriendRequestCancel({
        userId: normalizedUserId,
        notificationId: params?.notificationId || '',
        endpoint
    });
    return unwrapVrchatFriendResponse<Record<string, unknown>>(
        response,
        `user/${encodeURIComponent(normalizedUserId)}/friendRequest`
    );
}

const vrchatFriendRepository = Object.freeze({
    getFriends,
    getAllFriends,
    getUser,
    deleteFriend,
    getFriendStatus,
    sendFriendRequest,
    cancelFriendRequest
});

export {
    getFriends,
    getAllFriends,
    getUser,
    deleteFriend,
    getFriendStatus,
    sendFriendRequest,
    cancelFriendRequest
};
export default vrchatFriendRepository;
