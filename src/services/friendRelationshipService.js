import vrchatFriendRepository from '@/repositories/vrchatFriendRepository.js';
import { handleRealtimePresenceEvent } from '@/services/realtimePresenceService.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

function normalizeUserId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function isCurrentAuthTarget({ currentUserId, endpoint }) {
    const auth = useRuntimeStore.getState().auth;
    return (
        auth.currentUserId === currentUserId &&
        auth.currentUserEndpoint === endpoint
    );
}

async function deleteFriend({
    friend,
    userId,
    endpoint = '',
    currentUserId = ''
}) {
    const normalizedUserId = normalizeUserId(userId || friend?.id);
    if (!normalizedUserId) {
        throw new Error('deleteFriend requires a friend user id.');
    }

    await vrchatFriendRepository.deleteFriend({
        userId: normalizedUserId,
        endpoint
    });

    if (!isCurrentAuthTarget({ currentUserId, endpoint })) {
        return {
            stale: true,
            userId: normalizedUserId
        };
    }

    await handleRealtimePresenceEvent({
        type: 'friend-delete',
        content: {
            userId: normalizedUserId
        }
    });

    return {
        stale: false,
        userId: normalizedUserId
    };
}

const friendRelationshipService = {
    deleteFriend
};

export { deleteFriend };
export default friendRelationshipService;
