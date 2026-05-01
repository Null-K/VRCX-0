import { useEffect, useMemo, useRef, useState } from 'react';

import { userProfileRepository } from '@/repositories/index.js';
import {
    buildCurrentUserPresenceView,
    mergeCurrentUserPresenceFields
} from '@/shared/utils/currentUserPresence.js';

import { normalizeUserId } from './userProfileFields.js';

function resolveProfileUserId(profile) {
    return normalizeUserId(
        profile?.id ||
            profile?.userId ||
            profile?.user_id ||
            profile?.targetUserId ||
            profile?.target_user_id
    );
}

function normalizeTargetSnapshot(
    snapshot,
    targetUserId,
    { allowMissingId = true } = {}
) {
    if (!snapshot) {
        return null;
    }

    const nextProfile = userProfileRepository.normalize(snapshot);
    const snapshotUserId = resolveProfileUserId(nextProfile);
    if (snapshotUserId && snapshotUserId !== targetUserId) {
        return null;
    }
    if (!snapshotUserId && targetUserId && allowMissingId) {
        return {
            ...nextProfile,
            id: targetUserId
        };
    }
    return nextProfile;
}

function profileMatchesTarget(profile, targetUserId) {
    return Boolean(
        profile &&
        targetUserId &&
        resolveProfileUserId(profile) === targetUserId
    );
}

function previousTargetProfile(profile, targetUserId) {
    return profileMatchesTarget(profile, targetUserId) ? profile : null;
}

const LOCAL_SNAPSHOT_REFRESH_FIELDS = [
    'status',
    'statusDescription',
    'state',
    'stateBucket',
    'location',
    '$location',
    '$location_at',
    'locationAt',
    'locationUpdatedAt',
    'worldId',
    'instanceId',
    'travelingToLocation',
    'travelingToWorld',
    'travelingToInstance',
    '$travelingToLocation',
    '$travelingToTime'
];

function hasRefreshValue(value) {
    return value !== undefined && value !== null && value !== '';
}

export function mergeLocalSnapshotIntoProfile(localSnapshot, profile) {
    if (!localSnapshot) {
        return profile || null;
    }
    if (!profile || typeof profile !== 'object') {
        return localSnapshot;
    }

    const localUserId = resolveProfileUserId(localSnapshot);
    const profileUserId = resolveProfileUserId(profile);
    if (localUserId && profileUserId && localUserId !== profileUserId) {
        return localSnapshot;
    }

    const merged = { ...localSnapshot, ...profile };
    for (const field of LOCAL_SNAPSHOT_REFRESH_FIELDS) {
        if (hasRefreshValue(localSnapshot[field])) {
            merged[field] = localSnapshot[field];
        }
    }
    return merged;
}

export function mergeUserDialogLocalSnapshot({
    friendSnapshot = null,
    seedData = null,
    knownTargetUser = null
} = {}) {
    const baseSnapshot = seedData || knownTargetUser || null;
    if (friendSnapshot && baseSnapshot) {
        return mergeLocalSnapshotIntoProfile(friendSnapshot, baseSnapshot);
    }
    return friendSnapshot || baseSnapshot;
}

