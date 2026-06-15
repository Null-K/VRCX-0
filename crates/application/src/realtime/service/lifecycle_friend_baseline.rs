use super::types::{ActiveRealtimeContext, PendingFriendBaseline};
use super::*;

impl RealtimeHostRuntime {
    pub fn sync_friend_snapshot(
        self: &Arc<Self>,
        user_id: String,
        endpoint: String,
        websocket: String,
        generation: Option<u64>,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<FriendBaselineResult> {
        self.sync_friend_snapshot_with_started_at(
            user_id,
            endpoint,
            websocket,
            generation,
            0,
            friends_by_id,
        )
    }

    pub fn sync_friend_snapshot_with_started_at(
        self: &Arc<Self>,
        user_id: String,
        endpoint: String,
        websocket: String,
        generation: Option<u64>,
        baseline_started_ms: i64,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<FriendBaselineResult> {
        let requested_session = RealtimeSessionContext::new(user_id, endpoint, websocket);
        let friend_count = friends_by_id.len();
        let friend_user_ids = friends_by_id.keys().cloned().collect::<Vec<_>>();
        let (result, active, baseline_projection) = {
            let mut state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            let Some(active) = state.active_context.clone() else {
                state.pending_friend_baseline = Some(PendingFriendBaseline {
                    session: requested_session,
                    baseline_started_ms,
                    friends_by_id,
                });
                drop(state);
                self.deps.sync.record(
                    "realtimeFriends",
                    "pending",
                    "Friend baseline cached until realtime transport starts.",
                    friend_count as u64,
                );
                self.deps
                    .overlay_activity
                    .set_friend_user_ids(friend_user_ids);
                return Ok(FriendBaselineResult {
                    accepted: true,
                    generation: 0,
                    baseline_revision: 0,
                    friend_count,
                });
            };
            if active.session != requested_session
                || generation
                    .map(|generation| generation != active.generation)
                    .unwrap_or(false)
                || !self
                    .deps
                    .session
                    .is_realtime_generation_active(active.session_generation)
            {
                self.deps.sync.record(
                    "realtimeFriends",
                    "ignored",
                    "Stale friend baseline ignored by Rust realtime runtime.",
                    friend_count as u64,
                );
                return Ok(FriendBaselineResult {
                    accepted: false,
                    generation: generation.unwrap_or(active.generation),
                    baseline_revision: self
                        .friends
                        .snapshot()
                        .map(|snapshot| snapshot.baseline_revision)
                        .unwrap_or(0),
                    friend_count: friends_by_id.len(),
                });
            }

            let previous_snapshot = self
                .friends
                .snapshot()
                .filter(|snapshot| snapshot.generation == active.generation);
            let baseline_revision = previous_snapshot
                .as_ref()
                .map(|snapshot| snapshot.baseline_revision.saturating_add(1))
                .unwrap_or(0);
            let result = self.friends.set_baseline_with_started_at(
                FriendRosterBaseline {
                    current_user_id: active.session.user_id.clone(),
                    endpoint: active.session.endpoint.clone(),
                    websocket: active.session.websocket.clone(),
                    friends_by_id,
                },
                active.generation,
                baseline_revision,
                baseline_started_ms,
            );
            let baseline_projection = if result.accepted {
                self.friends
                    .snapshot()
                    .filter(|snapshot| snapshot.generation == active.generation)
                    .and_then(|snapshot| {
                        friend_snapshot_diff_projection(previous_snapshot.as_ref(), &snapshot)
                    })
            } else {
                None
            };
            state.friend_reconnect_baseline_refresh_in_flight = false;
            (result, active, baseline_projection)
        };

        if result.accepted {
            self.deps
                .overlay_activity
                .set_friend_user_ids(friend_user_ids);
        }
        if let Some(projection) = baseline_projection {
            self.apply_friend_output(RealtimeFriendOutput {
                owner_user_id: active.session.user_id.clone(),
                projection,
                ..RealtimeFriendOutput::default()
            });
        }
        self.drain_queued_friend_messages(active);
        self.deps.sync.record(
            "realtimeFriends",
            if result.accepted { "ready" } else { "ignored" },
            format!(
                "Friend baseline revision {} with {} friends.",
                result.baseline_revision, result.friend_count
            ),
            0,
        );

        Ok(result)
    }

    pub(super) fn schedule_reconnect_friend_baseline_refresh(
        self: &Arc<Self>,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
    ) {
        let (active, refresh_token, current_user_snapshot) = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            if !self.is_message_current_locked(&state, generation, session_generation, session) {
                return;
            }
            if !state.friend_messages_paused {
                return;
            }
            if state.friend_reconnect_baseline_refresh_in_flight {
                return;
            }
            let Some(active) = state.active_context.clone() else {
                return;
            };
            let Some(current_user_snapshot) = self.current_user.snapshot_value() else {
                drop(state);
                self.drain_queued_friend_messages(active);
                return;
            };
            state.friend_reconnect_baseline_refresh_in_flight = true;
            (
                active,
                state.friend_reconnect_refresh_token,
                current_user_snapshot,
            )
        };

        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            runtime
                .refresh_friend_baseline_after_reconnect(
                    active,
                    refresh_token,
                    current_user_snapshot,
                )
                .await;
        });
    }

    async fn refresh_friend_baseline_after_reconnect(
        self: Arc<Self>,
        active: ActiveRealtimeContext,
        refresh_token: u64,
        current_user_snapshot: Value,
    ) {
        let baseline_started_ms = chrono::Utc::now().timestamp_millis();
        let result = build_friend_roster_baseline(
            SocialBaselineDeps {
                db: Arc::clone(&self.deps.db),
                web: Arc::clone(&self.deps.web),
                auth_scope: self.deps.auth_scope.clone(),
                session: self.deps.session.clone(),
            },
            SocialFriendRosterBaselineInput {
                user_id: active.session.user_id.clone(),
                endpoint: active.session.endpoint.clone(),
                websocket: active.session.websocket.clone(),
                current_user_snapshot: RawJson::from(current_user_snapshot),
            },
        )
        .await;
        let output = match result {
            Ok(output) => output,
            Err(error) => {
                tracing::warn!(
                    generation = active.generation,
                    session_generation = active.session_generation,
                    refresh_token,
                    "[Realtime] reconnect friend baseline recovery failed: {error}"
                );
                self.finish_reconnect_friend_baseline_refresh(active, refresh_token, true);
                return;
            }
        };
        let Some(snapshot) = output.snapshot.as_ref().filter(|_| !output.stale) else {
            self.finish_reconnect_friend_baseline_refresh(active, refresh_token, true);
            return;
        };
        let friends_value = snapshot
            .as_value()
            .get("friendsById")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        let friends_by_id =
            match serde_json::from_value::<HashMap<String, FriendRecord>>(friends_value) {
                Ok(friends_by_id) => friends_by_id,
                Err(error) => {
                    tracing::warn!(
                        generation = active.generation,
                        session_generation = active.session_generation,
                        refresh_token,
                        "[Realtime] reconnect friend baseline recovery decode failed: {error}"
                    );
                    self.finish_reconnect_friend_baseline_refresh(active, refresh_token, true);
                    return;
                }
            };
        let sync_result = self.sync_reconnect_friend_baseline_if_current(
            active.clone(),
            refresh_token,
            baseline_started_ms,
            friends_by_id,
        );
        match sync_result {
            Ok(Some(result)) if result.accepted => {
                self.finish_reconnect_friend_baseline_refresh(active, refresh_token, false);
            }
            Ok(Some(_result)) => {
                self.finish_reconnect_friend_baseline_refresh(active, refresh_token, true);
            }
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(
                    generation = active.generation,
                    session_generation = active.session_generation,
                    refresh_token,
                    "[Realtime] reconnect friend baseline recovery sync failed: {error}"
                );
                self.finish_reconnect_friend_baseline_refresh(active, refresh_token, true);
            }
        }
    }

    pub(super) fn sync_reconnect_friend_baseline_if_current(
        self: &Arc<Self>,
        active: ActiveRealtimeContext,
        refresh_token: u64,
        baseline_started_ms: i64,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<Option<FriendBaselineResult>> {
        {
            let state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            if !self.is_message_current_locked(
                &state,
                active.generation,
                active.session_generation,
                &active.session,
            ) || state.friend_reconnect_refresh_token != refresh_token
                || !state.friend_reconnect_baseline_refresh_in_flight
            {
                return Ok(None);
            }
        }
        self.sync_friend_snapshot_with_started_at(
            active.session.user_id.clone(),
            active.session.endpoint.clone(),
            active.session.websocket.clone(),
            Some(active.generation),
            baseline_started_ms,
            friends_by_id,
        )
        .map(Some)
    }

    fn finish_reconnect_friend_baseline_refresh(
        self: &Arc<Self>,
        active: ActiveRealtimeContext,
        refresh_token: u64,
        drain_queued_messages: bool,
    ) {
        let should_drain = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            if !self.is_message_current_locked(
                &state,
                active.generation,
                active.session_generation,
                &active.session,
            ) || state.friend_reconnect_refresh_token != refresh_token
            {
                return;
            }
            state.friend_reconnect_baseline_refresh_in_flight = false;
            drain_queued_messages && state.friend_messages_paused
        };
        if should_drain {
            self.drain_queued_friend_messages(active);
        }
    }
}

