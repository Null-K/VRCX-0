//! Canonical VRChat location-tag parser.
//!
//! A VRChat location tag looks like
//! `wrld_<id>:<instanceName>~<segment>~<segment>...&shortName=<code>` (plus the
//! sentinels `offline` / `private` / `traveling`). This module is the single
//! source of truth for turning that string into structured data; every realtime,
//! presence, and Discord path consumes it instead of re-implementing parsing.

use serde::Serialize;
use serde_json::{json, Value};

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

impl ParsedLocation {
    pub fn to_minimal_value(&self, tag: &str) -> Value {
        json!({
            "tag": tag,
            "worldId": self.world_id,
            "instanceId": self.instance_id,
            "groupId": self.group_id.clone().unwrap_or_default(),
        })
    }
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

pub fn normalize_instance_type(parsed: &ParsedLocation) -> String {
    if parsed.access_type != "group" {
        return parsed.access_type.clone();
    }
    match parsed.group_access_type.as_deref() {
        Some("members") => "groupOnly".into(),
        Some("plus") => "groupPlus".into(),
        _ => "groupPublic".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sentinels_short_circuit_without_world() {
        for (tag, is_offline, is_private, is_traveling) in [
            ("offline", true, false, false),
            ("offline:offline", true, false, false),
            ("private", false, true, false),
            ("private:private", false, true, false),
            ("traveling", false, false, true),
            ("traveling:traveling", false, false, true),
        ] {
            let parsed = parse_location(tag);
            assert_eq!(parsed.is_offline, is_offline, "{tag}");
            assert_eq!(parsed.is_private, is_private, "{tag}");
            assert_eq!(parsed.is_traveling, is_traveling, "{tag}");
            assert!(!parsed.is_real_instance, "{tag}");
            assert_eq!(parsed.world_id, "", "{tag}");
            assert_eq!(parsed.instance_id, "", "{tag}");
        }
    }

    #[test]
    fn empty_and_local_are_not_real_instances() {
        for tag in ["", "local", "local:1234"] {
            let parsed = parse_location(tag);
            assert!(!parsed.is_real_instance, "{tag}");
            assert_eq!(parsed.world_id, "", "{tag}");
        }
    }

    #[test]
    fn public_instance_parses_world_instance_region() {
        let parsed = parse_location("wrld_abc:12345~region(use)");
        assert!(parsed.is_real_instance);
        assert_eq!(parsed.world_id, "wrld_abc");
        assert_eq!(parsed.instance_id, "12345~region(use)");
        assert_eq!(parsed.instance_name, "12345");
        assert_eq!(parsed.access_type, "public");
        assert_eq!(parsed.region, "use");
    }

    #[test]
    fn access_types_are_derived_from_segments() {
        let invite = parse_location("wrld_a:1~private(usr_x)");
        assert_eq!(invite.access_type, "invite");
        assert_eq!(invite.user_id.as_deref(), Some("usr_x"));

        let invite_plus = parse_location("wrld_a:1~private(usr_x)~canRequestInvite");
        assert_eq!(invite_plus.access_type, "invite+");
        assert!(invite_plus.can_request_invite);

        let friends = parse_location("wrld_a:1~friends(usr_y)");
        assert_eq!(friends.access_type, "friends");
        assert_eq!(friends.user_id.as_deref(), Some("usr_y"));

        let friends_plus = parse_location("wrld_a:1~hidden(usr_z)");
        assert_eq!(friends_plus.access_type, "friends+");
        assert_eq!(friends_plus.user_id.as_deref(), Some("usr_z"));
    }

    #[test]
    fn group_access_type_drives_name_and_normalization() {
        let plus = parse_location("wrld_a:1~group(grp_a)~groupAccessType(plus)");
        assert_eq!(plus.group_id.as_deref(), Some("grp_a"));
        assert_eq!(plus.access_type, "group");
        assert_eq!(plus.access_type_name, "groupPlus");
        assert_eq!(normalize_instance_type(&plus), "groupPlus");

        let public = parse_location("wrld_a:1~group(grp_a)~groupAccessType(public)");
        assert_eq!(public.access_type_name, "groupPublic");
        assert_eq!(normalize_instance_type(&public), "groupPublic");

        let members = parse_location("wrld_a:1~group(grp_a)~groupAccessType(members)");
        assert_eq!(members.access_type_name, "group");
        assert_eq!(normalize_instance_type(&members), "groupOnly");
    }

    #[test]
    fn strict_age_gate_and_short_name() {
        let parsed = parse_location("wrld_a:1~region(eu)~strict~ageGate&shortName=ab12");
        assert!(parsed.strict);
        assert!(parsed.age_gate);
        assert_eq!(parsed.short_name, "ab12");
        assert_eq!(parsed.instance_id, "1~region(eu)~strict~ageGate");
    }

    #[test]
    fn bare_world_id_without_instance() {
        let parsed = parse_location("wrld_only");
        assert_eq!(parsed.world_id, "wrld_only");
        assert_eq!(parsed.instance_id, "");
    }

    #[test]
    fn minimal_value_matches_presence_contract() {
        let parsed = parse_location("wrld_a:1~group(grp_a)~groupAccessType(plus)");
        assert_eq!(
            parsed.to_minimal_value("wrld_a:1~group(grp_a)~groupAccessType(plus)"),
            json!({
                "tag": "wrld_a:1~group(grp_a)~groupAccessType(plus)",
                "worldId": "wrld_a",
                "instanceId": "1~group(grp_a)~groupAccessType(plus)",
                "groupId": "grp_a",
            })
        );

        let public = parse_location("wrld_a:1~region(use)");
        assert_eq!(
            public.to_minimal_value("wrld_a:1~region(use)")["groupId"],
            json!("")
        );

        let offline = parse_location("offline");
        assert_eq!(
            offline.to_minimal_value("  offline  "),
            json!({"tag": "  offline  ", "worldId": "", "instanceId": "", "groupId": ""})
        );
    }
}
