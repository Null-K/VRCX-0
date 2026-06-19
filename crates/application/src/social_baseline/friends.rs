use super::*;
use vrcx_0_core::trust::{compute_trust_level, compute_user_platform};
use vrcx_0_vrchat_client::auth::current_user_get_input;

fn add_state_bucket_ids(
    snapshot: &Value,
    key: &str,
    deps: &str,
    state_by_id: &mut HashMap<String, String>,
    ordered_ids: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    for user_id in string_array_field(snapshot, key) {
        if user_id.is_empty() {
            continue;
        }
        unique_push(ordered_ids, seen, user_id.clone());
        state_by_id.insert(user_id, deps.to_string());
    }
}

#[derive(Clone, Debug)]
struct RemoteFriendProfile {
    id: String,
    raw: Value,
    source_state_bucket: Option<String>,
}

impl RemoteFriendProfile {
    fn from_raw(raw: Value, source_state_bucket: Option<&str>) -> Option<Self> {
        let id = object_field_normalized(&raw, &["id"]);
        if id.is_empty() {
            return None;
        }
        let source_state_bucket = source_state_bucket
            .map(normalize_state_bucket)
            .filter(|value| !value.is_empty());
        Some(Self {
            id,
            raw,
            source_state_bucket,
        })
    }
}

