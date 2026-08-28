use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use crate::contracts::{
    PrintBatchRequest, PrintBatchResult, PrintBatchResultItem, PrintQueueItemPayload,
};
#[cfg(windows)]
use crate::documents::office::convert_office_to_pdf;
#[cfg(windows)]
use crate::documents::pdf_pages::extract_pages_to_temp_pdf;
#[cfg(windows)]
use crate::documents::print_shell::print_file_to_printer;
use crate::documents::{detect_document_kind, DocumentKind};
use crate::printers;

/// Shell `printto` / staged PDF handlers may open files asynchronously.
/// Keep temp PDFs alive long enough for those fallbacks.
const TEMP_PRINT_FILE_RETENTION: Duration = Duration::from_secs(180);

pub fn run_print_batch_sync(
    request: PrintBatchRequest,
    profile_store: Option<&printers::PrinterProfileStore>,
    app: Option<&tauri::AppHandle>,
) -> PrintBatchResult {
    let mut results = Vec::new();
    let mut succeeded = 0_u32;
    let mut failed = 0_u32;
    let mut skipped = 0_u32;
    let total = request.items.len();

    for (index, item) in request.items.into_iter().enumerate() {
        let item_id = item.queue_item_id.clone();
        if let Some(app_handle) = app {
            use tauri::Emitter;
            let _ = app_handle.emit(
                "print-item-started",
                serde_json::json!({
                    "queueItemId": item_id,
                    "index": index,
                    "total": total,
                }),
            );
        }

        let result_item = print_single_item(item, profile_store);
        match result_item.status.as_str() {
            "succeeded" => succeeded += 1,
            "skipped" => skipped += 1,
            _ => failed += 1,
        }

        if let Some(app_handle) = app {
            use tauri::Emitter;
            let _ = app_handle.emit(
                "print-item-finished",
                serde_json::json!({
                    "queueItemId": result_item.queue_item_id.clone(),
                    "status": result_item.status.clone(),
                    "message": result_item.message.clone(),
                    "index": index,
                    "total": total,
                    "succeeded": succeeded,
                    "failed": failed,
                    "skipped": skipped,
                }),
            );
        }

        results.push(result_item);
    }

    PrintBatchResult {
        succeeded,
        failed,
        skipped,
        results,
    }
}

fn print_single_item(
    item: PrintQueueItemPayload,
    profile_store: Option<&printers::PrinterProfileStore>,
) -> PrintBatchResultItem {
    let path = Path::new(&item.path);
    if !path.exists() {
        return failed_item(item, "文件不存在");
    }

    if item.settings.printer_name.trim().is_empty() {
        return failed_item(item, "未指定打印机");
    }

    if let Err(error) = validate_printer_capabilities(&item) {
        return failed_item(item, &error);
    }

    let kind = detect_document_kind(path);
    if kind == DocumentKind::Unknown {
        return failed_item(item, "不支持的文件类型");
    }

    if item.settings.page_range_mode == "custom"
        && item.settings.page_range_expression.trim().is_empty()
    {
        return failed_item(item, "自定义页码表达式为空");
    }

    let custom_range = item.settings.page_range_mode == "custom";

    // Image/text do not define multi-page custom ranges.
    if custom_range && matches!(kind, DocumentKind::Image | DocumentKind::Text) {
        return failed_item(item, "图片/文本不支持自定义页码范围，请使用全部页");
    }

    let mut temporary_paths: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    let print_result = print_item_windows(
        &item,
        path,
        kind,
        custom_range,
        &mut temporary_paths,
        profile_store,
    );

    #[cfg(not(windows))]
    let print_result: Result<(), String> = {
        let _ = (
            path,
            kind,
            custom_range,
            &mut temporary_paths,
            profile_store,
        );
        Err("当前平台不支持打印".to_string())
    };

    // Keep staged files around for async association fallbacks.
    schedule_temporary_cleanup(temporary_paths);

    match print_result {
        Ok(()) => PrintBatchResultItem {
            queue_item_id: item.queue_item_id,
            path: item.path,
            file_name: item.file_name,
            status: "succeeded".to_string(),
            message: None,
        },
        Err(error) => failed_item(item, &error),
    }
}

