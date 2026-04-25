use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const VRCHAT_APP_ID: &str = "438100";
const OUTPUT_LOG_PREFIX: &str = "output_log_";
const OUTPUT_LOG_SUFFIX: &str = ".txt";

#[derive(Clone, Debug)]
pub struct LinuxSteamLibraries {
    pub libraries: Vec<PathBuf>,
}

#[derive(Clone, Debug)]
pub struct LinuxVrchatPaths {
    pub proton_prefix: PathBuf,
    pub app_data: PathBuf,
    pub latest_log: Option<PathBuf>,
}

pub fn discover_linux_steam_libraries() -> Result<LinuxSteamLibraries, String> {
    let home = dirs::home_dir().ok_or_else(|| "Linux home directory not found".to_string())?;
    let mut libraries = Vec::new();
    let mut seen = HashSet::new();
    let mut found_libraryfolders = false;

    for steam_root in steam_root_candidates(&home) {
        let libraryfolders = steam_root.join("config").join("libraryfolders.vdf");
        if !libraryfolders.is_file() {
            continue;
        }

        found_libraryfolders = true;
        push_unique_path(&mut libraries, &mut seen, steam_root.clone());
        let discovered = read_steam_libraries_from_vdf(&libraryfolders);
        for library in discovered
            .app_libraries
            .into_iter()
            .chain(discovered.all_libraries)
        {
            push_unique_path(&mut libraries, &mut seen, library);
        }
    }

    if !found_libraryfolders {
        return Err("Steam libraryfolders.vdf not found".into());
    }

    if libraries.is_empty() {
        return Err("Steam library path not found".into());
    }

    Ok(LinuxSteamLibraries { libraries })
}

pub fn discover_linux_vrchat_paths() -> Result<LinuxVrchatPaths, String> {
    let steam_libraries = discover_linux_steam_libraries()?;
    let mut saw_prefix = false;
    let mut newest: Option<(SystemTime, LinuxVrchatPaths)> = None;
    let mut fallback: Option<LinuxVrchatPaths> = None;

    for library in steam_libraries.libraries {
        let prefix = library
            .join("steamapps")
            .join("compatdata")
            .join(VRCHAT_APP_ID)
            .join("pfx");
        if !prefix.is_dir() {
            continue;
        }
        saw_prefix = true;

        let app_data = prefix
            .join("drive_c")
            .join("users")
            .join("steamuser")
            .join("AppData")
            .join("LocalLow")
            .join("VRChat")
            .join("VRChat");

        let Some((modified, latest_log)) = newest_output_log(&app_data) else {
            if fallback.is_none() {
                fallback = Some(LinuxVrchatPaths {
                    proton_prefix: prefix.clone(),
                    app_data: app_data.clone(),
                    latest_log: None,
                });
            }
            continue;
        };

        if newest
            .as_ref()
            .is_none_or(|(newest_modified, _)| modified > *newest_modified)
        {
            newest = Some((
                modified,
                LinuxVrchatPaths {
                    proton_prefix: prefix.clone(),
                    app_data: app_data.clone(),
                    latest_log: Some(latest_log),
                },
            ));
        }
    }

    if let Some((_, paths)) = newest {
        return Ok(paths);
    }

    if let Some(paths) = fallback {
        return Ok(paths);
    }

    if saw_prefix {
        return Err("VRChat output log path not found".into());
    }

    Err("VRChat Proton prefix not found".into())
}

fn steam_root_candidates(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".local").join("share").join("Steam"),
        home.join(".var")
            .join("app")
            .join("com.valvesoftware.Steam")
            .join(".local")
            .join("share")
            .join("Steam"),
        home.join(".steam").join("steam"),
    ]
}

#[derive(Default)]
struct ParsedSteamLibraries {
    app_libraries: Vec<PathBuf>,
    all_libraries: Vec<PathBuf>,
}

fn read_steam_libraries_from_vdf(path: &Path) -> ParsedSteamLibraries {
    let Ok(content) = fs::read_to_string(path) else {
        return ParsedSteamLibraries::default();
    };

    let mut parsed = ParsedSteamLibraries::default();
    let mut current_library: Option<PathBuf> = None;

    for line in content.lines() {
        let tokens = quoted_tokens(line);
        if tokens.len() >= 2 && tokens[0] == "path" {
            let library = PathBuf::from(&tokens[1]);
            parsed.all_libraries.push(library.clone());
            current_library = Some(library);
            continue;
        }

        if tokens.first().is_some_and(|token| token == VRCHAT_APP_ID) {
            if let Some(library) = &current_library {
                parsed.app_libraries.push(library.clone());
            }
        }
    }

    parsed
}

fn quoted_tokens(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    let mut escaped = false;

    for ch in line.chars() {
        if !in_quote {
            if ch == '"' {
                in_quote = true;
                current.clear();
            }
            continue;
        }

        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }

        match ch {
            '\\' => escaped = true,
            '"' => {
                in_quote = false;
                tokens.push(current.clone());
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    tokens
}

fn newest_output_log(log_dir: &Path) -> Option<(SystemTime, PathBuf)> {
    let entries = fs::read_dir(log_dir).ok()?;
    let mut newest: Option<(SystemTime, PathBuf)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if !file_name.starts_with(OUTPUT_LOG_PREFIX) || !file_name.ends_with(OUTPUT_LOG_SUFFIX) {
            continue;
        }

        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        if newest
            .as_ref()
            .is_none_or(|(newest_modified, _)| modified > *newest_modified)
        {
            newest = Some((modified, path));
        }
    }

    newest
}

fn push_unique_path(paths: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, path: PathBuf) {
    if seen.insert(path.clone()) {
        paths.push(path);
    }
}
