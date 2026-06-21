use super::message_dispatch::json_string_field;
use super::*;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

const NOTIFICATION_RESOLVE_BUDGET_MS: u64 = 2_500;
const NOTIFICATION_RESOLVE_ATTEMPTS: usize = 3;
const NOTIFICATION_RESOLVE_RETRY_DELAY_MS: u64 = 100;

impl RealtimeHostRuntime {
    pub(super) fn enrich_projection_world_names(&self, entries: &mut [Value]) -> Vec<String> {
        let mut unresolved_world_ids = Vec::new();
        for entry in entries {
            if let Some(world_id) = self.enrich_world_name(entry) {
                unresolved_world_ids.push(world_id);
            }
        }
        unresolved_world_ids
    }

    pub(super) fn enrich_notification_world_names(
        &self,
        projection: &mut RealtimeNotificationProjection,
    ) -> Vec<String> {
        let mut unresolved_world_ids = Vec::new();
        for upsert in &mut projection.upserts {
            if let Some(world_id) = self.enrich_world_name(&mut upsert.notification) {
                unresolved_world_ids.push(world_id);
            }
        }
        unresolved_world_ids
    }

    pub(super) fn enrich_notification_sender_names(
        &self,
        projection: &mut RealtimeNotificationProjection,
    ) {
        let endpoint = self.active_endpoint();
        for upsert in &mut projection.upserts {
            self.enrich_sender_name(&endpoint, &mut upsert.notification);
        }
    }

    pub(super) fn enrich_persistence_sender_names(
        &self,
        persistence: &mut RealtimePersistenceBatch,
    ) {
        let endpoint = self.active_endpoint();
        for notification in &mut persistence.notification_v1_upserts {
            self.enrich_sender_name(&endpoint, notification);
        }
        for notification in &mut persistence.notification_v2_upserts {
            self.enrich_sender_name(&endpoint, notification);
        }
        for update in &mut persistence.notification_v2_updates {
            self.enrich_sender_name(&endpoint, &mut update.updates);
        }
    }

    fn enrich_sender_name(&self, endpoint: &str, value: &mut Value) -> bool {
        if let Some(name) = meaningful_sender_name(value) {
            apply_sender_display_name(value, &name);
            return true;
        }
        let sender_id = sender_user_id(value);
        if !sender_id.starts_with("usr_") {
            return false;
        }
        let Some(display_name) = self.cached_user_display_name(endpoint, &sender_id) else {
            return false;
        };
        apply_sender_display_name(value, &display_name);
        true
    }

    fn cached_user_display_name(&self, endpoint: &str, user_id: &str) -> Option<String> {
        let user = self.user_cache.get_user(endpoint, user_id)?;
        let display_name = user
            .get("displayName")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        is_meaningful_actor_name(display_name).then(|| display_name.to_string())
    }

    pub(super) fn finalize_notification_output_for_delivery(
        &self,
        output: &mut RealtimeNotificationOutput,
    ) {
        self.sync_persistence_notifications_from_projection(output);
        self.sanitize_persistence_notification_names(&mut output.persistence);
        self.sanitize_projection_notification_names(&mut output.projection);
        for upsert in &mut output.projection.upserts {
            if upsert.insert_defaults.is_some() {
                continue;
            }
            if !notification_is_deliverable(&upsert.notification) {
                upsert.notify_menu = false;
                upsert.deliver_runtime = false;
                upsert.run_automation = false;
            }
        }
    }

    pub(super) async fn resolve_notification_output_names(
        self: &Arc<Self>,
        output: &mut RealtimeNotificationOutput,
    ) {
        let endpoint = self.active_endpoint();
        if endpoint.is_empty() {
            return;
        }
        let deadline = Instant::now() + Duration::from_millis(NOTIFICATION_RESOLVE_BUDGET_MS);
        for upsert in &mut output.projection.upserts {
            if !notification_upsert_needs_remote_resolution(upsert) {
                continue;
            }
            self.resolve_notification_sender_name(&endpoint, &mut upsert.notification, deadline)
                .await;
            self.resolve_notification_world_name(&endpoint, &mut upsert.notification, deadline)
                .await;
        }
        self.sync_persistence_notifications_from_projection(output);
    }

    async fn resolve_notification_sender_name(
        self: &Arc<Self>,
        endpoint: &str,
        value: &mut Value,
        deadline: Instant,
    ) {
        if self.enrich_sender_name(endpoint, value) {
            return;
        }
        let sender_id = sender_user_id(value);
        if !sender_id.starts_with("usr_") {
            return;
        }
        let Some(display_name) = self
            .fetch_user_display_name_with_retries(endpoint, &sender_id, deadline)
            .await
        else {
            return;
        };
        apply_sender_display_name(value, &display_name);
    }

