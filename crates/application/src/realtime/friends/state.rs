use super::event_patch::{
    apply_friend_event, apply_refetched_friend_profile_event, is_friend_event_type,
    record_to_value,
};
use super::persistence::{duration_ms, is_online_state, online_offline_feed_entry};
use super::utils::{string_field, EventTime};
use super::*;

pub(super) const DELAYED_OFFLINE_FEED_DELAY_MS: u64 = 170_000;

#[derive(Clone, Debug, Default)]
pub(super) struct RecentGps {
    pub(super) locations_by_tag: HashMap<String, i64>,
}

#[derive(Clone, Debug)]
pub(super) struct DelayedOfflineFeed {
    // Roster has already moved offline/active; this only delays the Offline feed write.
    pub(super) token: u64,
    pub(super) previous: FriendRecord,
    pub(super) target_state: String,
    pub(super) started_at_ms: i64,
}

#[derive(Clone, Debug, Default)]
pub(super) struct RealtimeFriendState {
    pub(super) generation: u64,
    pub(super) timer_token: u64,
    pub(super) baseline: Option<RealtimeFriendSnapshot>,
    pub(super) delayed_offline_feeds: HashMap<String, DelayedOfflineFeed>,
    pub(super) recent_gps: HashMap<String, RecentGps>,
    pub(super) friend_presence_updated_ms: HashMap<String, i64>,
}

#[derive(Clone, Debug, Default)]
pub struct RealtimeFriendsRuntime {
    state: Arc<Mutex<RealtimeFriendState>>,
}

