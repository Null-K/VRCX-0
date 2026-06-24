use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub kind: String,
    pub id: String,
    pub display_name: String,
}

/// Recursively scan a tool result JSON for user/world entities.
///
/// Heuristic: any object carrying a VRChat id (`usr_*` / `wrld_*`, found in an
/// `id` field or a `*_id`/`*Id` field) together with a name-like sibling is
/// collected once, keyed by id so duplicates across the payload collapse.
pub fn extract_entities(value: &Value) -> Vec<Entity> {
    let mut found: BTreeMap<String, Entity> = BTreeMap::new();
    walk(value, &mut found);
    found.into_values().collect()
}

fn walk(value: &Value, found: &mut BTreeMap<String, Entity>) {
    match value {
        Value::Object(map) => {
            if let Some(entity) = entity_from_object(map) {
                found.entry(entity.id.clone()).or_insert(entity);
            }
            for nested in map.values() {
                walk(nested, found);
            }
        }
        Value::Array(items) => {
            for item in items {
                walk(item, found);
            }
        }
        _ => {}
    }
}

fn entity_from_object(map: &serde_json::Map<String, Value>) -> Option<Entity> {
    let id = object_entity_id(map)?;
    let kind = if id.starts_with("usr_") {
        "user"
    } else if id.starts_with("wrld_") {
        "world"
    } else {
        return None;
    };
    let display_name = name_field(map).unwrap_or_default();
    Some(Entity {
        kind: kind.into(),
        id,
        display_name,
    })
}

fn object_entity_id(map: &serde_json::Map<String, Value>) -> Option<String> {
    for (key, value) in map {
        let Some(text) = value.as_str() else {
            continue;
        };
        if !(text.starts_with("usr_") || text.starts_with("wrld_")) {
            continue;
        }
        let lowered = key.to_ascii_lowercase();
        if lowered == "id" || lowered.ends_with("_id") || lowered.ends_with("id") {
            return Some(text.to_string());
        }
    }
    None
}

fn name_field(map: &serde_json::Map<String, Value>) -> Option<String> {
    const NAME_KEYS: [&str; 4] = ["display_name", "displayName", "name", "world_name"];
    for key in NAME_KEYS {
        if let Some(text) = map.get(key).and_then(Value::as_str) {
            if !text.trim().is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}

/// Keep the entities the final answer actually names, capped, with a fallback to
/// the first few candidates when the answer mentions nobody by name.
pub fn surfaced_entities(candidates: Vec<Entity>, answer: &str, cap: usize) -> Vec<Entity> {
    let lowered_answer = answer.to_ascii_lowercase();
    let named: Vec<Entity> = candidates
        .iter()
        .filter(|entity| {
            !entity.display_name.is_empty()
                && lowered_answer.contains(&entity.display_name.to_ascii_lowercase())
        })
        .cloned()
        .collect();
    let mut selected = if named.is_empty() { candidates } else { named };
    selected.truncate(cap);
    selected
}
