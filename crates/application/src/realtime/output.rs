use vrcx_0_persistence::realtime::RealtimePersistenceBatch;

use super::projection::{
    FriendProjection, RealtimeCurrentUserProjection, RealtimeInstanceClosedProjection,
    RealtimeNotificationProjection,
};
use super::runtime_types::{DelayedOfflineFeedTimerAction, FriendProfileRefetchRequest};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeFriendOutput {
    pub owner_user_id: String,
    pub projection: FriendProjection,
    pub persistence: RealtimePersistenceBatch,
    pub timer_action: DelayedOfflineFeedTimerAction,
    pub profile_refetch_requests: Vec<FriendProfileRefetchRequest>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeNotificationOutput {
    pub owner_user_id: String,
    pub projection: RealtimeNotificationProjection,
    pub persistence: RealtimePersistenceBatch,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeCurrentUserOutput {
    pub owner_user_id: String,
    pub projection: RealtimeCurrentUserProjection,
    pub persistence: RealtimePersistenceBatch,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeInstanceClosedOutput {
    pub projection: RealtimeInstanceClosedProjection,
    pub persistence: RealtimePersistenceBatch,
}