#[cfg(windows)]
fn print_item_windows(
    item: &PrintQueueItemPayload,
    path: &Path,
    kind: DocumentKind,
    custom_range: bool,
    temporary_paths: &mut Vec<PathBuf>,
    profile_store: Option<&printers::PrinterProfileStore>,
) -> Result<(), String> {
    let printer = item.settings.printer_name.as_str();
    let copies = item.settings.copies.max(1);

    // Retrieve and prepare active DEVMODE if stored profile exists
    let active_devmode: Option<Vec<u8>> = item
        .settings
        .driver_profile_id
        .as_deref()
        .and_then(|id| profile_store.and_then(|store| store.get_profile(id, printer)))
        .map(|mut devmode| {
            // Apply single-item standard settings overrides on top of stored profile
            let _ = crate::printers::devmode::apply_settings_to_devmode(
                &mut devmode,
                Some(&item.settings.color_mode),
                Some(&item.settings.sides_mode),
                Some(&item.settings.flip_mode),
                item.settings.source_code,
            );
            devmode
        });

    let scale_mode = item.settings.scale_mode.as_deref();

    match kind {
        DocumentKind::Image => crate::documents::image_print::print_image_to_printer(
            path,
            printer,
            copies,
            active_devmode.as_deref(),
            scale_mode,
        ),

        DocumentKind::Pdf => {
            let pdf_path = if custom_range {
                let ranged = extract_pages_to_temp_pdf(path, &item.settings.page_range_expression)?;
                temporary_paths.push(ranged.clone());
                ranged
            } else {
                path.to_path_buf()
            };
            print_pdf_preserving_orientation(&pdf_path, printer, copies, active_devmode.as_deref(), scale_mode)
        }

        DocumentKind::Word | DocumentKind::Excel | DocumentKind::PowerPoint => {
            // Prefer Office -> PDF conversion to ensure driver DEVMODE (paper, duplex, tray, color)
            // and page orientation are fully respected by the native GDI pipeline.
            match convert_office_to_pdf(path, kind) {
                Ok(pdf_path) => {
                    temporary_paths.push(pdf_path.clone());
                    let staged_pdf = if custom_range {
                        let ranged = extract_pages_to_temp_pdf(
                            &pdf_path,
                            &item.settings.page_range_expression,
                        )?;
                        temporary_paths.push(ranged.clone());
                        ranged
                    } else {
                        pdf_path
                    };
                    print_pdf_preserving_orientation(
                        &staged_pdf,
                        printer,
                        copies,
                        active_devmode.as_deref(),
                        scale_mode,
                    )
                }
                Err(convert_error) => {
                    // Fallback to Office COM direct printing if enabled
                    if !item.allow_association_fallback {
                        return Err(format!(
                            "Office 文档转换为 PDF 失败（{convert_error}）；请勾选允许关联程序回退以使用直接打印"
                        ));
                    }

                    if kind == DocumentKind::Word {
                        crate::documents::office_print::print_office_to_printer(
                            path,
                            kind,
                            printer,
                            copies,
                            item.settings.page_range_mode.as_str(),
                            item.settings.page_range_expression.as_str(),
                        )
                    } else if custom_range {
                        Err(format!(
                            "{convert_error}；自定义页码需要 Office 转 PDF，无法使用关联程序回退"
                        ))
                    } else {
                        crate::documents::office_print::print_office_to_printer(
                            path, kind, printer, copies, "all", "",
                        )
                    }
                }
            }
        }

        DocumentKind::Text => {
            // Text files route through Shell printto
            print_file_to_printer(path, printer, copies)
        }

        DocumentKind::Unknown => Err("不支持的文件类型".to_string()),
    }
}

/// Prefer WinRT/GDI-style PDF printing that keeps landscape pages landscape and honors DEVMODE.
#[cfg(windows)]
fn print_pdf_preserving_orientation(
    pdf_path: &Path,
    printer: &str,
    copies: u32,
    devmode: Option<&[u8]>,
    scale_mode: Option<&str>,
) -> Result<(), String> {
    crate::documents::pdf_print::print_pdf_to_printer(pdf_path, printer, copies, devmode, scale_mode)
}

#[cfg(not(windows))]
fn print_pdf_preserving_orientation(
    _pdf_path: &Path,
    _printer: &str,
    _copies: u32,
    _devmode: Option<&[u8]>,
    _scale_mode: Option<&str>,
) -> Result<(), String> {
    Err("非 Windows 平台不支持原生打印".to_string())
}

fn validate_printer_capabilities(item: &PrintQueueItemPayload) -> Result<(), String> {
    let printers = printers::list_system_printers_sync()?;
    let printer = printers
        .into_iter()
        .find(|candidate| {
            candidate
                .name
                .eq_ignore_ascii_case(&item.settings.printer_name)
        })
        .ok_or_else(|| format!("找不到打印机：{}", item.settings.printer_name))?;

    if printer.state == crate::contracts::PrinterOperationalState::Offline {
        return Err("打印机离线".to_string());
    }
    if printer.state == crate::contracts::PrinterOperationalState::Error {
        return Err("打印机处于错误状态".to_string());
    }

    if item.settings.color_mode == "color"
        && printer.color.support == crate::contracts::CapabilitySupport::Unsupported
    {
        return Err("当前打印机不支持彩色，已阻止静默降级".to_string());
    }

    if item.settings.sides_mode == "duplex"
        && printer.duplex.support == crate::contracts::CapabilitySupport::Unsupported
    {
        return Err("当前打印机不支持双面，已阻止静默降级".to_string());
    }

    Ok(())
}

fn failed_item(item: PrintQueueItemPayload, message: &str) -> PrintBatchResultItem {
    PrintBatchResultItem {
        queue_item_id: item.queue_item_id,
        path: item.path,
        file_name: item.file_name,
        status: "failed".to_string(),
        message: Some(message.to_string()),
    }
}

fn cleanup_temporary_paths(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

fn schedule_temporary_cleanup(paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    thread::spawn(move || {
        thread::sleep(TEMP_PRINT_FILE_RETENTION);
        cleanup_temporary_paths(&paths);
    });
}
