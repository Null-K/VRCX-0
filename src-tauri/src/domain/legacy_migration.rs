use std::path::{Path, PathBuf};

use crate::domain::app_paths::AppPaths;
use crate::domain::legacy_vrcx::{LegacyVrcxMigrationStatus, LegacyVrcxSource};
use crate::error::AppError;

pub fn cleanup_legacy_updater_files(app_data: &Path) {
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

pub fn consume_pending_legacy_migration(paths: &AppPaths) -> Result<(), AppError> {
    consume_pending_legacy_migration_with_discovery(
        paths,
        crate::domain::legacy_vrcx::discover_supported_legacy_source,
    )
}

#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn request_legacy_migration(paths: &AppPaths) -> Result<(), AppError> {
    let flag_path = paths.app_data.join("pending_vrcx_migration");
    std::fs::write(&flag_path, b"1")?;
    Ok(())
}

fn consume_pending_legacy_migration_with_discovery<F>(
    paths: &AppPaths,
    discover_legacy_source: F,
) -> Result<(), AppError>
where
    F: FnOnce() -> (Option<LegacyVrcxSource>, LegacyVrcxMigrationStatus),
{
    let migration_flag = paths.app_data.join("pending_vrcx_migration");
    if !migration_flag.exists() {
        return Ok(());
    }

    if paths.db_file.exists() || paths.config_file.exists() {
        tracing::warn!(
            "Legacy VRCX data migration skipped: VRCX-0 database or config already exists"
        );
    } else {
        let (source, status) = discover_legacy_source();
        if let Some(source) = source.as_ref() {
            copy_legacy_vrcx_data(paths, source)?;
            tracing::info!("Legacy VRCX data migration completed");
        } else if let Some(reason) = status.reason {
            tracing::warn!(reason, "Legacy VRCX data migration skipped");
        } else {
            tracing::warn!("Legacy VRCX data migration skipped: no legacy source found");
        }
    }
    let _ = std::fs::remove_file(&migration_flag);
    Ok(())
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

fn sidecar_path(db_path: &Path, suffix: &str) -> PathBuf {
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

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn app_paths(&self) -> AppPaths {
            let app_data = self.path.join("VRCX-0");
            std::fs::create_dir_all(&app_data).unwrap();
            AppPaths::from_app_data(app_data)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn write_file(path: &Path, contents: &[u8]) -> Result<(), AppError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, contents)?;
        Ok(())
    }

    #[test]
    fn copies_legacy_vrcx_data_into_empty_vrcx0_targets() -> Result<(), AppError> {
        let dir = TestDir::new("legacy-copy");
        let paths = dir.app_paths();
        let legacy_dir = dir.path.join("VRCX");
        let legacy_db = legacy_dir.join("VRCX.sqlite3");
        let legacy_config = legacy_dir.join("VRCX.json");

        write_file(&legacy_db, b"legacy-db")?;
        write_file(&sidecar_path(&legacy_db, "shm"), b"legacy-shm")?;
        write_file(&sidecar_path(&legacy_db, "wal"), b"legacy-wal")?;
        write_file(&legacy_config, br#"{"VRCX_CloseToTray":"true"}"#)?;

        let source = LegacyVrcxSource {
            db_path: legacy_db,
            config_path: Some(legacy_config),
            version: 16,
        };

        copy_legacy_vrcx_data(&paths, &source)?;

        assert_eq!(std::fs::read(&paths.db_file)?, b"legacy-db");
        assert_eq!(
            std::fs::read(paths.app_data.join("VRCX-0.sqlite3-shm"))?,
            b"legacy-shm"
        );
        assert_eq!(
            std::fs::read(paths.app_data.join("VRCX-0.sqlite3-wal"))?,
            b"legacy-wal"
        );
        assert_eq!(
            std::fs::read_to_string(&paths.config_file)?,
            r#"{"VRCX_CloseToTray":"true"}"#
        );
        Ok(())
    }

    #[test]
    fn removes_stale_vrcx0_sidecars_when_legacy_sidecars_are_missing() -> Result<(), AppError> {
        let dir = TestDir::new("legacy-sidecars");
        let paths = dir.app_paths();
        let legacy_db = dir.path.join("VRCX").join("VRCX.sqlite3");

        write_file(&legacy_db, b"legacy-db")?;
        write_file(&paths.app_data.join("VRCX-0.sqlite3-shm"), b"stale-shm")?;
        write_file(&paths.app_data.join("VRCX-0.sqlite3-wal"), b"stale-wal")?;

        let source = LegacyVrcxSource {
            db_path: legacy_db,
            config_path: None,
            version: 16,
        };

        copy_legacy_vrcx_data(&paths, &source)?;

        assert_eq!(std::fs::read(&paths.db_file)?, b"legacy-db");
        assert!(!paths.app_data.join("VRCX-0.sqlite3-shm").exists());
        assert!(!paths.app_data.join("VRCX-0.sqlite3-wal").exists());
        Ok(())
    }

    #[test]
    fn skips_pending_legacy_migration_when_target_db_or_config_exists() -> Result<(), AppError> {
        let dir = TestDir::new("legacy-skip");
        let paths = dir.app_paths();
        let migration_flag = paths.app_data.join("pending_vrcx_migration");

        write_file(&paths.db_file, b"existing-db")?;
        write_file(&migration_flag, b"1")?;

        consume_pending_legacy_migration_with_discovery(&paths, || {
            panic!("legacy source discovery should be skipped when VRCX-0 targets exist")
        })?;

        assert_eq!(std::fs::read(&paths.db_file)?, b"existing-db");
        assert!(!migration_flag.exists());
        Ok(())
    }

    #[test]
    fn cleans_legacy_updater_artifacts_from_app_data() -> Result<(), AppError> {
        let dir = TestDir::new("updater-cleanup");

        for name in [
            "update.exe",
            "VRCX-0_Setup.exe",
            "tempDownload",
            "tempDownload-123",
            "tempDownload2",
            "keep.txt",
        ] {
            write_file(&dir.path.join(name), b"artifact")?;
        }

        cleanup_legacy_updater_files(&dir.path);

        for removed in [
            "update.exe",
            "VRCX-0_Setup.exe",
            "tempDownload",
            "tempDownload-123",
        ] {
            assert!(
                !dir.path.join(removed).exists(),
                "{removed} should be removed"
            );
        }
        for kept in ["tempDownload2", "keep.txt"] {
            assert!(dir.path.join(kept).exists(), "{kept} should be kept");
        }
        Ok(())
    }
}
