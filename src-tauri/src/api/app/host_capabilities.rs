#![allow(non_snake_case)]

use serde::Serialize;

use crate::error::AppError;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityStatus {
    pub supported: bool,
    pub enabled: bool,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCapabilities {
    pub platform: String,
    pub local_database: CapabilityStatus,
    pub websocket_runtime: CapabilityStatus,
    pub game_log_watcher: CapabilityStatus,
    pub game_process_monitor: CapabilityStatus,
    pub vrchat_path_discovery: CapabilityStatus,
    pub steam_library_discovery: CapabilityStatus,
    pub steam_runtime_integration: CapabilityStatus,
    pub registry_prefs: CapabilityStatus,
    pub game_launch: CapabilityStatus,
    pub ipc: CapabilityStatus,
    pub screenshot_cache: CapabilityStatus,
}

#[derive(Clone, Copy, Debug)]
pub enum HostCapability {
    GameLogWatcher,
    GameProcessMonitor,
    VrchatPathDiscovery,
    SteamLibraryDiscovery,
    SteamRuntimeIntegration,
    RegistryPrefs,
    GameLaunch,
    Ipc,
    ScreenshotCache,
}

impl CapabilityStatus {
    fn available() -> Self {
        Self {
            supported: true,
            enabled: true,
            available: true,
            reason: None,
        }
    }

    fn pending(reason: &str) -> Self {
        Self {
            supported: true,
            enabled: false,
            available: false,
            reason: Some(reason.to_string()),
        }
    }

    #[cfg(target_os = "linux")]
    fn unavailable(reason: &str) -> Self {
        Self {
            supported: true,
            enabled: true,
            available: false,
            reason: Some(reason.to_string()),
        }
    }

    fn unsupported(label: &str, platform: &str) -> Self {
        Self {
            supported: false,
            enabled: false,
            available: false,
            reason: Some(format!("{label} is not supported on {platform}")),
        }
    }
}

impl HostCapabilities {
    fn status(&self, capability: HostCapability) -> &CapabilityStatus {
        match capability {
            HostCapability::GameLogWatcher => &self.game_log_watcher,
            HostCapability::GameProcessMonitor => &self.game_process_monitor,
            HostCapability::VrchatPathDiscovery => &self.vrchat_path_discovery,
            HostCapability::SteamLibraryDiscovery => &self.steam_library_discovery,
            HostCapability::SteamRuntimeIntegration => &self.steam_runtime_integration,
            HostCapability::RegistryPrefs => &self.registry_prefs,
            HostCapability::GameLaunch => &self.game_launch,
            HostCapability::Ipc => &self.ipc,
            HostCapability::ScreenshotCache => &self.screenshot_cache,
        }
    }
}

impl HostCapability {
    fn label(self) -> &'static str {
        match self {
            HostCapability::GameLogWatcher => "GameLog watcher",
            HostCapability::GameProcessMonitor => "Game process monitor",
            HostCapability::VrchatPathDiscovery => "VRChat path discovery",
            HostCapability::SteamLibraryDiscovery => "Steam library discovery",
            HostCapability::SteamRuntimeIntegration => "Steam runtime integration",
            HostCapability::RegistryPrefs => "VRChat registry preferences",
            HostCapability::GameLaunch => "Game launch",
            HostCapability::Ipc => "IPC",
            HostCapability::ScreenshotCache => "Screenshot cache",
        }
    }
}

pub fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "unknown"
    }
}

pub fn current_host_capabilities() -> HostCapabilities {
    let platform = current_platform();
    let available = CapabilityStatus::available();

    match platform {
        "windows" => HostCapabilities {
            platform: platform.to_string(),
            local_database: available.clone(),
            websocket_runtime: available.clone(),
            game_log_watcher: available.clone(),
            game_process_monitor: available.clone(),
            vrchat_path_discovery: available.clone(),
            steam_library_discovery: available.clone(),
            steam_runtime_integration: available.clone(),
            registry_prefs: available.clone(),
            game_launch: available.clone(),
            ipc: available.clone(),
            screenshot_cache: available,
        },
        "linux" => linux_host_capabilities(platform, &available),
        "macos" => HostCapabilities {
            platform: platform.to_string(),
            local_database: available.clone(),
            websocket_runtime: available,
            game_log_watcher: CapabilityStatus::unsupported("GameLog watcher", "macOS"),
            game_process_monitor: CapabilityStatus::unsupported("Game process monitor", "macOS"),
            vrchat_path_discovery: CapabilityStatus::unsupported("VRChat path discovery", "macOS"),
            steam_library_discovery: CapabilityStatus::unsupported(
                "Steam library discovery",
                "macOS",
            ),
            steam_runtime_integration: CapabilityStatus::unsupported(
                "Steam runtime integration",
                "macOS",
            ),
            registry_prefs: CapabilityStatus::unsupported("VRChat registry preferences", "macOS"),
            game_launch: CapabilityStatus::unsupported("Game launch", "macOS"),
            ipc: CapabilityStatus::unsupported("IPC", "macOS"),
            screenshot_cache: CapabilityStatus::unsupported("Screenshot cache", "macOS"),
        },
        _ => HostCapabilities {
            platform: platform.to_string(),
            local_database: available.clone(),
            websocket_runtime: available,
            game_log_watcher: CapabilityStatus::unsupported("GameLog watcher", platform),
            game_process_monitor: CapabilityStatus::unsupported("Game process monitor", platform),
            vrchat_path_discovery: CapabilityStatus::unsupported("VRChat path discovery", platform),
            steam_library_discovery: CapabilityStatus::unsupported(
                "Steam library discovery",
                platform,
            ),
            steam_runtime_integration: CapabilityStatus::unsupported(
                "Steam runtime integration",
                platform,
            ),
            registry_prefs: CapabilityStatus::unsupported("VRChat registry preferences", platform),
            game_launch: CapabilityStatus::unsupported("Game launch", platform),
            ipc: CapabilityStatus::unsupported("IPC", platform),
            screenshot_cache: CapabilityStatus::unsupported("Screenshot cache", platform),
        },
    }
}