    async fn resolve_notification_world_name(
        self: &Arc<Self>,
        endpoint: &str,
        value: &mut Value,
        deadline: Instant,
    ) {
        let Some(world_id) = self.enrich_world_name(value) else {
            return;
        };
        let Some(world_name) = self
            .fetch_world_name_with_retries(endpoint, &world_id, deadline)
            .await
        else {
            return;
        };
        apply_world_name(value, &world_name);
    }

    async fn fetch_user_display_name_with_retries(
        self: &Arc<Self>,
        endpoint: &str,
        user_id: &str,
        deadline: Instant,
    ) -> Option<String> {
        for attempt in 0..NOTIFICATION_RESOLVE_ATTEMPTS {
            if let Some(display_name) = self.cached_user_display_name(endpoint, user_id) {
                return Some(display_name);
            }
            let remaining = deadline.checked_duration_since(Instant::now())?;
            let response = tokio::time::timeout(
                remaining,
                self.get_user_via_cache(
                    endpoint.to_string(),
                    user_id.to_string(),
                    false,
                    false,
                    None,
                ),
            )
            .await;
            match response {
                Ok(Ok(response)) if (200..300).contains(&response.status) => {
                    let profile = serde_json::from_str::<Value>(&response.data).ok()?;
                    let display_name = profile
                        .get("displayName")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default();
                    if is_meaningful_actor_name(display_name) {
                        return Some(display_name.to_string());
                    }
                    return None;
                }
                Ok(Ok(response)) if (500..600).contains(&response.status) => {}
                Ok(Err(_)) => {}
                Ok(Ok(_)) | Err(_) => return None,
            }
            if attempt + 1 < NOTIFICATION_RESOLVE_ATTEMPTS {
                sleep_before_retry(deadline).await;
            }
        }
        None
    }

    async fn fetch_world_name_with_retries(
        self: &Arc<Self>,
        endpoint: &str,
        world_id: &str,
        deadline: Instant,
    ) -> Option<String> {
        for attempt in 0..NOTIFICATION_RESOLVE_ATTEMPTS {
            if let Some(name) = lookup_cached_world_name(self.deps.db.as_ref(), world_id) {
                return Some(name);
            }
            let remaining = deadline.checked_duration_since(Instant::now())?;
            let response = tokio::time::timeout(
                remaining,
                self.fetch_and_cache_world_once(endpoint.to_string(), world_id.to_string()),
            )
            .await;
            match response {
                Ok(WorldNameFetchOutcome::Found(name)) => return Some(name),
                Ok(WorldNameFetchOutcome::RetryableFailure) => {}
                Ok(WorldNameFetchOutcome::PermanentFailure) | Err(_) => return None,
            }
            if attempt + 1 < NOTIFICATION_RESOLVE_ATTEMPTS {
                sleep_before_retry(deadline).await;
            }
        }
        None
    }

    fn sync_persistence_notifications_from_projection(
        &self,
        output: &mut RealtimeNotificationOutput,
    ) {
        let mut by_id = HashMap::new();
        for upsert in &output.projection.upserts {
            let id = notification_id(&upsert.notification);
            if !id.is_empty() {
                by_id.insert(id, upsert.notification.clone());
            }
        }
        for notification in &mut output.persistence.notification_v1_upserts {
            if let Some(resolved) = by_id.get(&notification_id(notification)) {
                *notification = resolved.clone();
            }
        }
        for notification in &mut output.persistence.notification_v2_upserts {
            if let Some(resolved) = by_id.get(&notification_id(notification)) {
                *notification = resolved.clone();
            }
        }
    }

    fn sanitize_projection_notification_names(
        &self,
        projection: &mut RealtimeNotificationProjection,
    ) {
        for upsert in &mut projection.upserts {
            sanitize_notification_display_names(&mut upsert.notification);
        }
    }

    fn sanitize_persistence_notification_names(&self, persistence: &mut RealtimePersistenceBatch) {
        for notification in &mut persistence.notification_v1_upserts {
            sanitize_notification_display_names(notification);
        }
        for notification in &mut persistence.notification_v2_upserts {
            sanitize_notification_display_names(notification);
        }
        for update in &mut persistence.notification_v2_updates {
            sanitize_notification_display_names(&mut update.updates);
        }
    }

    pub(super) fn projection_has_visible_notification_work(
        &self,
        projection: &RealtimeNotificationProjection,
    ) -> bool {
        projection
            .upserts
            .iter()
            .any(notification_upsert_is_visible)
            || !projection.expired_ids.is_empty()
            || !projection.seen_ids.is_empty()
            || projection.clear_menu_if_no_unseen
    }

