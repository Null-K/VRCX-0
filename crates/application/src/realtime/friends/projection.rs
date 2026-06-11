use super::*;

pub(super) fn resolve_state_bucket(
    content: &Value,
    patch: &Value,
    previous: Option<&Value>,
    fallback: &str,
) -> String {
    for candidate in [
        content.get("stateBucket"),
        content.get("state"),
        content.get("user").and_then(|user| user.get("stateBucket")),
        content.get("user").and_then(|user| user.get("state")),
        patch.get("stateBucket"),
        patch.get("state"),
        previous.and_then(|previous| previous.get("stateBucket")),
        previous.and_then(|previous| previous.get("state")),
    ] {
        let normalized = candidate
            .and_then(Value::as_str)
            .and_then(normalize_state_bucket);
        if let Some(normalized) = normalized {
            return normalized;
        }
    }
    fallback.to_string()
}

pub(super) fn state_bucket_from_patch(patch: &Value, fallback: &str) -> String {
    patch
        .get("state")
        .and_then(Value::as_str)
        .and_then(normalize_state_bucket)
        .unwrap_or_else(|| fallback.to_string())
}
