use super::message_dispatch::json_string_field;
use super::*;

impl RealtimeHostRuntime {
    pub(super) fn enrich_projection_world_names(&self, entries: &mut [Value]) {
        for entry in entries {
            self.enrich_world_name(entry);
        }
    }

    pub(super) fn enrich_notification_world_names(
        &self,
        projection: &mut RealtimeNotificationProjection,
    ) {
        for upsert in &mut projection.upserts {
            self.enrich_world_name(&mut upsert.notification);
        }
    }

    pub(super) fn enrich_persistence_world_names(
        &self,
        persistence: &mut RealtimePersistenceBatch,
    ) {
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

fn is_meaningful_world_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && !trimmed.starts_with("wrld_")
}