fn friend_snapshot_diff_projection(
    previous: Option<&crate::realtime::RealtimeFriendSnapshot>,
    next: &crate::realtime::RealtimeFriendSnapshot,
) -> Option<FriendProjection> {
    let mut projection = FriendProjection {
        generation: next.generation,
        baseline_revision: next.baseline_revision,
        ..FriendProjection::default()
    };

    if let Some(previous) = previous {
        let mut removals = previous
            .friends_by_id
            .keys()
            .filter(|user_id| !next.friends_by_id.contains_key(*user_id))
            .cloned()
            .collect::<Vec<_>>();
        removals.sort();
        projection.removals = removals;
    }

    let mut user_ids = next.friends_by_id.keys().cloned().collect::<Vec<_>>();
    user_ids.sort();
    for user_id in user_ids {
        let Some(record) = next.friends_by_id.get(&user_id) else {
            continue;
        };
        let previous_record = previous.and_then(|snapshot| snapshot.friends_by_id.get(&user_id));
        let state_bucket = friend_record_state_bucket(record);
        let changed = !previous_record.is_some_and(|previous_record| previous_record == record);
        if !changed {
            continue;
        }
        let patch = match serde_json::to_value(record) {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(
                    user_id,
                    error = %error,
                    "[Realtime] failed to serialize friend baseline projection patch"
                );
                continue;
            }
        };
        projection
            .patches
            .push(crate::realtime::FriendProjectionPatch {
                user_id,
                patch,
                state_bucket,
                state_bucket_authority: Some("explicit".to_string()),
            });
    }

    (!projection.patches.is_empty() || !projection.removals.is_empty()).then_some(projection)
}

fn friend_record_state_bucket(record: &FriendRecord) -> String {
    vrcx_0_core::friends::normalize_state_bucket(&record.state_bucket)
        .or_else(|| vrcx_0_core::friends::normalize_state_bucket(&record.state))
        .unwrap_or_else(|| "offline".to_string())
}
