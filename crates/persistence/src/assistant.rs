use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::schema::ensure_assistant_tables;
use crate::database::DatabaseService;
use crate::Error;

#[derive(Debug, Clone)]
pub struct PersistedMessage {
    pub id: String,
    pub seq: i64,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct PersistedSession {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub entity_panel_open: bool,
    pub surfaced_entities: String,
    pub messages: Vec<PersistedMessage>,
}

pub fn assistant_sessions_load(db: &DatabaseService) -> Result<Vec<PersistedSession>, Error> {
    ensure_assistant_tables(db)?;
    let mut sessions: Vec<PersistedSession> = db
        .execute(
            "SELECT id, title, created_at, updated_at, entity_panel_open, surfaced_entities FROM assistant_session ORDER BY updated_at DESC",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| PersistedSession {
            id: row_string(&row, 0),
            title: row_string(&row, 1),
            created_at: row_string(&row, 2),
            updated_at: row_string(&row, 3),
            entity_panel_open: row_i64(&row, 4) != 0,
            surfaced_entities: row_string(&row, 5),
            messages: Vec::new(),
        })
        .collect();

    for session in &mut sessions {
        session.messages = db
            .execute(
                "SELECT id, seq, role, content, created_at FROM assistant_message WHERE session_id = @session_id ORDER BY seq ASC",
                &ParamsBuilder::new()
                    .set("session_id", session.id.clone())
                    .build(),
            )?
            .into_iter()
            .map(|row| PersistedMessage {
                id: row_string(&row, 0),
                seq: row_i64(&row, 1),
                role: row_string(&row, 2),
                content: row_string(&row, 3),
                created_at: row_string(&row, 4),
            })
            .collect();
    }
    Ok(sessions)
}

pub fn assistant_session_upsert(
    db: &DatabaseService,
    id: &str,
    title: &str,
    created_at: &str,
    updated_at: &str,
) -> Result<(), Error> {
    ensure_assistant_tables(db)?;
    db.execute_non_query(
        "INSERT INTO assistant_session (id, title, created_at, updated_at) \
         VALUES (@id, @title, @created_at, @updated_at) \
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at",
        &ParamsBuilder::new()
            .set("id", id.to_string())
            .set("title", title.to_string())
            .set("created_at", created_at.to_string())
            .set("updated_at", updated_at.to_string())
            .build(),
    )?;
    Ok(())
}

pub fn assistant_session_set_ui_state(
    db: &DatabaseService,
    id: &str,
    entity_panel_open: bool,
    surfaced_entities: &str,
) -> Result<(), Error> {
    ensure_assistant_tables(db)?;
    db.execute_non_query(
        "UPDATE assistant_session SET entity_panel_open = @open, surfaced_entities = @entities WHERE id = @id",
        &ParamsBuilder::new()
            .set("open", i64::from(entity_panel_open))
            .set("entities", surfaced_entities.to_string())
            .set("id", id.to_string())
            .build(),
    )?;
    Ok(())
}

pub fn assistant_session_delete(db: &DatabaseService, id: &str) -> Result<(), Error> {
    ensure_assistant_tables(db)?;
    let params = ParamsBuilder::new()
        .set("session_id", id.to_string())
        .build();
    db.execute_non_query(
        "DELETE FROM assistant_message WHERE session_id = @session_id",
        &params,
    )?;
    db.execute_non_query(
        "DELETE FROM assistant_session WHERE id = @session_id",
        &params,
    )?;
    Ok(())
}

pub fn assistant_message_insert(
    db: &DatabaseService,
    id: &str,
    session_id: &str,
    seq: i64,
    role: &str,
    content: &str,
    created_at: &str,
) -> Result<(), Error> {
    ensure_assistant_tables(db)?;
    db.execute_non_query(
        "INSERT OR REPLACE INTO assistant_message (id, session_id, seq, role, content, created_at) \
         VALUES (@id, @session_id, @seq, @role, @content, @created_at)",
        &ParamsBuilder::new()
            .set("id", id.to_string())
            .set("session_id", session_id.to_string())
            .set("seq", seq)
            .set("role", role.to_string())
            .set("content", content.to_string())
            .set("created_at", created_at.to_string())
            .build(),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db(name: &str) -> DatabaseService {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        DatabaseService::new(&dir.join("VRCX-0.sqlite3")).unwrap()
    }

    #[test]
    fn round_trips_sessions_and_messages() {
        let db = test_db("assistant-roundtrip");
        assistant_session_upsert(&db, "ses_1", "", "t0", "t0").unwrap();
        assistant_message_insert(&db, "msg_1", "ses_1", 1, "user", "hi", "t1").unwrap();
        assistant_session_upsert(&db, "ses_1", "hi", "t0", "t1").unwrap();
        assistant_message_insert(&db, "msg_2", "ses_1", 2, "assistant", "hello", "t2").unwrap();

        let loaded = assistant_sessions_load(&db).unwrap();
        assert_eq!(loaded.len(), 1);
        let session = &loaded[0];
        assert_eq!(session.title, "hi");
        assert_eq!(session.messages.len(), 2);
        assert_eq!(session.messages[0].seq, 1);
        assert_eq!(session.messages[1].role, "assistant");
    }

    #[test]
    fn delete_removes_session_and_messages() {
        let db = test_db("assistant-delete");
        assistant_session_upsert(&db, "ses_1", "x", "t0", "t0").unwrap();
        assistant_message_insert(&db, "msg_1", "ses_1", 1, "user", "hi", "t1").unwrap();

        assistant_session_delete(&db, "ses_1").unwrap();

        assert!(assistant_sessions_load(&db).unwrap().is_empty());
        let remaining = db
            .execute(
                "SELECT id FROM assistant_message WHERE session_id = @session_id",
                &ParamsBuilder::new().set("session_id", "ses_1").build(),
            )
            .unwrap();
        assert!(remaining.is_empty());
    }
}