#[cfg(target_os = "linux")]
fn linux_host_capabilities(platform: &str, available: &CapabilityStatus) -> HostCapabilities {
    let steam_library_discovery =
        match crate::domain::vrchat_paths::discover_linux_steam_libraries() {
            Ok(_) => available.clone(),
            Err(reason) => CapabilityStatus::unavailable(&reason),
        };

    let vrchat_path_discovery = match crate::domain::vrchat_paths::discover_linux_vrchat_paths() {
        Ok(_) => available.clone(),
        Err(reason) => CapabilityStatus::unavailable(&reason),
    };

    HostCapabilities {
        platform: platform.to_string(),
        local_database: available.clone(),
        websocket_runtime: available.clone(),
        game_log_watcher: vrchat_path_discovery.clone(),
        game_process_monitor: CapabilityStatus::pending(
            "Linux process monitor implementation pending",
        ),
        vrchat_path_discovery,
        steam_library_discovery,
        steam_runtime_integration: CapabilityStatus::unsupported(
            "Steam runtime integration",
            "Linux",
        ),
        registry_prefs: CapabilityStatus::unsupported("VRChat registry preferences", "Linux"),
        game_launch: CapabilityStatus::unsupported("Game launch", "Linux"),
        ipc: CapabilityStatus::unsupported("IPC", "Linux"),
        screenshot_cache: CapabilityStatus::unsupported("Screenshot cache", "Linux"),
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn linux_host_capabilities(platform: &str, available: &CapabilityStatus) -> HostCapabilities {
    pending_linux_host_capabilities(platform, available)
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn linux_host_capabilities(platform: &str, available: &CapabilityStatus) -> HostCapabilities {
    pending_linux_host_capabilities(platform, available)
}

#[cfg(any(
    target_os = "windows",
    target_os = "macos",
    not(any(target_os = "windows", target_os = "linux", target_os = "macos"))
))]
fn pending_linux_host_capabilities(
    platform: &str,
    available: &CapabilityStatus,
) -> HostCapabilities {
    let pending = CapabilityStatus::pending("Linux implementation pending");
    HostCapabilities {
        platform: platform.to_string(),
        local_database: available.clone(),
        websocket_runtime: available.clone(),
        game_log_watcher: pending.clone(),
        game_process_monitor: pending.clone(),
        vrchat_path_discovery: pending.clone(),
        steam_library_discovery: pending,
        steam_runtime_integration: CapabilityStatus::unsupported(
            "Steam runtime integration",
            "Linux",
        ),
        registry_prefs: CapabilityStatus::unsupported("VRChat registry preferences", "Linux"),
        game_launch: CapabilityStatus::unsupported("Game launch", "Linux"),
        ipc: CapabilityStatus::unsupported("IPC", "Linux"),
        screenshot_cache: CapabilityStatus::unsupported("Screenshot cache", "Linux"),
    }
}

pub fn require_host_capability(capability: HostCapability) -> Result<(), AppError> {
    let capabilities = current_host_capabilities();
    let status = capabilities.status(capability);
    if status.available {
        return Ok(());
    }

    Err(AppError::Custom(status.reason.clone().unwrap_or_else(
        || {
            format!(
                "{} is unavailable on {}",
                capability.label(),
                capabilities.platform
            )
        },
    )))
}

pub fn is_host_capability_available(capability: HostCapability) -> bool {
    current_host_capabilities().status(capability).available
}

#[tauri::command]
pub fn app__get_host_capabilities() -> HostCapabilities {
    current_host_capabilities()
}
