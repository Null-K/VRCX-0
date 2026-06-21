use super::*;
use vrcx_0_persistence::cache_entities::CacheEntityInput;
use vrcx_0_persistence::worlds::{world_cache_get, world_cache_upsert};
use vrcx_0_vrchat_client::worlds::world_get_input;

const WORLD_NAME_FETCH_THROTTLE_MS: i64 = 600_000;

pub(super) enum WorldNameFetchOutcome {
    Found(String),
    RetryableFailure,
    PermanentFailure,
}

impl RealtimeHostRuntime {
    pub(super) async fn fetch_and_cache_world(
        &self,
        endpoint: String,
        world_id: String,
    ) -> Option<String> {
        let world_id = world_id.trim().to_string();
        if world_id.is_empty() {
            return None;
        }
        if let Some(name) = lookup_cached_world_name(self.deps.db.as_ref(), &world_id) {
            return Some(name);
        }
        match self.fetch_and_cache_world_once(endpoint, world_id).await {
            WorldNameFetchOutcome::Found(name) => Some(name),
            WorldNameFetchOutcome::RetryableFailure | WorldNameFetchOutcome::PermanentFailure => {
                None
            }
        }
    }

    pub(super) async fn fetch_and_cache_world_once(
        &self,
        endpoint: String,
        world_id: String,
    ) -> WorldNameFetchOutcome {
        let world_id = world_id.trim().to_string();
        if world_id.is_empty() {
            return WorldNameFetchOutcome::PermanentFailure;
        }
        let Ok((_, request)) = world_get_input(endpoint, world_id.clone()) else {
            return WorldNameFetchOutcome::PermanentFailure;
        };
        let response = match self
            .deps
            .web
            .execute_api(request, ApiScope::Vrchat, self.deps.db.as_ref())
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(world_id = %world_id, "Realtime world lookup failed: {error}");
                return WorldNameFetchOutcome::RetryableFailure;
            }
        };
        if !(200..=299).contains(&response.status) {
            tracing::warn!(
                world_id = %world_id,
                status = response.status,
                "Realtime world lookup returned non-success"
            );
            if (500..600).contains(&response.status) {
                return WorldNameFetchOutcome::RetryableFailure;
            }
            return WorldNameFetchOutcome::PermanentFailure;
        }
        let world = match serde_json::from_str::<Value>(&response.data) {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(world_id = %world_id, "Realtime world lookup json failed: {error}");
                return WorldNameFetchOutcome::PermanentFailure;
            }
        };
        let name = string_value(&world, "name");
        if !is_meaningful_world_name(&name) {
            return WorldNameFetchOutcome::PermanentFailure;
        }
        let entry = CacheEntityInput {
            id: string_or_value(&world, "id", &world_id),
            author_id: value_or_null(&world, "authorId"),
            author_name: value_or_null(&world, "authorName"),
            created_at: value_or_null(&world, "createdAt"),
            description: value_or_null(&world, "description"),
            image_url: value_or_null(&world, "imageUrl"),
            name: Value::String(name.clone()),
            release_status: value_or_null(&world, "releaseStatus"),
            thumbnail_image_url: value_or_null(&world, "thumbnailImageUrl"),
            updated_at: value_or_null(&world, "updatedAt"),
            version: value_or_null(&world, "version"),
        };
        if let Err(error) = world_cache_upsert(self.deps.db.as_ref(), entry) {
            tracing::warn!(world_id = %world_id, "Realtime world cache upsert failed: {error}");
        }
        WorldNameFetchOutcome::Found(name)
    }

    pub(super) fn schedule_world_name_warm(self: &Arc<Self>, world_ids: Vec<String>) {
        if world_ids.is_empty() {
            return;
        }
        let endpoint = self.active_endpoint();
        if endpoint.is_empty() {
            return;
        }
        let mut candidate_ids = Vec::new();
        for world_id in world_ids {
            let world_id = world_id.trim().to_string();
            if world_id.is_empty() || candidate_ids.contains(&world_id) {
                continue;
            }
            if lookup_cached_world_name(self.deps.db.as_ref(), &world_id).is_some() {
                continue;
            }
            candidate_ids.push(world_id);
        }
        if candidate_ids.is_empty() {
            return;
        }
        let now_ms = chrono::Utc::now().timestamp_millis();
        let fetch_ids = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            let mut fetch_ids = Vec::new();
            for world_id in candidate_ids {
                let recent = state
                    .world_name_fetches
                    .get(&world_id)
                    .map(|last_ms| now_ms.saturating_sub(*last_ms) < WORLD_NAME_FETCH_THROTTLE_MS)
                    .unwrap_or(false);
                if recent {
                    continue;
                }
                state.world_name_fetches.insert(world_id.clone(), now_ms);
                fetch_ids.push(world_id);
            }
            fetch_ids
        };
        for world_id in fetch_ids {
            let runtime = Arc::clone(self);
            let endpoint = endpoint.clone();
            self.deps.tasks.spawn(async move {
                runtime.fetch_and_cache_world(endpoint, world_id).await;
            });
        }
    }
}

pub(super) fn lookup_cached_world_name(db: &DatabaseService, world_id: &str) -> Option<String> {
    world_cache_get(db, world_id.to_string())
        .ok()
        .flatten()
        .map(|world| world.name)
        .filter(|name| is_meaningful_world_name(name))
        .or_else(|| {
            lookup_game_log_world_name(db, world_id)
                .ok()
                .filter(|name| is_meaningful_world_name(name))
        })
}

pub(super) fn is_meaningful_world_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && !trimmed.starts_with("wrld_")
}

fn string_value(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn value_or_null(value: &Value, key: &str) -> Value {
    value.get(key).cloned().unwrap_or(Value::Null)
}

fn string_or_value(value: &Value, key: &str, fallback: &str) -> Value {
    let text = string_value(value, key);
    if text.is_empty() {
        Value::String(fallback.to_string())
    } else {
        Value::String(text)
    }
}
