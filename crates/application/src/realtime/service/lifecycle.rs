use super::message_dispatch::json_string_field;
use super::types::{
    ActiveRealtimeContext, PendingFriendBaseline, RealtimeHostRuntimeMessageSink,
    RealtimeHostRuntimeState, MAX_QUEUED_FRIEND_MESSAGES,
};
use super::*;

const FRIEND_PROFILE_REFETCH_THROTTLE_MS: i64 = 10_000;

impl RealtimeHostRuntime {
    pub fn new(deps: RealtimeHostRuntimeDeps) -> Self {
        let (cancel_tx, _) = watch::channel(0);
        Self {
            deps,
            state: Mutex::new(RealtimeHostRuntimeState::default()),
            cancel_tx,
            friends: RealtimeFriendsRuntime::new(),
            current_user: RealtimeCurrentUserRuntime::new(),
        }
    }

    pub fn start(
        self: &Arc<Self>,
        user_id: String,
        endpoint: String,
        websocket: String,
        client_run_id: u64,
        current_user_snapshot: serde_json::Value,
        friends_by_id: HashMap<String, FriendRecord>,
    ) -> Result<RealtimeTransportStartResult> {
        let session = RealtimeSessionContext::new(user_id, endpoint, websocket);
        if session.user_id.is_empty() {
            return Err(Error::Custom(
                "Runtime realtime transport requires an authenticated user.".into(),
            ));
        }
        let mut friends_by_id = friends_by_id;
        let mut baseline_started_ms = chrono::Utc::now().timestamp_millis();
        let generation = {
            let mut state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            state.generation = state.generation.saturating_add(1);
            state.generation
        };
        let session_generation =
            self.deps
                .session
                .set_realtime_context(crate::session::RealtimeSessionContext::new(
                    session.user_id.clone(),
                    session.endpoint.clone(),
                    session.websocket.clone(),
                ));
        {
            let mut state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            state.active_context = Some(ActiveRealtimeContext {
                session: session.clone(),
                generation,
                client_run_id,
                session_generation,
            });
            if let Some(pending) = state.pending_friend_baseline.take() {
                if pending.session == session {
                    baseline_started_ms = pending.baseline_started_ms;
                    friends_by_id = pending.friends_by_id;
                }
            }
            state.friend_messages_paused = false;
            state.queued_friend_messages.clear();
            state.friend_profile_refetches.clear();
            self.friends.clear();
            self.current_user.clear();
            let friend_user_ids = friends_by_id.keys().cloned().collect::<Vec<_>>();
            self.friends.set_baseline_with_started_at(
                FriendRosterBaseline {
                    current_user_id: session.user_id.clone(),
                    endpoint: session.endpoint.clone(),
                    websocket: session.websocket.clone(),
                    friends_by_id,
                },
                generation,
                0,
                baseline_started_ms,
            );
            self.deps
                .overlay_activity
                .set_friend_user_ids(friend_user_ids);
            self.current_user.set_snapshot(
                session.user_id.clone(),
                generation,
                current_user_snapshot,
            );
        }
        let transport_deps = RealtimeTransportDeps {
            db: Arc::clone(&self.deps.db),
            web: Arc::clone(&self.deps.web),
            event_bus: self.deps.event_bus.clone(),
            session: self.deps.session.clone(),
        };
        let message_sink: Arc<dyn RealtimeMessageSink> = Arc::new(RealtimeHostRuntimeMessageSink {
            runtime: Arc::clone(self),
        });
        let cancel_rx = self.cancel_tx.subscribe();
        let _ = self.cancel_tx.send(generation);
        self.deps.sync.record(
            "realtime",
            "running",
            format!("Realtime transport generation {generation} started."),
            0,
        );
        self.deps.tasks.spawn(async move {
            run_realtime_transport(
                transport_deps,
                message_sink,
                client_run_id,
                generation,
                session_generation,
                session,
                cancel_rx,
            )
            .await;
        });

        if self.deps.session.snapshot().is_game_running {
            self.sync_current_user_game_running_state(generation, true);
        }

        Ok(RealtimeTransportStartResult {
            generation,
            client_run_id,
            session_generation,
        })
    }

    pub fn friend_snapshot(&self) -> Option<crate::realtime::RealtimeFriendSnapshot> {
        self.friends.snapshot()
    }

