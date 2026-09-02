use std::{path::PathBuf, time::UNIX_EPOCH};

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[cfg(windows)]
use crate::contracts::PrinterPropertiesStatus;
use crate::contracts::{
    ExportPrinterProfilesBundlePayload, FileMetadata, ImportProfileFileContent,
    LoadedPrinterProfileResult, PaperSourceCapability, PrintBatchRequest, PrintBatchResult,
    PrinterPropertiesResult, SavePrinterProfileRequest, SavedPrinterProfileSummary, SystemPrinter,
};
use crate::ingress::{collect_path_argument, is_supported_file};
use crate::printers::{
    self, evaluate_profile_compatibility, query_printer_fingerprint, PersistentPrinterProfileStore,
    PrinterProfileStore,
};
use crate::printing::run_print_batch_sync;

#[tauri::command]
pub async fn list_system_printers() -> Result<Vec<SystemPrinter>, String> {
    tauri::async_runtime::spawn_blocking(printers::list_system_printers_sync)
        .await
        .map_err(|error| format!("printer discovery task failed: {error}"))?
}

#[tauri::command]
pub async fn list_printer_paper_sources(
    printer_name: String,
) -> Result<PaperSourceCapability, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(printers::query_paper_source_capability(&printer_name, None))
    })
    .await
    .map_err(|error| format!("failed to list paper sources: {error}"))?
}

#[tauri::command]
pub async fn open_printer_properties(
    window: tauri::Window,
    printer_name: String,
    profile_id: Option<String>,
    profile_store: tauri::State<'_, PrinterProfileStore>,
) -> Result<PrinterPropertiesResult, String> {
    if printer_name.trim().is_empty() {
        return Err("未指定打印机名称".to_string());
    }

    #[cfg(windows)]
    {
        let input_devmode = profile_id
            .as_deref()
            .and_then(|id| profile_store.get_profile(id, &printer_name));

        // HWND contains a raw pointer and is not Send. Move only its numeric value
        // into the blocking task, then reconstruct the non-owning handle there.
        let owner_hwnd_value = window
            .hwnd()
            .map(|handle| handle.0 as isize)
            .unwrap_or_default();

        let printer_name_clone = printer_name.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            let owner_hwnd =
                windows::Win32::Foundation::HWND(owner_hwnd_value as *mut std::ffi::c_void);
            printers::open_printer_properties_sync(
                owner_hwnd,
                &printer_name_clone,
                input_devmode.as_deref(),
            )
        })
        .await
        .map_err(|error| format!("打印机属性任务执行失败：{error}"))??;

        match outcome {
            printers::PrinterPropertiesOutcome::Accepted(devmode) => {
                let new_profile_id = profile_store.save_profile(&printer_name, devmode.clone());
                let paper_names = printers::query_paper_names_map(&printer_name, None);
                let bin_names = printers::query_bin_names_map(&printer_name, None);
                let settings = printers::devmode::parse_devmode_standard_fields(
                    &printer_name,
                    &devmode,
                    Some(&paper_names),
                    Some(&bin_names),
                )?;

                Ok(PrinterPropertiesResult {
                    status: PrinterPropertiesStatus::Accepted,
                    profile_id: Some(new_profile_id),
                    settings: Some(settings),
                })
            }
            printers::PrinterPropertiesOutcome::Cancelled => Ok(PrinterPropertiesResult {
                status: PrinterPropertiesStatus::Cancelled,
                profile_id: None,
                settings: None,
            }),
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (window, printer_name, profile_id, profile_store);
        Err("打印机属性配置仅支持 Windows 平台".to_string())
    }
}

#[tauri::command]
pub async fn list_saved_printer_profiles(
    printer_name: Option<String>,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
) -> Result<Vec<SavedPrinterProfileSummary>, String> {
    let persistent_store = persistent_store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let available_printers = printers::list_system_printers_sync().unwrap_or_default();
        let profiles = persistent_store.list_profiles(printer_name.as_deref());

        let mut summaries = Vec::with_capacity(profiles.len());
        for p in profiles {
            let default_id = persistent_store.get_default_profile_id(&p.printer.printer_name);
            let is_default = default_id.as_deref() == Some(&p.id);

            let current_fingerprint = query_printer_fingerprint(&p.printer.printer_name).ok();
            let compatibility = evaluate_profile_compatibility(
                &p.printer,
                &available_printers,
                current_fingerprint.as_ref(),
            );

            summaries.push(p.to_summary(is_default, compatibility));
        }

        Ok(summaries)
    })
    .await
    .map_err(|error| format!("查询保存的配置失败：{error}"))?
}

