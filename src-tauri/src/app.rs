use crate::bindings_export;
use crate::bootstrap;
use crate::commands;
#[cfg(target_os = "macos")]
use crate::macos_menu;
use crate::state::AppState;

use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::Emitter;
use tauri::Manager;
use tauri::WindowEvent;
use vrcx_0_application::{BackendRuntimeMode, BackendRuntimePhase};
use vrcx_0_persistence::config::{self as config_store, ConfigWriteEntry};

fn refresh_tray_menu(app: &tauri::AppHandle, state: &AppState) {
    if let Err(error) = bootstrap::refresh_tray_menu(app, state) {
        tracing::warn!(error = %error, "failed to refresh tray background mode item");
    }
}

fn stop_background_mode_and_show_window(app: &tauri::AppHandle, state: &AppState) {
    if let Err(error) = bootstrap::restore_foreground_window_from_background_mode(app, state) {
        tracing::warn!(
            error = %error,
            "failed to show main window after stopping background mode"
        );
    }
}

fn restore_or_ensure_main_window(app: &tauri::AppHandle, failure_message: &'static str) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Err(error) = bootstrap::restore_foreground_window_from_background_mode(app, &state) {
            tracing::warn!(error = %error, "{failure_message}");
        }
    } else if let Err(error) = bootstrap::ensure_main_window(app) {
        tracing::warn!(error = %error, "{failure_message}");
    }
}

fn hide_window_to_tray(window: &tauri::Window) {
    let _ = window.hide();
    let _ = window.set_skip_taskbar(true);
}

fn auto_background_mode_on_tray_enabled(state: &AppState) -> bool {
    state
        .runtime_context
        .config()
        .get_bool("backgroundModeEnabled", false)
        .unwrap_or(false)
}

fn is_background_running(mode: BackendRuntimeMode, phase: BackendRuntimePhase) -> bool {
    mode == BackendRuntimeMode::Background && phase == BackendRuntimePhase::Running
}

fn is_background_mode_hidden(app: &tauri::AppHandle, state: &AppState) -> bool {
    let snapshot = state.snapshot_backend_runtime();
    if !is_background_running(snapshot.mode, snapshot.phase) {
        return false;
    }
    match app.get_webview_window("main") {
        Some(window) => !window.is_visible().unwrap_or(true),
        None => true,
    }
}

fn disable_community_theme_from_tray(app: &tauri::AppHandle, state: &AppState) {
    if let Err(error) = config_store::config_set_values(
        state.db.as_ref(),
        vec![ConfigWriteEntry {
            key: "config:vrcx_communitythemeenabled".into(),
            value: "false".into(),
        }],
    ) {
        tracing::warn!(error = %error, "failed to disable community theme from tray");
    }
    if let Err(error) = app.emit("communityThemeDisableRequested", serde_json::json!({})) {
        tracing::warn!(error = %error, "failed to emit community theme disable request");
    }
    if let Err(error) = bootstrap::refresh_tray_menu(app, state) {
        tracing::warn!(error = %error, "failed to refresh tray menu after disabling community theme");
    }
}

fn start_background_mode_and_hide_window(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        bootstrap::capture_background_resume_route(&app, &state);
        match state
            .start_backend_runtime(BackendRuntimeMode::Background)
            .await
        {
            Ok(snapshot) => {
                let current = state.snapshot_backend_runtime();
                if snapshot.mode == BackendRuntimeMode::Background
                    && is_background_running(current.mode, current.phase)
                {
                    bootstrap::show_background_mode_started_notification(&app, &state);
                    bootstrap::destroy_main_window_for_background_mode(&app);
                }
                refresh_tray_menu(&app, &state);
            }
            Err(error) => {
                bootstrap::show_auth_failure_notification_after_backend_start_error(
                    &app,
                    &state,
                    &error.to_string(),
                );
                tracing::warn!(error = %error, "failed to start background mode from tray");
                refresh_tray_menu(&app, &state);
            }
        }
    });
}