    pub fn current_user_snapshot(&self) -> Option<serde_json::Value> {
        self.current_user.snapshot_value()
    }

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
                .refresh_friend_baseline_after_reconnect(active, refresh_token, current_user_snapshot)
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
        let friends_by_id = match serde_json::from_value::<HashMap<String, FriendRecord>>(
            friends_value,
        ) {
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

    fn sync_reconnect_friend_baseline_if_current(
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

    pub fn apply_friend_profile_refresh(
        self: &Arc<Self>,
        endpoint: String,
        user_id: String,
        profile: serde_json::Value,
    ) -> Result<bool> {
        let normalized_user_id = user_id.trim().to_string();
        if normalized_user_id.is_empty() {
            return Ok(false);
        }
        let profile_user_id = json_string_field(profile.get("id"));
        if profile_user_id != normalized_user_id {
            return Ok(false);
        }
        let requested_endpoint = endpoint.trim().to_string();
        let active = {
            let state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            let Some(active) = state.active_context.clone() else {
                return Ok(false);
            };
            if active.session.endpoint != requested_endpoint
                || !self.is_message_current_locked(
                    &state,
                    active.generation,
                    active.session_generation,
                    &active.session,
                )
            {
                return Ok(false);
            }
            active
        };
        if !self
            .friends
            .has_friend(active.generation, &normalized_user_id)
        {
            return Ok(false);
        }
        match self.friends.apply_refetched_user_profile(
            active.generation,
            &normalized_user_id,
            profile,
            &chrono::Utc::now().to_rfc3339(),
        ) {
            RealtimeFriendApplyResult::Output(output) => {
                self.apply_friend_output(*output);
                Ok(true)
            }
            RealtimeFriendApplyResult::MissingBaseline | RealtimeFriendApplyResult::Ignored => Ok(false),
        }
    }

    pub fn sync_current_user_snapshot(
        &self,
        user_id: String,
        endpoint: String,
        websocket: String,
        generation: Option<u64>,
        snapshot: serde_json::Value,
        overlay_patch: serde_json::Value,
    ) -> Result<bool> {
        let requested_session = RealtimeSessionContext::new(user_id, endpoint, websocket);
        let active = {
            let state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            let Some(active) = state.active_context.clone() else {
                return Ok(false);
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
                return Ok(false);
            }
            active
        };

        let Some(output) = self.current_user.apply_refreshed_snapshot(
            active.generation,
            snapshot,
            overlay_patch,
            self.current_user_authority(),
        ) else {
            return Ok(false);
        };
        self.apply_current_user_output(output);
        Ok(true)
    }

    pub fn expire_notification(&self, user_id: String, notification_id: String) -> Result<()> {
        let user_id = user_id.trim().to_string();
        let notification_id = notification_id.trim().to_string();
        if user_id.is_empty() || notification_id.is_empty() {
            return Ok(());
        }

        let batch = RealtimePersistenceBatch {
            notification_expirations: vec![NotificationExpiration {
                id: notification_id,
                expired_at: chrono::Utc::now().to_rfc3339(),
            }],
            ..RealtimePersistenceBatch::default()
        };
        let persistence_attempted = !batch.is_empty();
        let result = write_realtime_batch(&self.deps.db, &user_id, &batch)
            .map_err(|error| Error::Custom(format!("expire realtime notification: {error}")));
        match &result {
            Ok(counts) => {
                self.deps.sync.record(
                    "realtimeNotifications",
                    "persisted",
                    "Realtime notification expiration persisted by Rust.",
                    0,
                );
                self.emit_realtime_persisted(*counts, persistence_attempted);
            }
            Err(error) => self
                .deps
                .sync
                .record_failure("realtimeNotifications", error.to_string()),
        }
        result.map(|_| ())
    }

    pub fn stop(&self, request: RealtimeStopRequest) {
        let (
            websocket_domain,
            client_run_id,
            generation,
            session_generation,
            final_current_user_output,
        ) = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };

            let Some(active) = state.active_context.clone() else {
                if request.has_scope() {
                    return;
                }
                state.generation = state.generation.saturating_add(1);
                let _ = self.cancel_tx.send(state.generation);
                return;
            };

            if !request.matches_active(&active) {
                tracing::warn!(
                    client_run_id = ?request.client_run_id,
                    generation = ?request.generation,
                    active_client_run_id = active.client_run_id,
                    active_generation = active.generation,
                    "[Realtime] ignored stale stop request"
                );
                return;
            }

            let websocket_domain = normalize_websocket_domain(&active.session.websocket);
            let final_current_user_output = self
                .current_user
                .apply_game_running_state(active.generation, false);
            state.generation = state.generation.saturating_add(1);
            state.active_context = None;
            state.pending_friend_baseline = None;
            state.friend_messages_paused = false;
            state.queued_friend_messages.clear();
            state.friend_profile_refetches.clear();
            let _ = self.cancel_tx.send(state.generation);
            self.deps.session.clear_realtime_context();
            self.friends.clear();
            self.current_user.clear();
            (
                websocket_domain,
                active.client_run_id,
                active.generation,
                active.session_generation,
                final_current_user_output,
            )
        };

        if let Some(output) = final_current_user_output {
            self.apply_current_user_output(output);
        }

        self.deps
            .event_bus
            .emit_realtime_ws_status(RealtimeWsStatusPayload {
                status: "disconnected".into(),
                websocket_domain,
                at: chrono::Utc::now().to_rfc3339(),
                client_run_id: Some(client_run_id),
                generation: Some(generation),
                session_generation: Some(session_generation),
                reason: None,
                status_code: None,
            });
        self.deps
            .sync
            .record("realtime", "idle", "Realtime transport stopped.", 0);
    }

    fn is_friend_output_current_locked(
        &self,
        state: &RealtimeHostRuntimeState,
        projection: &FriendProjection,
    ) -> bool {
        let Some(active) = state.active_context.as_ref() else {
            return false;
        };
        active.generation == projection.generation
            && self
                .deps
                .session
                .is_realtime_generation_active(active.session_generation)
    }

    pub(super) fn is_message_current_locked(
        &self,
        state: &RealtimeHostRuntimeState,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
    ) -> bool {
        state
            .active_context
            .as_ref()
            .map(|active| {
                active.generation == generation
                    && active.session_generation == session_generation
                    && active.session == *session
                    && self
                        .deps
                        .session
                        .is_realtime_generation_active(session_generation)
            })
            .unwrap_or(false)
    }