#[tauri::command]
pub async fn save_printer_profile(
    request: SavePrinterProfileRequest,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
    profile_store: tauri::State<'_, PrinterProfileStore>,
) -> Result<SavedPrinterProfileSummary, String> {
    let devmode_bytes = profile_store
        .get_profile(&request.runtime_profile_id, &request.printer_name)
        .ok_or_else(|| "当前未找到该运行时的驱动配置数据，请重新打开打印机属性".to_string())?;

    let paper_names = printers::query_paper_names_map(&request.printer_name, None);
    let bin_names = printers::query_bin_names_map(&request.printer_name, None);
    let settings = printers::devmode::parse_devmode_standard_fields(
        &request.printer_name,
        &devmode_bytes,
        Some(&paper_names),
        Some(&bin_names),
    )?;

    let fingerprint = query_printer_fingerprint(&request.printer_name)?;

    let saved = persistent_store.save_profile(
        printers::SaveProfileParams::new(
            &request.name,
            &request.printer_name,
            &devmode_bytes,
            settings,
            fingerprint,
        )
        .with_overwrite(request.overwrite_persistent_profile_id.as_deref())
        .with_note(request.note),
    )?;

    let is_default = persistent_store
        .get_default_profile_id(&request.printer_name)
        .as_deref()
        == Some(&saved.id);

    Ok(saved.to_summary(
        is_default,
        crate::contracts::PrinterProfileCompatibility::Compatible,
    ))
}

#[tauri::command]
pub async fn load_printer_profile(
    persistent_profile_id: String,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
    profile_store: tauri::State<'_, PrinterProfileStore>,
) -> Result<LoadedPrinterProfileResult, String> {
    let profile = persistent_store
        .get_profile(&persistent_profile_id)
        .ok_or_else(|| format!("未找到 ID 为 {persistent_profile_id} 的配置"))?;

    let available_printers = printers::list_system_printers_sync().unwrap_or_default();
    let current_fingerprint = query_printer_fingerprint(&profile.printer.printer_name).ok();
    let compatibility = evaluate_profile_compatibility(
        &profile.printer,
        &available_printers,
        current_fingerprint.as_ref(),
    );

    if compatibility != crate::contracts::PrinterProfileCompatibility::Compatible {
        return Err(format!(
            "配置“{}”当前不可用（{}），若驱动已更新请选择“标准字段重建”",
            profile.name,
            match compatibility {
                crate::contracts::PrinterProfileCompatibility::PrinterUnavailable =>
                    "打印机离线或不存在",
                crate::contracts::PrinterProfileCompatibility::DriverChanged =>
                    "驱动版本已发生变更",
                crate::contracts::PrinterProfileCompatibility::Corrupted => "配置文件校验损坏",
                crate::contracts::PrinterProfileCompatibility::UnsupportedSchema =>
                    "配置架构版本不兼容",
                _ => "未知状态",
            }
        ));
    }

    let devmode_bytes = persistent_store
        .load_devmode_bytes(&persistent_profile_id)
        .map_err(|err| format!("加载配置“{}”的驱动二进制数据失败：{err}", profile.name))?;

    crate::printers::devmode::validate_devmode_buffer(&devmode_bytes)
        .map_err(|err| format!("配置“{}”的 DEVMODE 缓冲区结构无效：{err}", profile.name))?;

    let runtime_profile_id = profile_store.save_profile_with_source(
        &profile.printer.printer_name,
        devmode_bytes.clone(),
        Some(persistent_profile_id.clone()),
    );

    persistent_store.touch_last_used(&persistent_profile_id);

    let is_default = persistent_store
        .get_default_profile_id(&profile.printer.printer_name)
        .as_deref()
        == Some(&persistent_profile_id);

    let summary = profile.to_summary(is_default, compatibility);

    Ok(LoadedPrinterProfileResult {
        persistent_profile: summary,
        runtime_profile_id,
        settings: profile.settings_snapshot,
        compatibility,
    })
}

#[tauri::command]
pub async fn rename_printer_profile(
    persistent_profile_id: String,
    new_name: String,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
) -> Result<SavedPrinterProfileSummary, String> {
    let updated = persistent_store.rename_profile(&persistent_profile_id, &new_name)?;
    let is_default = persistent_store
        .get_default_profile_id(&updated.printer.printer_name)
        .as_deref()
        == Some(&persistent_profile_id);

    Ok(updated.to_summary(
        is_default,
        crate::contracts::PrinterProfileCompatibility::Compatible,
    ))
}

