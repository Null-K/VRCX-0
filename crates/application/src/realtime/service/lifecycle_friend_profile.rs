use super::message_dispatch::json_string_field;
use super::types::ActiveRealtimeContext;
use super::*;

const FRIEND_PROFILE_REFETCH_THROTTLE_MS: i64 = 10_000;

impl RealtimeHostRuntime {
    pub fn apply_friend_profile_refresh(
        self: &Arc<Self>,
        endpoint: String,
        user_id: String,
        mut profile: serde_json::Value,
    ) -> Result<bool> {
        let normalized_user_id = user_id.trim().to_string();
        if normalized_user_id.is_empty() {
            return Ok(false);
        }
        let profile_user_id = json_string_field(profile.get("id"));
        if profile_user_id != normalized_user_id {
            return Ok(false);
        }
        if let Some(profile_object) = profile.as_object_mut() {
            vrcx_0_core::friends::strip_default_avatar_image(profile_object);
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
            RealtimeFriendApplyResult::MissingBaseline | RealtimeFriendApplyResult::Ignored => {
                Ok(false)
            }
        }
    }

    pub(super) fn schedule_friend_profile_refetches(
        self: &Arc<Self>,
        generation: u64,
        user_ids: Vec<String>,
    ) {
        if user_ids.is_empty() {
            return;
        }
        let now_ms = chrono::Utc::now().timestamp_millis();
        let (active, refetch_ids) = {
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
            let mut refetch_ids = Vec::new();
            for user_id in user_ids {
                let user_id = user_id.trim().to_string();
                if user_id.is_empty() || refetch_ids.contains(&user_id) {
                    continue;
                }
                let recent = state
                    .friend_profile_refetches
                    .get(&user_id)
                    .map(|last_ms| {
                        now_ms.saturating_sub(*last_ms) < FRIEND_PROFILE_REFETCH_THROTTLE_MS
                    })
                    .unwrap_or(false);
                if recent {
                    continue;
                }
                state
                    .friend_profile_refetches
                    .insert(user_id.clone(), now_ms);
                refetch_ids.push(user_id);
            }
            (active, refetch_ids)
        };
        for user_id in refetch_ids {
            let runtime = Arc::clone(self);
            let active = active.clone();
            self.deps.tasks.spawn(async move {
                runtime.refetch_friend_profile(active, user_id).await;
            });
        }
    }

    async fn refetch_friend_profile(
        self: Arc<Self>,
        active: ActiveRealtimeContext,
        user_id: String,
    ) {
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
        let (_, request) = match remote_users::user_get_input(
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
            .execute_api(request, ApiScope::Vrchat, &self.deps.db)
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
        match self.friends.apply_refetched_user_profile(
            active.generation,
            &user_id,
            profile,
            &chrono::Utc::now().to_rfc3339(),
        ) {
            RealtimeFriendApplyResult::Output(output) => self.apply_friend_output(*output),
            RealtimeFriendApplyResult::MissingBaseline | RealtimeFriendApplyResult::Ignored => {}
        }
    }
}