    pub(super) fn queue_friend_message_locked(
        &self,
        state: &mut RealtimeHostRuntimeState,
        generation: u64,
        payload: &RealtimeWsMessagePayload,
    ) {
        if state.queued_friend_messages.len() >= MAX_QUEUED_FRIEND_MESSAGES {
            state.queued_friend_messages.remove(0);
            tracing::warn!(
                generation,
                max = MAX_QUEUED_FRIEND_MESSAGES,
                "[Realtime] dropped oldest queued friend message during baseline refresh"
            );
        }
        state.queued_friend_messages.push(payload.clone());
    }

    pub(super) fn handle_friend_ws_message(
        self: &Arc<Self>,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
        payload: &RealtimeWsMessagePayload,
    ) {
        let state = match self.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return;
            }
        };
        if !self.is_message_current_locked(&state, generation, session_generation, session) {
            return;
        }
        drop(state);

        match self.friends.apply_ws_message(payload) {
            RealtimeFriendApplyResult::Output(output) => {
                self.apply_friend_output(*output);
            }
            RealtimeFriendApplyResult::MissingBaseline => {
                tracing::warn!(
                    generation,
                    "[Realtime] friend event arrived without a baseline"
                );
            }
            RealtimeFriendApplyResult::Ignored => {}
        };
    }

    fn apply_friend_output(self: &Arc<Self>, mut output: RealtimeFriendOutput) {
        let timer_action = output.timer_action.clone();
        let profile_refetch_requests = output.profile_refetch_requests.clone();
        let mut projection = output.projection.clone();
        let projection_generation = projection.generation;
        if !self.is_friend_projection_current(&projection) {
            self.friends
                .clear_baseline_if_revision(projection.generation, projection.baseline_revision);
            return;
        }
        self.enrich_projection_world_names(&mut projection.feed_entries);
        self.enrich_persistence_world_names(&mut output.persistence);
        let persistence_attempted = !output.persistence.is_empty();
        match write_realtime_batch(&self.deps.db, &output.owner_user_id, &output.persistence) {
            Ok(counts) => {
                self.deps.sync.record(
                    "realtimeFriends",
                    "persisted",
                    "Realtime friend projection persisted by Rust.",
                    0,
                );
                self.emit_realtime_persisted(counts, persistence_attempted);
            }
            Err(error) => {
                tracing::warn!("Realtime friend persistence failed: {error}");
                self.deps
                    .sync
                    .record_failure("realtimeFriends", error.to_string());
                projection.feed_entries.clear();
            }
        }
        self.deps
            .overlay_activity
            .ingest_friend_projection(&projection);
        self.deps
            .event_bus
            .emit_realtime_friend_projection(projection);

        if let DelayedOfflineFeedTimerAction::Schedule {
            user_id,
            token,
            delay_ms,
        } = timer_action
        {
            let runtime = Arc::clone(self);
            self.deps.tasks.spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                let now = chrono::Utc::now().to_rfc3339();
                runtime.fire_delayed_offline_feed(&user_id, token, now);
            });
        }
        self.schedule_friend_profile_refetches(projection_generation, profile_refetch_requests);
    }

    fn schedule_friend_profile_refetches(
        self: &Arc<Self>,
        generation: u64,
        requests: Vec<FriendProfileRefetchRequest>,
    ) {
        if requests.is_empty() {
            return;
        }
        let now_ms = chrono::Utc::now().timestamp_millis();
        let (active, refetch_requests) = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            let Some(active) = state.active_context.clone() else {
                return;
            };
            if active.generation != generation
                || !self
                    .deps
                    .session
                    .is_realtime_generation_active(active.session_generation)
            {
                return;
            }
            let mut refetch_requests = Vec::new();
            for request in requests {
                match request {
                    FriendProfileRefetchRequest::LocationRepair { user_id } => {
                        let user_id = user_id.trim().to_string();
                        if user_id.is_empty()
                            || refetch_requests.iter().any(|existing| {
                                matches!(
                                    existing,
                                    FriendProfileRefetchRequest::LocationRepair {
                                        user_id: existing_id
                                    } if existing_id == &user_id
                                )
                            })
                        {
                            continue;
                        }
                        let recent = state
                            .friend_profile_refetches
                            .get(&user_id)
                            .map(|last_ms| {
                                now_ms.saturating_sub(*last_ms)
                                    < FRIEND_PROFILE_REFETCH_THROTTLE_MS
                            })
                            .unwrap_or(false);
                        if recent {
                            continue;
                        }
                        state
                            .friend_profile_refetches
                            .insert(user_id.clone(), now_ms);
                        refetch_requests
                            .push(FriendProfileRefetchRequest::LocationRepair { user_id });
                    }
                    FriendProfileRefetchRequest::OfflineConfirm { user_id, token } => {
                        let user_id = user_id.trim().to_string();
                        if user_id.is_empty()
                            || refetch_requests.iter().any(|existing| {
                                matches!(
                                    existing,
                                    FriendProfileRefetchRequest::OfflineConfirm {
                                        user_id: existing_id,
                                        token: existing_token,
                                    } if existing_id == &user_id && *existing_token == token
                                )
                            })
                        {
                            continue;
                        }
                        refetch_requests
                            .push(FriendProfileRefetchRequest::OfflineConfirm { user_id, token });
                    }
                }
            }
            (active, refetch_requests)
        };
        for request in refetch_requests {
            let runtime = Arc::clone(self);
            let active = active.clone();
            self.deps.tasks.spawn(async move {
                runtime.refetch_friend_profile(active, request).await;
            });
        }
    }

    async fn refetch_friend_profile(
        self: Arc<Self>,
        active: ActiveRealtimeContext,
        request: FriendProfileRefetchRequest,
    ) {
        let user_id = match &request {
            FriendProfileRefetchRequest::LocationRepair { user_id }
            | FriendProfileRefetchRequest::OfflineConfirm { user_id, .. } => user_id.clone(),
        };
        {
            let state = match self.state.lock() {
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
            ) {
                return;
            }
        }
        let refetch_request = request.clone();
        let (_, api_request) = match remote_users::user_get_input(
            active.session.endpoint.clone(),
            user_id.clone(),
        ) {
            Ok(request) => request,
            Err(error) => {
                tracing::warn!(user_id = %user_id, "Realtime friend profile refetch input failed: {error}");
                return;
            }
        };
        let response = match self
            .deps
            .web
            .execute_api(api_request, ApiScope::Vrchat, &self.deps.db)
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(user_id = %user_id, "Realtime friend profile refetch failed: {error}");
                return;
            }
        };
        if !(200..300).contains(&response.status) {
            tracing::warn!(
                user_id = %user_id,
                status = response.status,
                "Realtime friend profile refetch returned non-success"
            );
            return;
        }
        let profile = match serde_json::from_str::<Value>(&response.data) {
            Ok(profile) => profile,
            Err(error) => {
                tracing::warn!(user_id = %user_id, "Realtime friend profile refetch json failed: {error}");
                return;
            }
        };
        let profile_user_id = json_string_field(profile.get("id"));
        if profile_user_id != user_id {
            tracing::warn!(
                expected_user_id = %user_id,
                profile_user_id = %profile_user_id,
                "Realtime friend profile refetch returned a different user"
            );
            return;
        }
        {
            let state = match self.state.lock() {
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
            ) {
                return;
            }
        }
        let received_at = chrono::Utc::now().to_rfc3339();
        let result = match refetch_request {
            FriendProfileRefetchRequest::LocationRepair { .. } => self
                .friends
                .apply_refetched_user_profile(active.generation, &user_id, profile, &received_at),
            FriendProfileRefetchRequest::OfflineConfirm { token, .. } => {
                self.friends.apply_offline_confirm_user_profile(
                    active.generation,
                    &user_id,
                    token,
                    profile,
                    &received_at,
                )
            }
        };
        match result {
            RealtimeFriendApplyResult::Output(output) => {
                self.apply_friend_output(*output)
            }
            RealtimeFriendApplyResult::MissingBaseline | RealtimeFriendApplyResult::Ignored => {}
        }
    }

    fn is_friend_projection_current(&self, projection: &FriendProjection) -> bool {
        let state = match self.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                return false;
            }
        };
        self.is_friend_output_current_locked(&state, projection)
    }

    pub(super) fn apply_notification_output(&self, mut output: RealtimeNotificationOutput) {
        let mut projection = output.projection;
        self.enrich_notification_world_names(&mut projection);
        self.enrich_persistence_world_names(&mut output.persistence);
        let persistence_attempted = !output.persistence.is_empty();
        match write_realtime_batch(&self.deps.db, &output.owner_user_id, &output.persistence) {
            Ok(counts) => {
                self.deps.sync.record(
                    "realtimeNotifications",
                    "persisted",
                    "Realtime notification projection persisted by Rust.",
                    0,
                );
                self.emit_realtime_persisted(counts, persistence_attempted);
            }
            Err(error) => {
                tracing::warn!("Realtime notification persistence failed: {error}");
                self.deps
                    .sync
                    .record_failure("realtimeNotifications", error.to_string());
            }
        }
        self.deps
            .overlay_activity
            .ingest_notification_projection(&projection);
        self.deps
            .event_bus
            .emit_realtime_notification_projection(projection);
    }

    pub(super) fn apply_current_user_output(&self, mut output: RealtimeCurrentUserOutput) {
        self.enrich_current_user_location_output(&mut output);
        let projection = output.projection;
        let persistence_attempted = !output.persistence.is_empty();
        match write_realtime_batch(&self.deps.db, &output.owner_user_id, &output.persistence) {
            Ok(counts) => {
                self.deps.sync.record(
                    "realtimeCurrentUser",
                    "persisted",
                    "Realtime current-user projection persisted by Rust.",
                    0,
                );
                self.emit_realtime_persisted(counts, persistence_attempted);
            }
            Err(error) => {
                tracing::warn!("Realtime current user persistence failed: {error}");
                self.deps
                    .sync
                    .record_failure("realtimeCurrentUser", error.to_string());
            }
        }
        self.deps
            .event_bus
            .emit_realtime_current_user_projection(projection);
    }

    fn enrich_projection_world_names(&self, entries: &mut [Value]) {
        for entry in entries {
            self.enrich_world_name(entry);
        }
    }

    fn enrich_notification_world_names(&self, projection: &mut RealtimeNotificationProjection) {
        for upsert in &mut projection.upserts {
            self.enrich_world_name(&mut upsert.notification);
        }
    }

    fn enrich_persistence_world_names(&self, persistence: &mut RealtimePersistenceBatch) {
        self.enrich_projection_world_names(&mut persistence.feed_entries);
        for notification in &mut persistence.notification_v1_upserts {
            self.enrich_world_name(notification);
        }
        for notification in &mut persistence.notification_v2_upserts {
            self.enrich_world_name(notification);
        }
        for update in &mut persistence.notification_v2_updates {
            self.enrich_world_name(&mut update.updates);
        }
    }

    fn enrich_world_name(&self, value: &mut Value) {
        let Some(object) = value.as_object_mut() else {
            return;
        };
        let top_level_name = object_string(object, "worldName");
        let details_name = nested_object_string(object, &["details", "worldName"]);
        let top_level_is_meaningful = is_meaningful_world_name(&top_level_name);
        let details_is_meaningful = is_meaningful_world_name(&details_name);
        if top_level_is_meaningful && details_is_meaningful {
            return;
        }

        let world_name = if top_level_is_meaningful {
            Some(top_level_name)
        } else if details_is_meaningful {
            Some(details_name)
        } else {
            let world_id = first_world_id([
                object_string(object, "worldId"),
                object_string(object, "worldName"),
                object_string(object, "location"),
                object_string(object, "instanceLocation"),
                nested_object_string(object, &["details", "worldId"]),
                nested_object_string(object, &["details", "worldName"]),
                nested_object_string(object, &["details", "location"]),
            ]);
            if world_id.is_empty() {
                None
            } else {
                self.lookup_world_display_name(&world_id)
            }
        };

        if let Some(world_name) = world_name {
            if !top_level_is_meaningful {
                object.insert("worldName".into(), Value::String(world_name.clone()));
            }
            if !details_is_meaningful {
                if let Some(details) = object.get_mut("details").and_then(Value::as_object_mut) {
                    details.insert("worldName".into(), Value::String(world_name));
                }
            }
        }
    }

    fn lookup_world_display_name(&self, world_id: &str) -> Option<String> {
        world_cache_get(self.deps.db.as_ref(), world_id.to_string())
            .ok()
            .flatten()
            .map(|world| world.name)
            .filter(|name| is_meaningful_world_name(name))
            .or_else(|| {
                lookup_game_log_world_name(self.deps.db.as_ref(), world_id)
                    .ok()
                    .filter(|name| is_meaningful_world_name(name))
            })
    }

    fn enrich_current_user_location_output(&self, output: &mut RealtimeCurrentUserOutput) {
        let Some(location_entry) = output.persistence.game_log_locations.first_mut() else {
            return;
        };
        if !location_entry.world_name.trim().is_empty()
            && location_entry.world_name.trim() != location_entry.world_id.trim()
        {
            return;
        }
        let world_name = match lookup_game_log_world_name(&self.deps.db, &location_entry.world_id) {
            Ok(world_name) => world_name,
            Err(error) => {
                tracing::warn!("Realtime current user world-name lookup failed: {error}");
                String::new()
            }
        };
        if world_name.is_empty() {
            return;
        }
        location_entry.world_name = world_name.clone();
        if let Some(game_state_patch) = output.projection.game_state_patch.as_mut() {
            let current_world_id = json_string_field(game_state_patch.get("currentWorldId"));
            if current_world_id == location_entry.world_id {
                game_state_patch.insert("currentWorldName".into(), Value::String(world_name));
            }
        }
    }

    pub(super) fn apply_instance_closed_output(
        &self,
        owner_user_id: &str,
        output: RealtimeInstanceClosedOutput,
    ) {
        let projection = output.projection;
        let persistence_attempted = !output.persistence.is_empty();
        match write_realtime_batch(&self.deps.db, owner_user_id, &output.persistence) {
            Ok(counts) => {
                self.deps.sync.record(
                    "realtimeInstanceClosed",
                    "persisted",
                    "Realtime instance-closed projection persisted by Rust.",
                    0,
                );
                self.emit_realtime_persisted(counts, persistence_attempted);
            }
            Err(error) => {
                tracing::warn!("Realtime instance-closed persistence failed: {error}");
                self.deps
                    .sync
                    .record_failure("realtimeInstanceClosed", error.to_string());
            }
        }
        self.deps
            .overlay_activity
            .ingest_instance_closed_projection(&projection);
        self.deps
            .event_bus
            .emit_realtime_instance_closed_projection(projection);
    }

    fn emit_realtime_persisted(&self, counts: RealtimeWriteCounts, persistence_attempted: bool) {
        if persistence_attempted {
            self.deps.event_bus.emit_ws_persisted(counts.affected_count);
        }
        if counts.game_log_affected_count > 0 {
            self.deps
                .event_bus
                .emit_game_log_persisted(counts.game_log_affected_count);
        }
    }

    pub(super) fn refresh_current_user_snapshot_after_update(
        self: &Arc<Self>,
        generation: u64,
        session: RealtimeSessionContext,
        overlay_patch: serde_json::Map<String, Value>,
    ) {
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            let response = match runtime
                .deps
                .web
                .execute_api(
                    current_user_get_input(session.endpoint.clone()),
                    ApiScope::Vrchat,
                    &runtime.deps.db,
                )
                .await
            {
                Ok(result) => result,
                Err(error) => {
                    tracing::warn!("Realtime current user refresh failed: {error}");
                    return;
                }
            };
            if !(200..300).contains(&response.status) {
                tracing::warn!(
                    status = response.status,
                    "Realtime current user refresh returned non-success"
                );
                return;
            }
            let snapshot = match serde_json::from_str::<Value>(&response.data) {
                Ok(snapshot) => snapshot,
                Err(error) => {
                    tracing::warn!("Realtime current user refresh json failed: {error}");
                    return;
                }
            };
            let Some(output) = runtime.current_user.apply_refreshed_snapshot(
                generation,
                snapshot,
                serde_json::Value::Object(overlay_patch),
                runtime.current_user_authority(),
            ) else {
                return;
            };
            runtime.apply_current_user_output(output);
        });
    }

    fn fire_delayed_offline_feed(self: &Arc<Self>, user_id: &str, token: u64, now: String) {
        if let Some(output) = self.friends.fire_delayed_offline_feed(user_id, token, now) {
            self.apply_friend_output(output);
        }
    }

    fn drain_queued_friend_messages(self: &Arc<Self>, active: ActiveRealtimeContext) {
        loop {
            let queued_messages = {
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
                ) {
                    return;
                }
                if state.queued_friend_messages.is_empty() {
                    state.friend_messages_paused = false;
                    return;
                }
                std::mem::take(&mut state.queued_friend_messages)
            };

            for payload in queued_messages {
                self.handle_friend_ws_message(
                    active.generation,
                    active.session_generation,
                    &active.session,
                    &payload,
                );
            }
        }
    }

    pub(super) fn current_user_authority(&self) -> RealtimeCurrentUserAuthority {
        let session = self.deps.session.snapshot();
        let game_log_snapshot = self
            .deps
            .game_log_snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default();
        let game_log_disabled =
            config_store::get_bool(&self.deps.db, "gameLogDisabled", false).unwrap_or(false);
        RealtimeCurrentUserAuthority {
            is_game_running: session.is_game_running,
            game_log_enabled: !game_log_disabled,
            game_log_location: game_log_snapshot.location,
            game_log_destination: game_log_snapshot.destination,
            game_log_world_name: game_log_snapshot.world_name,
        }
    }

    pub(super) fn sync_current_user_game_running_state(
        &self,
        generation: u64,
        is_game_running: bool,
    ) {
        let Some(output) = self
            .current_user
            .apply_game_running_state(generation, is_game_running)
        else {
            return;
        };
        self.apply_current_user_output(output);
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

fn object_string(object: &serde_json::Map<String, Value>, key: &str) -> String {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn nested_object_string(object: &serde_json::Map<String, Value>, path: &[&str]) -> String {
    let Some((first, rest)) = path.split_first() else {
        return String::new();
    };
    let Some(mut current) = object.get(*first) else {
        return String::new();
    };
    for key in rest {
        let Some(next) = current.get(*key) else {
            return String::new();
        };
        current = next;
    }
    current
        .as_str()
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn first_world_id<const N: usize>(values: [String; N]) -> String {
    values
        .into_iter()
        .map(|value| world_id_from_location_or_id(&value))
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}

fn world_id_from_location_or_id(value: &str) -> String {
    let trimmed = value.trim();
    if !trimmed.starts_with("wrld_") {
        return String::new();
    }
    trimmed
        .split([':', '~'])
        .next()
        .unwrap_or_default()
        .to_string()
}

fn is_meaningful_world_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && !trimmed.starts_with("wrld_")
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    use serde_json::json;
    use vrcx_0_core::friends::FriendRecord;
    use vrcx_0_persistence::storage::StorageService;
    use vrcx_0_persistence::DatabaseService;

    use crate::overlay_activity::{
        OverlayActivityCandidate, OverlayActivityFilters, OverlayActivityRuntime,
    };
    use crate::{
        HostSessionRuntime, RuntimeEventBus, RuntimeSnapshot, RuntimeSyncEngine, TaskSupervisor,
        WebClient,
    };

    use super::super::types::RealtimeHostRuntimeState;
    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-realtime-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn runtime_with_active_session(
        name: &str,
    ) -> Result<(TestDir, Arc<RealtimeHostRuntime>, RealtimeSessionContext)> {
        let dir = TestDir::new(name);
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let storage = StorageService::new(&dir.path.join("storage.json"))?;
        let web = Arc::new(WebClient::new(
            &storage,
            db.as_ref(),
            "wss://pipeline.vrchat.cloud".to_string(),
        )?);
        let session = HostSessionRuntime::new();
        let host_session_generation =
            session.set_realtime_context(crate::session::RealtimeSessionContext::new(
                "usr_self".into(),
                "https://api.vrchat.cloud/api/1".into(),
                "wss://pipeline.vrchat.cloud".into(),
            ));
        let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
            db,
            web,
            event_bus: RuntimeEventBus::new(),
            sync: RuntimeSyncEngine::new(),
            tasks: TaskSupervisor::new(),
            session,
            auth_scope: RuntimeAuthScope::new(),
            game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
            overlay_activity: OverlayActivityRuntime::default(),
        }));
        let active_session = RealtimeSessionContext::new(
            "usr_self".into(),
            "https://api.vrchat.cloud/api/1".into(),
            "wss://pipeline.vrchat.cloud".into(),
        );
        {
            let mut state = runtime.state.lock().unwrap();
            *state = RealtimeHostRuntimeState {
                generation: 7,
                active_context: Some(ActiveRealtimeContext {
                    session: active_session.clone(),
                    generation: 7,
                    client_run_id: 1,
                    session_generation: host_session_generation,
                }),
                ..RealtimeHostRuntimeState::default()
            };
        }
        Ok((dir, runtime, active_session))
    }

    #[test]
    fn sync_friend_snapshot_updates_overlay_friend_scope() -> Result<()> {
        let dir = TestDir::new("overlay-friend-scope");
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let storage = StorageService::new(&dir.path.join("storage.json"))?;
        let web = Arc::new(WebClient::new(
            &storage,
            db.as_ref(),
            "wss://pipeline.vrchat.cloud".to_string(),
        )?);
        let session = HostSessionRuntime::new();
        let host_session_generation =
            session.set_realtime_context(crate::session::RealtimeSessionContext::new(
                "usr_self".into(),
                "https://api.vrchat.cloud/api/1".into(),
                "wss://pipeline.vrchat.cloud".into(),
            ));
        let overlay_activity =
            OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
                "version": 1,
                "wrist": {
                    "types": {
                        "invite": {
                            "scope": "friends",
                            "favoriteGroupKeys": "all"
                        }
                    }
                }
            })));
        let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
            db,
            web,
            event_bus: RuntimeEventBus::new(),
            sync: RuntimeSyncEngine::new(),
            tasks: TaskSupervisor::new(),
            session,
            auth_scope: RuntimeAuthScope::new(),
            game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
            overlay_activity: overlay_activity.clone(),
        }));
        let active_session = RealtimeSessionContext::new(
            "usr_self".into(),
            "https://api.vrchat.cloud/api/1".into(),
            "wss://pipeline.vrchat.cloud".into(),
        );
        {
            let mut state = runtime.state.lock().unwrap();
            *state = RealtimeHostRuntimeState {
                generation: 7,
                active_context: Some(ActiveRealtimeContext {
                    session: active_session.clone(),
                    generation: 7,
                    client_run_id: 1,
                    session_generation: host_session_generation,
                }),
                ..RealtimeHostRuntimeState::default()
            };
        }
        let mut friends_by_id = HashMap::new();
        friends_by_id.insert(
            "usr_new".to_string(),
            FriendRecord {
                id: "usr_new".to_string(),
                display_name: "New Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                ..FriendRecord::default()
            },
        );

        let result = runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            friends_by_id,
        )?;

        assert!(result.accepted);
        assert!(overlay_activity
            .ingest_candidate(invite_candidate("usr_new"))
            .is_some());
        Ok(())
    }

    #[test]
    fn sync_friend_snapshot_emits_projection_for_active_state_changes() -> Result<()> {
        let (_dir, runtime, active_session) = runtime_with_active_session("baseline-projection")?;
        let mut initial_friends = HashMap::new();
        initial_friends.insert(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                location: "wrld_old:123".to_string(),
                ..FriendRecord::default()
            },
        );
        runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            initial_friends,
        )?;
        runtime.deps.event_bus.take_events_for_test();

        let mut refreshed_friends = HashMap::new();
        refreshed_friends.insert(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state: "offline".to_string(),
                state_bucket: "offline".to_string(),
                location: "offline".to_string(),
                ..FriendRecord::default()
            },
        );
        let result = runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            refreshed_friends,
        )?;

        let events = runtime.deps.event_bus.take_events_for_test();
        let projection = events
            .iter()
            .find(|event| event.name == "realtimeFriendProjection")
            .expect("baseline refresh should emit a friend projection");
        assert!(result.accepted);
        assert_eq!(result.baseline_revision, 1);
        assert_eq!(projection.payload["generation"], 7);
        assert_eq!(projection.payload["baselineRevision"], 1);
        assert_eq!(projection.payload["patches"].as_array().unwrap().len(), 1);
        assert_eq!(projection.payload["patches"][0]["userId"], "usr_friend");
        assert_eq!(projection.payload["patches"][0]["stateBucket"], "offline");
        assert_eq!(
            projection.payload["patches"][0]["patch"]["stateBucket"],
            "offline"
        );
        assert_eq!(
            projection.payload["patches"][0]["patch"]["location"],
            "offline"
        );
        Ok(())
    }

    #[test]
    fn sync_friend_snapshot_emits_projection_for_active_removals() -> Result<()> {
        let (_dir, runtime, active_session) = runtime_with_active_session("baseline-removal")?;
        let mut initial_friends = HashMap::new();
        initial_friends.insert(
            "usr_removed".to_string(),
            FriendRecord {
                id: "usr_removed".to_string(),
                display_name: "Removed Friend".to_string(),
                state: "offline".to_string(),
                state_bucket: "offline".to_string(),
                ..FriendRecord::default()
            },
        );
        runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            initial_friends,
        )?;
        runtime.deps.event_bus.take_events_for_test();

        let result = runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            HashMap::new(),
        )?;

        let events = runtime.deps.event_bus.take_events_for_test();
        let projection = events
            .iter()
            .find(|event| event.name == "realtimeFriendProjection")
            .expect("baseline removal should emit a friend projection");
        assert!(result.accepted);
        assert_eq!(result.baseline_revision, 1);
        assert!(projection.payload["patches"].as_array().unwrap().is_empty());
        assert_eq!(
            projection.payload["removals"].as_array().unwrap(),
            &vec![json!("usr_removed")]
        );
        Ok(())
    }

    #[test]
    fn apply_friend_profile_refresh_updates_existing_friend_only() -> Result<()> {
        let (_dir, runtime, active_session) = runtime_with_active_session("profile-refresh")?;
        let mut friends_by_id = HashMap::new();
        friends_by_id.insert(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                location: "wrld_old:123".to_string(),
                ..FriendRecord::default()
            },
        );
        runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            friends_by_id,
        )?;

        let updated = runtime.apply_friend_profile_refresh(
            active_session.endpoint.clone(),
            "usr_friend".into(),
            json!({
                "id": "usr_friend",
                "displayName": "Fresh Friend",
                "state": "online",
                "location": "wrld_fresh:456"
            }),
        )?;
        let stranger_added = runtime.apply_friend_profile_refresh(
            active_session.endpoint.clone(),
            "usr_stranger".into(),
            json!({
                "id": "usr_stranger",
                "displayName": "Stranger",
                "state": "online"
            }),
        )?;

        let snapshot = runtime.friend_snapshot().unwrap();
        let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
        assert!(updated);
        assert!(!stranger_added);
        assert_eq!(friend.display_name, "Fresh Friend");
        assert_eq!(friend.location, "wrld_fresh:456");
        assert!(snapshot.friends_by_id.get("usr_stranger").is_none());
        Ok(())
    }

    #[test]
    fn connected_after_reconnect_without_snapshot_resumes_queued_friend_events() -> Result<()> {
        let (_dir, runtime, active_session) = runtime_with_active_session("reconnect-drain")?;
        let active = runtime.state.lock().unwrap().active_context.clone().unwrap();
        let mut friends_by_id = HashMap::new();
        friends_by_id.insert(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                location: "wrld_old:123".to_string(),
                ..FriendRecord::default()
            },
        );
        runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(active.generation),
            friends_by_id,
        )?;
        runtime.deps.event_bus.take_events_for_test();

        let sink = RealtimeHostRuntimeMessageSink {
            runtime: Arc::clone(&runtime),
        };
        sink.handle_realtime_transport_status(
            active.generation,
            active.session_generation,
            &active_session,
            "reconnecting",
        );
        sink.handle_realtime_ws_message(
            active.generation,
            active.session_generation,
            &active_session,
            &RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-location",
                    "content": {
                        "userId": "usr_friend",
                        "location": "wrld_new:456"
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-06-08T10:05:00Z".into(),
            },
        );
        assert!(runtime.state.lock().unwrap().friend_messages_paused);

        sink.handle_realtime_transport_status(
            active.generation,
            active.session_generation,
            &active_session,
            "connected",
        );

        let events = runtime.deps.event_bus.take_events_for_test();
        let projection = events
            .iter()
            .find(|event| event.name == "realtimeFriendProjection")
            .expect("queued friend event should be drained after reconnect");
        assert!(!runtime.state.lock().unwrap().friend_messages_paused);
        assert_eq!(projection.payload["patches"][0]["userId"], "usr_friend");
        assert_eq!(
            projection.payload["patches"][0]["patch"]["location"],
            "wrld_new:456"
        );
        Ok(())
    }

    #[test]
    fn stale_reconnect_baseline_refresh_cannot_replace_active_friend_cache() -> Result<()> {
        let (_dir, runtime, active_session) = runtime_with_active_session("stale-reconnect")?;
        let active = runtime.state.lock().unwrap().active_context.clone().unwrap();
        let mut initial_friends = HashMap::new();
        initial_friends.insert(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                location: "wrld_old:123".to_string(),
                ..FriendRecord::default()
            },
        );
        runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(active.generation),
            initial_friends,
        )?;
        {
            let mut state = runtime.state.lock().unwrap();
            state.friend_messages_paused = true;
            state.friend_reconnect_refresh_token = 2;
            state.friend_reconnect_baseline_refresh_in_flight = true;
        }

        let mut stale_refresh_friends = HashMap::new();
        stale_refresh_friends.insert(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state: "offline".to_string(),
                state_bucket: "offline".to_string(),
                location: "offline".to_string(),
                ..FriendRecord::default()
            },
        );
        let result = runtime.sync_reconnect_friend_baseline_if_current(
            active.clone(),
            1,
            123,
            stale_refresh_friends,
        )?;

        let snapshot = runtime.friend_snapshot().unwrap();
        let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
        assert!(result.is_none());
        assert_eq!(friend.state_bucket, "online");
        assert!(runtime.state.lock().unwrap().friend_messages_paused);
        Ok(())
    }

    #[test]
    fn sync_friend_snapshot_caches_pre_active_baseline() -> Result<()> {
        let (_dir, runtime, active_session) = runtime_with_active_session("pre-active-baseline")?;
        {
            let mut state = runtime.state.lock().unwrap();
            state.active_context = None;
        }
        let mut friends_by_id = HashMap::new();
        friends_by_id.insert(
            "usr_cached".to_string(),
            FriendRecord {
                id: "usr_cached".to_string(),
                display_name: "Cached Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                ..FriendRecord::default()
            },
        );

        let result = runtime.sync_friend_snapshot_with_started_at(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            None,
            123,
            friends_by_id,
        )?;

        let state = runtime.state.lock().unwrap();
        let pending = state.pending_friend_baseline.as_ref().unwrap();
        assert!(result.accepted);
        assert_eq!(result.friend_count, 1);
        assert_eq!(pending.session, active_session);
        assert_eq!(pending.baseline_started_ms, 123);
        assert!(pending.friends_by_id.contains_key("usr_cached"));
        Ok(())
    }

    fn invite_candidate(user_id: &str) -> OverlayActivityCandidate {
        OverlayActivityCandidate {
            source_id: format!("invite:{user_id}"),
            activity_type: "invite".to_string(),
            created_at: "2026-06-01T00:00:00.000Z".to_string(),
            actor_user_id: user_id.to_string(),
            actor_display_name: "Friend".to_string(),
            current_instance: false,
            payload: json!({}),
        }
    }
}
