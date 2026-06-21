const GLOBAL_DATA_CAVEATS: &[&str] = &[
    "VRCX-0 data is observer-centered and not a global VRChat record.",
    "Missing rows mean this VRCX-0 profile did not observe the event, not that the event did not happen.",
    "Co-presence minutes are useful for relative sorting; join/leave pairing can undercount absolute duration.",
    "Private instances that the owner cannot see may only appear as private and cannot be separated by instance.",
];

pub fn global_caveats() -> Vec<String> {
    GLOBAL_DATA_CAVEATS
        .iter()
        .map(|value| (*value).to_string())
        .collect()
}

pub fn data_caveats_resource() -> String {
    global_caveats().join("\n")
}

pub(crate) fn copresence_caveats() -> Vec<String> {
    vec![
        "Co-presence total_minutes can be systemically low; use it for relative sorting, not exact duration.".into(),
        "minutes_by_access is based on parse_location and can miss transition or empty locations.".into(),
    ]
}

pub(crate) fn friend_activity_caveats() -> Vec<String> {
    vec![
        "Online events are reliable for observed friend availability but do not imply joinability."
            .into(),
    ]
}

pub(crate) fn worlds_visited_caveats() -> Vec<String> {
    vec![
        "World visit rows are based on this profile's local game log.".into(),
        "Several worlds may match a natural-language window; confirm the target before writing favorites.".into(),
    ]
}

pub(crate) fn favorite_local_caveats() -> Vec<String> {
    vec!["This writes only VRCX-0 local favorites and does not change the VRChat account.".into()]
}

pub(crate) fn social_graph_caveats() -> Vec<String> {
    vec![
        "Social graph edges describe friend relationship data, not co-play or co-presence.".into(),
        "Only mutual graph snapshots that VRCX-0 has fetched are represented.".into(),
        "Mutual data is fetched on demand and breaks when a friend opts out of Shared Connections; use refresh_mutual_graph to update.".into(),
    ]
}

pub(crate) fn companions_caveats() -> Vec<String> {
    vec![
        "Companion inference only covers visible instance locations in feed_gps.".into(),
        "Private instances that are not visible to the owner cannot be separated by instance and are excluded.".into(),
        "overlap_minutes is an approximation based on overlapping visible location events.".into(),
    ]
}

pub(crate) fn invite_history_caveats() -> Vec<String> {
    vec![
        "Invite history is based on notifications observed by this VRCX-0 profile.".into(),
        "Sent invite coverage depends on whether the local notification row includes a receiver_user_id.".into(),
    ]
}

pub(crate) fn friend_log_caveats() -> Vec<String> {
    vec!["Friend log is observed relationship events for this profile.".into()]
}

pub(crate) fn friend_changes_caveats() -> Vec<String> {
    vec!["Friend changes are observed realtime feed events for this VRCX-0 profile.".into()]
}
