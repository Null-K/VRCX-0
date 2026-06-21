use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::caveats::friend_log_caveats;
use super::helpers::{append_time_window_filter, clamped_optional_limit, table_exists};
use super::types::{FriendLogInput, FriendLogOutput, FriendLogRow};

pub fn get_friend_log(
    db: &DatabaseService,
    input: FriendLogInput,
) -> Result<FriendLogOutput, Error> {
    let user_prefix = normalize_user_table_prefix(&input.owner_user_id)?;
    let table_name = format!("{user_prefix}_friend_log_history");
    if !table_exists(db, &table_name)? {
        return Ok(FriendLogOutput {
            rows: Vec::new(),
            caveats: friend_log_caveats(),
        });
    }

    let target_user_id = input.target_user_id.unwrap_or_default().trim().to_string();
    let types = normalize_friend_log_types(input.types)?;
    let limit = clamped_optional_limit(input.limit, 100, 500);
    let mut sql = format!(
        "SELECT created_at, type, user_id, display_name, previous_display_name,
            trust_level, previous_trust_level, friend_number
         FROM {table_name}
         WHERE 1 = 1"
    );
    let mut params = ParamsBuilder::new().set("limit", limit);

    if !target_user_id.is_empty() {
        sql.push_str(" AND user_id = @target_user_id");
        params = params.set("target_user_id", target_user_id);
    }
    if !types.is_empty() {
        let mut placeholders = Vec::with_capacity(types.len());
        for (index, kind) in types.into_iter().enumerate() {
            let key = format!("type_{index}");
            placeholders.push(format!("@{key}"));
            params = params.set(&key, kind);
        }
        sql.push_str(&format!(" AND type IN ({})", placeholders.join(", ")));
    }
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");
    sql.push_str(" ORDER BY created_at DESC, id DESC LIMIT @limit");

    let rows = db
        .execute(&sql, &params.build())?
        .into_iter()
        .map(|row| FriendLogRow {
            created_at: row_string(&row, 0),
            kind: row_string(&row, 1),
            user_id: row_string(&row, 2),
            display_name: row_string(&row, 3),
            previous_display_name: row_string(&row, 4),
            trust_level: row_string(&row, 5),
            previous_trust_level: row_string(&row, 6),
            friend_number: row_i64(&row, 7),
        })
        .filter(|row| !row.user_id.trim().is_empty())
        .collect();

    Ok(FriendLogOutput {
        rows,
        caveats: friend_log_caveats(),
    })
}

pub fn get_friend_log_first_created_at(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    kind: &str,
) -> Result<Option<String>, Error> {
    let target_user_id = target_user_id.trim();
    if target_user_id.is_empty() {
        return Ok(None);
    }
    let kind = kind.trim();
    if !is_friend_log_type(kind) {
        return Err(Error::InvalidData(format!(
            "unsupported friend log type: {kind}"
        )));
    }

    let user_prefix = normalize_user_table_prefix(owner_user_id)?;
    let table_name = format!("{user_prefix}_friend_log_history");
    if !table_exists(db, &table_name)? {
        return Ok(None);
    }

    Ok(db
        .execute(
            &format!(
                "SELECT created_at
                 FROM {table_name}
                 WHERE user_id = @target_user_id AND type = @kind
                 ORDER BY created_at ASC, id ASC
                 LIMIT 1"
            ),
            &ParamsBuilder::new()
                .set("target_user_id", target_user_id)
                .set("kind", kind)
                .build(),
        )?
        .first()
        .map(|row| row_string(row, 0))
        .filter(|value| !value.trim().is_empty()))
}

fn normalize_friend_log_types(types: Vec<String>) -> Result<Vec<String>, Error> {
    let mut normalized = Vec::new();
    let mut invalid = Vec::new();
    for value in types {
        let value = value.trim().to_string();
        if value.is_empty() {
            continue;
        }
        if is_friend_log_type(&value) {
            normalized.push(value);
        } else {
            invalid.push(value);
        }
    }
    if invalid.is_empty() {
        Ok(normalized)
    } else {
        Err(Error::InvalidData(format!(
            "unsupported friend log type(s): {}",
            invalid.join(", ")
        )))
    }
}

fn is_friend_log_type(value: &str) -> bool {
    matches!(
        value,
        "Friend"
            | "Unfriend"
            | "FriendRequest"
            | "CancelFriendRequest"
            | "DisplayName"
            | "TrustLevel"
    )
}
