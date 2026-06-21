use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TimeWindow {
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
}

impl TimeWindow {
    pub fn all() -> Self {
        Self::default()
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum CopresenceGroupBy {
    #[default]
    Friend,
    FriendWorld,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CopresenceSummaryInput {
    pub time_window: TimeWindow,
    #[serde(default)]
    pub group_by: CopresenceGroupBy,
    #[serde(default)]
    pub min_minutes: Option<i64>,
    #[serde(default)]
    pub owner_user_id: Option<String>,
    #[serde(default)]
    pub friends_only: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CopresenceSummaryOutput {
    pub rows: Vec<CopresenceSummaryRow>,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CopresenceSummaryRow {
    pub user_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_name: Option<String>,
    pub total_minutes: i64,
    pub co_days: usize,
    pub instances: usize,
    pub last_seen_together: String,
    pub minutes_by_access: BTreeMap<String, i64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ActivityBucket {
    #[default]
    HourOfDay,
    DayOfWeek,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendActivityPatternInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub user_id: Option<String>,
    pub time_window: TimeWindow,
    #[serde(default)]
    pub bucket: ActivityBucket,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendActivityPatternOutput {
    pub rows: Vec<FriendActivityPatternRow>,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendActivityPatternRow {
    pub user_id: String,
    pub display_name: String,
    pub buckets: BTreeMap<String, i64>,
    pub typical_online_window: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchWorldsVisitedInput {
    pub time_window: TimeWindow,
    pub limit: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchWorldsVisitedOutput {
    pub rows: Vec<VisitedWorldRow>,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VisitedWorldRow {
    pub world_id: String,
    pub world_name: String,
    pub location: String,
    pub visited_at: String,
    pub stay_minutes: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialGraphInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub user_id: Option<String>,
    pub depth: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialGraphOutput {
    pub nodes: Vec<SocialGraphNode>,
    pub edges: Vec<SocialGraphEdge>,
    pub fetched_friends: usize,
    pub opted_out_friends: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub newest_fetched_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oldest_fetched_at: Option<String>,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialGraphNode {
    pub user_id: String,
    pub display_name: String,
    pub connection_degree: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialGraphEdge {
    pub source_user_id: String,
    pub target_user_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CompanionsOfInput {
    pub owner_user_id: String,
    pub user_id: String,
    pub time_window: TimeWindow,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CompanionsOfOutput {
    pub rows: Vec<CompanionOfRow>,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CompanionOfRow {
    pub user_id: String,
    pub display_name: String,
    pub overlap_minutes: i64,
    pub overlap_events: i64,
    pub shared_instances: usize,
    pub last_seen_together: String,
    pub worlds: Vec<CompanionWorldRow>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CompanionWorldRow {
    pub location: String,
    pub world_id: String,
    pub world_name: String,
}

#[derive(
    Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub enum InviteDirection {
    Received,
    Sent,
    #[default]
    Both,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InviteHistoryInput {
    pub owner_user_id: String,
    pub time_window: TimeWindow,
    #[serde(default)]
    pub direction: InviteDirection,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InviteHistoryOutput {
    pub rows: Vec<InviteHistoryRow>,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InviteHistoryRow {
    pub user_id: String,
    pub display_name: String,
    pub direction: InviteDirection,
    pub total_count: i64,
    pub last_invite_at: String,
    pub types: BTreeMap<String, i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub target_user_id: Option<String>,
    #[serde(default)]
    pub types: Vec<String>,
    pub time_window: TimeWindow,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogOutput {
    pub rows: Vec<FriendLogRow>,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogRow {
    pub created_at: String,
    pub kind: String,
    pub user_id: String,
    pub display_name: String,
    pub previous_display_name: String,
    pub trust_level: String,
    pub previous_trust_level: String,
    pub friend_number: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FriendChangeKind {
    #[default]
    Status,
    Avatar,
    Bio,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendChangesInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub target_user_id: Option<String>,
    pub time_window: TimeWindow,
    #[serde(default)]
    pub kind: FriendChangeKind,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendChangesOutput {
    pub rows: Vec<FriendChangeRow>,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendChangeRow {
    pub user_id: String,
    pub display_name: String,
    pub change_count: i64,
    pub last_changed_at: String,
    pub recent_events: Vec<FriendChangeEvent>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendChangeEvent {
    pub changed_at: String,
    pub kind: FriendChangeKind,
    pub previous_value: String,
    pub new_value: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteLocalInput {
    pub kind: String,
    pub entity_id: String,
    pub group: String,
    #[serde(default = "default_add_action")]
    pub action: String,
    #[serde(default = "default_true")]
    pub dry_run: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteOutput {
    pub kind: String,
    pub entity_id: String,
    pub group: String,
    pub action: String,
    pub dry_run: bool,
    pub affected_rows: i64,
    pub caveats: Vec<String>,
}

fn default_true() -> bool {
    true
}

fn default_add_action() -> String {
    "add".into()
}