#[tauri::command]
pub async fn duplicate_printer_profile(
    persistent_profile_id: String,
    new_name: String,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
) -> Result<SavedPrinterProfileSummary, String> {
    let duplicated = persistent_store.duplicate_profile(&persistent_profile_id, &new_name)?;
    Ok(duplicated.to_summary(
        false,
        crate::contracts::PrinterProfileCompatibility::Compatible,
    ))
}

#[tauri::command]
pub async fn delete_printer_profile(
    persistent_profile_id: String,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
) -> Result<(), String> {
    persistent_store.delete_profile(&persistent_profile_id)
}

#[tauri::command]
pub async fn set_default_printer_profile(
    printer_name: String,
    persistent_profile_id: Option<String>,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
) -> Result<(), String> {
    persistent_store.set_default_profile(&printer_name, persistent_profile_id.as_deref())
}

#[tauri::command]
pub async fn reorder_printer_profiles(
    printer_name: String,
    ordered_profile_ids: Vec<String>,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
) -> Result<Vec<String>, String> {
    persistent_store.reorder_profiles(&printer_name, &ordered_profile_ids)
}

#[tauri::command]
pub async fn rebuild_printer_profile(
    persistent_profile_id: String,
    new_name: Option<String>,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
    profile_store: tauri::State<'_, PrinterProfileStore>,
) -> Result<LoadedPrinterProfileResult, String> {
    let old_profile = persistent_store
        .get_profile(&persistent_profile_id)
        .ok_or_else(|| format!("未找到 ID 为 {persistent_profile_id} 的配置"))?;

    let printer_name = &old_profile.printer.printer_name;

    #[cfg(windows)]
    let new_devmode = printers::devmode::rebuild_devmode_from_settings(
        printer_name,
        old_profile.settings_snapshot.color_mode.as_deref(),
        old_profile.settings_snapshot.sides_mode.as_deref(),
        old_profile.settings_snapshot.flip_mode.as_deref(),
    )?;

    #[cfg(not(windows))]
    let new_devmode = vec![0_u8; 128];

    let paper_names = printers::query_paper_names_map(printer_name, None);
    let bin_names = printers::query_bin_names_map(printer_name, None);
    let new_settings = printers::devmode::parse_devmode_standard_fields(
        printer_name,
        &new_devmode,
        Some(&paper_names),
        Some(&bin_names),
    )?;

    let fingerprint = query_printer_fingerprint(printer_name)?;
    let target_name = new_name.as_deref().unwrap_or(&old_profile.name);

    let saved = persistent_store.save_profile(
        printers::SaveProfileParams::new(
            target_name,
            printer_name,
            &new_devmode,
            new_settings.clone(),
            fingerprint,
        )
        .with_overwrite(Some(&persistent_profile_id))
        .with_note(old_profile.note),
    )?;

    let runtime_profile_id =
        profile_store.save_profile_with_source(printer_name, new_devmode, Some(saved.id.clone()));

    let is_default = persistent_store
        .get_default_profile_id(printer_name)
        .as_deref()
        == Some(&saved.id);

    Ok(LoadedPrinterProfileResult {
        persistent_profile: saved.to_summary(
            is_default,
            crate::contracts::PrinterProfileCompatibility::Compatible,
        ),
        runtime_profile_id,
        settings: new_settings,
        compatibility: crate::contracts::PrinterProfileCompatibility::Compatible,
    })
}

#[tauri::command]
pub async fn export_printer_profile(
    persistent_profile_id: String,
    target_path: String,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
) -> Result<(), String> {
    let payload = persistent_store.export_profile(&persistent_profile_id)?;
    let json_str = serde_json::to_string_pretty(&payload)
        .map_err(|err| format!("序列化导出数据失败：{err}"))?;

    let path = std::path::Path::new(&target_path);
    std::fs::write(path, json_str).map_err(|err| format!("写入导出文件失败：{err}"))?;

    Ok(())
}

#[tauri::command]
pub async fn export_all_printer_profiles(
    printer_name: String,
    target_path: String,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
) -> Result<usize, String> {
    let profiles = persistent_store.list_profiles(Some(&printer_name));
    if profiles.is_empty() {
        return Err("当前打印机暂无配置可导出".to_string());
    }

    let mut payloads = Vec::new();
    for p in &profiles {
        let payload = persistent_store.export_profile(&p.id)?;
        payloads.push(payload);
    }

    let exported_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let bundle = ExportPrinterProfilesBundlePayload {
        schema_version: crate::printers::persistent_profile_store::SCHEMA_VERSION,
        printer_name,
        exported_at,
        profiles: payloads,
    };

    let json_str = serde_json::to_string_pretty(&bundle)
        .map_err(|err| format!("序列化导出数据失败：{err}"))?;

    let path = std::path::Path::new(&target_path);
    std::fs::write(path, json_str).map_err(|err| format!("写入导出文件失败：{err}"))?;

    Ok(bundle.profiles.len())
}