pub fn run() {
    let app_data_dir = match vrcx_0_host::app_paths::resolve_app_data_dir() {
        Ok(resolution) => {
            bootstrap::init_error_logging(Some(resolution.current_dir.clone()));
            resolution
        }
        Err(error) => {
            bootstrap::init_error_logging(None);
            panic!("failed to resolve app data directory: {error}");
        }
    };

    bootstrap::init_tls_crypto_provider();
    bootstrap::apply_linux_webkit_workaround();

    let protocol_paths = std::sync::Arc::new(vrcx_0_host::app_paths::AppPaths::from_app_data(
        app_data_dir.current_dir.clone(),
    ));

    let image_protocol_paths = protocol_paths.clone();
    let thumbnail_protocol_paths = protocol_paths.clone();
    let setup_app_data_dir = app_data_dir.clone();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            restore_or_ensure_main_window(app, "failed to show main window from single instance");
        }))
        .register_asynchronous_uri_scheme_protocol("vrcx-0-img", move |_ctx, request, responder| {
            let paths = image_protocol_paths.clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(bootstrap::screenshot_protocol_response(
                    request,
                    paths.as_ref(),
                ));
            });
        })
        .register_asynchronous_uri_scheme_protocol(
            "vrcx-0-thumb",
            move |_ctx, request, responder| {
                let paths = thumbnail_protocol_paths.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    responder.respond(bootstrap::screenshot_thumbnail_protocol_response(
                        request,
                        paths.as_ref(),
                    ));
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "vrcx-0-bg-img",
            move |ctx, request, responder| {
                let app_handle = ctx.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let response = match app_handle.try_state::<AppState>() {
                        Some(state) => {
                            bootstrap::background_image_protocol_response(request, &state)
                        }
                        None => tauri::http::Response::builder()
                            .status(tauri::http::StatusCode::SERVICE_UNAVAILABLE)
                            .body(Vec::new().into())
                            .unwrap(),
                    };
                    responder.respond(response);
                });
            },
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(bootstrap::updater_public_key())
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        );

    #[cfg(target_os = "windows")]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--autostart"]),
    ));

    #[cfg(target_os = "linux")]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--autostart"]),
    ));

    builder
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let snapshot = state.snapshot_backend_runtime();
                if is_background_running(snapshot.mode, snapshot.phase) {
                    return;
                }

                if state.storage.get("VRCX_CloseToTray").as_deref() == Some("true") {
                    api.prevent_close();
                    hide_window_to_tray(window);
                    if auto_background_mode_on_tray_enabled(&state) {
                        start_background_mode_and_hide_window(window.app_handle().clone());
                    }
                } else {
                    commands::host::window::stop_runtime_services(window.app_handle());
                }
            }
        })
        .on_tray_icon_event(|app, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                restore_or_ensure_main_window(app, "failed to show main window from tray");
            }
            _ => {}
        })
        .setup(move |app| bootstrap::setup_app_with_data_dir(app, setup_app_data_dir.clone()))
        .on_menu_event(|app, event| match event.id().0.as_str() {
            "tray-open" => {
                restore_or_ensure_main_window(app, "failed to open main window from tray menu");
            }
            "tray-toggle-background-mode" | "tray-stop-background-mode" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if is_background_mode_hidden(app, &state) {
                        stop_background_mode_and_show_window(app, &state);
                    } else {
                        start_background_mode_and_hide_window(app.clone());
                    }
                }
            }
            "tray-disable-theme" => {
                if let Some(state) = app.try_state::<AppState>() {
                    disable_community_theme_from_tray(app, &state);
                }
            }
            "tray-exit" => {
                commands::host::window::stop_runtime_services(app);
                app.exit(0);
            }
            id if id.starts_with("mac-menu-") => {
                #[cfg(target_os = "macos")]
                if let Err(error) = macos_menu::emit_menu_action(app, id) {
                    tracing::warn!(error = %error, id, "failed to emit macOS menu action");
                }
            }
            _ => {}
        })
        .invoke_handler(bindings_export::builder().invoke_handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_some() {
                    return;
                }
                let Some(state) = app.try_state::<AppState>() else {
                    return;
                };
                let snapshot = state.snapshot_backend_runtime();
                if is_background_running(snapshot.mode, snapshot.phase) {
                    api.prevent_exit();
                }
            }
        });
}
