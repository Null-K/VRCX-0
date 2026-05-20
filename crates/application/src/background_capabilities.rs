use std::collections::{HashMap, HashSet};

use chrono::{Datelike, Local, Timelike, Utc};
use futures_util::{stream, StreamExt};
use serde::Serialize;
use serde_json::{json, Map, Value};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::groups::current_user_group_instances_get_input;
use vrcx_0_vrchat_client::groups::profile_get_input as group_profile_get_input;
use vrcx_0_vrchat_client::http_api::{normalize_vrchat_api_endpoint, ApiScope};
use vrcx_0_vrchat_client::users::current_user_update_input;
use vrcx_0_vrchat_client::worlds::world_get_input;

use crate::{Error, PlayerState, Result, RuntimeSnapshot, WebClient};

const DEFAULT_APP_ID: &str = "883308884863901717";
const GAME_STOP_DISCORD_CLOSE_ATTEMPTS: u8 = 5;
const DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS: i64 = 60_000;
const DEFAULT_MIN_DESCRIPTION_WRITE_INTERVAL_MS: i64 = 60_000;
const DEFAULT_STABLE_LOCATION_MS: i64 = 30_000;
const GROUP_PROFILE_HYDRATION_CONCURRENCY: usize = 4;

#[derive(Clone, Debug, Default)]
pub struct BackgroundCapabilitySession {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub current_user_snapshot: Value,
}

#[derive(Clone, Debug)]
pub struct BackgroundPresenceFactsInput {
    pub session: BackgroundCapabilitySession,
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub last_game_started_at: Option<String>,
    pub game_log_snapshot: RuntimeSnapshot,
    pub now_playing: Value,
    pub friends_by_id: HashMap<String, FriendRecord>,
    pub favorite_friend_groups_by_key: HashMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Default)]
