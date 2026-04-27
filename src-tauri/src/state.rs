use std::path::PathBuf;

use crate::domain::auto_launch::AutoAppLaunchManager;
use crate::domain::database::DatabaseService;
use crate::domain::discord_rpc::DiscordRpc;
use crate::domain::image_cache::ImageCache;
use crate::domain::ipc::IpcServer;
use crate::domain::legacy_vrcx::{LegacyVrcxMigrationStatus, LegacyVrcxSource};
use crate::domain::log_watcher::LogWatcher;
use crate::domain::process_monitor::ProcessMonitor;
use crate::domain::screenshot::MetadataCacheDb;
use crate::domain::storage::StorageService;
use crate::domain::web_client::WebClient;
use crate::error::AppError;

pub struct AppPaths {
    pub app_data: PathBuf,
    pub db_file: PathBuf,
    pub config_file: PathBuf,
    pub image_cache: PathBuf,
}

pub struct AppState {
    pub paths: AppPaths,
    pub storage: StorageService,
    pub db: DatabaseService,
    pub discord_rpc: DiscordRpc,
    pub process_monitor: ProcessMonitor,
    pub log_watcher: LogWatcher,
    pub web: WebClient,
    pub image_cache: ImageCache,
    pub ipc: IpcServer,
    pub screenshot_cache: MetadataCacheDb,

    pub auto_launch: AutoAppLaunchManager,
    pub legacy_vrcx_available: bool,
    pub legacy_vrcx_source: Option<LegacyVrcxSource>,
    pub legacy_vrcx_migration_status: LegacyVrcxMigrationStatus,
    pub launched_from_autostart: bool,
}

impl AppState {
    pub fn new() -> Result<Self, AppError> {
        let app_data = dirs::config_dir()
            .ok_or_else(|| AppError::Custom("cannot resolve AppData".into()))?
            .join("VRCX-0");

        std::fs::create_dir_all(&app_data)?;

        let paths = AppPaths {
            db_file: app_data.join("VRCX-0.sqlite3"),
            config_file: app_data.join("VRCX-0.json"),
            image_cache: app_data.join("ImageCache"),
            app_data,
        };
        cleanup_legacy_updater_files(&paths.app_data);
        let launched_from_autostart = std::env::args().any(|arg| arg == "--autostart");

        let migration_flag = paths.app_data.join("pending_vrcx_migration");
        if migration_flag.exists() {
            if paths.db_file.exists() || paths.config_file.exists() {
                tracing::warn!(
                    "Legacy VRCX data migration skipped: VRCX-0 database or config already exists"
                );
            } else {
                let (source, status) =
                    crate::domain::legacy_vrcx::discover_supported_legacy_source();
                if let Some(source) = source.as_ref() {
                    copy_legacy_vrcx_data(&paths, source)?;
                    tracing::info!("Legacy VRCX data migration completed");
                } else if let Some(reason) = status.reason {
                    tracing::warn!(reason, "Legacy VRCX data migration skipped");
                } else {
                    tracing::warn!("Legacy VRCX data migration skipped: no legacy source found");
                }
            }
            let _ = std::fs::remove_file(&migration_flag);
        }

        let (legacy_vrcx_source, legacy_vrcx_migration_status) =
            crate::domain::legacy_vrcx::discover_legacy_vrcx_migration(
                &paths.db_file,
                &paths.config_file,
            );
        let legacy_vrcx_available = legacy_vrcx_migration_status.available;

        let storage = StorageService::new(&paths.config_file)?;

        let db = DatabaseService::new(&paths.db_file)?;
        let discord_rpc = DiscordRpc::new();
        let process_monitor = ProcessMonitor::new();
        let log_watcher = LogWatcher::new();
        let web = WebClient::new(&storage, &db)?;
        let image_cache =
            ImageCache::new(paths.image_cache.clone(), web.cookie_jar(), web.proxy_url())?;
        let ipc = IpcServer::new();
        let screenshot_cache = MetadataCacheDb::new(&paths.app_data.join("metadataCache.db"))
            .map_err(|e| AppError::Custom(format!("screenshot cache: {e}")))?;

        let auto_launch = AutoAppLaunchManager::new(&paths.app_data);

        Ok(Self {
            paths,
            storage,
            db,
            discord_rpc,
            process_monitor,
            log_watcher,
            web,
            image_cache,
            ipc,
            screenshot_cache,
            auto_launch,
            legacy_vrcx_available,
            legacy_vrcx_source,
            legacy_vrcx_migration_status,
            launched_from_autostart,
        })
    }
}

fn cleanup_legacy_updater_files(app_data: &std::path::Path) {
    for file_name in ["update.exe", "VRCX-0_Setup.exe", "tempDownload"] {
        let _ = std::fs::remove_file(app_data.join(file_name));
    }

    if let Ok(entries) = std::fs::read_dir(app_data) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().and_then(|name| name.to_str());
            if file_name.is_some_and(|name| name.starts_with("tempDownload-")) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

fn copy_legacy_vrcx_data(paths: &AppPaths, source: &LegacyVrcxSource) -> Result<(), AppError> {
    copy_replace(source.db_path.clone(), paths.db_file.clone())?;
    sync_sidecar(
        sidecar_path(&source.db_path, "shm"),
        paths.app_data.join("VRCX-0.sqlite3-shm"),
    )?;
    sync_sidecar(
        sidecar_path(&source.db_path, "wal"),
        paths.app_data.join("VRCX-0.sqlite3-wal"),
    )?;

    if let Some(config_path) = source.config_path.as_ref() {
        copy_replace(config_path.clone(), paths.config_file.clone())?;
    }

    Ok(())
}

fn copy_replace(from: PathBuf, to: PathBuf) -> Result<(), AppError> {
    if !from.exists() {
        return Ok(());
    }

    if to.exists() {
        std::fs::remove_file(&to)?;
    }
    std::fs::copy(&from, &to)?;
    Ok(())
}

fn sidecar_path(db_path: &std::path::Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}-{suffix}", db_path.to_string_lossy()))
}

fn sync_sidecar(from: PathBuf, to: PathBuf) -> Result<(), AppError> {
    if from.exists() {
        copy_replace(from, to)?;
    } else if to.exists() {
        std::fs::remove_file(to)?;
    }
    Ok(())
}
