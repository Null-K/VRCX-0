use super::*;

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

#[derive(Clone, Debug)]
struct TrustLevelInfo {
    trust_level: String,
    trust_class: String,
    trust_sort_num: f64,
    is_moderator: bool,
    is_troll: bool,
    is_probable_troll: bool,
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
) -> Option<(String, String)> {
    let friend = RemoteFriendProfile::from_raw(friend, source_state_bucket)?;
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
        let state_bucket = fetched_friend_state_bucket(&friend);
        fetched_friends_by_id.insert(friend_id.clone(), friend);
        return state_bucket.map(|state_bucket| (friend_id, state_bucket));
    }
    None
}

fn fetched_friend_state_bucket(profile: &RemoteFriendProfile) -> Option<String> {
    for key in ["state", "stateBucket"] {
        let state_bucket = normalize_state_bucket(&object_field_string(&profile.raw, &[key]));
        if !state_bucket.is_empty() {
            return Some(state_bucket);
        }
    }
    None
}

fn apply_fetched_friend_state_bucket(
    state_by_id: &mut HashMap<String, String>,
    inserted_state_bucket: Option<(String, String)>,
) -> bool {
    let Some((friend_id, state_bucket)) = inserted_state_bucket else {
        return false;
    };
    state_by_id.insert(friend_id, state_bucket);
    true
}

fn compute_trust_level(tags: &[String], developer_type: &str) -> TrustLevelInfo {
    let mut is_moderator = !developer_type.is_empty() && developer_type != "none";
    let mut is_troll = false;
    let mut is_probable_troll = false;
    let mut trust_level = "Visitor".to_string();
    let mut trust_class = "x-tag-untrusted".to_string();
    let mut trust_color_key = "untrusted".to_string();
    let mut trust_sort_num = 1.0;

    if tags.iter().any(|tag| tag == "admin_moderator") {
        is_moderator = true;
    }
    if tags.iter().any(|tag| tag == "system_troll") {
        is_troll = true;
    }
    if tags.iter().any(|tag| tag == "system_probable_troll") && !is_troll {
        is_probable_troll = true;
    }

    if tags.iter().any(|tag| tag == "system_trust_veteran") {
        trust_level = "Trusted User".into();
        trust_class = "x-tag-veteran".into();
        trust_color_key = "veteran".into();
        trust_sort_num = 5.0;
    } else if tags.iter().any(|tag| tag == "system_trust_trusted") {
        trust_level = "Known User".into();
        trust_class = "x-tag-trusted".into();
        trust_color_key = "trusted".into();
        trust_sort_num = 4.0;
    } else if tags.iter().any(|tag| tag == "system_trust_known") {
        trust_level = "User".into();
        trust_class = "x-tag-known".into();
        trust_color_key = "known".into();
        trust_sort_num = 3.0;
    } else if tags.iter().any(|tag| tag == "system_trust_basic") {
        trust_level = "New User".into();
        trust_class = "x-tag-basic".into();
        trust_color_key = "basic".into();
        trust_sort_num = 2.0;
    }

    if is_troll || is_probable_troll {
        trust_color_key = "troll".into();
        trust_sort_num += 0.1;
    }
    if is_moderator {
        trust_color_key = "vip".into();
        trust_sort_num += 0.3;
    }

    let _ = trust_color_key;
    TrustLevelInfo {
        trust_level,
        trust_class,
        trust_sort_num,
        is_moderator,
        is_troll,
        is_probable_troll,
    }
}

fn compute_user_platform(platform: &str, last_platform: &str) -> String {
    if !platform.is_empty() && platform != "offline" && platform != "web" {
        return platform.to_string();
    }
    last_platform.to_string()
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
    // Mirror upstream userStatusClass: an "online" with offline/empty location is really offline.
    // "active" is untouched; a ws-confirmed active is restored in set_baseline.
    let location = object.get("location").and_then(Value::as_str).unwrap_or("");
    let location_is_offline =
        location.trim().is_empty() || location.eq_ignore_ascii_case("offline");
    let effective_state_bucket = if state_bucket == "online" && location_is_offline {
        "offline"
    } else {
        state_bucket
    };
    object.insert(
        "state".into(),
        Value::String(effective_state_bucket.to_string()),
    );
    object.insert(
        "stateBucket".into(),
        Value::String(effective_state_bucket.to_string()),
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

pub async fn build_friend_roster_baseline(
    deps: SocialBaselineDeps,
    input: SocialFriendRosterBaselineInput,
) -> Result<SocialFriendRosterBaselineOutput> {
    let current_user = CurrentUserSnapshotView::from_raw(input.current_user_snapshot.as_value());
    let user_id = normalize_text(if input.user_id.is_empty() {
        current_user.user_id.clone()
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

    let CurrentUserSnapshotView {
        state_by_id,
        state_order_ids,
        friend_ids: snapshot_friend_ids,
        has_friend_list,
        ..
    } = current_user;
    let mut state_by_id = state_by_id;
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
    for friend in online_friends {
        apply_fetched_friend_state_bucket(
            &mut state_by_id,
            insert_fetched_friend(
                &mut fetched_friends_by_id,
                &mut fetched_friend_ids_ordered,
                &mut fetched_friend_ids_seen,
                friend,
                Some("online"),
            ),
        );
    }
    for friend in offline_friends {
        apply_fetched_friend_state_bucket(
            &mut state_by_id,
            insert_fetched_friend(
                &mut fetched_friends_by_id,
                &mut fetched_friend_ids_ordered,
                &mut fetched_friend_ids_seen,
                friend,
                Some("offline"),
            ),
        );
    }

    if !auth_scope_matches(&deps, &user_id, &input.endpoint) {
        return Ok(stale_friend_output(user_id, String::new()));
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
    fn fetched_friend_state_updates_snapshot_bucket() {
        let mut state_by_id = HashMap::from([("usr_friend".to_string(), "offline".to_string())]);
        let mut fetched_friends_by_id = HashMap::new();
        let mut fetched_friend_ids_ordered = Vec::new();
        let mut fetched_friend_ids_seen = HashSet::new();

        let applied = apply_fetched_friend_state_bucket(
            &mut state_by_id,
            insert_fetched_friend(
                &mut fetched_friends_by_id,
                &mut fetched_friend_ids_ordered,
                &mut fetched_friend_ids_seen,
                json!({
                    "id": "usr_friend",
                    "state": "online",
                    "platform": "standalonewindows"
                }),
                Some("online"),
            ),
        );

        assert!(applied);
        assert_eq!(
            state_by_id.get("usr_friend").map(String::as_str),
            Some("online")
        );
        let profile = fetched_friends_by_id
            .get("usr_friend")
            .expect("inserted friend profile");
        assert_eq!(profile.id, "usr_friend");
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
    fn placeholder_friend_from_stale_online_list_is_offline() {
        // Placeholder (live fetch returned nothing) with a stale-list "online" and no real location:
        // build demotes it to offline, matching userStatusClass.
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
            Some("offline")
        );
        assert_eq!(
            object_field(stale, "$profileSource").and_then(Value::as_str),
            Some("placeholder")
        );
    }

    #[test]
    fn placeholder_active_friend_is_kept_active() {
        // Active friends can legitimately be absent from the world fetch; keep them active.
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
        // location=private is a hidden world, still online — must NOT be demoted to offline.
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
}
