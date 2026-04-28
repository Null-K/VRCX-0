#![allow(non_snake_case)]

use tauri::{AppHandle, State};

use crate::domain::legacy_vrcx::LegacyVrcxMigrationStatus;
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn app__check_legacy_vrcx_available(state: State<'_, AppState>) -> bool {
    state.legacy_vrcx_available
}

#[tauri::command]
pub fn app__get_legacy_vrcx_migration_status(
    state: State<'_, AppState>,
) -> LegacyVrcxMigrationStatus {
    state.legacy_vrcx_migration_status.clone()
}

#[tauri::command]
pub fn app__request_legacy_migration(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let Some(source) = state.legacy_vrcx_source.as_ref() else {
        let reason = state
            .legacy_vrcx_migration_status
            .reason
            .clone()
            .unwrap_or_else(|| "Legacy VRCX migration is unavailable.".to_string());
        return Err(AppError::Custom(reason));
    };
    crate::domain::legacy_vrcx::validate_legacy_source(source).map_err(AppError::Custom)?;

    #[cfg(debug_assertions)]
    {
        tracing::warn!("app__request_legacy_migration: dev mode does not auto-restart or persist migration flag");
        let _ = (app_handle, state);
        Ok(false)
    }

    #[cfg(not(debug_assertions))]
    {
        crate::domain::legacy_migration::request_legacy_migration(&state.paths)?;
        app_handle.request_restart();
        Ok(true)
    }
}