pub struct BackgroundPresenceAutomationState {
    scope_key: String,
    last_status_write_at_ms: i64,
    last_description_write_at_ms: i64,
    last_status_value: String,
    last_description_value: String,
    next_allowed_at_ms: i64,
    last_error: String,
    time_restore_snapshots: HashMap<String, TimeRestoreSnapshot>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundPresenceAutomationResult {
    pub applied: bool,
    pub reason: String,
    pub patch: Value,
    pub updated_user: Option<Value>,
    pub matched_rule_ids: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub struct BackgroundDiscordPresenceState {
    is_active: bool,
    last_game_running: bool,
    initial_non_game_cleanup_sent: bool,
    disabled_cleanup_sent: bool,
    close_attempts_remaining: u8,
    last_location_details: DiscordLocationDetails,
}

impl BackgroundDiscordPresenceState {
    pub fn apply_set_active_result(&mut self, active: bool) {
        self.is_active = active;
        if !active {
            self.last_location_details = DiscordLocationDetails::default();
        }
    }

    pub fn apply_set_assets_result(&mut self, active: bool) {
        self.is_active = active;
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundDiscordActivityPayload {
    pub app_id: String,
    pub activity: Value,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum BackgroundDiscordPresenceCommand {
    Noop {
        detail: String,
    },
    SetActive {
        active: bool,
        force: bool,
        detail: String,
    },
    SetAssets {
        payload: BackgroundDiscordActivityPayload,
    },
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundPresenceFacts {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub current_user: Value,
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub last_game_started_at: Option<String>,
    pub current_location: String,
    pub current_destination: String,
    pub current_location_started_at: String,
    pub parsed_location: ParsedLocation,
    pub instance_type: String,
    pub players: Vec<PresencePlayer>,
    pub player_count: usize,
    pub player_facts_known: bool,
    pub observed_player_event_count: usize,
    pub friend_count: usize,
    pub present_friend_ids: Vec<String>,
    pub present_favorite_group_keys: Vec<String>,
    pub can_invite_from_current_location: bool,
    pub world_name: String,
    pub now_playing: Value,
}

#[derive(Clone, Debug, Default)]
pub struct BackgroundGroupInstancesRefresh {
    pub instances: Vec<Value>,
    pub fetched_at: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresencePlayer {
    pub id: String,
    pub user_id: String,
    pub display_name: String,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedLocation {
    pub tag: String,
    pub is_offline: bool,
    pub is_private: bool,
    pub is_traveling: bool,
    pub is_real_instance: bool,
    pub world_id: String,
    pub instance_id: String,
    pub instance_name: String,
    pub access_type: String,
    pub access_type_name: String,
    pub region: String,
    pub short_name: String,
    pub user_id: Option<String>,
    pub hidden_id: Option<String>,
    pub private_id: Option<String>,
    pub friends_id: Option<String>,
    pub group_id: Option<String>,
    pub group_access_type: Option<String>,
    pub can_request_invite: bool,
    pub strict: bool,
    pub age_gate: bool,
}

#[derive(Clone, Debug, Default)]
struct TimeRestoreSnapshot {
    previous_value: String,
    automated_value: String,
}

#[derive(Clone, Debug, Default)]
struct PatchWithTimeRestore {
    patch: Map<String, Value>,
    pending_snapshot_completions: Vec<String>,
}

#[derive(Clone, Debug)]
struct PresenceAutomationConfig {
    enabled: bool,
    rules: Vec<Value>,
    throttle: PresenceAutomationThrottle,
}

#[derive(Clone, Copy, Debug)]
struct PresenceAutomationThrottle {
    min_status_write_interval_ms: i64,
    min_description_write_interval_ms: i64,
    stable_location_ms: i64,
}

#[derive(Clone, Debug, Default)]
struct PresenceRuleEvaluation {
    patch: Map<String, Value>,
    matched_rules: Vec<MatchedPresenceRule>,
}

#[derive(Clone, Debug, Default)]
struct MatchedPresenceRule {
    id: String,
    domain: String,
    restore_previous_state: bool,
    owned_fields: Vec<String>,
}

#[derive(Clone, Debug, Default)]
struct DiscordConfig {
    discord_active: bool,
    discord_instance: bool,
    discord_hide_invite: bool,
    discord_join_button: bool,
    discord_hide_image: bool,
    discord_show_platform: bool,
    discord_world_integration: bool,
    discord_world_name_as_discord_status: bool,
}

#[derive(Clone, Debug, Default)]
struct DiscordLocationDetails {
    tag: String,
    parsed: Option<ParsedLocation>,
    world_name: String,
    thumbnail_image_url: String,
    world_capacity: i64,
    world_link: String,
    group_name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RpcWorldConfig {
    app_id: &'static str,
    activity_type: i64,
    status_display_type: i64,
    big_icon: &'static str,
}

pub fn build_background_presence_facts(
    db: &DatabaseService,
    input: BackgroundPresenceFactsInput,
) -> Result<BackgroundPresenceFacts> {
    let current_user = ensure_current_user_id(
        input.session.current_user_snapshot,
        &input.session.current_user_id,
    );
    let game_snapshot = input.game_log_snapshot;
    let current_location = resolve_current_location(&game_snapshot, &current_user)
        .trim()
        .to_string();
    let parsed_location = parse_location(&current_location);
    let instance_type = normalize_instance_type(&parsed_location);
    let has_live_location = is_live_current_location(&current_location);
    let runtime_players = normalize_runtime_players(&game_snapshot.players);
    let runtime_player_count = runtime_players.len();
    let (players, observed_player_event_count) = if has_live_location && runtime_players.is_empty()
    {
        load_players_from_persistence(db, &current_location, &game_snapshot.started_at)?
    } else {
        (runtime_players, 0)
    };
    let player_facts_known =
        has_live_location && (runtime_player_count > 0 || observed_player_event_count > 0);
    let friend_ids: Vec<String> = players
        .iter()
        .filter_map(|player| {
            if !player.user_id.is_empty() && input.friends_by_id.contains_key(&player.user_id) {
                Some(player.user_id.clone())
            } else {
                None
            }
        })
        .collect();
    let present_favorite_group_keys =
        collect_present_favorite_group_keys(db, &players, &input.favorite_friend_groups_by_key)?;
    let can_invite_from_current_location = check_can_invite(
        &current_location,
        &parsed_location,
        &input.session.current_user_id,
    );

    Ok(BackgroundPresenceFacts {
        current_user_id: input.session.current_user_id,
        endpoint: input.session.endpoint,
        websocket: input.session.websocket,
        current_user,
        is_game_running: input.is_game_running,
        is_steamvr_running: input.is_steamvr_running,
        last_game_started_at: input.last_game_started_at,
        current_location,
        current_destination: game_snapshot.destination,
        current_location_started_at: game_snapshot.started_at,
        parsed_location,
        instance_type,
        player_count: players.len(),
        players,
        player_facts_known,
        observed_player_event_count,
        friend_count: friend_ids.len(),
        present_friend_ids: friend_ids,
        present_favorite_group_keys,
        can_invite_from_current_location,
        world_name: game_snapshot.world_name,
        now_playing: input.now_playing,
    })
}

pub async fn run_background_presence_automation(
    config: &ConfigRepository,
    web: &WebClient,
    db: &DatabaseService,
    facts: &BackgroundPresenceFacts,
    state: &mut BackgroundPresenceAutomationState,
) -> Result<BackgroundPresenceAutomationResult> {
    ensure_presence_state_scope(state, facts);
    let automation_config = load_presence_automation_config(config)?;
    if !automation_config.enabled {
        return Ok(presence_result(
            false,
            "disabled",
            Value::Null,
            None,
            Vec::new(),
        ));
    }

    let evaluation = evaluate_presence_rules(facts, &automation_config.rules);
    let effective = build_patch_with_time_restore(facts, &evaluation, state);
    let changed_patch = changed_patch(&facts.current_user, &effective.patch);
    if changed_patch.is_empty() {
        complete_time_restores(state, &effective.pending_snapshot_completions);
        return Ok(presence_result(
            false,
            if evaluation.patch.is_empty() {
                "no-match"
            } else {
                "no-change"
            },
            Value::Object(effective.patch),
            None,
            matched_rule_ids(&evaluation),
        ));
    }

    if has_location_scoped_changes(&evaluation, &changed_patch) {
        if let Some(reason) =
            stable_location_skip_reason(facts, automation_config.throttle.stable_location_ms)
        {
            return Ok(presence_result(
                false,
                reason,
                Value::Object(changed_patch),
                None,
                matched_rule_ids(&evaluation),
            ));
        }
    }

    let now_ms = Utc::now().timestamp_millis();
    if now_ms < state.next_allowed_at_ms {
        return Ok(presence_result(
            false,
            "backoff",
            Value::Object(changed_patch),
            None,
            matched_rule_ids(&evaluation),
        ));
    }

    if let Some(reason) =
        throttle_skip_reason(&changed_patch, automation_config.throttle, now_ms, state)
    {
        return Ok(presence_result(
            false,
            reason,
            Value::Object(changed_patch),
            None,
            matched_rule_ids(&evaluation),
        ));
    }

    let (_, request) = current_user_update_input(
        normalize_vrchat_api_endpoint(Some(&facts.endpoint)),
        facts.current_user_id.clone(),
        Some(Value::Object(changed_patch.clone())),
    )?;
    let response = match web.execute_api(request, ApiScope::Vrchat, db).await {
        Ok(response) if (200..=299).contains(&response.status) => response,
        Ok(response) => {
            state.last_error = format!("VRChat API returned HTTP {}", response.status);
            state.next_allowed_at_ms = now_ms + DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS;
            return Ok(presence_result(
                false,
                "error",
                Value::Object(changed_patch),
                None,
                matched_rule_ids(&evaluation),
            ));
        }
        Err(error) => {
            state.last_error = error.to_string();
            state.next_allowed_at_ms = now_ms + DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS;
            return Ok(presence_result(
                false,
                "error",
                Value::Object(changed_patch),
                None,
                matched_rule_ids(&evaluation),
            ));
        }
    };

    update_presence_write_timestamps(state, &changed_patch, now_ms);
    state.last_error.clear();
    state.next_allowed_at_ms = 0;
    complete_time_restores(state, &effective.pending_snapshot_completions);
    let updated_user = parse_response_json(&response.data).unwrap_or_else(|| {
        merge_object_patch(
            facts.current_user.clone(),
            Value::Object(changed_patch.clone()),
        )
    });

    Ok(presence_result(
        true,
        "applied",
        Value::Object(changed_patch),
        Some(updated_user),
        matched_rule_ids(&evaluation),
    ))
}

pub async fn build_background_discord_presence_command(
    config: &ConfigRepository,
    web: &WebClient,
    db: &DatabaseService,
    facts: &BackgroundPresenceFacts,
    state: &mut BackgroundDiscordPresenceState,
    force: bool,
) -> Result<BackgroundDiscordPresenceCommand> {
    if !facts.is_game_running {
        if state.last_game_running {
            state.close_attempts_remaining = GAME_STOP_DISCORD_CLOSE_ATTEMPTS;
            state.last_location_details = DiscordLocationDetails::default();
            state.last_game_running = false;
        } else if !state.initial_non_game_cleanup_sent {
            state.initial_non_game_cleanup_sent = true;
            return Ok(BackgroundDiscordPresenceCommand::SetActive {
                active: false,
                force: true,
                detail: "Initial background Discord cleanup while VRChat is not running.".into(),
            });
        }

        if state.close_attempts_remaining > 0 {
            state.close_attempts_remaining = state.close_attempts_remaining.saturating_sub(1);
            return Ok(BackgroundDiscordPresenceCommand::SetActive {
                active: false,
                force: true,
                detail: "VRChat stopped; clearing Discord presence.".into(),
            });
        }
        if force || state.is_active {
            return Ok(BackgroundDiscordPresenceCommand::SetActive {
                active: false,
                force,
                detail: "VRChat is not running.".into(),
            });
        }
        return Ok(BackgroundDiscordPresenceCommand::Noop {
            detail: "VRChat is not running.".into(),
        });
    }

    state.last_game_running = true;
    state.initial_non_game_cleanup_sent = false;
    state.close_attempts_remaining = 0;
    let discord_config = load_discord_config(config)?;
    if !discord_config.discord_active {
        if force || state.is_active || !state.disabled_cleanup_sent {
            state.disabled_cleanup_sent = true;
            return Ok(BackgroundDiscordPresenceCommand::SetActive {
                active: false,
                force: true,
                detail: "Discord presence is disabled.".into(),
            });
        }
        return Ok(BackgroundDiscordPresenceCommand::Noop {
            detail: "Discord presence is disabled.".into(),
        });
    }
    state.disabled_cleanup_sent = false;

    let discord_location =
        if facts.current_location == "traveling" && !facts.current_destination.trim().is_empty() {
            facts.current_destination.trim()
        } else {
            facts.current_location.trim()
        };
    let parsed_discord_location = parse_location(discord_location);
    if !parsed_discord_location.is_real_instance {
        return Ok(BackgroundDiscordPresenceCommand::SetAssets {
            payload: build_running_fallback_activity(&discord_config, facts),
        });
    }

    let location_details =
        load_discord_location_details(web, db, facts, state, discord_location).await?;
    let Some(parsed) = location_details.parsed.clone() else {
        return Ok(BackgroundDiscordPresenceCommand::SetActive {
            active: false,
            force,
            detail: "Current location is not a Discord instance.".into(),
        });
    };

    Ok(BackgroundDiscordPresenceCommand::SetAssets {
        payload: build_discord_activity(&discord_config, facts, &location_details, &parsed),
    })
}

pub async fn refresh_background_current_user(
    web: &WebClient,
    db: &DatabaseService,
    session: &BackgroundCapabilitySession,
) -> Result<Value> {
    let response = web
        .execute_api(
            vrcx_0_vrchat_client::auth::current_user_get_input(normalize_vrchat_api_endpoint(
                Some(&session.endpoint),
            )),
            ApiScope::Vrchat,
            db,
        )
        .await?;
    if !(200..=299).contains(&response.status) {
        return Err(Error::Custom(format!(
            "current user refresh returned HTTP {}",
            response.status
        )));
    }
    parse_response_json(&response.data)
        .ok_or_else(|| Error::Custom("current user refresh returned invalid JSON".into()))
}

pub async fn refresh_background_group_instances(
    web: &WebClient,
    db: &DatabaseService,
    session: &BackgroundCapabilitySession,
) -> Result<BackgroundGroupInstancesRefresh> {
    let (_, request) = current_user_group_instances_get_input(
        normalize_vrchat_api_endpoint(Some(&session.endpoint)),
        session.current_user_id.clone(),
    )?;
    let response = web.execute_api(request, ApiScope::Vrchat, db).await?;
    if !(200..=299).contains(&response.status) {
        return Err(Error::Custom(format!(
            "group instance refresh returned HTTP {}",
            response.status
        )));
    }
    let fetched_at = Utc::now().to_rfc3339();
    let value = parse_response_json(&response.data).unwrap_or(Value::Null);
    let instances = value
        .as_array()
        .cloned()
        .or_else(|| {
            value.get("instances")
                .and_then(Value::as_array)
                .cloned()
        })
        .unwrap_or_default();
    let instances =
        hydrate_background_group_instances(web, db, &session.endpoint, instances).await;
    Ok(BackgroundGroupInstancesRefresh {
        instances,
        fetched_at,
    })
}

async fn hydrate_background_group_instances(
    web: &WebClient,
    db: &DatabaseService,
    endpoint: &str,
    instances: Vec<Value>,
) -> Vec<Value> {
    let mut group_ids = Vec::new();
    let mut seen = HashSet::new();
    for instance in &instances {
        if has_complete_group_instance_group(instance) {
            continue;
        }
        let group_id = normalize_group_instance_group_id(instance);
        if !group_id.is_empty() && seen.insert(group_id.clone()) {
            group_ids.push(group_id);
        }
    }
    if group_ids.is_empty() {
        return instances;
    }

    let endpoint = normalize_vrchat_api_endpoint(Some(endpoint));
    let group_fetches = group_ids.into_iter().filter_map(|group_id| {
        let Ok((_, request)) = group_profile_get_input(endpoint.clone(), group_id.clone(), false)
        else {
            return None;
        };
        Some(async move {
            match web.execute_api(request, ApiScope::Vrchat, db).await {
                Ok(response) if (200..=299).contains(&response.status) => {
                    parse_response_json(&response.data).map(|group| (group_id, group))
                }
                Ok(response) => {
                    tracing::warn!(
                        group_id,
                        status = response.status,
                        "background group instance profile hydration failed"
                    );
                    None
                }
                Err(error) => {
                    tracing::warn!(
                        group_id,
                        error = %error,
                        "background group instance profile hydration failed"
                    );
                    None
                }
            }
        })
    });
    let groups_by_id: HashMap<String, Value> = stream::iter(group_fetches)
        .buffer_unordered(GROUP_PROFILE_HYDRATION_CONCURRENCY)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .flatten()
        .collect();

    instances
        .into_iter()
        .map(|instance| hydrate_group_instance(instance, &groups_by_id))
        .collect()
}

fn hydrate_group_instance(mut instance: Value, groups_by_id: &HashMap<String, Value>) -> Value {
    let group_id = normalize_group_instance_group_id(&instance);
    let existing_group = group_instance_group(&instance)
        .cloned()
        .or_else(|| group_fallback(&group_id));
    let fetched_group = groups_by_id.get(&group_id).cloned();
    let Some(group) = merge_group_instance_group(existing_group, fetched_group, &group_id) else {
        return instance;
    };
    if let Some(object) = instance.as_object_mut() {
        object.insert("group".into(), group);
    }
    instance
}

fn group_instance_group(instance: &Value) -> Option<&Value> {
    instance
        .get("group")
        .or_else(|| instance.get("instance").and_then(|value| value.get("group")))
}

fn group_fallback(group_id: &str) -> Option<Value> {
    if group_id.is_empty() {
        None
    } else {
        Some(json!({
            "id": group_id,
            "groupId": group_id,
            "name": group_id,
        }))
    }
}

fn merge_group_instance_group(
    existing_group: Option<Value>,
    fetched_group: Option<Value>,
    group_id: &str,
) -> Option<Value> {
    let existing_name = existing_group
        .as_ref()
        .and_then(|group| resolve_group_instance_name_value(group, group_id));
    let fetched_name = fetched_group
        .as_ref()
        .and_then(|group| resolve_group_instance_name_value(group, group_id));
    let mut merged = Map::new();
    if let Some(Value::Object(fetched)) = fetched_group {
        merged.extend(fetched);
    }
    if let Some(Value::Object(existing)) = existing_group {
        merged.extend(existing);
    }
    if merged.is_empty() {
        return None;
    }

    let id = first_non_empty_owned([
        string_field_value(merged.get("id")).unwrap_or_default(),
        string_field_value(merged.get("groupId")).unwrap_or_default(),
        group_id.to_string(),
    ]);
    if !id.is_empty() {
        merged.insert("id".into(), Value::String(id.clone()));
        merged.insert("groupId".into(), Value::String(id));
    }

    let name = first_non_empty_owned([
        existing_name.unwrap_or_default(),
        fetched_name.unwrap_or_default(),
        resolve_group_instance_name(&merged, group_id),
    ]);
    if !name.is_empty() {
        merged.insert("name".into(), Value::String(name));
    }
    Some(Value::Object(merged))
}

fn resolve_group_instance_name_value(group: &Value, group_id: &str) -> Option<String> {
    let group = group.as_object()?;
    let name = resolve_group_instance_name(group, group_id);
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn resolve_group_instance_name(group: &Map<String, Value>, group_id: &str) -> String {
    let name = first_non_empty_owned([
        string_field_value(group.get("name")).unwrap_or_default(),
        string_field_value(group.get("displayName")).unwrap_or_default(),
    ]);
    if name.is_empty() || name == group_id {
        String::new()
    } else {
        name
    }
}

fn has_complete_group_instance_group(instance: &Value) -> bool {
    let Some(group) = group_instance_group(instance) else {
        return false;
    };
    let has_id = string_field_value(group.get("id")).is_some()
        || string_field_value(group.get("groupId")).is_some();
    let has_name = string_field_value(group.get("name")).is_some();
    let has_icon = ["iconUrl", "icon", "thumbnailUrl", "imageUrl"]
        .iter()
        .any(|key| string_field_value(group.get(*key)).is_some());
    has_id && has_name && has_icon
}

fn normalize_group_instance_group_id(instance: &Value) -> String {
    let location = string_field_value(instance.get("location"))
        .or_else(|| {
            instance
                .get("instance")
                .and_then(|value| string_field_value(value.get("location")))
        })
        .unwrap_or_default();
    let parsed_location = parse_location(&location);
    first_group_id([
        nested_string(instance, &["group", "groupId"]),
        nested_string(instance, &["group", "id"]),
        nested_string(instance, &["instance", "group", "groupId"]),
        nested_string(instance, &["instance", "group", "id"]),
        string_field_value(instance.get("groupId")).unwrap_or_default(),
        string_field_value(instance.get("group_id")).unwrap_or_default(),
        nested_string(instance, &["instance", "groupId"]),
        nested_string(instance, &["instance", "group_id"]),
        string_field_value(instance.get("ownerId")).unwrap_or_default(),
        string_field_value(instance.get("owner_id")).unwrap_or_default(),
        nested_string(instance, &["instance", "ownerId"]),
        nested_string(instance, &["instance", "owner_id"]),
        parsed_location.group_id.unwrap_or_default(),
    ])
}

fn first_group_id(values: impl IntoIterator<Item = String>) -> String {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .find(|value| value.starts_with("grp_"))
        .unwrap_or_default()
}

fn first_non_empty_owned(values: impl IntoIterator<Item = String>) -> String {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}

fn nested_string(value: &Value, path: &[&str]) -> String {
    let mut current = value;
    for key in path {
        let Some(next) = current.get(*key) else {
            return String::new();
        };
        current = next;
    }
    string_field_value(Some(current)).unwrap_or_default()
}

fn string_field_value(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn load_presence_automation_config(config: &ConfigRepository) -> Result<PresenceAutomationConfig> {
    let time_rules = load_stored_rules(config, "presenceAutomationTimeRules")?;
    let context_rules: Vec<Value> = load_stored_rules(config, "presenceAutomationContextRules")?
        .into_iter()
        .map(force_game_running_condition)
        .collect();
    let legacy_rules = load_legacy_presence_rules(config)?;
    let mut rules = Vec::new();
    rules.extend(time_rules);
    rules.extend(context_rules);
    rules.extend(legacy_rules);
    rules.retain(|rule| rule_enabled(rule) && has_presence_action(rule));

    Ok(PresenceAutomationConfig {
        enabled: !rules.is_empty(),
        rules,
        throttle: PresenceAutomationThrottle {
            min_status_write_interval_ms: config_int(
                config,
                "presenceAutomationMinStatusWriteIntervalMs",
                DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS,
            )?,
            min_description_write_interval_ms: config_int(
                config,
                "presenceAutomationMinDescriptionWriteIntervalMs",
                DEFAULT_MIN_DESCRIPTION_WRITE_INTERVAL_MS,
            )?,
            stable_location_ms: config_int(
                config,
                "presenceAutomationStableLocationMs",
                DEFAULT_STABLE_LOCATION_MS,
            )?,
        },
    })
}

fn load_legacy_presence_rules(config: &ConfigRepository) -> Result<Vec<Value>> {
    if !config.get_bool("autoStateChangeEnabled", false)? {
        return Ok(Vec::new());
    }
    let no_friends = config.get_bool("autoStateChangeNoFriends", false)?;
    let selected_groups = safe_string_array(&config.get_string("autoStateChangeGroups", "[]")?);
    let selected_instance_types =
        safe_string_array(&config.get_string("autoStateChangeInstanceTypes", "[]")?);
    let alone_status = non_empty(
        &config.get_string("autoStateChangeAloneStatus", "join me")?,
        "join me",
    );
    let company_status = non_empty(
        &config.get_string("autoStateChangeCompanyStatus", "busy")?,
        "busy",
    );
    let alone_desc_enabled = config.get_bool("autoStateChangeAloneDescEnabled", false)?;
    let alone_desc = config.get_string("autoStateChangeAloneDesc", "")?;
    let company_desc_enabled = config.get_bool("autoStateChangeCompanyDescEnabled", false)?;
    let company_desc = config.get_string("autoStateChangeCompanyDesc", "")?;

    let mut instance_conditions = Vec::new();
    if !selected_instance_types.is_empty() {
        instance_conditions.push(json!({
            "type": "instanceTypeIn",
            "values": selected_instance_types,
        }));
    }
    let company_conditions = if !no_friends {
        vec![json!({ "type": "withCompany" })]
    } else if !selected_groups.is_empty() {
        vec![json!({
            "type": "hasFriendInGroups",
            "values": selected_groups,
        })]
    } else {
        vec![json!({ "type": "hasAnyFriend" })]
    };

    let mut company_actions = Map::new();
    company_actions.insert("status".into(), Value::String(company_status));
    if company_desc_enabled {
        company_actions.insert("statusDescription".into(), Value::String(company_desc));
    }
    let mut alone_actions = Map::new();
    alone_actions.insert("status".into(), Value::String(alone_status));
    if alone_desc_enabled {
        alone_actions.insert("statusDescription".into(), Value::String(alone_desc));
    }

    let mut company_rule_conditions = vec![json!({ "type": "isGameRunning" })];
    company_rule_conditions.extend(instance_conditions.clone());
    company_rule_conditions.extend(company_conditions);
    let mut alone_rule_conditions = vec![
        json!({ "type": "isGameRunning" }),
        json!({ "type": "playerFactsKnown" }),
    ];
    alone_rule_conditions.extend(instance_conditions);

    Ok(vec![
        json!({
            "id": "legacy-company",
            "label": "Legacy company rule",
            "enabled": true,
            "generated": true,
            "domain": "context",
            "priority": 200,
            "conditions": company_rule_conditions,
            "actions": company_actions,
            "stopProcessing": true,
        }),
        json!({
            "id": "legacy-alone",
            "label": "Legacy alone rule",
            "enabled": true,
            "generated": true,
            "domain": "context",
            "priority": 100,
            "conditions": alone_rule_conditions,
            "actions": alone_actions,
            "stopProcessing": true,
        }),
    ])
}

fn evaluate_presence_rules(
    facts: &BackgroundPresenceFacts,
    rules: &[Value],
) -> PresenceRuleEvaluation {
    let mut sorted_rules: Vec<&Value> = rules.iter().filter(|rule| rule_enabled(rule)).collect();
    sorted_rules.sort_by(|left, right| {
        let priority_delta = rule_priority(right).cmp(&rule_priority(left));
        if priority_delta == std::cmp::Ordering::Equal {
            rule_id(left).cmp(&rule_id(right))
        } else {
            priority_delta
        }
    });

    let mut patch = Map::new();
    let mut field_owners = HashSet::new();
    let mut stopped_domains = HashSet::new();
    let mut matched_rules = Vec::new();

    for rule in sorted_rules {
        let domain = string_field(rule, "domain").unwrap_or_else(|| "context".into());
        if stopped_domains.contains(&domain) || !rule_matches(rule, facts) {
            continue;
        }
        let action_patch = validate_action_patch(rule.get("actions").unwrap_or(&Value::Null));
        let mut owned_fields = Vec::new();
        for (field, value) in action_patch {
            if field_owners.insert(field.clone()) {
                patch.insert(field.clone(), value);
                owned_fields.push(field);
            }
        }
        matched_rules.push(MatchedPresenceRule {
            id: rule_id(rule),
            domain: domain.clone(),
            restore_previous_state: rule
                .get("restorePreviousState")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            owned_fields,
        });
        if rule
            .get("stopProcessing")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            stopped_domains.insert(domain);
        }
    }

    PresenceRuleEvaluation {
        patch,
        matched_rules,
    }
}

fn rule_matches(rule: &Value, facts: &BackgroundPresenceFacts) -> bool {
    array_field(rule, "conditions")
        .into_iter()
        .all(|condition| condition_matches(condition, facts))
}

fn condition_matches(condition: &Value, facts: &BackgroundPresenceFacts) -> bool {
    match string_field(condition, "type").as_deref() {
        Some("timeWindow") => matches_time_window(condition),
        Some("playerFactsKnown") => {
            facts.player_facts_known == condition_bool_value(condition, true)
        }
        Some("instanceTypeIn") => string_array_field(condition, "values")
            .iter()
            .any(|value| value == &facts.instance_type),
        Some("playerCount") => {
            facts.player_facts_known
                && compare_numbers(
                    facts.player_count as i64,
                    string_field(condition, "op")
                        .unwrap_or_else(|| "==".into())
                        .as_str(),
                    condition_i64_value(condition, 0),
                )
        }
        Some("friendCount") => {
            facts.player_facts_known
                && compare_numbers(
                    facts.friend_count as i64,
                    string_field(condition, "op")
                        .unwrap_or_else(|| "==".into())
                        .as_str(),
                    condition_i64_value(condition, 0),
                )
        }
        Some("hasAnyFriend") => facts.player_facts_known && facts.friend_count > 0,
        Some("hasFriendInGroups") => {
            facts.player_facts_known
                && string_array_field(condition, "values").iter().any(|group| {
                    facts
                        .present_favorite_group_keys
                        .iter()
                        .any(|present| present == group)
                })
        }
        Some("hasSpecificFriend") => {
            facts.player_facts_known
                && string_array_field(condition, "values")
                    .iter()
                    .any(|user_id| {
                        facts
                            .present_friend_ids
                            .iter()
                            .any(|present| present == user_id)
                    })
        }
        Some("isAlone") => facts.player_facts_known && facts.player_count == 0,
        Some("withCompany") => facts.player_facts_known && facts.player_count > 0,
        Some("isTraveling") => {
            facts.parsed_location.is_traveling == condition_bool_value(condition, true)
        }
        Some("isGameRunning") => facts.is_game_running == condition_bool_value(condition, true),
        Some("canInviteFromCurrentLocation") => {
            facts.can_invite_from_current_location == condition_bool_value(condition, true)
        }
        _ => false,
    }
}

fn matches_time_window(condition: &Value) -> bool {
    let Some(start) = parse_clock_minutes(&string_field(condition, "start").unwrap_or_default())
    else {
        return false;
    };
    let Some(end) = parse_clock_minutes(&string_field(condition, "end").unwrap_or_default()) else {
        return false;
    };
    let days = int_array_field(condition, "days");
    let now = Local::now();
    let now_minutes = now.hour() as i64 * 60 + now.minute() as i64;
    if start == end {
        return matches_day_filter(&days, 0);
    }
    if end > start {
        return matches_day_filter(&days, 0) && now_minutes >= start && now_minutes < end;
    }
    if now_minutes >= start {
        return matches_day_filter(&days, 0);
    }
    now_minutes < end && matches_day_filter(&days, -1)
}

fn matches_day_filter(days: &[i64], offset_days: i64) -> bool {
    if days.is_empty() {
        return true;
    }
    let shifted = Local::now() + chrono::Duration::days(offset_days);
    let day = match shifted.weekday().number_from_monday() {
        1..=7 => shifted.weekday().number_from_monday() as i64,
        _ => 1,
    };
    days.contains(&day)
}

fn validate_action_patch(actions: &Value) -> Map<String, Value> {
    let mut patch = Map::new();
    if let Some(status) = string_field(actions, "status").filter(|value| valid_status(value)) {
        patch.insert("status".into(), Value::String(status));
    }
    if let Some(object) = actions.as_object() {
        if object.contains_key("statusDescription") {
            patch.insert(
                "statusDescription".into(),
                Value::String(
                    string_field(actions, "statusDescription")
                        .unwrap_or_default()
                        .chars()
                        .take(32)
                        .collect(),
                ),
            );
        } else if actions
            .get("clearStatusDescription")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            patch.insert("statusDescription".into(), Value::String(String::new()));
        }
    }
    patch
}

fn ensure_presence_state_scope(
    state: &mut BackgroundPresenceAutomationState,
    facts: &BackgroundPresenceFacts,
) {
    let scope_key = format!("{}:{}", facts.endpoint.trim(), facts.current_user_id.trim());
    if state.scope_key == scope_key {
        return;
    }
    *state = BackgroundPresenceAutomationState {
        scope_key,
        ..Default::default()
    };
}

fn build_patch_with_time_restore(
    facts: &BackgroundPresenceFacts,
    evaluation: &PresenceRuleEvaluation,
    state: &mut BackgroundPresenceAutomationState,
) -> PatchWithTimeRestore {
    let mut patch = evaluation.patch.clone();
    let mut pending_snapshot_completions = Vec::new();
    let time_owned_fields: HashMap<String, bool> = evaluation
        .matched_rules
        .iter()
        .filter(|rule| rule.domain == "time")
        .flat_map(|rule| {
            rule.owned_fields
                .iter()
                .map(|field| (field.clone(), rule.restore_previous_state))
                .collect::<Vec<_>>()
        })
        .collect();

    for (field, restore_previous_state) in &time_owned_fields {
        if !restore_previous_state {
            pending_snapshot_completions.push(field.clone());
            continue;
        }
        let automated_value = patch.get(field).map(value_to_string).unwrap_or_default();
        state
            .time_restore_snapshots
            .entry(field.clone())
            .and_modify(|snapshot| snapshot.automated_value = automated_value.clone())
            .or_insert_with(|| TimeRestoreSnapshot {
                previous_value: value_to_string(
                    facts.current_user.get(field).unwrap_or(&Value::Null),
                ),
                automated_value,
            });
    }

    for (field, snapshot) in state.time_restore_snapshots.clone() {
        if time_owned_fields.contains_key(&field) {
            continue;
        }
        if !patch.contains_key(&field)
            && value_to_string(facts.current_user.get(&field).unwrap_or(&Value::Null))
                == snapshot.automated_value
        {
            patch.insert(field.clone(), Value::String(snapshot.previous_value));
        }
        pending_snapshot_completions.push(field);
    }

    PatchWithTimeRestore {
        patch,
        pending_snapshot_completions,
    }
}

fn changed_patch(current_user: &Value, patch: &Map<String, Value>) -> Map<String, Value> {
    let mut changed = Map::new();
    for field in ["status", "statusDescription"] {
        if let Some(value) = patch.get(field) {
            if current_user
                .get(field)
                .map(value_to_string)
                .unwrap_or_default()
                != value_to_string(value)
            {
                changed.insert(field.into(), value.clone());
            }
        }
    }
    changed
}

fn has_location_scoped_changes(
    evaluation: &PresenceRuleEvaluation,
    changed_patch: &Map<String, Value>,
) -> bool {
    let location_fields: HashSet<&str> = evaluation
        .matched_rules
        .iter()
        .filter(|rule| rule.domain != "time")
        .flat_map(|rule| rule.owned_fields.iter().map(String::as_str))
        .collect();
    changed_patch
        .keys()
        .any(|field| location_fields.contains(field.as_str()))
}

fn stable_location_skip_reason(
    facts: &BackgroundPresenceFacts,
    stable_location_ms: i64,
) -> Option<&'static str> {
    if facts.parsed_location.is_traveling {
        return Some("traveling");
    }
    let started_at_ms = parse_date_ms(&facts.current_location_started_at);
    if started_at_ms > 0 && Utc::now().timestamp_millis() - started_at_ms < stable_location_ms {
        return Some("location-stabilizing");
    }
    None
}

fn throttle_skip_reason(
    changed_patch: &Map<String, Value>,
    throttle: PresenceAutomationThrottle,
    now_ms: i64,
    state: &BackgroundPresenceAutomationState,
) -> Option<&'static str> {
    if let Some(value) = changed_patch.get("status").map(value_to_string) {
        if value == state.last_status_value
            && now_ms - state.last_status_write_at_ms < throttle.min_status_write_interval_ms
        {
            return Some("status-throttled");
        }
    }
    if let Some(value) = changed_patch.get("statusDescription").map(value_to_string) {
        if value == state.last_description_value
            && now_ms - state.last_description_write_at_ms
                < throttle.min_description_write_interval_ms
        {
            return Some("description-throttled");
        }
    }
    None
}

fn update_presence_write_timestamps(
    state: &mut BackgroundPresenceAutomationState,
    changed_patch: &Map<String, Value>,
    now_ms: i64,
) {
    if let Some(value) = changed_patch.get("status").map(value_to_string) {
        state.last_status_write_at_ms = now_ms;
        state.last_status_value = value;
    }
    if let Some(value) = changed_patch.get("statusDescription").map(value_to_string) {
        state.last_description_write_at_ms = now_ms;
        state.last_description_value = value;
    }
}

fn complete_time_restores(state: &mut BackgroundPresenceAutomationState, fields: &[String]) {
    for field in fields {
        state.time_restore_snapshots.remove(field);
    }
}

fn load_discord_config(config: &ConfigRepository) -> Result<DiscordConfig> {
    Ok(DiscordConfig {
        discord_active: config.get_bool("discordActive", false)?,
        discord_instance: config.get_bool("discordInstance", true)?,
        discord_hide_invite: config.get_bool("discordHideInvite", true)?,
        discord_join_button: config.get_bool("discordJoinButton", false)?,
        discord_hide_image: config.get_bool("discordHideImage", false)?,
        discord_show_platform: config.get_bool("discordShowPlatform", true)?,
        discord_world_integration: config.get_bool("discordWorldIntegration", true)?,
        discord_world_name_as_discord_status: config
            .get_bool("discordWorldNameAsDiscordStatus", false)?,
    })
}

fn build_running_fallback_activity(
    config: &DiscordConfig,
    facts: &BackgroundPresenceFacts,
) -> BackgroundDiscordActivityPayload {
    let status_info = status_info(
        string_field(&facts.current_user, "status").as_deref(),
        config.discord_hide_invite,
    );
    let platform = if config.discord_show_platform {
        platform_label(
            current_user_platform(&facts.current_user)
                .as_deref()
                .unwrap_or_default(),
            facts.is_game_running,
            !facts.is_steamvr_running,
        )
    } else {
        String::new()
    };
    let details = "VRChat".to_string();
    let activity = compact_object(json!({
        "type": 0,
        "name": "VRChat",
        "details": details,
        "state": platform.trim(),
        "status_display_type": 0,
        "timestamps": create_activity_timestamps(facts.last_game_started_at.as_deref(), None),
        "assets": create_activity_assets("vrchat", status_info.status_image, status_info.status_name),
    }));
    BackgroundDiscordActivityPayload {
        app_id: DEFAULT_APP_ID.into(),
        detail: if platform.trim().is_empty() {
            details
        } else {
            format!("{details} - {}", platform.trim())
        },
        activity,
    }
}

async fn load_discord_location_details(
    web: &WebClient,
    db: &DatabaseService,
    facts: &BackgroundPresenceFacts,
    state: &mut BackgroundDiscordPresenceState,
    current_location: &str,
) -> Result<DiscordLocationDetails> {
    if state.last_location_details.tag == current_location
        && state.last_location_details.parsed.is_some()
    {
        return Ok(state.last_location_details.clone());
    }

    let parsed = parse_location(current_location);
    let mut details = DiscordLocationDetails {
        tag: parsed.tag.clone(),
        parsed: Some(parsed.clone()),
        ..Default::default()
    };
    if !parsed.world_id.is_empty() {
        let (_, request) = world_get_input(
            normalize_vrchat_api_endpoint(Some(&facts.endpoint)),
            parsed.world_id.clone(),
        )?;
        match web.execute_api(request, ApiScope::Vrchat, db).await {
            Ok(response) if (200..=299).contains(&response.status) => {
                if let Some(world) = parse_response_json(&response.data) {
                    details.world_name =
                        string_field(&world, "name").unwrap_or_else(|| parsed.world_id.clone());
                    details.thumbnail_image_url = string_field(&world, "thumbnailImageUrl")
                        .or_else(|| string_field(&world, "imageUrl"))
                        .unwrap_or_default();
                    details.world_capacity = int_field(&world, "capacity").unwrap_or(0);
                    if string_field(&world, "releaseStatus").as_deref() == Some("public") {
                        details.world_link =
                            format!("https://vrchat.com/home/world/{}", parsed.world_id);
                    }
                }
            }
            Ok(response) => {
                tracing::warn!(
                    world_id = parsed.world_id,
                    status = response.status,
                    "background Discord world lookup failed"
                );
            }
            Err(error) => {
                tracing::warn!(
                    world_id = parsed.world_id,
                    error = %error,
                    "background Discord world lookup failed"
                );
            }
        }
        if details.world_name.is_empty() {
            details.world_name = if facts.world_name.trim().is_empty() {
                parsed.world_id.clone()
            } else {
                facts.world_name.clone()
            };
        }
    }

    if let Some(group_id) = parsed.group_id.as_ref().filter(|value| !value.is_empty()) {
        let (_, request) = group_profile_get_input(
            normalize_vrchat_api_endpoint(Some(&facts.endpoint)),
            group_id.clone(),
            false,
        )?;
        match web.execute_api(request, ApiScope::Vrchat, db).await {
            Ok(response) if (200..=299).contains(&response.status) => {
                if let Some(group) = parse_response_json(&response.data) {
                    details.group_name = string_field(&group, "name").unwrap_or_default();
                }
            }
            Ok(response) => {
                tracing::warn!(
                    group_id,
                    status = response.status,
                    "background Discord group lookup failed"
                );
            }
            Err(error) => {
                tracing::warn!(
                    group_id,
                    error = %error,
                    "background Discord group lookup failed"
                );
            }
        }
    }

    state.last_location_details = details.clone();
    Ok(details)
}

fn build_discord_activity(
    config: &DiscordConfig,
    facts: &BackgroundPresenceFacts,
    details: &DiscordLocationDetails,
    parsed: &ParsedLocation,
) -> BackgroundDiscordActivityPayload {
    let platform = if config.discord_show_platform {
        platform_label(
            current_user_platform(&facts.current_user)
                .as_deref()
                .unwrap_or_default(),
            facts.is_game_running,
            !facts.is_steamvr_running,
        )
    } else {
        String::new()
    };
    let access_name = build_access_name(parsed, &details.group_name, &platform);
    let status_info = status_info(
        string_field(&facts.current_user, "status").as_deref(),
        config.discord_hide_invite,
    );
    let mut hide_private = config.discord_hide_invite
        && (parsed.access_type == "invite"
            || parsed.access_type == "invite+"
            || parsed.group_access_type.as_deref() == Some("members"));
    if status_info.hide_private {
        hide_private = true;
    }

    let mut details_text = non_empty(
        &details.world_name,
        non_empty(
            &facts.world_name,
            non_empty(&parsed.world_id, "VRChat").as_str(),
        )
        .as_str(),
    );
    let mut state_text = access_name;
    let mut start_time = first_non_empty([
        facts.current_location_started_at.as_str(),
        facts.last_game_started_at.as_deref().unwrap_or(""),
    ])
    .to_string();
    let mut end_time = String::new();
    let mut activity_type = 0;
    let mut status_display_type = if config.discord_world_name_as_discord_status {
        2
    } else {
        0
    };
    let mut app_id = DEFAULT_APP_ID.to_string();
    let mut big_icon = if !config.discord_hide_image && !details.thumbnail_image_url.is_empty() {
        details.thumbnail_image_url.clone()
    } else {
        "vrchat".into()
    };
    let mut details_url = details.world_link.clone();
    let mut party_id = format!("{}:{}", parsed.world_id, parsed.instance_name);
    let mut party_size = facts.player_count as i64;
    let mut party_max_size = details.world_capacity.max(party_size);
    if party_size == 0 {
        party_max_size = 0;
    }
    if !config.discord_instance {
        party_size = 0;
        party_max_size = 0;
        state_text.clear();
    }
    let mut button_text = "Join".to_string();
    let mut button_url = if parsed.access_type == "public" {
        get_launch_url(parsed)
    } else {
        String::new()
    };
    if !config.discord_join_button {
        button_text.clear();
        button_url.clear();
    }

    if config.discord_world_integration {
        if let Some(rpc_config) = rpc_world_config(&parsed.world_id) {
            activity_type = rpc_config.activity_type;
            status_display_type = rpc_config.status_display_type;
            app_id = rpc_config.app_id.into();
            big_icon = rpc_config.big_icon.into();
            if is_popcorn_palace_world(&parsed.world_id) && !config.discord_hide_image {
                if let Some(thumbnail_url) = string_field(&facts.now_playing, "thumbnailUrl") {
                    big_icon = thumbnail_url;
                }
            }
            if let Some(now_playing_name) = string_field(&facts.now_playing, "name") {
                details_text = now_playing_name;
            }
            if now_playing_has_content(&facts.now_playing) {
                let (now_playing_start, now_playing_end) =
                    now_playing_activity_times(&facts.now_playing);
                if !now_playing_start.is_empty() {
                    start_time = now_playing_start;
                    end_time = now_playing_end;
                }
            }
        }
    }

    if hide_private {
        party_id.clear();
        party_size = 0;
        party_max_size = 0;
        button_text.clear();
        button_url.clear();
        details_url.clear();
        details_text = "Private World".into();
        state_text.clear();
        start_time.clear();
        end_time.clear();
        app_id = DEFAULT_APP_ID.into();
        big_icon = "vrchat".into();
        activity_type = 0;
        status_display_type = 0;
    }

    if details_text.chars().count() < 2 {
        details_text.push('\u{FFA0}');
    }

    let activity = compact_object(json!({
        "type": activity_type,
        "name": "VRChat",
        "details": details_text,
        "details_url": details_url,
        "state": state_text,
        "status_display_type": status_display_type,
        "timestamps": create_activity_timestamps(Some(start_time.as_str()), Some(end_time.as_str())),
        "assets": create_activity_assets(big_icon, status_info.status_image, status_info.status_name),
        "party": create_activity_party(party_id, party_size, party_max_size),
        "buttons": create_activity_buttons(button_text, button_url),
    }));

    let detail = format!(
        "{}{}",
        details_text,
        activity
            .get("state")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(|state| format!(" - {state}"))
            .unwrap_or_default()
    );
    BackgroundDiscordActivityPayload {
        app_id,
        activity,
        detail,
    }
}

fn ensure_current_user_id(mut current_user: Value, current_user_id: &str) -> Value {
    if let Some(object) = current_user.as_object_mut() {
        if !current_user_id.trim().is_empty() {
            object
                .entry("id")
                .or_insert_with(|| Value::String(current_user_id.trim().to_string()));
        }
    }
    current_user
}

fn resolve_current_location(snapshot: &RuntimeSnapshot, current_user: &Value) -> String {
    first_non_empty([
        snapshot.location.as_str(),
        snapshot.destination.as_str(),
        string_field(current_user, "$locationTag")
            .as_deref()
            .unwrap_or(""),
        string_field(current_user, "location")
            .as_deref()
            .unwrap_or(""),
        string_field(current_user, "worldId")
            .as_deref()
            .unwrap_or(""),
    ])
    .to_string()
}

fn normalize_runtime_players(players: &[PlayerState]) -> Vec<PresencePlayer> {
    players
        .iter()
        .enumerate()
        .filter_map(|(index, player)| {
            let user_id = player.user_id.trim().to_string();
            let display_name = player.display_name.trim().to_string();
            if user_id.is_empty() && display_name.is_empty() {
                return None;
            }
            Some(PresencePlayer {
                id: non_empty(&user_id, &format!("runtime:{index}")),
                user_id,
                display_name,
            })
        })
        .collect()
}

fn load_players_from_persistence(
    db: &DatabaseService,
    location: &str,
    started_at: &str,
) -> Result<(Vec<PresencePlayer>, usize)> {
    let rows = vrcx_0_persistence::player_list::player_list_join_leave_rows(
        db,
        location.to_string(),
        started_at.to_string(),
    )?;
    let mut players: HashMap<String, PresencePlayer> = HashMap::new();
    let observed = rows.len();
    for (index, row) in rows.into_iter().enumerate() {
        let key = if row.user_id.trim().is_empty() {
            format!("display:{}", row.display_name)
        } else {
            row.user_id.clone()
        };
        if row.r#type == "OnPlayerLeft" {
            players.remove(&key);
        } else {
            players.insert(
                key,
                PresencePlayer {
                    id: non_empty(&row.user_id, &format!("persisted:{index}")),
                    user_id: row.user_id,
                    display_name: row.display_name,
                },
            );
        }
    }
    Ok((players.into_values().collect(), observed))
}

fn collect_present_favorite_group_keys(
    db: &DatabaseService,
    players: &[PresencePlayer],
    favorite_friend_groups_by_key: &HashMap<String, Vec<String>>,
) -> Result<Vec<String>> {
    let present_user_ids: HashSet<&str> = players
        .iter()
        .filter_map(|player| {
            if player.user_id.is_empty() {
                None
            } else {
                Some(player.user_id.as_str())
            }
        })
        .collect();
    if present_user_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut keys = HashSet::new();
    for (group_key, user_ids) in favorite_friend_groups_by_key {
        if user_ids
            .iter()
            .any(|user_id| present_user_ids.contains(user_id.as_str()))
        {
            keys.insert(group_key.clone());
        }
    }
    for row in vrcx_0_persistence::favorites::favorite_list(db, "friend".into())? {
        let user_id = string_field(&row, "userId").unwrap_or_default();
        let group_name = string_field(&row, "groupName").unwrap_or_default();
        if !group_name.is_empty() && present_user_ids.contains(user_id.as_str()) {
            keys.insert(format!("local:{group_name}"));
        }
    }
    let mut keys: Vec<String> = keys.into_iter().collect();
    keys.sort();
    Ok(keys)
}

fn check_can_invite(location: &str, parsed: &ParsedLocation, current_user_id: &str) -> bool {
    if location.is_empty()
        || !parsed.is_real_instance
        || parsed.world_id.is_empty()
        || parsed.instance_id.is_empty()
    {
        return false;
    }
    if parsed.access_type == "public" || parsed.access_type == "group" {
        return true;
    }
    if parsed.user_id.as_deref() == Some(current_user_id) {
        return true;
    }
    if parsed.access_type == "invite" || parsed.access_type == "friends" {
        return false;
    }
    true
}

pub fn parse_location(tag: &str) -> ParsedLocation {
    let mut raw = tag.trim().to_string();
    let mut parsed = ParsedLocation {
        tag: raw.clone(),
        ..Default::default()
    };
    match raw.as_str() {
        "offline" | "offline:offline" => {
            parsed.is_offline = true;
            return parsed;
        }
        "private" | "private:private" => {
            parsed.is_private = true;
            return parsed;
        }
        "traveling" | "traveling:traveling" => {
            parsed.is_traveling = true;
            return parsed;
        }
        _ => {}
    }
    if raw.is_empty() || raw.starts_with("local") {
        return parsed;
    }
    parsed.is_real_instance = true;
    const SHORT_NAME_QUALIFIER: &str = "&shortName=";
    if let Some(index) = raw.find(SHORT_NAME_QUALIFIER) {
        parsed.short_name = raw[index + SHORT_NAME_QUALIFIER.len()..].to_string();
        raw.truncate(index);
    }
    if let Some(separator) = raw.find(':') {
        parsed.world_id = raw[..separator].to_string();
        parsed.instance_id = raw[separator + 1..].to_string();
        for (index, segment) in parsed.instance_id.split('~').enumerate() {
            if index == 0 {
                parsed.instance_name = segment.to_string();
                continue;
            }
            let (key, value) = parse_location_segment(segment);
            match key.as_str() {
                "hidden" => parsed.hidden_id = Some(value),
                "private" => parsed.private_id = Some(value),
                "friends" => parsed.friends_id = Some(value),
                "canRequestInvite" => parsed.can_request_invite = true,
                "region" => parsed.region = value,
                "group" => parsed.group_id = Some(value),
                "groupAccessType" => parsed.group_access_type = Some(value),
                "strict" => parsed.strict = true,
                "ageGate" => parsed.age_gate = true,
                _ => {}
            }
        }
        parsed.access_type = "public".into();
        if let Some(value) = parsed.private_id.clone() {
            parsed.access_type = if parsed.can_request_invite {
                "invite+".into()
            } else {
                "invite".into()
            };
            parsed.user_id = Some(value);
        } else if let Some(value) = parsed.friends_id.clone() {
            parsed.access_type = "friends".into();
            parsed.user_id = Some(value);
        } else if let Some(value) = parsed.hidden_id.clone() {
            parsed.access_type = "friends+".into();
            parsed.user_id = Some(value);
        } else if parsed.group_id.is_some() {
            parsed.access_type = "group".into();
        }
        parsed.access_type_name = parsed.access_type.clone();
        if let Some(group_access_type) = parsed.group_access_type.as_deref() {
            if group_access_type == "public" {
                parsed.access_type_name = "groupPublic".into();
            } else if group_access_type == "plus" {
                parsed.access_type_name = "groupPlus".into();
            }
        }
    } else {
        parsed.world_id = raw;
    }
    parsed
}

fn parse_location_segment(segment: &str) -> (String, String) {
    let Some(open) = segment.find('(') else {
        return (segment.to_string(), String::new());
    };
    let Some(close) = segment.rfind(')') else {
        return (segment.to_string(), String::new());
    };
    if open >= close {
        return (segment.to_string(), String::new());
    }
    (
        segment[..open].to_string(),
        segment[open + 1..close].to_string(),
    )
}

fn normalize_instance_type(parsed: &ParsedLocation) -> String {
    if parsed.access_type != "group" {
        return parsed.access_type.clone();
    }
    match parsed.group_access_type.as_deref() {
        Some("members") => "groupOnly".into(),
        Some("plus") => "groupPlus".into(),
        _ => "groupPublic".into(),
    }
}

fn is_live_current_location(location: &str) -> bool {
    let normalized = location.trim();
    !normalized.is_empty()
        && normalized != "offline"
        && normalized != "private"
        && normalized != "traveling"
}

fn load_stored_rules(config: &ConfigRepository, key: &str) -> Result<Vec<Value>> {
    Ok(safe_value_array(
        &config.get_string(key, "[]").unwrap_or_else(|_| "[]".into()),
    ))
}

fn force_game_running_condition(rule: Value) -> Value {
    let mut object = rule.as_object().cloned().unwrap_or_default();
    let conditions: Vec<Value> = object
        .get("conditions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|condition| string_field(condition, "type").as_deref() != Some("isGameRunning"))
        .collect();
    let mut next_conditions = vec![json!({ "type": "isGameRunning" })];
    next_conditions.extend(conditions);
    object.insert("conditions".into(), Value::Array(next_conditions));
    Value::Object(object)
}

fn has_presence_action(rule: &Value) -> bool {
    let Some(actions) = rule.get("actions").and_then(Value::as_object) else {
        return false;
    };
    actions.contains_key("status")
        || actions.contains_key("statusDescription")
        || actions.contains_key("clearStatusDescription")
}

fn rule_enabled(rule: &Value) -> bool {
    rule.get("enabled").and_then(Value::as_bool) != Some(false)
}

fn rule_priority(rule: &Value) -> i64 {
    int_field(rule, "priority").unwrap_or(0)
}

fn rule_id(rule: &Value) -> String {
    string_field(rule, "id").unwrap_or_default()
}

fn condition_bool_value(condition: &Value, default_value: bool) -> bool {
    condition
        .get("value")
        .and_then(Value::as_bool)
        .unwrap_or(default_value)
}

fn condition_i64_value(condition: &Value, default_value: i64) -> i64 {
    condition
        .get("value")
        .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
        .unwrap_or(default_value)
}

fn compare_numbers(left: i64, op: &str, right: i64) -> bool {
    match op {
        ">" => left > right,
        ">=" => left >= right,
        "<" => left < right,
        "<=" => left <= right,
        "!=" => left != right,
        _ => left == right,
    }
}

fn parse_clock_minutes(value: &str) -> Option<i64> {
    let (hours, minutes) = value.split_once(':')?;
    let hours: i64 = hours.parse().ok()?;
    let minutes: i64 = minutes.parse().ok()?;
    if !(0..=23).contains(&hours) || !(0..=59).contains(&minutes) {
        return None;
    }
    Some(hours * 60 + minutes)
}

fn valid_status(value: &str) -> bool {
    matches!(value, "active" | "join me" | "ask me" | "busy" | "offline")
}

fn parse_date_ms(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|date| date.timestamp_millis())
        .unwrap_or(0)
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn matched_rule_ids(evaluation: &PresenceRuleEvaluation) -> Vec<String> {
    evaluation
        .matched_rules
        .iter()
        .map(|rule| rule.id.clone())
        .collect()
}

fn presence_result(
    applied: bool,
    reason: impl Into<String>,
    patch: Value,
    updated_user: Option<Value>,
    matched_rule_ids: Vec<String>,
) -> BackgroundPresenceAutomationResult {
    BackgroundPresenceAutomationResult {
        applied,
        reason: reason.into(),
        patch,
        updated_user,
        matched_rule_ids,
    }
}

fn config_int(config: &ConfigRepository, key: &str, default_value: i64) -> Result<i64> {
    Ok(config
        .get_raw(key)?
        .as_deref()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(default_value))
}

fn safe_value_array(value: &str) -> Vec<Value> {
    serde_json::from_str::<Value>(value)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
}

fn safe_string_array(value: &str) -> Vec<String> {
    safe_value_array(value)
        .into_iter()
        .filter_map(|value| value.as_str().map(str::trim).map(str::to_string))
        .filter(|value| !value.is_empty())
        .collect()
}

fn array_field<'a>(value: &'a Value, key: &str) -> Vec<&'a Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|values| values.iter().collect())
        .unwrap_or_default()
}

fn string_array_field(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn int_array_field(value: &Value, key: &str) -> Vec<i64> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default()
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn int_field(value: &Value, key: &str) -> Option<i64> {
    value
        .get(key)
        .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
}

fn non_empty(value: &str, fallback: &str) -> String {
    if value.trim().is_empty() {
        fallback.to_string()
    } else {
        value.trim().to_string()
    }
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> &'a str {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or("")
        .trim()
}

fn parse_response_json(data: &str) -> Option<Value> {
    serde_json::from_str(data).ok()
}

fn merge_object_patch(mut current_user: Value, patch: Value) -> Value {
    if let (Some(user), Some(patch)) = (current_user.as_object_mut(), patch.as_object()) {
        for (key, value) in patch {
            user.insert(key.clone(), value.clone());
        }
    }
    current_user
}

fn current_user_platform(current_user: &Value) -> Option<String> {
    current_user
        .get("presence")
        .and_then(|presence| string_field(presence, "platform"))
        .or_else(|| string_field(current_user, "platform"))
        .or_else(|| string_field(current_user, "last_platform"))
}

fn platform_label(platform: &str, is_game_running: bool, is_game_no_vr: bool) -> String {
    if is_game_running {
        if is_game_no_vr {
            "(Desktop)".into()
        } else {
            "(VR)".into()
        }
    } else {
        match platform {
            "standalonewindows" | "windows" => "(PC)".into(),
            "android" => "(Android)".into(),
            "ios" => "(iOS)".into(),
            _ => String::new(),
        }
    }
}

#[derive(Clone, Copy)]
struct StatusInfo {
    status_name: &'static str,
    status_image: &'static str,
    hide_private: bool,
}

fn status_info(status: Option<&str>, hide_invite: bool) -> StatusInfo {
    match status.unwrap_or("active") {
        "join me" => StatusInfo {
            status_name: "Join Me",
            status_image: "joinme",
            hide_private: false,
        },
        "ask me" => StatusInfo {
            status_name: "Ask Me",
            status_image: "askme",
            hide_private: hide_invite,
        },
        "busy" => StatusInfo {
            status_name: "Busy",
            status_image: "busy",
            hide_private: true,
        },
        "offline" => StatusInfo {
            status_name: "Offline",
            status_image: "offline",
            hide_private: true,
        },
        _ => StatusInfo {
            status_name: "Active",
            status_image: "active",
            hide_private: false,
        },
    }
}

fn build_access_name(parsed: &ParsedLocation, group_name: &str, platform: &str) -> String {
    let suffix = format!("#{}{}", parsed.instance_name, platform);
    match parsed.access_type.as_str() {
        "public" => format!("Public {suffix}"),
        "invite+" => format!("Invite+ {suffix}"),
        "invite" => format!("Invite {suffix}"),
        "friends" => format!("Friends {suffix}"),
        "friends+" => format!("Friends+ {suffix}"),
        "group" => {
            let group_access = match parsed.group_access_type.as_deref() {
                Some("public") => "Public",
                Some("plus") => "Plus",
                Some("members") => "Members",
                _ => "",
            };
            let group_suffix = if !group_name.is_empty() && !group_access.is_empty() {
                format!(" {group_access}({group_name})")
            } else if !group_access.is_empty() {
                format!(" {group_access}")
            } else if !group_name.is_empty() {
                format!(" ({group_name})")
            } else {
                String::new()
            };
            format!("Group{group_suffix} {suffix}")
        }
        _ => String::new(),
    }
}

fn create_activity_timestamps(start_time: Option<&str>, end_time: Option<&str>) -> Option<Value> {
    let mut timestamps = Map::new();
    if let Some(start) = start_time
        .and_then(timestamp_seconds)
        .filter(|value| *value > 0)
    {
        timestamps.insert("start".into(), json!(start));
    }
    if let Some(end) = end_time
        .and_then(timestamp_seconds)
        .filter(|value| *value > 0)
    {
        timestamps.insert("end".into(), json!(end));
    }
    if timestamps.is_empty() {
        None
    } else {
        Some(Value::Object(timestamps))
    }
}

fn timestamp_seconds(value: &str) -> Option<i64> {
    if let Ok(number) = value.parse::<i64>() {
        return Some(if number > 10_000_000_000 {
            number / 1000
        } else {
            number
        });
    }
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.timestamp())
}

fn create_activity_assets(
    big_icon: impl Into<String>,
    status_image: &str,
    status_name: &str,
) -> Option<Value> {
    let mut assets = Map::new();
    let big_icon = big_icon.into();
    if !big_icon.is_empty() {
        assets.insert("large_image".into(), Value::String(big_icon));
    }
    if !status_image.is_empty() {
        assets.insert("small_image".into(), Value::String(status_image.into()));
    }
    if !status_name.is_empty() {
        assets.insert("small_text".into(), Value::String(status_name.into()));
    }
    if assets.is_empty() {
        None
    } else {
        Some(Value::Object(assets))
    }
}

fn create_activity_party(
    party_id: impl Into<String>,
    party_size: i64,
    party_max_size: i64,
) -> Option<Value> {
    let party_id = party_id.into();
    if party_id.is_empty() || party_size <= 0 || party_max_size <= 0 {
        return None;
    }
    Some(json!({
        "id": party_id,
        "size": [party_size, party_max_size],
    }))
}

fn create_activity_buttons(
    button_text: impl Into<String>,
    button_url: impl Into<String>,
) -> Option<Value> {
    let button_text = button_text.into();
    let button_url = button_url.into();
    if button_text.is_empty() || button_url.is_empty() {
        return None;
    }
    Some(json!([{ "label": button_text, "url": button_url }]))
}

fn compact_object(value: Value) -> Value {
    let Some(object) = value.as_object() else {
        return value;
    };
    let compacted = object
        .iter()
        .filter_map(|(key, value)| {
            let keep = match value {
                Value::Null => false,
                Value::String(value) => !value.is_empty(),
                _ => true,
            };
            keep.then(|| (key.clone(), value.clone()))
        })
        .collect();
    Value::Object(compacted)
}

fn get_launch_url(parsed: &ParsedLocation) -> String {
    if parsed.world_id.is_empty() || parsed.instance_id.is_empty() {
        return String::new();
    }
    let mut url = format!(
        "https://vrchat.com/home/launch?worldId={}&instanceId={}",
        parsed.world_id, parsed.instance_id
    );
    if !parsed.short_name.is_empty() {
        url.push_str("&shortName=");
        url.push_str(&parsed.short_name);
    }
    url
}

fn now_playing_has_content(now_playing: &Value) -> bool {
    string_field(now_playing, "url").is_some() || string_field(now_playing, "name").is_some()
}

fn now_playing_activity_times(now_playing: &Value) -> (String, String) {
    let start_time = string_field(now_playing, "startedAt")
        .or_else(|| string_field(now_playing, "created_at"))
        .unwrap_or_default();
    let Some(start_seconds) = timestamp_seconds(&start_time).filter(|value| *value > 0) else {
        return (start_time, String::new());
    };
    let length = int_field(now_playing, "length").unwrap_or(0);
    let end_time = if length > 0 {
        (start_seconds + length).to_string()
    } else {
        String::new()
    };
    (start_time, end_time)
}

fn is_popcorn_palace_world(world_id: &str) -> bool {
    matches!(
        world_id,
        "wrld_266523e8-9161-40da-acd0-6bd82e075833" | "wrld_27c7e6b2-d938-447e-a270-3d1a873e2cf3"
    )
}

fn rpc_world_config(world_id: &str) -> Option<RpcWorldConfig> {
    match world_id {
        "wrld_f20326da-f1ac-45fc-a062-609723b097b1"
        | "wrld_10e5e467-fc65-42ed-8957-f02cace1398c"
        | "wrld_04899f23-e182-4a8d-b2c7-2c74c7c15534" => Some(RpcWorldConfig {
            app_id: "784094509008551956",
            activity_type: 2,
            status_display_type: 2,
            big_icon: "pypy",
        }),
        "wrld_42377cf1-c54f-45ed-8996-5875b0573a83"
        | "wrld_dd6d2888-dbdc-47c2-bc98-3d631b2acd7c" => Some(RpcWorldConfig {
            app_id: "846232616054030376",
            activity_type: 2,
            status_display_type: 2,
            big_icon: "vr_dancing",
        }),
        "wrld_52bdcdab-11cd-4325-9655-0fb120846945"
        | "wrld_2d40da63-8f1f-4011-8a9e-414eb8530acd" => Some(RpcWorldConfig {
            app_id: "939473404808007731",
            activity_type: 2,
            status_display_type: 2,
            big_icon: "zuwa_zuwa_dance",
        }),
        "wrld_74970324-58e8-4239-a17b-2c59dfdf00db"
        | "wrld_db9d878f-6e76-4776-8bf2-15bcdd7fc445"
        | "wrld_435bbf25-f34f-4b8b-82c6-cd809057eb8e"
        | "wrld_f767d1c8-b249-4ecc-a56f-614e433682c8" => Some(RpcWorldConfig {
            app_id: "968292722391785512",
            activity_type: 3,
            status_display_type: 2,
            big_icon: "ls_media",
        }),
        "wrld_266523e8-9161-40da-acd0-6bd82e075833"
        | "wrld_27c7e6b2-d938-447e-a270-3d1a873e2cf3" => Some(RpcWorldConfig {
            app_id: "1095440531821170820",
            activity_type: 3,
            status_display_type: 2,
            big_icon: "popcorn_palace",
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_location_matches_group_plus_instance_type() {
        let parsed = parse_location("wrld_1:123~group(grp_1)~groupAccessType(plus)");

        assert_eq!(parsed.world_id, "wrld_1");
        assert_eq!(parsed.access_type, "group");
        assert_eq!(normalize_instance_type(&parsed), "groupPlus");
    }

    #[test]
    fn discord_non_game_tick_is_quiet_after_close_attempts() {
        let mut state = BackgroundDiscordPresenceState {
            last_game_running: true,
            is_active: true,
            ..Default::default()
        };
        let facts = BackgroundPresenceFacts {
            is_game_running: false,
            ..Default::default()
        };

        if !facts.is_game_running {
            if state.last_game_running {
                state.close_attempts_remaining = GAME_STOP_DISCORD_CLOSE_ATTEMPTS;
            }
            state.last_game_running = false;
        }

        assert_eq!(state.close_attempts_remaining, 5);
    }

    #[test]
    fn legacy_company_rule_beats_alone_rule_by_priority() {
        let facts = BackgroundPresenceFacts {
            is_game_running: true,
            player_facts_known: true,
            player_count: 1,
            instance_type: "public".into(),
            ..Default::default()
        };
        let rules = vec![
            json!({
                "id": "legacy-alone",
                "enabled": true,
                "priority": 100,
                "conditions": [{"type": "playerFactsKnown"}],
                "actions": {"status": "join me"},
            }),
            json!({
                "id": "legacy-company",
                "enabled": true,
                "priority": 200,
                "conditions": [{"type": "withCompany"}],
                "actions": {"status": "busy"},
                "stopProcessing": true,
            }),
        ];

        let result = evaluate_presence_rules(&facts, &rules);

        assert_eq!(
            result.patch.get("status"),
            Some(&Value::String("busy".into()))
        );
    }

    #[test]
    fn discord_rpc_world_uses_now_playing_details_and_thumbnail() {
        let config = DiscordConfig {
            discord_world_integration: true,
            discord_world_name_as_discord_status: true,
            discord_instance: true,
            discord_join_button: true,
            ..Default::default()
        };
        let facts = BackgroundPresenceFacts {
            is_game_running: true,
            current_location_started_at: "2026-05-19T00:00:00Z".into(),
            now_playing: json!({
                "url": "https://video.example/watch",
                "name": "Example Movie",
                "thumbnailUrl": "https://image.example/thumb.jpg",
                "startedAt": "2026-05-19T01:00:00Z",
                "length": 120,
            }),
            ..Default::default()
        };
        let parsed = parse_location("wrld_266523e8-9161-40da-acd0-6bd82e075833:12345");
        let details = DiscordLocationDetails {
            world_name: "Popcorn Palace".into(),
            thumbnail_image_url: "https://image.example/world.jpg".into(),
            world_capacity: 32,
            world_link: "https://vrchat.com/home/world/wrld_266523e8-9161-40da-acd0-6bd82e075833"
                .into(),
            parsed: Some(parsed.clone()),
            ..Default::default()
        };

        let payload = build_discord_activity(&config, &facts, &details, &parsed);
        let activity = payload.activity.as_object().unwrap();

        assert_eq!(payload.app_id, "1095440531821170820");
        assert_eq!(
            activity.get("details"),
            Some(&Value::String("Example Movie".into()))
        );
        assert_eq!(
            activity
                .get("assets")
                .and_then(|value| value.get("large_image")),
            Some(&Value::String("https://image.example/thumb.jpg".into()))
        );
        assert_eq!(
            activity
                .get("timestamps")
                .and_then(|value| value.get("start"))
                .and_then(Value::as_i64),
            timestamp_seconds("2026-05-19T01:00:00Z")
        );
        assert_eq!(
            activity
                .get("timestamps")
                .and_then(|value| value.get("end"))
                .and_then(Value::as_i64),
            timestamp_seconds("2026-05-19T01:02:00Z")
        );
    }
}
