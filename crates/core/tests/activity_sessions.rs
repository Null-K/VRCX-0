use vrcx_0_core::activity_sessions::{
    merge_sessions, sessions_from_presence, ActivitySession, PresenceKind,
    ONLINE_SESSION_MERGE_GAP_MS,
};

const BASE: i64 = 1_700_000_000_000;
const MINUTE: i64 = 60_000;
const HOUR: i64 = 60 * MINUTE;

fn session(start: i64, end: i64) -> ActivitySession {
    ActivitySession {
        start,
        end,
        is_open_tail: false,
        source_revision: String::new(),
    }
}

#[test]
fn activity_sessions_presence_empty_has_no_pending_session() {
    let (pending, sessions) = sessions_from_presence(&[], None);

    assert_eq!(pending, None);
    assert!(sessions.is_empty());
}

#[test]
fn activity_sessions_presence_builds_online_offline_pair() {
    let events = [
        (BASE, PresenceKind::Online),
        (BASE + HOUR, PresenceKind::Offline),
    ];

    let (pending, sessions) = sessions_from_presence(&events, None);

    assert_eq!(pending, None);
    assert_eq!(sessions, vec![session(BASE, BASE + HOUR)]);
}

#[test]
fn activity_sessions_presence_closes_previous_online_on_second_online() {
    let events = [
        (BASE, PresenceKind::Online),
        (BASE + HOUR, PresenceKind::Online),
    ];

    let (pending, sessions) = sessions_from_presence(&events, None);

    assert_eq!(pending, Some(BASE + HOUR));
    assert_eq!(sessions, vec![session(BASE, BASE + HOUR)]);
}

#[test]
fn activity_sessions_presence_respects_initial_pending_session() {
    let events = [(BASE + HOUR, PresenceKind::Offline)];

    let (pending, sessions) = sessions_from_presence(&events, Some(BASE));

    assert_eq!(pending, None);
    assert_eq!(sessions, vec![session(BASE, BASE + HOUR)]);
}

#[test]
fn activity_sessions_merge_joins_gap_and_preserves_metadata() {
    let mut newer = session(
        BASE + HOUR + ONLINE_SESSION_MERGE_GAP_MS - MINUTE,
        BASE + 2 * HOUR,
    );
    newer.is_open_tail = true;
    newer.source_revision = "cursor-2".to_string();

    let merged = merge_sessions(&[session(BASE, BASE + HOUR)], &[newer]);

    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].start, BASE);
    assert_eq!(merged[0].end, BASE + 2 * HOUR);
    assert!(merged[0].is_open_tail);
    assert_eq!(merged[0].source_revision, "cursor-2");
}

#[test]
fn activity_sessions_merge_keeps_gap_larger_than_threshold() {
    let merged = merge_sessions(
        &[session(BASE, BASE + HOUR)],
        &[session(
            BASE + HOUR + ONLINE_SESSION_MERGE_GAP_MS + MINUTE,
            BASE + 2 * HOUR,
        )],
    );

    assert_eq!(merged.len(), 2);
}
