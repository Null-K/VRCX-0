#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_harness::{AssistantConfigStatus, Session, SessionSummary};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_send_message(
    state: State<'_, AppState>,
    sessionId: Option<String>,
    text: String,
    locale: Option<String>,
) -> Result<vrcx_0_harness::SendResult, AppError> {
    state
        .assistant()
        .await?
        .send_message(sessionId, text, locale)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_cancel(
    state: State<'_, AppState>,
    sessionId: String,
) -> Result<(), AppError> {
    state.assistant().await?.cancel(&sessionId);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<SessionSummary>, AppError> {
    Ok(state.assistant().await?.list_sessions())
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_get_session(
    state: State<'_, AppState>,
    sessionId: String,
) -> Result<Option<Session>, AppError> {
    Ok(state.assistant().await?.get_session(&sessionId))
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_new_session(state: State<'_, AppState>) -> Result<Session, AppError> {
    Ok(state.assistant().await?.new_session())
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_delete_session(
    state: State<'_, AppState>,
    sessionId: String,
) -> Result<(), AppError> {
    state.assistant().await?.delete_session(&sessionId);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_list_models(
    state: State<'_, AppState>,
    baseUrl: String,
    apiKey: Option<String>,
) -> Result<Vec<String>, AppError> {
    state
        .assistant()
        .await?
        .list_models(baseUrl, apiKey)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_set_panel_open(
    state: State<'_, AppState>,
    sessionId: String,
    open: bool,
) -> Result<(), AppError> {
    state
        .assistant()
        .await?
        .set_entity_panel_open(&sessionId, open);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_config_status(
    state: State<'_, AppState>,
) -> Result<AssistantConfigStatus, AppError> {
    state
        .assistant()
        .await?
        .config_status()
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__assistant_set_config(
    state: State<'_, AppState>,
    baseUrl: String,
    apiKey: Option<String>,
    model: String,
    allowWrites: bool,
) -> Result<AssistantConfigStatus, AppError> {
    state
        .assistant()
        .await?
        .set_config(baseUrl, apiKey, model, allowWrites)
        .map_err(AppError::from)
}