#[tauri::command]
pub async fn import_printer_profiles(
    source_paths: Vec<String>,
    target_printer_name: Option<String>,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
) -> Result<Vec<SavedPrinterProfileSummary>, String> {
    if source_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut imported_summaries = Vec::new();
    let mut errors = Vec::new();

    for source_path in source_paths {
        let path = std::path::Path::new(&source_path);
        if !path.is_file() {
            errors.push(format!("导入文件不存在：{}", path.display()));
            continue;
        }

        let json_str = match std::fs::read_to_string(path) {
            Ok(content) => content,
            Err(err) => {
                errors.push(format!("读取文件失败（{}）：{err}", path.display()));
                continue;
            }
        };

        let content: ImportProfileFileContent = match serde_json::from_str(&json_str) {
            Ok(parsed) => parsed,
            Err(err) => {
                errors.push(format!("解析文件失败（{}）：{err}", path.display()));
                continue;
            }
        };

        let payloads = match content {
            ImportProfileFileContent::Bundle(b) => b.profiles,
            ImportProfileFileContent::List(l) => l,
            ImportProfileFileContent::Single(s) => vec![s],
        };

        for payload in payloads {
            match persistent_store.import_profile(payload, target_printer_name.as_deref()) {
                Ok(saved) => {
                    let is_default = persistent_store
                        .get_default_profile_id(&saved.printer.printer_name)
                        .as_deref()
                        == Some(&saved.id);
                    imported_summaries.push(saved.to_summary(
                        is_default,
                        crate::contracts::PrinterProfileCompatibility::Compatible,
                    ));
                }
                Err(err) => {
                    errors.push(format!("导入配置失败：{err}"));
                }
            }
        }
    }

    if imported_summaries.is_empty() && !errors.is_empty() {
        return Err(errors.join("\n"));
    }

    Ok(imported_summaries)
}

#[tauri::command]
pub async fn import_printer_profile(
    source_path: String,
    target_printer_name: Option<String>,
    persistent_store: tauri::State<'_, PersistentPrinterProfileStore>,
) -> Result<SavedPrinterProfileSummary, String> {
    let mut summaries = import_printer_profiles(
        vec![source_path],
        target_printer_name,
        persistent_store,
    ).await?;
    summaries.pop().ok_or_else(|| "未导入任何有效配置".to_string())
}

#[tauri::command]
pub async fn pick_files(app: AppHandle) -> Result<Vec<String>, String> {
    let files = app
        .dialog()
        .file()
        .add_filter("可打印文件", crate::documents::SUPPORTED_EXTENSIONS)
        .blocking_pick_files();

    Ok(files
        .unwrap_or_default()
        .into_iter()
        .filter_map(|file_path| file_path.into_path().ok())
        .map(|path| path.to_string_lossy().to_string())
        .collect())
}

#[tauri::command]
pub async fn pick_folder_files(app: AppHandle) -> Result<Vec<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    let Some(folder_path) = folder.and_then(|path| path.into_path().ok()) else {
        return Ok(Vec::new());
    };

    let mut paths = Vec::new();
    collect_path_argument(&folder_path.to_string_lossy(), &mut paths);
    Ok(paths)
}

#[tauri::command]
pub async fn save_export_profile_path(
    app: AppHandle,
    default_name: String,
) -> Result<Option<String>, String> {
    let file = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("PrintAssist 配置", &["paprofile", "json"])
        .blocking_save_file();

    Ok(file
        .and_then(|file_path| file_path.into_path().ok())
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn pick_import_profile_file(app: AppHandle) -> Result<Option<String>, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("PrintAssist 配置", &["paprofile", "json"])
        .blocking_pick_file();

    Ok(file
        .and_then(|file_path| file_path.into_path().ok())
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn pick_import_profile_files(app: AppHandle) -> Result<Vec<String>, String> {
    let files = app
        .dialog()
        .file()
        .add_filter("PrintAssist 配置", &["paprofile", "json"])
        .blocking_pick_files();

    Ok(files
        .unwrap_or_default()
        .into_iter()
        .filter_map(|file_path| file_path.into_path().ok())
        .map(|path| path.to_string_lossy().to_string())
        .collect())
}

/// Expand dropped file/folder paths into supported printable file paths.
#[tauri::command]
pub async fn expand_file_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut expanded = Vec::new();
    for path in paths {
        collect_path_argument(&path, &mut expanded);
    }
    Ok(expanded)
}

#[tauri::command]
pub async fn run_print_batch(
    app: tauri::AppHandle,
    request: PrintBatchRequest,
    profile_store: tauri::State<'_, PrinterProfileStore>,
) -> Result<PrintBatchResult, String> {
    let store_clone = profile_store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_print_batch_sync(request, Some(&store_clone), Some(&app))
    })
    .await
    .map_err(|error| format!("print batch task failed: {error}"))?
}