    pub(super) fn visible_notification_projection(
        &self,
        mut projection: RealtimeNotificationProjection,
    ) -> RealtimeNotificationProjection {
        projection.upserts.retain(notification_upsert_is_visible);
        projection
    }

    pub(super) fn notification_output_needs_remote_resolution(
        &self,
        output: &RealtimeNotificationOutput,
    ) -> bool {
        output
            .projection
            .upserts
            .iter()
            .any(notification_upsert_needs_remote_resolution)
    }

    pub(super) fn enrich_persistence_world_names(
        &self,
        persistence: &mut RealtimePersistenceBatch,
    ) -> Vec<String> {
        let mut unresolved_world_ids =
            self.enrich_projection_world_names(&mut persistence.feed_entries);
        for notification in &mut persistence.notification_v1_upserts {
            if let Some(world_id) = self.enrich_world_name(notification) {
                unresolved_world_ids.push(world_id);
            }
        }
        for notification in &mut persistence.notification_v2_upserts {
            if let Some(world_id) = self.enrich_world_name(notification) {
                unresolved_world_ids.push(world_id);
            }
        }
        for update in &mut persistence.notification_v2_updates {
            if let Some(world_id) = self.enrich_world_name(&mut update.updates) {
                unresolved_world_ids.push(world_id);
            }
        }
        unresolved_world_ids
    }