pub(super) fn build_friend_state_map(snapshot: &Value) -> (HashMap<String, String>, Vec<String>) {
    let mut state_by_id = HashMap::new();
    let mut ordered_ids = Vec::new();
    let mut seen = HashSet::new();
    add_state_bucket_ids(
        snapshot,
        "friends",
        "offline",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    add_state_bucket_ids(
        snapshot,
        "offlineFriends",
        "offline",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    add_state_bucket_ids(
        snapshot,
        "activeFriends",
        "active",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    add_state_bucket_ids(
        snapshot,
        "onlineFriends",
        "online",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    (state_by_id, ordered_ids)
}

pub(super) fn build_snapshot_friend_ids(snapshot: &Value) -> (Vec<String>, HashSet<String>, bool) {
    let has_friend_list = object_field(snapshot, "friends").is_some_and(Value::is_array);
    let friend_ids = string_array_field(snapshot, "friends");
    let friend_set = friend_ids.iter().cloned().collect();
    (friend_ids, friend_set, has_friend_list)
}

fn is_valid_friend_user(value: &Value) -> bool {
    !object_field_normalized(value, &["id"]).is_empty()
}

async fn fetch_all_friends(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    offline: bool,
) -> Result<Vec<Value>> {
    let rows = fetch_paged_array(deps, FRIEND_PAGE_SIZE, None, |n, offset| {
        remote_friends::friends_get_input(endpoint.to_string(), offline, n, offset)
    })
    .await?;
    Ok(rows.into_iter().filter(is_valid_friend_user).collect())
}

fn insert_fetched_friend(
    fetched_friends_by_id: &mut HashMap<String, RemoteFriendProfile>,
    fetched_friend_ids_ordered: &mut Vec<String>,
    fetched_friend_ids_seen: &mut HashSet<String>,
    friend: Value,
    source_state_bucket: Option<&str>,
) {
    let Some(friend) = RemoteFriendProfile::from_raw(friend, source_state_bucket) else {
        return;
    };
    let friend_id = friend.id.clone();
    unique_push(
        fetched_friend_ids_ordered,
        fetched_friend_ids_seen,
        friend_id.clone(),
    );
    let should_replace = fetched_friends_by_id
        .get(&friend_id)
        .map(|existing| {
            friend.source_state_bucket.is_none()
                || existing.source_state_bucket.as_deref() != Some("online")
                || friend.source_state_bucket.as_deref() == Some("online")
        })
        .unwrap_or(true);
    if should_replace {
        fetched_friends_by_id.insert(friend_id, friend);
    }
}

fn number_value(value: i64) -> Value {
    Value::Number(Number::from(value))
}

fn float_value(value: f64) -> Value {
    Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn fallback_friend_user(user_id: &str, existing_row: &Value) -> Value {
    let display_name = object_field_string(existing_row, &["displayName", "display_name"]);
    let display_name = if display_name.is_empty() {
        user_id.to_string()
    } else {
        display_name
    };
    json!({
        "id": user_id,
        "displayName": display_name,
        "username": "",
        "tags": [],
        "developerType": "",
        "platform": "offline",
        "last_platform": "",
        "location": "offline",
        "state": "offline"
    })
}

fn get_display_name(user: &Value) -> String {
    for key in ["displayName", "username", "id"] {
        let value = object_field_string(user, &[key]);
        if !value.is_empty() {
            return value;
        }
    }
    String::new()
}

fn get_meaningful_display_name(user: &Value, user_id: &str) -> String {
    let normalized_user_id = normalize_text(if user_id.is_empty() {
        object_field_string(user, &["id"])
    } else {
        user_id.to_string()
    });
    for key in ["displayName", "username"] {
        let display_name = object_field_normalized(user, &[key]);
        if !display_name.is_empty() && display_name != normalized_user_id {
            return display_name;
        }
    }
    String::new()
}

fn normalize_state_bucket(value: &str) -> String {
    match normalize_text(value).to_ascii_lowercase().as_str() {
        "online" => "online".into(),
        "active" => "active".into(),
        "offline" => "offline".into(),
        _ => String::new(),
    }
}

fn normalize_friend_entry(
    friend: Option<&Value>,
    state_bucket: &str,
    existing_row: &Value,
) -> Value {
    let user_id = object_field_normalized(existing_row, &["userId", "user_id"]);
    let source = friend
        .cloned()
        .unwrap_or_else(|| fallback_friend_user(&user_id, existing_row));
    let mut object = source.as_object().cloned().unwrap_or_default();
    let tags = object
        .get("tags")
        .and_then(Value::as_array)
        .map(|tags| tags.iter().map(value_as_string).collect::<Vec<_>>())
        .unwrap_or_default();
    let developer_type = object
        .get("developerType")
        .map(value_as_string)
        .unwrap_or_default();
    let trust = compute_trust_level(&tags, &developer_type);
    let explicit_trust_level = object
        .get("$trustLevel")
        .or_else(|| object.get("trustLevel"))
        .map(value_as_string)
        .unwrap_or_default();
    let has_trust_metadata = friend.is_some()
        && (!tags.is_empty() || !developer_type.is_empty() || !explicit_trust_level.is_empty());
    let existing_trust_level = object_field_string(existing_row, &["trustLevel", "$trustLevel"]);
    let trust_level = if !explicit_trust_level.is_empty() {
        explicit_trust_level
    } else if has_trust_metadata {
        trust.trust_level.clone()
    } else if !existing_trust_level.is_empty() {
        existing_trust_level
    } else {
        trust.trust_level.clone()
    };
    let friend_number = value_as_i64(
        object
            .get("friendNumber")
            .or_else(|| object.get("$friendNumber"))
            .or_else(|| object_field(existing_row, "friendNumber"))
            .or_else(|| object_field(existing_row, "$friendNumber")),
    );
    let source_user_id = object
        .get("id")
        .map(value_as_string)
        .unwrap_or_else(|| user_id.clone());
    let display_name = {
        let meaningful =
            get_meaningful_display_name(&Value::Object(object.clone()), &source_user_id);
        if !meaningful.is_empty() {
            meaningful
        } else {
            let existing_display_name =
                object_field_string(existing_row, &["displayName", "display_name"]);
            if !existing_display_name.is_empty() {
                existing_display_name
            } else {
                let source_display_name = get_display_name(&Value::Object(object.clone()));
                if source_display_name.is_empty() {
                    source_user_id.clone()
                } else {
                    source_display_name
                }
            }
        }
    };

    let platform = object
        .get("platform")
        .map(value_as_string)
        .unwrap_or_default();
    let last_platform = object
        .get("last_platform")
        .or_else(|| object.get("lastPlatform"))
        .map(value_as_string)
        .unwrap_or_default();
    object.insert("displayName".into(), Value::String(display_name));
    // location never participates in bucketing; the /auth/user list bucket is the only authority.
    object.insert("state".into(), Value::String(state_bucket.to_string()));
    object.insert(
        "stateBucket".into(),
        Value::String(state_bucket.to_string()),
    );
    object.insert("friendNumber".into(), number_value(friend_number));
    object.insert("trustLevel".into(), Value::String(trust_level.clone()));
    object.insert("$friendNumber".into(), number_value(friend_number));
    object.insert("$trustLevel".into(), Value::String(trust_level));
    object.insert("$trustClass".into(), Value::String(trust.trust_class));
    object.insert("$trustSortNum".into(), float_value(trust.trust_sort_num));
    object.insert("$isModerator".into(), Value::Bool(trust.is_moderator));
    object.insert("$isTroll".into(), Value::Bool(trust.is_troll));
    object.insert(
        "$isProbableTroll".into(),
        Value::Bool(trust.is_probable_troll),
    );
    object.insert(
        "$platform".into(),
        Value::String(compute_user_platform(&platform, &last_platform)),
    );
    vrcx_0_core::friends::strip_default_avatar_image(&mut object);
    Value::Object(object)
}

fn compare_friend_entries(left: &Value, right: &Value) -> Ordering {
    let left_number = value_as_i64(
        object_field(left, "friendNumber").or_else(|| object_field(left, "$friendNumber")),
    );
    let right_number = value_as_i64(
        object_field(right, "friendNumber").or_else(|| object_field(right, "$friendNumber")),
    );
    let left_has_number = left_number > 0;
    let right_has_number = right_number > 0;

    if left_has_number != right_has_number {
        return if left_has_number {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }
    if left_has_number && right_has_number && left_number != right_number {
        return left_number.cmp(&right_number);
    }

    let left_name = object_field_string(left, &["displayName", "id"]);
    let right_name = object_field_string(right, &["displayName", "id"]);
    let name_comparison = compare_display_text(&left_name, &right_name);
    if name_comparison != Ordering::Equal {
        return name_comparison;
    }
    compare_display_text(
        &object_field_string(left, &["id"]),
        &object_field_string(right, &["id"]),
    )
}

fn compare_display_text(left: &str, right: &str) -> Ordering {
    let left_primary = display_text_primary_key(left);
    let right_primary = display_text_primary_key(right);
    let primary = left_primary.cmp(&right_primary);
    if primary != Ordering::Equal {
        return primary;
    }

    let left_lower = left.to_lowercase();
    let right_lower = right.to_lowercase();
    let secondary = left_lower.cmp(&right_lower);
    if secondary != Ordering::Equal {
        return secondary;
    }

    left.cmp(right)
}

fn display_text_primary_key(value: &str) -> String {
    let mut output = String::new();
    for character in value.to_lowercase().chars() {
        output.push_str(match character {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' | 'ǎ' | 'ǟ' => "a",
            'æ' => "ae",
            'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => "c",
            'ð' | 'ď' | 'đ' => "d",
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => "e",
            'ƒ' => "f",
            'ĝ' | 'ğ' | 'ġ' | 'ģ' => "g",
            'ĥ' | 'ħ' => "h",
            'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ı' => "i",
            'ĵ' => "j",
            'ķ' | 'ĸ' => "k",
            'ĺ' | 'ļ' | 'ľ' | 'ŀ' | 'ł' => "l",
            'ñ' | 'ń' | 'ņ' | 'ň' | 'ŉ' => "n",
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ŏ' | 'ő' => "o",
            'œ' => "oe",
            'ŕ' | 'ŗ' | 'ř' => "r",
            'ś' | 'ŝ' | 'ş' | 'š' | 'ſ' => "s",
            'ß' => "ss",
            'ţ' | 'ť' | 'ŧ' => "t",
            'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => "u",
            'ŵ' => "w",
            'ý' | 'ÿ' | 'ŷ' => "y",
            'ź' | 'ż' | 'ž' => "z",
            _ => {
                output.push(character);
                continue;
            }
        });
    }
    output
}

fn build_bucket_ids(
    included_ids: &[String],
    friends_by_id: &Map<String, Value>,
    state_bucket: &str,
) -> Vec<String> {
    let mut ids = included_ids
        .iter()
        .filter(|user_id| {
            friends_by_id
                .get(*user_id)
                .map(|friend| object_field_string(friend, &["stateBucket"]) == state_bucket)
                .unwrap_or(false)
        })
        .cloned()
        .collect::<Vec<_>>();
    ids.sort_by(|left_id, right_id| {
        let left = friends_by_id.get(left_id).unwrap_or(&Value::Null);
        let right = friends_by_id.get(right_id).unwrap_or(&Value::Null);
        compare_friend_entries(left, right)
    });
    ids
}

fn build_fast_roster_snapshot(
    user_id: &str,
    expected_ids: &[String],
    state_by_id: &HashMap<String, String>,
    fetched_friends_by_id: &HashMap<String, RemoteFriendProfile>,
) -> Value {
    let friend_order_numbers = expected_ids
        .iter()
        .enumerate()
        .map(|(index, friend_id)| (friend_id.clone(), (index + 1) as i64))
        .collect::<HashMap<_, _>>();

    let mut friends_by_id = Map::new();
    for friend_id in expected_ids {
        let fetched_profile = fetched_friends_by_id.get(friend_id);
        let friend = fetched_profile.map(|profile| &profile.raw);
        let existing_row = json!({
            "userId": friend_id,
            "displayName": friend.map(get_display_name).filter(|name| !name.is_empty()).unwrap_or_else(|| friend_id.clone()),
            "trustLevel": "Visitor",
            "friendNumber": friend_order_numbers.get(friend_id).copied().unwrap_or_default()
        });
        let state_bucket = state_by_id
            .get(friend_id)
            .map(String::as_str)
            .unwrap_or("offline");
        let mut normalized_friend = normalize_friend_entry(friend, state_bucket, &existing_row);
        if let Some(object) = normalized_friend.as_object_mut() {
            object.insert(
                "$profileSource".into(),
                Value::String(if friend.is_some() {
                    "remote".into()
                } else {
                    "placeholder".into()
                }),
            );
        }
        friends_by_id.insert(friend_id.clone(), normalized_friend);
    }

    let online_ids = build_bucket_ids(expected_ids, &friends_by_id, "online");
    let active_ids = build_bucket_ids(expected_ids, &friends_by_id, "active");
    let offline_ids = build_bucket_ids(expected_ids, &friends_by_id, "offline");
    let mut ordered_friend_ids = Vec::new();
    ordered_friend_ids.extend(online_ids.clone());
    ordered_friend_ids.extend(active_ids.clone());
    ordered_friend_ids.extend(offline_ids.clone());

    let detail = String::new();
    json!({
        "currentUserId": user_id,
        "friendsById": friends_by_id,
        "orderedFriendIds": ordered_friend_ids,
        "onlineIds": online_ids,
        "activeIds": active_ids,
        "offlineIds": offline_ids,
        "detail": detail
    })
}

fn infer_state_from_platform(platform: &str) -> &'static str {
    match platform {
        "" | "offline" => "offline",
        "web" => "active",
        _ => "online",
    }
}

fn collect_suspicious_friend_ids(
    expected_ids: &[String],
    state_by_id: &HashMap<String, String>,
    fetched_friends_by_id: &HashMap<String, RemoteFriendProfile>,
) -> Vec<String> {
    let mut suspicious = Vec::new();
    for friend_id in expected_ids {
        let Some(profile) = fetched_friends_by_id.get(friend_id) else {
            continue;
        };
        let list_state = state_by_id
            .get(friend_id)
            .map(String::as_str)
            .unwrap_or("offline");
        let inferred = infer_state_from_platform(&object_field_string(&profile.raw, &["platform"]));
        let location = object_field_string(&profile.raw, &["location"]);
        if inferred != list_state || location == "traveling" {
            suspicious.push(friend_id.clone());
        }
    }
    suspicious
}

pub async fn build_friend_roster_baseline(
    deps: SocialBaselineDeps,
    input: SocialFriendRosterBaselineInput,
) -> Result<SocialFriendRosterBaselineOutput> {
    let cached_current_user =
        CurrentUserSnapshotView::from_raw(input.current_user_snapshot.as_value());
    let user_id = normalize_text(if input.user_id.is_empty() {
        cached_current_user.user_id.clone()
    } else {
        input.user_id.clone()
    });
    if user_id.is_empty() {
        return Err(Error::Custom(
            "SocialFriendRosterBaselineGet requires an authenticated user id.".into(),
        ));
    }
    if !auth_scope_matches(&deps, &user_id, &input.endpoint) {
        return Ok(stale_friend_output(user_id, String::new()));
    }

    let current_user =
        execute_vrchat_json_request(&deps, current_user_get_input(input.endpoint.clone()))
            .await
            .ok()
            .filter(|value| !object_field_string(value, &["id"]).is_empty())
            .map(|value| CurrentUserSnapshotView::from_raw(&value))
            .unwrap_or(cached_current_user);

    let CurrentUserSnapshotView {
        mut state_by_id,
        state_order_ids,
        friend_ids: snapshot_friend_ids,
        has_friend_list,
        ..
    } = current_user;
    if !has_friend_list {
        return Ok(stale_friend_output(
            user_id,
            "Current user friend list is incomplete.".into(),
        ));
    }
    let mut expected_ids = Vec::new();
    let mut expected_seen = HashSet::new();
    extend_unique(&mut expected_ids, &mut expected_seen, state_order_ids);
    extend_unique(
        &mut expected_ids,
        &mut expected_seen,
        snapshot_friend_ids.clone(),
    );

    let online_friends = fetch_all_friends(&deps, &input.endpoint, false).await?;
    let offline_friends = fetch_all_friends(&deps, &input.endpoint, true).await?;
    let mut fetched_friends_by_id: HashMap<String, RemoteFriendProfile> = HashMap::new();
    let mut fetched_friend_ids_ordered = Vec::new();
    let mut fetched_friend_ids_seen = HashSet::new();
    // Fetched `state` is unreliable and must never overwrite the /auth/user list bucket.
    for friend in online_friends {
        insert_fetched_friend(
            &mut fetched_friends_by_id,
            &mut fetched_friend_ids_ordered,
            &mut fetched_friend_ids_seen,
            friend,
            Some("online"),
        );
    }
    for friend in offline_friends {
        insert_fetched_friend(
            &mut fetched_friends_by_id,
            &mut fetched_friend_ids_ordered,
            &mut fetched_friend_ids_seen,
            friend,
            Some("offline"),
        );
    }

    if !auth_scope_matches(&deps, &user_id, &input.endpoint) {
        return Ok(stale_friend_output(user_id, String::new()));
    }

    let mut refetch_ids =
        collect_suspicious_friend_ids(&expected_ids, &state_by_id, &fetched_friends_by_id);
    if input.is_first_load {
        for friend_id in &expected_ids {
            if !fetched_friends_by_id.contains_key(friend_id) {
                refetch_ids.push(friend_id.clone());
            }
        }
    }
    if !refetch_ids.is_empty() {
        let repaired = refetch_users_concurrent(&deps, &input.endpoint, refetch_ids).await;
        for (repaired_id, user) in repaired {
            let repaired_bucket = normalize_state_bucket(&object_field_string(&user, &["state"]));
            let Some(mut profile) = RemoteFriendProfile::from_raw(user, None) else {
                continue;
            };
            profile.source_state_bucket = fetched_friends_by_id
                .get(&repaired_id)
                .and_then(|existing| existing.source_state_bucket.clone());
            fetched_friends_by_id.insert(repaired_id.clone(), profile);
            if !repaired_bucket.is_empty() {
                state_by_id.insert(repaired_id, repaired_bucket);
            }
        }
    }

    let snapshot = build_fast_roster_snapshot(
        &user_id,
        &expected_ids,
        &state_by_id,
        &fetched_friends_by_id,
    );
    let detail = String::new();
    let count = snapshot
        .get("orderedFriendIds")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);

    Ok(SocialFriendRosterBaselineOutput {
        user_id,
        stale: false,
        count,
        detail,
        snapshot: Some(RawJson::from(snapshot)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_suspicious_only_targets_mismatched_or_traveling_friends() {
        let expected_ids = vec![
            "usr_online".to_string(),
            "usr_active_pc".to_string(),
            "usr_traveling".to_string(),
            "usr_offline".to_string(),
        ];
        let state_by_id = HashMap::from([
            ("usr_online".to_string(), "online".to_string()),
            ("usr_active_pc".to_string(), "active".to_string()),
            ("usr_traveling".to_string(), "online".to_string()),
            ("usr_offline".to_string(), "offline".to_string()),
        ]);
        let profile = |id: &str, platform: &str, location: &str| {
            RemoteFriendProfile::from_raw(
                json!({ "id": id, "platform": platform, "location": location }),
                None,
            )
            .expect("valid profile")
        };
        let fetched_friends_by_id = HashMap::from([
            (
                "usr_online".to_string(),
                profile("usr_online", "standalonewindows", "wrld_1:1"),
            ),
            (
                "usr_active_pc".to_string(),
                profile("usr_active_pc", "standalonewindows", "offline"),
            ),
            (
                "usr_traveling".to_string(),
                profile("usr_traveling", "standalonewindows", "traveling"),
            ),
            (
                "usr_offline".to_string(),
                profile("usr_offline", "", "offline"),
            ),
        ]);

        let suspicious =
            collect_suspicious_friend_ids(&expected_ids, &state_by_id, &fetched_friends_by_id);

        assert_eq!(
            suspicious,
            vec!["usr_active_pc".to_string(), "usr_traveling".to_string()]
        );
    }

    #[test]
    fn collect_suspicious_flags_stale_online_friend() {
        let expected_ids = vec!["usr_stale".to_string()];
        let state_by_id = HashMap::from([("usr_stale".to_string(), "online".to_string())]);
        let fetched_friends_by_id = HashMap::from([(
            "usr_stale".to_string(),
            RemoteFriendProfile::from_raw(
                json!({ "id": "usr_stale", "platform": "", "location": "offline" }),
                None,
            )
            .expect("valid profile"),
        )]);

        let suspicious =
            collect_suspicious_friend_ids(&expected_ids, &state_by_id, &fetched_friends_by_id);

        assert_eq!(suspicious, vec!["usr_stale".to_string()]);
    }

    #[test]
    fn insert_fetched_friend_collects_profile_and_prefers_online_source() {
        let mut fetched_friends_by_id = HashMap::new();
        let mut ordered = Vec::new();
        let mut seen = HashSet::new();

        insert_fetched_friend(
            &mut fetched_friends_by_id,
            &mut ordered,
            &mut seen,
            json!({ "id": "usr_friend", "state": "online", "location": "offline" }),
            Some("offline"),
        );
        insert_fetched_friend(
            &mut fetched_friends_by_id,
            &mut ordered,
            &mut seen,
            json!({ "id": "usr_friend", "location": "wrld_live:123" }),
            Some("online"),
        );

        assert_eq!(ordered, vec!["usr_friend".to_string()]);
        let profile = fetched_friends_by_id
            .get("usr_friend")
            .expect("inserted friend profile");
        assert_eq!(profile.source_state_bucket.as_deref(), Some("online"));
        assert_eq!(
            object_field_string(&profile.raw, &["location"]),
            "wrld_live:123"
        );
    }

    #[test]
    fn fast_roster_snapshot_uses_current_user_ids_and_remote_profiles_without_friend_log() {
        let expected_ids = vec!["usr_online".to_string(), "usr_missing".to_string()];
        let state_by_id = HashMap::from([
            ("usr_online".to_string(), "online".to_string()),
            ("usr_missing".to_string(), "offline".to_string()),
        ]);
        let fetched_friends_by_id = HashMap::from([(
            "usr_online".to_string(),
            RemoteFriendProfile::from_raw(
                json!({
                    "id": "usr_online",
                    "displayName": "Online Friend",
                    "location": "wrld_live:123",
                    "platform": "standalonewindows",
                    "tags": ["system_trust_known"]
                }),
                Some("online"),
            )
            .expect("valid profile"),
        )]);

        let snapshot = build_fast_roster_snapshot(
            "usr_self",
            &expected_ids,
            &state_by_id,
            &fetched_friends_by_id,
        );

        let friends_by_id = snapshot
            .get("friendsById")
            .and_then(Value::as_object)
            .expect("friendsById object");
        assert_eq!(
            friends_by_id
                .get("usr_online")
                .and_then(|friend| object_field(friend, "displayName"))
                .and_then(Value::as_str),
            Some("Online Friend")
        );
        assert_eq!(
            friends_by_id
                .get("usr_online")
                .and_then(|friend| object_field(friend, "location"))
                .and_then(Value::as_str),
            Some("wrld_live:123")
        );
        assert_eq!(
            friends_by_id
                .get("usr_missing")
                .and_then(|friend| object_field(friend, "displayName"))
                .and_then(Value::as_str),
            Some("usr_missing")
        );
        assert_eq!(
            snapshot
                .get("orderedFriendIds")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            vec![json!("usr_online"), json!("usr_missing")]
        );
    }

    #[test]
    fn placeholder_friend_uses_realtime_list_bucket() {
        let expected_ids = vec!["usr_stale".to_string()];
        let state_by_id = HashMap::from([("usr_stale".to_string(), "online".to_string())]);
        let fetched_friends_by_id = HashMap::new();

        let snapshot = build_fast_roster_snapshot(
            "usr_self",
            &expected_ids,
            &state_by_id,
            &fetched_friends_by_id,
        );

        let friends_by_id = snapshot
            .get("friendsById")
            .and_then(Value::as_object)
            .expect("friendsById object");
        let stale = friends_by_id.get("usr_stale").expect("usr_stale present");
        assert_eq!(
            object_field(stale, "stateBucket").and_then(Value::as_str),
            Some("online")
        );
        assert_eq!(
            object_field(stale, "$profileSource").and_then(Value::as_str),
            Some("placeholder")
        );
    }

    #[test]
    fn placeholder_active_friend_is_kept_active() {
        let expected_ids = vec!["usr_active".to_string()];
        let state_by_id = HashMap::from([("usr_active".to_string(), "active".to_string())]);
        let fetched_friends_by_id = HashMap::new();

        let snapshot = build_fast_roster_snapshot(
            "usr_self",
            &expected_ids,
            &state_by_id,
            &fetched_friends_by_id,
        );

        let friends_by_id = snapshot
            .get("friendsById")
            .and_then(Value::as_object)
            .expect("friendsById object");
        let active = friends_by_id.get("usr_active").expect("usr_active present");
        assert_eq!(
            object_field(active, "stateBucket").and_then(Value::as_str),
            Some("active")
        );
        assert_eq!(
            snapshot
                .get("activeIds")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            vec![json!("usr_active")]
        );
    }

    #[test]
    fn online_friend_in_private_world_stays_online() {
        let expected_ids = vec!["usr_priv".to_string()];
        let state_by_id = HashMap::from([("usr_priv".to_string(), "online".to_string())]);
        let fetched_friends_by_id = HashMap::from([(
            "usr_priv".to_string(),
            RemoteFriendProfile::from_raw(
                json!({
                    "id": "usr_priv",
                    "displayName": "Priv",
                    "location": "private",
                    "status": "ask me"
                }),
                Some("online"),
            )
            .expect("valid profile"),
        )]);

        let snapshot = build_fast_roster_snapshot(
            "usr_self",
            &expected_ids,
            &state_by_id,
            &fetched_friends_by_id,
        );

        let friends_by_id = snapshot
            .get("friendsById")
            .and_then(Value::as_object)
            .expect("friendsById object");
        let priv_friend = friends_by_id.get("usr_priv").expect("usr_priv present");
        assert_eq!(
            object_field(priv_friend, "stateBucket").and_then(Value::as_str),
            Some("online")
        );
    }

    #[test]
    fn list_bucket_decides_state_not_location() {
        let expected_ids = vec!["usr_inworld".to_string()];
        let state_by_id = HashMap::from([("usr_inworld".to_string(), "offline".to_string())]);
        let fetched_friends_by_id = HashMap::from([(
            "usr_inworld".to_string(),
            RemoteFriendProfile::from_raw(
                json!({
                    "id": "usr_inworld",
                    "displayName": "InWorld",
                    "location": "wrld_1b754e93:1",
                    "status": "join me"
                }),
                Some("offline"),
            )
            .expect("valid profile"),
        )]);

        let snapshot = build_fast_roster_snapshot(
            "usr_self",
            &expected_ids,
            &state_by_id,
            &fetched_friends_by_id,
        );

        let friends_by_id = snapshot
            .get("friendsById")
            .and_then(Value::as_object)
            .expect("friendsById object");
        let friend = friends_by_id
            .get("usr_inworld")
            .expect("usr_inworld present");
        assert_eq!(
            object_field(friend, "stateBucket").and_then(Value::as_str),
            Some("offline")
        );
    }

    #[test]
    fn active_list_bucket_ignores_location() {
        let expected_ids = vec!["usr_active_inworld".to_string()];
        let state_by_id = HashMap::from([("usr_active_inworld".to_string(), "active".to_string())]);
        let fetched_friends_by_id = HashMap::from([(
            "usr_active_inworld".to_string(),
            RemoteFriendProfile::from_raw(
                json!({
                    "id": "usr_active_inworld",
                    "displayName": "ActiveInWorld",
                    "location": "wrld_929c02a8:1",
                    "status": "join me"
                }),
                Some("active"),
            )
            .expect("valid profile"),
        )]);

        let snapshot = build_fast_roster_snapshot(
            "usr_self",
            &expected_ids,
            &state_by_id,
            &fetched_friends_by_id,
        );

        let friends_by_id = snapshot
            .get("friendsById")
            .and_then(Value::as_object)
            .expect("friendsById object");
        let friend = friends_by_id
            .get("usr_active_inworld")
            .expect("usr_active_inworld present");
        assert_eq!(
            object_field(friend, "stateBucket").and_then(Value::as_str),
            Some("active")
        );
    }
}