export function useUserDialogProfileResource({
    currentEndpoint,
    currentUserSnapshot,
    gameLogDisabled,
    gameState,
    isTargetCurrentUser,
    localSnapshot,
    normalizedUserId,
    updateEntityDialogMetadata
}) {
    const normalizedLocalSnapshot = useMemo(
        () => normalizeTargetSnapshot(localSnapshot, normalizedUserId),
        [localSnapshot, normalizedUserId]
    );
    const currentUserPresenceSnapshot = useMemo(
        () =>
            normalizeTargetSnapshot(currentUserSnapshot, normalizedUserId, {
                allowMissingId: false
            }),
        [currentUserSnapshot, normalizedUserId]
    );
    const localSnapshotRef = useRef(normalizedLocalSnapshot);
    localSnapshotRef.current = normalizedLocalSnapshot;
    const [baseProfile, setBaseProfile] = useState(
        () => normalizedLocalSnapshot
    );
    const activeBaseProfile = useMemo(
        () =>
            profileMatchesTarget(baseProfile, normalizedUserId)
                ? baseProfile
                : normalizedLocalSnapshot,
        [baseProfile, normalizedLocalSnapshot, normalizedUserId]
    );
    const profile = useMemo(
        () =>
            isTargetCurrentUser
                ? buildCurrentUserPresenceView(activeBaseProfile, {
                      currentUserSnapshot: currentUserPresenceSnapshot,
                      gameState,
                      gameLogDisabled
                  })
                : activeBaseProfile,
        [
            activeBaseProfile,
            currentUserPresenceSnapshot,
            gameState?.currentDestination,
            gameState?.currentLocation,
            gameState?.currentWorldId,
            gameState?.isGameRunning,
            gameLogDisabled,
            isTargetCurrentUser
        ]
    );
    const [loadStatus, setLoadStatus] = useState(
        normalizedUserId ? 'running' : 'idle'
    );
    const [reloadToken, setReloadToken] = useState(0);
    const [detail, setDetail] = useState('');
    const activeUserTargetRef = useRef({
        userId: normalizedUserId,
        endpoint: currentEndpoint
    });
    activeUserTargetRef.current.userId = normalizedUserId;
    activeUserTargetRef.current.endpoint = currentEndpoint;

    const effectiveLoadStatus =
        normalizedUserId && !profile && loadStatus !== 'error'
            ? 'running'
            : loadStatus;

    useEffect(() => {
        if (normalizedLocalSnapshot) {
            setBaseProfile((currentProfile) =>
                isTargetCurrentUser
                    ? mergeCurrentUserPresenceFields(
                          normalizedLocalSnapshot,
                          previousTargetProfile(
                              currentProfile,
                              normalizedUserId
                          )
                      )
                    : mergeLocalSnapshotIntoProfile(
                          normalizedLocalSnapshot,
                          previousTargetProfile(currentProfile, normalizedUserId)
                      )
            );
        } else if (!normalizedUserId) {
            setBaseProfile(null);
        }
    }, [isTargetCurrentUser, normalizedLocalSnapshot, normalizedUserId]);

    useEffect(() => {
        const title = normalizeUserId(
            profile?.displayName || profile?.username
        );
        if (!profile?.id || !title) {
            return;
        }
        updateEntityDialogMetadata({
            kind: 'user',
            entityId: profile.id,
            title
        });
    }, [
        profile?.displayName,
        profile?.id,
        profile?.username,
        updateEntityDialogMetadata
    ]);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setBaseProfile(null);
            setLoadStatus('error');
            setDetail('No user id was provided for this dialog.');
            return () => {
                active = false;
            };
        }

        const snapshot = localSnapshotRef.current;
        setBaseProfile((currentProfile) =>
            isTargetCurrentUser && snapshot
                ? mergeCurrentUserPresenceFields(
                      snapshot,
                      previousTargetProfile(currentProfile, normalizedUserId)
                  )
                : mergeLocalSnapshotIntoProfile(
                      snapshot,
                      previousTargetProfile(currentProfile, normalizedUserId)
                  )
        );
        setLoadStatus('running');
        setDetail('');

        userProfileRepository
            .getUserProfile({
                userId: normalizedUserId,
                endpoint: currentEndpoint,
                force: reloadToken > 0,
                dialog: true
            })
            .then((nextProfile) => {
                if (!active) {
                    return;
                }

                setBaseProfile((currentProfile) =>
                    isTargetCurrentUser
                        ? mergeCurrentUserPresenceFields(
                              nextProfile,
                              previousTargetProfile(
                                  currentProfile,
                                  normalizedUserId
                              )
                          )
                        : mergeLocalSnapshotIntoProfile(
                              localSnapshotRef.current,
                              nextProfile
                          )
                );
                setLoadStatus('ready');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                const fallbackSnapshot = localSnapshotRef.current;
                if (fallbackSnapshot) {
                    setBaseProfile((currentProfile) =>
                        isTargetCurrentUser
                            ? mergeCurrentUserPresenceFields(
                                  fallbackSnapshot,
                                  previousTargetProfile(
                                      currentProfile,
                                      normalizedUserId
                                  )
                              )
                            : mergeLocalSnapshotIntoProfile(
                                  fallbackSnapshot,
                                  previousTargetProfile(
                                      currentProfile,
                                      normalizedUserId
                                  )
                              )
                    );
                    setLoadStatus('ready');
                    setDetail(
                        error instanceof Error
                            ? error.message
                            : 'Failed to refresh the remote user snapshot.'
                    );
                    return;
                }

                setBaseProfile(null);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load the user profile.'
                );
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, isTargetCurrentUser, normalizedUserId, reloadToken]);

    function refreshProfile() {
        setReloadToken((value) => value + 1);
    }

    return {
        activeUserTargetRef,
        baseProfile: activeBaseProfile,
        detail,
        loadStatus: effectiveLoadStatus,
        profile,
        refreshProfile,
        reloadToken,
        setBaseProfile
    };
}
