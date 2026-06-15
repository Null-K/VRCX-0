#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    use serde_json::json;
    use vrcx_0_core::friends::FriendRecord;
    use vrcx_0_persistence::storage::StorageService;
    use vrcx_0_persistence::DatabaseService;

    use crate::overlay_activity::{
        OverlayActivityCandidate, OverlayActivityFilters, OverlayActivityRuntime,
    };
    use crate::{
        HostSessionRuntime, RuntimeEventBus, RuntimeSnapshot, RuntimeSyncEngine, TaskSupervisor,
        WebClient,
    };

    use super::super::types::{
        ActiveRealtimeContext, RealtimeHostRuntimeMessageSink, RealtimeHostRuntimeState,
    };
    use super::super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-realtime-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn runtime_with_active_session(
        name: &str,
    ) -> Result<(TestDir, Arc<RealtimeHostRuntime>, RealtimeSessionContext)> {
        let dir = TestDir::new(name);
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let storage = StorageService::new(&dir.path.join("storage.json"))?;
        let web = Arc::new(WebClient::new(
            &storage,
            db.as_ref(),
            "wss://pipeline.vrchat.cloud".to_string(),
        )?);
        let session = HostSessionRuntime::new();
        let host_session_generation =
            session.set_realtime_context(crate::session::RealtimeSessionContext::new(
                "usr_self".into(),
                "https://api.vrchat.cloud/api/1".into(),
                "wss://pipeline.vrchat.cloud".into(),
            ));
        let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
            db,
            web,
            event_bus: RuntimeEventBus::new(),
            sync: RuntimeSyncEngine::new(),
            tasks: TaskSupervisor::new(),
            session,
            auth_scope: RuntimeAuthScope::new(),
            game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
            overlay_activity: OverlayActivityRuntime::default(),
        }));
        let active_session = RealtimeSessionContext::new(
            "usr_self".into(),
            "https://api.vrchat.cloud/api/1".into(),
            "wss://pipeline.vrchat.cloud".into(),
        );
        {
            let mut state = runtime.state.lock().unwrap();
            *state = RealtimeHostRuntimeState {
                generation: 7,
                active_context: Some(ActiveRealtimeContext {
                    session: active_session.clone(),
                    generation: 7,
                    client_run_id: 1,
                    session_generation: host_session_generation,
                }),
                ..RealtimeHostRuntimeState::default()
            };
        }
        Ok((dir, runtime, active_session))
    }

    #[test]
    fn sync_friend_snapshot_updates_overlay_friend_scope() -> Result<()> {
        let dir = TestDir::new("overlay-friend-scope");
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let storage = StorageService::new(&dir.path.join("storage.json"))?;
        let web = Arc::new(WebClient::new(
            &storage,
            db.as_ref(),
            "wss://pipeline.vrchat.cloud".to_string(),
        )?);
        let session = HostSessionRuntime::new();
        let host_session_generation =
            session.set_realtime_context(crate::session::RealtimeSessionContext::new(
                "usr_self".into(),
                "https://api.vrchat.cloud/api/1".into(),
                "wss://pipeline.vrchat.cloud".into(),
            ));
        let overlay_activity =
            OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
                "version": 1,
                "wrist": {
                    "types": {
                        "invite": {
                            "scope": "friends",
                            "favoriteGroupKeys": "all"
                        }
                    }
                }
            })));
        let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
            db,
            web,
            event_bus: RuntimeEventBus::new(),
            sync: RuntimeSyncEngine::new(),
            tasks: TaskSupervisor::new(),
            session,
            auth_scope: RuntimeAuthScope::new(),
            game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
            overlay_activity: overlay_activity.clone(),
        }));
        let active_session = RealtimeSessionContext::new(
            "usr_self".into(),
            "https://api.vrchat.cloud/api/1".into(),
            "wss://pipeline.vrchat.cloud".into(),
        );
        {
            let mut state = runtime.state.lock().unwrap();
            *state = RealtimeHostRuntimeState {
                generation: 7,
                active_context: Some(ActiveRealtimeContext {
                    session: active_session.clone(),
                    generation: 7,
                    client_run_id: 1,
                    session_generation: host_session_generation,
                }),
                ..RealtimeHostRuntimeState::default()
            };
        }
        let mut friends_by_id = HashMap::new();
        friends_by_id.insert(
            "usr_new".to_string(),
            FriendRecord {
                id: "usr_new".to_string(),
                display_name: "New Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                ..FriendRecord::default()
            },
        );

        let result = runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            friends_by_id,
        )?;

        assert!(result.accepted);
        assert!(overlay_activity
            .ingest_candidate(invite_candidate("usr_new"))
            .is_some());
        Ok(())
    }

    #[test]
    fn sync_friend_snapshot_emits_projection_for_active_state_changes() -> Result<()> {
        let (_dir, runtime, active_session) = runtime_with_active_session("baseline-projection")?;
        let mut initial_friends = HashMap::new();
        initial_friends.insert(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                location: "wrld_old:123".to_string(),
                ..FriendRecord::default()
            },
        );
        runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            initial_friends,
        )?;
        runtime.deps.event_bus.take_events_for_test();

        let mut refreshed_friends = HashMap::new();
        refreshed_friends.insert(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state: "offline".to_string(),
                state_bucket: "offline".to_string(),
                location: "offline".to_string(),
                ..FriendRecord::default()
            },
        );
        let result = runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            refreshed_friends,
        )?;

        let events = runtime.deps.event_bus.take_events_for_test();
        let projection = events
            .iter()
            .find(|event| event.name == "realtimeFriendProjection")
            .expect("baseline refresh should emit a friend projection");
        assert!(result.accepted);
        assert_eq!(result.baseline_revision, 1);
        assert_eq!(projection.payload["generation"], 7);
        assert_eq!(projection.payload["baselineRevision"], 1);
        assert_eq!(projection.payload["patches"].as_array().unwrap().len(), 1);
        assert_eq!(projection.payload["patches"][0]["userId"], "usr_friend");
        assert_eq!(projection.payload["patches"][0]["stateBucket"], "offline");
        assert_eq!(
            projection.payload["patches"][0]["patch"]["stateBucket"],
            "offline"
        );
        assert_eq!(
            projection.payload["patches"][0]["patch"]["location"],
            "offline"
        );
        Ok(())
    }

    #[test]
    fn sync_friend_snapshot_emits_projection_for_active_removals() -> Result<()> {
        let (_dir, runtime, active_session) = runtime_with_active_session("baseline-removal")?;
        let mut initial_friends = HashMap::new();
        initial_friends.insert(
            "usr_removed".to_string(),
            FriendRecord {
                id: "usr_removed".to_string(),
                display_name: "Removed Friend".to_string(),
                state: "offline".to_string(),
                state_bucket: "offline".to_string(),
                ..FriendRecord::default()
            },
        );
        runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            initial_friends,
        )?;
        runtime.deps.event_bus.take_events_for_test();

        let result = runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            HashMap::new(),
        )?;

        let events = runtime.deps.event_bus.take_events_for_test();
        let projection = events
            .iter()
            .find(|event| event.name == "realtimeFriendProjection")
            .expect("baseline removal should emit a friend projection");
        assert!(result.accepted);
        assert_eq!(result.baseline_revision, 1);
        assert!(projection.payload["patches"].as_array().unwrap().is_empty());
        assert_eq!(
            projection.payload["removals"].as_array().unwrap(),
            &vec![json!("usr_removed")]
        );
        Ok(())
    }

    #[test]
    fn apply_friend_profile_refresh_updates_existing_friend_only() -> Result<()> {
        let (_dir, runtime, active_session) = runtime_with_active_session("profile-refresh")?;
        let mut friends_by_id = HashMap::new();
        friends_by_id.insert(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                location: "wrld_old:123".to_string(),
                ..FriendRecord::default()
            },
        );
        runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(7),
            friends_by_id,
        )?;

        let updated = runtime.apply_friend_profile_refresh(
            active_session.endpoint.clone(),
            "usr_friend".into(),
            json!({
                "id": "usr_friend",
                "displayName": "Fresh Friend",
                "state": "online",
                "location": "wrld_fresh:456"
            }),
        )?;
        let stranger_added = runtime.apply_friend_profile_refresh(
            active_session.endpoint.clone(),
            "usr_stranger".into(),
            json!({
                "id": "usr_stranger",
                "displayName": "Stranger",
                "state": "online"
            }),
        )?;

        let snapshot = runtime.friend_snapshot().unwrap();
        let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
        assert!(updated);
        assert!(!stranger_added);
        assert_eq!(friend.display_name, "Fresh Friend");
        assert_eq!(friend.location, "wrld_fresh:456");
        assert!(!snapshot.friends_by_id.contains_key("usr_stranger"));
        Ok(())
    }

    #[test]
    fn connected_after_reconnect_without_snapshot_resumes_queued_friend_events() -> Result<()> {
        let (_dir, runtime, active_session) = runtime_with_active_session("reconnect-drain")?;
        let active = runtime
            .state
            .lock()
            .unwrap()
            .active_context
            .clone()
            .unwrap();
        let mut friends_by_id = HashMap::new();
        friends_by_id.insert(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                location: "wrld_old:123".to_string(),
                ..FriendRecord::default()
            },
        );
        runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(active.generation),
            friends_by_id,
        )?;
        runtime.deps.event_bus.take_events_for_test();

        let sink = RealtimeHostRuntimeMessageSink {
            runtime: Arc::clone(&runtime),
        };
        sink.handle_realtime_transport_status(
            active.generation,
            active.session_generation,
            &active_session,
            "reconnecting",
        );
        sink.handle_realtime_ws_message(
            active.generation,
            active.session_generation,
            &active_session,
            &RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-location",
                    "content": {
                        "userId": "usr_friend",
                        "location": "wrld_new:456"
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-06-08T10:05:00Z".into(),
            },
        );
        assert!(runtime.state.lock().unwrap().friend_messages_paused);

        sink.handle_realtime_transport_status(
            active.generation,
            active.session_generation,
            &active_session,
            "connected",
        );

        let events = runtime.deps.event_bus.take_events_for_test();
        let projection = events
            .iter()
            .find(|event| event.name == "realtimeFriendProjection")
            .expect("queued friend event should be drained after reconnect");
        assert!(!runtime.state.lock().unwrap().friend_messages_paused);
        assert_eq!(projection.payload["patches"][0]["userId"], "usr_friend");
        assert_eq!(
            projection.payload["patches"][0]["patch"]["location"],
            "wrld_new:456"
        );
        Ok(())
    }

    #[test]
    fn stale_reconnect_baseline_refresh_cannot_replace_active_friend_cache() -> Result<()> {
        let (_dir, runtime, active_session) = runtime_with_active_session("stale-reconnect")?;
        let active = runtime
            .state
            .lock()
            .unwrap()
            .active_context
            .clone()
            .unwrap();
        let mut initial_friends = HashMap::new();
        initial_friends.insert(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                location: "wrld_old:123".to_string(),
                ..FriendRecord::default()
            },
        );
        runtime.sync_friend_snapshot(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            Some(active.generation),
            initial_friends,
        )?;
        {
            let mut state = runtime.state.lock().unwrap();
            state.friend_messages_paused = true;
            state.friend_reconnect_refresh_token = 2;
            state.friend_reconnect_baseline_refresh_in_flight = true;
        }

        let mut stale_refresh_friends = HashMap::new();
        stale_refresh_friends.insert(
            "usr_friend".to_string(),
            FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state: "offline".to_string(),
                state_bucket: "offline".to_string(),
                location: "offline".to_string(),
                ..FriendRecord::default()
            },
        );
        let result = runtime.sync_reconnect_friend_baseline_if_current(
            active.clone(),
            1,
            123,
            stale_refresh_friends,
        )?;

        let snapshot = runtime.friend_snapshot().unwrap();
        let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
        assert!(result.is_none());
        assert_eq!(friend.state_bucket, "online");
        assert!(runtime.state.lock().unwrap().friend_messages_paused);
        Ok(())
    }

    #[test]
    fn sync_friend_snapshot_caches_pre_active_baseline() -> Result<()> {
        let (_dir, runtime, active_session) = runtime_with_active_session("pre-active-baseline")?;
        {
            let mut state = runtime.state.lock().unwrap();
            state.active_context = None;
        }
        let mut friends_by_id = HashMap::new();
        friends_by_id.insert(
            "usr_cached".to_string(),
            FriendRecord {
                id: "usr_cached".to_string(),
                display_name: "Cached Friend".to_string(),
                state: "online".to_string(),
                state_bucket: "online".to_string(),
                ..FriendRecord::default()
            },
        );

        let result = runtime.sync_friend_snapshot_with_started_at(
            active_session.user_id.clone(),
            active_session.endpoint.clone(),
            active_session.websocket.clone(),
            None,
            123,
            friends_by_id,
        )?;

        let state = runtime.state.lock().unwrap();
        let pending = state.pending_friend_baseline.as_ref().unwrap();
        assert!(result.accepted);
        assert_eq!(result.friend_count, 1);
        assert_eq!(pending.session, active_session);
        assert_eq!(pending.baseline_started_ms, 123);
        assert!(pending.friends_by_id.contains_key("usr_cached"));
        Ok(())
    }

    fn invite_candidate(user_id: &str) -> OverlayActivityCandidate {
        OverlayActivityCandidate {
            source_id: format!("invite:{user_id}"),
            activity_type: "invite".to_string(),
            created_at: "2026-06-01T00:00:00.000Z".to_string(),
            actor_user_id: user_id.to_string(),
            actor_display_name: "Friend".to_string(),
            current_instance: false,
            payload: json!({}),
        }
    }
}
