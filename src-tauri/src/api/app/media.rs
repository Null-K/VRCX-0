#![allow(non_snake_case)]

use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use fast_rsync::{Signature, SignatureOptions};
use tauri::{AppHandle, State};

use crate::domain::{image_processing, ugc_image_files};
use crate::error::AppError;
use crate::state::AppState;

const MAX_IMAGE_SAVE_BYTES: usize = 100 * 1024 * 1024;

#[tauri::command]
pub async fn app__save_image_file(
    app_handle: AppHandle,
    default_name: String,
    base64_data: String,
) -> Result<String, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let file_name = ugc_image_files::normalize_image_save_file_name(&default_name)?;
    let bytes = B64
        .decode(base64_data.trim())
        .map_err(|e| AppError::Custom(format!("image base64 decode: {e}")))?;

    if bytes.is_empty() {
        return Err(AppError::Custom("image data is empty".into()));
    }

    if bytes.len() > MAX_IMAGE_SAVE_BYTES {
        return Err(AppError::Custom("image data is too large".into()));
    }

    let result = app_handle
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("Image Files", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .blocking_save_file();

    match result {
        Some(file_path) => {
            let mut path = match file_path {
                tauri_plugin_dialog::FilePath::Path(p) => p,
                other => PathBuf::from(other.to_string()),
            };

            if path.extension().is_none() {
                path.set_extension(ugc_image_files::default_image_extension(&file_name));
            }

            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }

            std::fs::write(&path, bytes)?;
            Ok(path.to_string_lossy().to_string())
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
pub async fn app__get_image(
    state: State<'_, AppState>,
    url: String,
    file_id: String,
    version: String,
) -> Result<String, AppError> {
    state.image_cache.get_image(&url, &file_id, &version).await
}

#[tauri::command]
pub fn app__resize_image_to_fit_limits(base64data: String) -> Result<String, AppError> {
    image_processing::resize_image_to_fit_limits_base64(&base64data)
}

#[tauri::command]
pub fn app__sign_file(blob: String) -> Result<String, AppError> {
    let data = B64
        .decode(&blob)
        .map_err(|e| AppError::Custom(format!("base64 decode: {e}")))?;
    let sig = Signature::calculate(
        &data,
        SignatureOptions {
            block_size: 2048,
            crypto_hash_size: 8,
        },
    );
    Ok(B64.encode(sig.serialized()))
}

#[tauri::command]
pub fn app__crop_all_prints(ugc_folder_path: String) -> Result<(), AppError> {
    image_processing::crop_all_prints(&ugc_folder_path)
}

#[tauri::command]
pub fn app__crop_print_image(path: String) -> Result<bool, AppError> {
    image_processing::crop_print_file(std::path::Path::new(&path))
        .map_err(|e| AppError::Custom(format!("{path}: {e}")))
}

async fn save_ugc_image_to_file(
    state: &AppState,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    let out = ugc_image_files::build_ugc_image_path(&ugc_folder_path, &month_folder, &file_name)?;
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let out_str = out.to_string_lossy().into_owned();
    state.image_cache.save_image_to_file(&url, &out_str).await?;
    Ok(out_str)
}

#[tauri::command]
pub async fn app__save_print_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    save_ugc_image_to_file(state.inner(), url, ugc_folder_path, month_folder, file_name).await
}

#[tauri::command]
pub async fn app__save_sticker_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    save_ugc_image_to_file(state.inner(), url, ugc_folder_path, month_folder, file_name).await
}

#[tauri::command]
pub async fn app__save_emoji_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    save_ugc_image_to_file(state.inner(), url, ugc_folder_path, month_folder, file_name).await
}
