#![allow(non_snake_case)]

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application::RuntimeBackgroundJobSnapshot;
use vrcx_0_application::RuntimeDiagnosticsSnapshot;
use vrcx_0_application::RuntimeLifecycleSnapshot;
use vrcx_0_application::RuntimeSyncSnapshot;
use vrcx_0_application::{PlayerState, RuntimeSnapshot as GameLogRuntimeSnapshot};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAppSnapshot {
    pub runtime: RuntimeLifecycleSnapshot,
    pub background_jobs: Vec<RuntimeBackgroundJobSnapshot>,
    pub sync: RuntimeSyncSnapshot,
    pub diagnostics: RuntimeDiagnosticsSnapshot,
    pub game_log: GameLogRuntimeSnapshotDto,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeJobRecordInput {
    pub name: String,
    #[serde(default = "default_frontend_owner")]
    pub owner: String,
    #[serde(default)]
    pub cadence_seconds: Option<u64>,
    pub status: String,
    #[serde(default)]
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFrontendScheduleJobDeferInput {
    pub name: String,
    pub delay_seconds: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFrontendScheduleJobDueClaimInput {
    pub name: String,
    pub cadence_seconds: u64,
    #[serde(default)]
    pub initial_delay_seconds: u64,
}

fn default_frontend_owner() -> String {
    "frontend".into()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLogRuntimeSnapshotDto {
    pub location: String,
    pub world_name: String,
    pub destination: String,
    pub players: Vec<PlayerState>,
}

impl From<GameLogRuntimeSnapshot> for GameLogRuntimeSnapshotDto {
    fn from(snapshot: GameLogRuntimeSnapshot) -> Self {
        Self {
            location: snapshot.location,
            world_name: snapshot.world_name,
            destination: snapshot.destination,
            players: snapshot.players,
        }
    }
}

#[tauri::command]
pub fn app__runtime_lifecycle_snapshot_get(state: State<'_, AppState>) -> RuntimeLifecycleSnapshot {
    state.runtime_context.runtime.snapshot()
}

#[tauri::command]
pub fn app__runtime_background_jobs_snapshot_get(
    state: State<'_, AppState>,
) -> Vec<RuntimeBackgroundJobSnapshot> {
    state.runtime_context.background_jobs.snapshot()
}

#[tauri::command]
pub fn app__runtime_frontend_schedule_due_jobs_get(state: State<'_, AppState>) -> Vec<String> {
    state.runtime_context.background_jobs.due_frontend_jobs()
}

#[tauri::command]
pub fn app__runtime_frontend_schedule_job_defer(
    state: State<'_, AppState>,
    input: RuntimeFrontendScheduleJobDeferInput,
) -> bool {
    state
        .runtime_context
        .background_jobs
        .defer_frontend_job(&input.name, input.delay_seconds)
}

#[tauri::command]
pub fn app__runtime_frontend_schedule_job_due_claim(
    state: State<'_, AppState>,
    input: RuntimeFrontendScheduleJobDueClaimInput,
) -> bool {
    state
        .runtime_context
        .background_jobs
        .claim_frontend_job_due(
            &input.name,
            input.cadence_seconds,
            input.initial_delay_seconds,
        )
}

#[tauri::command]
pub fn app__runtime_frontend_schedule_schedules_reset(state: State<'_, AppState>) {
    state
        .runtime_context
        .background_jobs
        .reset_frontend_schedules();
}

#[tauri::command]
pub async fn app__runtime_group_instances_refresh(
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.refresh_runtime_group_instances().await;
    Ok(())
}

#[tauri::command]
pub fn app__runtime_sync_snapshot_get(state: State<'_, AppState>) -> RuntimeSyncSnapshot {
    state.runtime_context.sync.snapshot()
}

#[tauri::command]
pub fn app__runtime_diagnostics_get(state: State<'_, AppState>) -> RuntimeDiagnosticsSnapshot {
    state.runtime_context.diagnostics.snapshot()
}

#[tauri::command]
pub fn app__runtime_app_snapshot_get(state: State<'_, AppState>) -> RuntimeAppSnapshot {
    RuntimeAppSnapshot {
        runtime: state.runtime_context.runtime.snapshot(),
        background_jobs: state.runtime_context.background_jobs.snapshot(),
        sync: state.runtime_context.sync.snapshot(),
        diagnostics: state.runtime_context.diagnostics.snapshot(),
        game_log: state.runtime_context.game_log_snapshot().into(),
    }
}

#[tauri::command]
pub fn app__runtime_background_job_record(
    state: State<'_, AppState>,
    input: RuntimeJobRecordInput,
) {
    let name = input.name.trim();
    if name.is_empty() {
        return;
    }

    let detail = input.detail.trim();
    state.runtime_context.background_jobs.register_job(
        name,
        input.owner.trim(),
        input.cadence_seconds,
        input.status.trim(),
        detail,
    );
    match input.status.trim() {
        "running" => state
            .runtime_context
            .background_jobs
            .mark_running(name, detail),
        "completed" | "idle" => state
            .runtime_context
            .background_jobs
            .mark_completed(name, detail),
        "error" => state
            .runtime_context
            .background_jobs
            .mark_failed(name, detail),
        status => state.runtime_context.background_jobs.register_job(
            name,
            input.owner.trim(),
            input.cadence_seconds,
            status,
            detail,
        ),
    }
}