    fn enrich_world_name(&self, value: &mut Value) -> Option<String> {
        let object = value.as_object_mut()?;
        let top_level_name = object_string(object, "worldName");
        let details_name = nested_object_string(object, &["details", "worldName"]);
        let top_level_is_meaningful = is_meaningful_world_name(&top_level_name);
        let details_is_meaningful = is_meaningful_world_name(&details_name);
        if top_level_is_meaningful && details_is_meaningful {
            return None;
        }

        let mut unresolved_world_id = None;
        let world_name = if top_level_is_meaningful {
            Some(top_level_name)
        } else if details_is_meaningful {
            Some(details_name)
        } else {
            let world_id = notification_world_id_from_object(object);
            if world_id.is_empty() {
                None
            } else {
                match lookup_cached_world_name(self.deps.db.as_ref(), &world_id) {
                    Some(world_name) => Some(world_name),
                    None => {
                        unresolved_world_id = Some(world_id);
                        None
                    }
                }
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
        unresolved_world_id
    }

    pub(super) fn enrich_current_user_location_output(
        &self,
        output: &mut RealtimeCurrentUserOutput,
    ) {
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

async fn sleep_before_retry(deadline: Instant) {
    let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
        return;
    };
    let delay = Duration::from_millis(NOTIFICATION_RESOLVE_RETRY_DELAY_MS).min(remaining);
    if delay > Duration::ZERO {
        tokio::time::sleep(delay).await;
    }
}

fn notification_upsert_needs_remote_resolution(upsert: &RealtimeNotificationUpsert) -> bool {
    if upsert.insert_defaults.is_some() || !notification_upsert_is_visible(upsert) {
        return false;
    }
    notification_has_unresolved_required_display(&upsert.notification)
}

fn notification_upsert_is_visible(upsert: &RealtimeNotificationUpsert) -> bool {
    upsert.notify_menu
        || upsert.deliver_runtime
        || upsert.run_automation
        || upsert.insert_defaults.is_some()
}

fn notification_is_deliverable(value: &Value) -> bool {
    !notification_has_unresolved_required_display(value)
}

fn notification_has_unresolved_required_display(value: &Value) -> bool {
    (notification_requires_sender_name(value) && meaningful_sender_name(value).is_none())
        || notification_requires_world_name(value)
            && !notification_has_meaningful_world_name(value)
            && !notification_has_private_location_label(value)
}

fn notification_requires_sender_name(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object_string(object, "senderUserId").starts_with("grp_") {
        return false;
    }
    matches!(
        object_string(object, "type").as_str(),
        "friendRequest"
            | "ignoredFriendRequest"
            | "invite"
            | "requestInvite"
            | "inviteResponse"
            | "requestInviteResponse"
            | "boop"
            | "message"
    )
}

fn notification_requires_world_name(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    matches!(
        object_string(object, "type").as_str(),
        "invite" | "requestInvite" | "inviteResponse" | "requestInviteResponse"
    ) && !notification_world_id(value).is_empty()
}

fn notification_has_meaningful_world_name(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    is_meaningful_world_name(&object_string(object, "worldName"))
        || is_meaningful_world_name(&nested_object_string(object, &["details", "worldName"]))
}

fn notification_has_private_location_label(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    [
        object_string(object, "location"),
        object_string(object, "instanceLocation"),
        nested_object_string(object, &["details", "location"]),
    ]
    .iter()
    .any(|value| {
        matches!(
            value.trim(),
            "private" | "offline" | "traveling" | "traveling~private"
        )
    })
}

fn meaningful_sender_name(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    [
        object_string(object, "senderDisplayName"),
        object_string(object, "displayName"),
        object_string(object, "senderUsername"),
        nested_object_string(object, &["details", "senderDisplayName"]),
        nested_object_string(object, &["details", "displayName"]),
        nested_object_string(object, &["data", "senderDisplayName"]),
        nested_object_string(object, &["data", "displayName"]),
    ]
    .into_iter()
    .find(|name| is_meaningful_actor_name(name))
}

fn sender_user_id(value: &Value) -> String {
    let Some(object) = value.as_object() else {
        return String::new();
    };
    let sender_user_id = object_string(object, "senderUserId");
    if sender_user_id.is_empty() {
        object_string(object, "userId")
    } else {
        sender_user_id
    }
}

fn apply_sender_display_name(value: &mut Value, display_name: &str) {
    let display_name = display_name.trim();
    if !is_meaningful_actor_name(display_name) {
        return;
    }
    let Some(object) = value.as_object_mut() else {
        return;
    };
    object.insert(
        "senderDisplayName".into(),
        Value::String(display_name.to_string()),
    );
    let sender_username = object_string(object, "senderUsername");
    if !is_meaningful_actor_name(&sender_username) {
        object.insert(
            "senderUsername".into(),
            Value::String(display_name.to_string()),
        );
    }
}

fn apply_world_name(value: &mut Value, world_name: &str) {
    let world_name = world_name.trim();
    if !is_meaningful_world_name(world_name) {
        return;
    }
    let Some(object) = value.as_object_mut() else {
        return;
    };
    if !is_meaningful_world_name(&object_string(object, "worldName")) {
        object.insert("worldName".into(), Value::String(world_name.to_string()));
    }
    let details = ensure_details_object(object);
    if !is_meaningful_world_name(&object_string(details, "worldName")) {
        details.insert("worldName".into(), Value::String(world_name.to_string()));
    }
}

fn sanitize_notification_display_names(value: &mut Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    for key in ["senderDisplayName", "displayName", "senderUsername"] {
        let current = object_string(object, key);
        if !current.is_empty() && !is_meaningful_actor_name(&current) {
            object.insert(key.into(), Value::String(String::new()));
        }
    }

    sanitize_world_name_fields(object);
    if let Some(details) = object.get_mut("details").and_then(Value::as_object_mut) {
        sanitize_world_name_fields(details);
    }
}

fn notification_id(value: &Value) -> String {
    let Some(object) = value.as_object() else {
        return String::new();
    };
    let id = object_string(object, "id");
    if id.is_empty() {
        object_string(object, "notificationId")
    } else {
        id
    }
}

fn notification_world_id(value: &Value) -> String {
    let Some(object) = value.as_object() else {
        return String::new();
    };
    notification_world_id_from_object(object)
}

fn notification_world_id_from_object(object: &serde_json::Map<String, Value>) -> String {
    first_world_id([
        object_string(object, "worldId"),
        object_string(object, "worldName"),
        object_string(object, "location"),
        object_string(object, "instanceLocation"),
        nested_object_string(object, &["details", "worldId"]),
        nested_object_string(object, &["details", "worldName"]),
        nested_object_string(object, &["details", "location"]),
    ])
}

fn sanitize_world_name_fields(object: &mut serde_json::Map<String, Value>) {
    let world_name = object_string(object, "worldName");
    let world_id = world_id_from_location_or_id(&world_name);
    if world_id.is_empty() {
        return;
    }
    if object_string(object, "worldId").is_empty() {
        object.insert("worldId".into(), Value::String(world_id));
    }
    object.insert("worldName".into(), Value::String(String::new()));
}

fn ensure_details_object(
    object: &mut serde_json::Map<String, Value>,
) -> &mut serde_json::Map<String, Value> {
    if !object.get("details").is_some_and(Value::is_object) {
        object.insert("details".into(), Value::Object(serde_json::Map::new()));
    }
    object
        .get_mut("details")
        .and_then(Value::as_object_mut)
        .expect("details was inserted as an object")
}

fn is_meaningful_actor_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && !trimmed.starts_with("usr_") && !trimmed.starts_with("grp_")
}