#[tauri::command]
pub fn pause_print_batch() -> Result<(), String> {
    crate::printing::pause_current_batch();
    Ok(())
}

#[tauri::command]
pub fn resume_print_batch() -> Result<(), String> {
    crate::printing::resume_current_batch();
    Ok(())
}

#[tauri::command]
pub fn terminate_print_batch() -> Result<(), String> {
    crate::printing::terminate_current_batch();
    Ok(())
}

#[tauri::command]
pub fn cancel_print_batch() -> Result<(), String> {
    crate::printing::cancel_current_batch();
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ValidatePathsResult {
    pub valid: Vec<String>,
    pub missing: Vec<String>,
}

#[tauri::command]
pub fn validate_supported_path(path: String) -> bool {
    is_supported_file(PathBuf::from(path).as_path())
}

#[tauri::command]
pub fn validate_supported_paths(paths: Vec<String>) -> ValidatePathsResult {
    let mut valid = Vec::new();
    let mut missing = Vec::new();
    for p in paths {
        if is_supported_file(PathBuf::from(&p).as_path()) {
            valid.push(p);
        } else {
            missing.push(p);
        }
    }
    ValidatePathsResult { valid, missing }
}

#[tauri::command]
pub async fn show_in_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(path);
    if let Some(parent) = p.parent() {
        if parent.exists() {
            return open::that(parent).map_err(|error| format!("打开所在文件夹失败：{error}"));
        }
    }
    open::that(p).map_err(|error| format!("打开文件位置失败：{error}"))
}

#[tauri::command]
pub async fn get_file_metadata(paths: Vec<String>) -> Result<Vec<FileMetadata>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok::<Vec<FileMetadata>, String>(paths.into_iter().filter_map(|path| {
            let metadata = std::fs::metadata(&path).ok()?;
            let to_timestamp = |time: std::io::Result<std::time::SystemTime>| {
                time.ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok()).map(|duration| duration.as_millis() as i64)
            };
            Some(FileMetadata {
                path,
                file_size: metadata.len(),
                created_at: to_timestamp(metadata.created()),
                modified_at: to_timestamp(metadata.modified()),
            })
        }).collect())
    }).await.map_err(|error| format!("读取文件属性失败：{error}"))?
}

#[tauri::command]
pub async fn open_file(path: String) -> Result<(), String> {
    open::that(path).map_err(|error| format!("打开文件失败：{error}"))
}

#[tauri::command]
pub fn get_shell_integration_status() -> Result<crate::shell_integration::ShellIntegrationStatus, String> {
    crate::shell_integration::get_status()
}

#[tauri::command]
pub fn register_shell_integration(
    options: crate::shell_integration::ShellIntegrationOptions,
) -> Result<crate::shell_integration::ShellIntegrationStatus, String> {
    crate::shell_integration::register(&options)
}

#[tauri::command]
pub fn unregister_shell_integration() -> Result<crate::shell_integration::ShellIntegrationStatus, String> {
    crate::shell_integration::unregister()
}

#[tauri::command]
pub fn repair_shell_integration() -> Result<crate::shell_integration::ShellIntegrationStatus, String> {
    crate::shell_integration::repair()
}

#[tauri::command]
pub fn get_app_executable_path() -> Result<String, String> {
    crate::shell_integration::get_current_exe_path().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn write_external_request_result(
    result_file: String,
    result: crate::ingress::ExternalRequestResult,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let json_str = serde_json::to_string_pretty(&result)
            .map_err(|e| format!("序列化结果 JSON 失败: {}", e))?;
        std::fs::write(&result_file, json_str)
            .map_err(|e| format!("写入结果文件失败: {}", e))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("写入任务执行异常: {}", e))?
}
