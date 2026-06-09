use std::collections::HashMap;

use serde::Serialize;
use vrcx_0_core::friends::FriendRecord;
pub use vrcx_0_core::realtime::{
    RealtimeSessionContext, RealtimeWsMessagePayload, RealtimeWsStatusPayload,
};

use super::output::RealtimeFriendOutput;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeFriendSnapshot {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub generation: u64,
    pub baseline_revision: u64,
    pub friends_by_id: HashMap<String, FriendRecord>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendBaselineResult {
    pub accepted: bool,
    pub generation: u64,
    pub baseline_revision: u64,
    pub friend_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeTransportStartResult {
    pub generation: u64,
    pub client_run_id: u64,
    pub session_generation: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RealtimeCurrentUserAuthority {
    pub is_game_running: bool,
    pub game_log_enabled: bool,
    pub game_log_location: String,
    pub game_log_destination: String,
    pub game_log_world_name: String,
}

pub enum RealtimeFriendApplyResult {
    Output(Box<RealtimeFriendOutput>),
    MissingBaseline,
    Ignored,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum DelayedOfflineFeedTimerAction {
    #[default]
    None,
    Schedule {
        user_id: String,
        token: u64,
        delay_ms: u64,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FriendProfileRefetchRequest {
    LocationRepair { user_id: String },
    OfflineConfirm { user_id: String, token: u64 },
}