impl RealtimeFriendsRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_baseline(
        &self,
        baseline: FriendRosterBaseline,
        realtime_generation: u64,
        baseline_revision: u64,
    ) -> FriendBaselineResult {
        self.set_baseline_with_started_at(
            baseline,
            realtime_generation,
            baseline_revision,
            Utc::now().timestamp_millis(),
        )
    }

    pub fn set_baseline_with_started_at(
        &self,
        baseline: FriendRosterBaseline,
        realtime_generation: u64,
        baseline_revision: u64,
        baseline_started_ms: i64,
    ) -> FriendBaselineResult {
        let mut baseline = baseline.normalized();
        let mut state = self.lock_state();
        let generation = realtime_generation;
        let same_generation = state
            .baseline
            .as_ref()
            .is_some_and(|snapshot| snapshot.generation == generation);
        state.generation = state.generation.max(generation);
        if same_generation {
            if let Some(existing_snapshot) = state.baseline.as_ref() {
                for (user_id, record) in baseline.friends_by_id.iter_mut() {
                    let Some(updated_ms) = state.friend_presence_updated_ms.get(user_id) else {
                        continue;
                    };
                    if *updated_ms <= baseline_started_ms {
                        continue;
                    }
                    let Some(existing_record) = existing_snapshot.friends_by_id.get(user_id) else {
                        continue;
                    };
                    preserve_newer_presence_fields(record, existing_record);
                }
            }
            state.delayed_offline_feeds.retain(|user_id, _pending| {
                baseline
                    .friends_by_id
                    .get(user_id)
                    .is_some_and(|record| !is_online_state(record))
            });
            state
                .recent_gps
                .retain(|user_id, _recent| baseline.friends_by_id.contains_key(user_id));
            state
                .friend_presence_updated_ms
                .retain(|user_id, _updated_ms| baseline.friends_by_id.contains_key(user_id));
        } else {
            state.delayed_offline_feeds.clear();
            state.recent_gps.clear();
            state.friend_presence_updated_ms.clear();
        }
        let friend_count = baseline.friends_by_id.len();
        state.baseline = Some(RealtimeFriendSnapshot {
            current_user_id: baseline.current_user_id,
            endpoint: baseline.endpoint,
            websocket: baseline.websocket,
            generation,
            baseline_revision,
            friends_by_id: baseline.friends_by_id,
        });

        FriendBaselineResult {
            accepted: true,
            generation,
            baseline_revision,
            friend_count,
        }
    }

    pub fn clear(&self) -> u64 {
        let mut state = self.lock_state();
        state.generation = state.generation.saturating_add(1);
        state.baseline = None;
        state.delayed_offline_feeds.clear();
        state.recent_gps.clear();
        state.friend_presence_updated_ms.clear();
        state.generation
    }

    pub fn clear_baseline_if_revision(&self, generation: u64, baseline_revision: u64) -> bool {
        let mut state = self.lock_state();
        let should_clear = state
            .baseline
            .as_ref()
            .map(|baseline| {
                baseline.generation == generation && baseline.baseline_revision == baseline_revision
            })
            .unwrap_or(false);
        if should_clear {
            state.generation = state.generation.saturating_add(1);
            state.baseline = None;
            state.delayed_offline_feeds.clear();
            state.recent_gps.clear();
            state.friend_presence_updated_ms.clear();
        }
        should_clear
    }

    pub fn snapshot(&self) -> Option<RealtimeFriendSnapshot> {
        self.lock_state().baseline.clone()
    }

    pub fn has_friend(&self, generation: u64, user_id: &str) -> bool {
        let normalized_user_id = user_id.trim();
        if normalized_user_id.is_empty() {
            return false;
        }
        self.lock_state()
            .baseline
            .as_ref()
            .filter(|baseline| baseline.generation == generation)
            .is_some_and(|baseline| baseline.friends_by_id.contains_key(normalized_user_id))
    }

    pub fn apply_ws_message(
        &self,
        payload: &RealtimeWsMessagePayload,
    ) -> RealtimeFriendApplyResult {
        let Some(message_type) = payload.json.get("type").and_then(Value::as_str) else {
            return RealtimeFriendApplyResult::Ignored;
        };
        if !is_friend_event_type(message_type) {
            return RealtimeFriendApplyResult::Ignored;
        }
        let content = payload.json.get("content").unwrap_or(&Value::Null);
        let now = EventTime::from_received_at(&payload.received_at);
        let mut state = self.lock_state();
        if state.baseline.is_none() {
            return RealtimeFriendApplyResult::MissingBaseline;
        }
        apply_friend_event(&mut state, message_type, content, &now)
            .map(Box::new)
            .map(RealtimeFriendApplyResult::Output)
            .unwrap_or(RealtimeFriendApplyResult::Ignored)
    }

    pub fn apply_refetched_user_profile(
        &self,
        generation: u64,
        user_id: &str,
        profile: serde_json::Value,
        received_at: &str,
    ) -> RealtimeFriendApplyResult {
        let mut state = self.lock_state();
        let Some(baseline) = state.baseline.as_ref() else {
            return RealtimeFriendApplyResult::MissingBaseline;
        };
        if baseline.generation != generation {
            return RealtimeFriendApplyResult::Ignored;
        }
        let normalized_user_id = user_id.trim();
        if normalized_user_id.is_empty() {
            return RealtimeFriendApplyResult::Ignored;
        }
        if !baseline.friends_by_id.contains_key(normalized_user_id) {
            return RealtimeFriendApplyResult::Ignored;
        }
        let content = json!({
            "userId": normalized_user_id,
            "user": profile
        });
        let now = EventTime::from_received_at(received_at);
        apply_refetched_friend_profile_event(&mut state, &content, &now)
            .map(Box::new)
            .map(RealtimeFriendApplyResult::Output)
            .unwrap_or(RealtimeFriendApplyResult::Ignored)
    }

    pub fn apply_offline_confirm_user_profile(
        &self,
        generation: u64,
        user_id: &str,
        token: u64,
        profile: serde_json::Value,
        received_at: &str,
    ) -> RealtimeFriendApplyResult {
        let mut state = self.lock_state();
        let Some(baseline) = state.baseline.as_ref() else {
            return RealtimeFriendApplyResult::MissingBaseline;
        };
        if baseline.generation != generation {
            return RealtimeFriendApplyResult::Ignored;
        }
        let normalized_user_id = user_id.trim();
        if normalized_user_id.is_empty() {
            return RealtimeFriendApplyResult::Ignored;
        }
        if !baseline.friends_by_id.contains_key(normalized_user_id) {
            return RealtimeFriendApplyResult::Ignored;
        }
        let Some(delayed) = state.delayed_offline_feeds.get(normalized_user_id) else {
            return RealtimeFriendApplyResult::Ignored;
        };
        if delayed.token != token {
            return RealtimeFriendApplyResult::Ignored;
        }
        let content = json!({
            "userId": normalized_user_id,
            "user": profile
        });
        let now = EventTime::from_received_at(received_at);
        apply_refetched_friend_profile_event(&mut state, &content, &now)
            .map(Box::new)
            .map(RealtimeFriendApplyResult::Output)
            .unwrap_or(RealtimeFriendApplyResult::Ignored)
    }

    pub fn fire_delayed_offline_feed(
        &self,
        user_id: &str,
        token: u64,
        now_iso: String,
    ) -> Option<RealtimeFriendOutput> {
        let mut state = self.lock_state();
        let baseline = state.baseline.as_ref()?;
        let owner_user_id = baseline.current_user_id.clone();
        let generation = baseline.generation;
        let baseline_revision = baseline.baseline_revision;
        let delayed = state.delayed_offline_feeds.get(user_id)?;
        if delayed.token != token {
            return None;
        }
        let delayed = state.delayed_offline_feeds.remove(user_id)?;
        state.recent_gps.remove(user_id);
        let current = state
            .baseline
            .as_ref()
            .and_then(|baseline| baseline.friends_by_id.get(user_id))?;
        let delayed_target_is_offline_like =
            matches!(delayed.target_state.as_str(), "offline" | "active");
        let current_is_offline_like = matches!(current.state_bucket.as_str(), "offline" | "active");
        if !delayed_target_is_offline_like || !current_is_offline_like {
            return None;
        }

        let previous = delayed.previous;
        let mut output = RealtimeFriendOutput {
            owner_user_id,
            projection: FriendProjection {
                generation,
                baseline_revision,
                ..FriendProjection::default()
            },
            ..RealtimeFriendOutput::default()
        };
        let current_value = record_to_value(current);
        let location = string_field(record_to_value(&previous).get("location"));
        let feed_time = EventTime::from_received_at(&now_iso)
            .timestamp_ms
            .max(delayed.started_at_ms);
        output
            .persistence
            .feed_entries
            .push(online_offline_feed_entry(
                "Offline",
                user_id,
                &current_value,
                &record_to_value(&previous),
                &location,
                duration_ms(&previous, feed_time),
                &now_iso,
            ));
        output.projection.feed_entries = output.persistence.feed_entries.clone();
        Some(output)
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, RealtimeFriendState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

fn preserve_newer_presence_fields(incoming: &mut FriendRecord, existing: &FriendRecord) {
    incoming.state = existing.state.clone();
    incoming.state_bucket = existing.state_bucket.clone();
    incoming.location = existing.location.clone();
    incoming.traveling_to_location = existing.traveling_to_location.clone();
    incoming.world_id = existing.world_id.clone();
    incoming.platform = existing.platform.clone();
    incoming.last_platform = existing.last_platform.clone();
    incoming.status = existing.status.clone();
    incoming.status_description = existing.status_description.clone();

    for key in [
        "$location",
        "$location_at",
        "locationUpdatedAt",
        "instanceId",
        "travelingToWorld",
        "travelingToInstance",
        "$travelingToLocation",
        "$travelingToTime",
        "travelingToLocation",
    ] {
        match existing.extra.get(key) {
            Some(value) => {
                incoming.extra.insert(key.to_string(), value.clone());
            }
            None => {
                incoming.extra.remove(key);
            }
        }
    }
}
