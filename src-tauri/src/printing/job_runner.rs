use std::fs;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::contracts::{
    PrintBatchRequest, PrintBatchResult, PrintBatchResultItem, PrintItemErrorKind,
    PrintQueueItemPayload,
};
#[cfg(windows)]
use crate::documents::office::convert_office_to_pdf;
#[cfg(windows)]
use crate::documents::pdf_pages::extract_pages_to_temp_pdf;
#[cfg(windows)]
use crate::documents::print_shell::print_file_to_printer;
use crate::documents::{detect_document_kind, DocumentKind};
use crate::printers;

/// Controller state for an active print batch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BatchControlState {
    Running,
    PauseRequested,
    Paused,
    TerminateRequested,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafeBoundaryAction {
    Continue,
    Terminate,
}

#[derive(Debug)]
pub struct BatchControl {
    state: Mutex<BatchControlState>,
    wake: std::sync::Condvar,
}

impl Default for BatchControl {
    fn default() -> Self {
        Self::new()
    }
}

impl BatchControl {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(BatchControlState::Running),
            wake: std::sync::Condvar::new(),
        }
    }

    pub fn request_pause(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if *state == BatchControlState::Running {
            *state = BatchControlState::PauseRequested;
        }
    }

    pub fn request_resume(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if *state == BatchControlState::Paused || *state == BatchControlState::PauseRequested {
            *state = BatchControlState::Running;
            self.wake.notify_all();
        }
    }

    pub fn request_terminate(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        *state = BatchControlState::TerminateRequested;
        self.wake.notify_all();
    }

    pub fn current_state(&self) -> BatchControlState {
        *self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn wait_at_safe_boundary<F>(&self, on_paused: F) -> SafeBoundaryAction
    where
        F: FnOnce(),
    {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());

        if *state == BatchControlState::PauseRequested {
            *state = BatchControlState::Paused;
            drop(state);
            on_paused();
            state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        }

        while *state == BatchControlState::Paused {
            state = self.wake.wait(state).unwrap_or_else(|e| e.into_inner());
        }

        if *state == BatchControlState::TerminateRequested {
            SafeBoundaryAction::Terminate
        } else {
            SafeBoundaryAction::Continue
        }
    }
}

/// Mutex guarding that at most one batch prints at a time, along with its scoped batch controller.
static ACTIVE_BATCH: Mutex<Option<Arc<BatchControl>>> = Mutex::new(None);

#[derive(Debug)]
pub struct ActiveBatchGuard {
    _private: (),
}

impl Drop for ActiveBatchGuard {
    fn drop(&mut self) {
        let mut lock = ACTIVE_BATCH.lock().unwrap_or_else(|e| e.into_inner());
        *lock = None;
    }
}

pub fn try_acquire_batch_lock() -> Result<(ActiveBatchGuard, Arc<BatchControl>), String> {
    let mut lock = ACTIVE_BATCH.lock().unwrap_or_else(|e| e.into_inner());
    if lock.is_some() {
        return Err("当前已有打印任务正在执行中，请等待完成或取消后再试".to_string());
    }
    let control = Arc::new(BatchControl::new());
    *lock = Some(Arc::clone(&control));
    Ok((ActiveBatchGuard { _private: () }, control))
}

pub fn pause_current_batch() {
    let lock = ACTIVE_BATCH.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref control) = *lock {
        control.request_pause();
    }
}

pub fn resume_current_batch() {
    let lock = ACTIVE_BATCH.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref control) = *lock {
        control.request_resume();
    }
}

pub fn terminate_current_batch() {
    let lock = ACTIVE_BATCH.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref control) = *lock {
        control.request_terminate();
    }
}

#[deprecated(note = "Use terminate_current_batch instead")]
pub fn cancel_current_batch() {
    terminate_current_batch();
}

/// Shell `printto` / staged PDF handlers may open files asynchronously.
/// Keep temp PDFs alive long enough for those fallbacks.
const TEMP_PRINT_FILE_RETENTION: Duration = Duration::from_secs(30);

pub fn run_print_batch_sync(
    request: PrintBatchRequest,
    profile_store: Option<&printers::PrinterProfileStore>,
    app: Option<&tauri::AppHandle>,
) -> Result<PrintBatchResult, String> {
    // P1-03: Unified request boundary validation
    request.validate()?;

    // P1-01: Single-batch mutex and isolated batch controller
    let (_batch_guard, batch_control) = try_acquire_batch_lock()?;

    let nup = request.nup_layout;
    let scope = request.nup_scope.as_deref().unwrap_or("perFile");
    let is_cross_file = nup.is_some_and(|l| l.cols * l.rows > 1) && scope == "crossFile";

    #[cfg(windows)]
    if is_cross_file {
        return Ok(run_batch_cross_file_nup(
            request,
            nup.unwrap(),
            profile_store,
            app,
            &batch_control,
        ));
    }

    #[cfg(not(windows))]
    if is_cross_file {
        return Ok(PrintBatchResult {
            succeeded: 0,
            failed: request.items.len() as u32,
            skipped: 0,
            results: request
                .items
                .into_iter()
                .map(|item| PrintBatchResultItem {
                    queue_item_id: item.queue_item_id,
                    path: item.path,
                    file_name: item.file_name,
                    status: "failed".to_string(),
                    message: Some("当前平台不支持跨文件拼接打印".to_string()),
                    error_kind: Some(PrintItemErrorKind::Unsupported),
                })
                .collect(),
        });
    }

    Ok(run_batch_per_file(
        request,
        profile_store,
        app,
        &batch_control,
    ))
}

fn run_batch_per_file(
    request: PrintBatchRequest,
    profile_store: Option<&printers::PrinterProfileStore>,
    app: Option<&tauri::AppHandle>,
    batch_control: &BatchControl,
) -> PrintBatchResult {
    let mut results = Vec::new();
    let mut succeeded = 0_u32;
    let mut failed = 0_u32;
    let mut skipped = 0_u32;
    let total = request.items.len();
    let cached_printers = printers::list_system_printers_sync().ok();

    for (index, item) in request.items.into_iter().enumerate() {
        let item_id = item.queue_item_id.clone();

        let action = batch_control.wait_at_safe_boundary(|| {
            if let Some(app_handle) = app {
                use tauri::Emitter;
                let _ = app_handle.emit(
                    "print-batch-state-changed",
                    serde_json::json!({
                        "state": "paused",
                        "completed": index,
                        "total": total,
                    }),
                );
            }
        });

        if action == SafeBoundaryAction::Terminate {
            let result_item = PrintBatchResultItem {
                queue_item_id: item_id.clone(),
                path: item.path.clone(),
                file_name: item.file_name.clone(),
                status: "skipped".to_string(),
                message: Some("用户已终止打印".to_string()),
                error_kind: None,
            };
            skipped += 1;
            if let Some(app_handle) = app {
                use tauri::Emitter;
                let _ = app_handle.emit(
                    "print-item-finished",
                    serde_json::json!({
                        "queueItemId": item_id,
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
            continue;
        }

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

        let result_item = print_single_item(item, profile_store, cached_printers.as_deref());
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
    cached_printers: Option<&[crate::contracts::SystemPrinter]>,
) -> PrintBatchResultItem {
    let path = Path::new(&item.path);
    if !path.exists() {
        return failed_item(item, "文件不存在", Some(PrintItemErrorKind::General));
    }

    if item.settings.printer_name.trim().is_empty() {
        return failed_item(item, "未指定打印机", Some(PrintItemErrorKind::PrinterUnavailable));
    }

    if let Err(error) = validate_printer_capabilities(&item, cached_printers) {
        return failed_item(item, &error, Some(PrintItemErrorKind::PrinterUnavailable));
    }

    let kind = detect_document_kind(path);
    if kind == DocumentKind::Unknown {
        return failed_item(item, "不支持的文件类型", Some(PrintItemErrorKind::Unsupported));
    }

    if item.settings.page_range_mode == "custom"
        && item.settings.page_range_expression.trim().is_empty()
    {
        return failed_item(item, "自定义页码表达式为空", Some(PrintItemErrorKind::General));
    }

    let custom_range = item.settings.page_range_mode == "custom";

    // Image/text do not define multi-page custom ranges.
    if custom_range && matches!(kind, DocumentKind::Image | DocumentKind::Text) {
        return failed_item(
            item,
            "图片/文本不支持自定义页码范围，请使用全部页",
            Some(PrintItemErrorKind::Unsupported),
        );
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
            error_kind: None,
        },
        Err(error) => failed_item(item, &error, None),
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

    // Retrieve and prepare active DEVMODE if stored profile exists or query default DEVMODE
    let mut devmode_buf: Option<Vec<u8>> = item
        .settings
        .driver_profile_id
        .as_deref()
        .and_then(|id| profile_store.and_then(|store| store.get_profile(id, printer)));

    if devmode_buf.is_none() {
        if let Ok(default_dm) = crate::printers::devmode::get_printer_default_devmode(printer) {
            devmode_buf = Some(default_dm);
        }
    }

    let active_devmode: Option<Vec<u8>> = if let Some(mut devmode) = devmode_buf {
        crate::printers::devmode::apply_settings_to_devmode(
            &mut devmode,
            Some(&item.settings.color_mode),
            Some(&item.settings.sides_mode),
            Some(&item.settings.flip_mode),
            item.settings.source_code,
            item.settings.collate,
        )
        .map_err(|err| format!("应用打印机驱动配置失败：{err}"))?;
        Some(devmode)
    } else {
        None
    };

    let scale_mode = item.settings.scale_mode.as_deref();
    let nup = item.settings.nup_layout;

    match kind {
        DocumentKind::Image => crate::documents::image_print::print_image_to_printer(
            path,
            printer,
            copies,
            active_devmode.as_deref(),
            scale_mode,
            nup,
        ),

        DocumentKind::Pdf => {
            let pdf_path = if custom_range {
                let ranged = extract_pages_to_temp_pdf(path, &item.settings.page_range_expression)?;
                temporary_paths.push(ranged.clone());
                ranged
            } else {
                path.to_path_buf()
            };
            print_pdf_preserving_orientation(
                &pdf_path,
                printer,
                copies,
                active_devmode.as_deref(),
                scale_mode,
                nup,
            )
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
                        nup,
                    )
                }
                Err(convert_error) => {
                    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                    if crate::documents::is_wps_native_extension(ext) {
                        return Err(convert_error);
                    }

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
    nup: Option<crate::contracts::NupLayout>,
) -> Result<(), String> {
    crate::documents::pdf_print::print_pdf_to_printer(
        pdf_path, printer, copies, devmode, scale_mode, nup,
    )
}

#[cfg(not(windows))]
#[allow(dead_code)]
fn print_pdf_preserving_orientation(
    _pdf_path: &Path,
    _printer: &str,
    _copies: u32,
    _devmode: Option<&[u8]>,
    _scale_mode: Option<&str>,
    _nup: Option<crate::contracts::NupLayout>,
) -> Result<(), String> {
    Err("非 Windows 平台不支持原生打印".to_string())
}

#[cfg(windows)]
fn stream_item_pages<F>(
    item: &PrintQueueItemPayload,
    temporary_paths: &mut Vec<PathBuf>,
    layout: crate::contracts::NupLayout,
    mut on_page: F,
) -> Result<usize, String>
where
    F: FnMut(crate::documents::image_print::DecodedImage) -> Result<(), String>,
{
    let path = Path::new(&item.path);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }
    let kind = detect_document_kind(path);
    let custom_range = item.settings.page_range_mode == "custom";

    let mut count = 0;
    match kind {
        DocumentKind::Image => {
            let img = crate::documents::image_print::decode_image_bgra(path)?;
            on_page(img)?;
            count += 1;
        }
        DocumentKind::Pdf => {
            let pdf_path = if custom_range {
                let ranged = extract_pages_to_temp_pdf(path, &item.settings.page_range_expression)?;
                temporary_paths.push(ranged.clone());
                ranged
            } else {
                path.to_path_buf()
            };
            let printer_name = item.settings.printer_name.as_str();
            let base_dpi = crate::documents::image_print::query_printer_logical_dpi(printer_name)
                .unwrap_or(300);
            let target_dpi =
                crate::documents::nup_layout::adjust_render_dpi_for_nup(base_dpi, layout);
            crate::documents::pdf_print::for_each_rendered_pdf_page(
                &pdf_path,
                target_dpi,
                |_idx, _total, img| {
                    count += 1;
                    on_page(img)
                },
            )?;
        }
        DocumentKind::Word | DocumentKind::Excel | DocumentKind::PowerPoint => {
            let pdf_path = convert_office_to_pdf(path, kind)?;
            temporary_paths.push(pdf_path.clone());
            let staged_pdf = if custom_range {
                let ranged =
                    extract_pages_to_temp_pdf(&pdf_path, &item.settings.page_range_expression)?;
                temporary_paths.push(ranged.clone());
                ranged
            } else {
                pdf_path
            };
            let printer_name = item.settings.printer_name.as_str();
            let base_dpi = crate::documents::image_print::query_printer_logical_dpi(printer_name)
                .unwrap_or(300);
            let target_dpi =
                crate::documents::nup_layout::adjust_render_dpi_for_nup(base_dpi, layout);
            crate::documents::pdf_print::for_each_rendered_pdf_page(
                &staged_pdf,
                target_dpi,
                |_idx, _total, img| {
                    count += 1;
                    on_page(img)
                },
            )?;
        }
        DocumentKind::Text => return Err("文本文件不支持跨文件拼接".to_string()),
        DocumentKind::Unknown => return Err("不支持的文件类型".to_string()),
    }
    Ok(count)
}

#[cfg(windows)]
fn run_batch_cross_file_nup(
    request: PrintBatchRequest,
    layout: crate::contracts::NupLayout,
    profile_store: Option<&printers::PrinterProfileStore>,
    app: Option<&tauri::AppHandle>,
    batch_control: &BatchControl,
) -> PrintBatchResult {
    let mut results = Vec::new();
    let total = request.items.len();

    if request.items.is_empty() {
        return PrintBatchResult {
            succeeded: 0,
            failed: 0,
            skipped: 0,
            results,
        };
    }

    let first_item = &request.items[0];
    let printer_name = first_item.settings.printer_name.clone();

    let mut devmode_buf: Option<Vec<u8>> = first_item
        .settings
        .driver_profile_id
        .as_deref()
        .and_then(|id| profile_store.and_then(|store| store.get_profile(id, &printer_name)));

    if devmode_buf.is_none() {
        if let Ok(default_dm) = crate::printers::devmode::get_printer_default_devmode(&printer_name)
        {
            devmode_buf = Some(default_dm);
        }
    }

    let active_devmode: Option<Vec<u8>> = if let Some(mut devmode) = devmode_buf {
        if let Err(err) = crate::printers::devmode::apply_settings_to_devmode(
            &mut devmode,
            Some(&first_item.settings.color_mode),
            Some(&first_item.settings.sides_mode),
            Some(&first_item.settings.flip_mode),
            first_item.settings.source_code,
            first_item.settings.collate,
        ) {
            return PrintBatchResult {
                succeeded: 0,
                failed: total as u32,
                skipped: 0,
                results: request
                    .items
                    .into_iter()
                    .map(|item| PrintBatchResultItem {
                        queue_item_id: item.queue_item_id,
                        path: item.path,
                        file_name: item.file_name,
                        status: "failed".to_string(),
                        message: Some(format!("应用打印机驱动配置失败：{err}")),
                        error_kind: Some(PrintItemErrorKind::PrinterUnavailable),
                    })
                    .collect(),
            };
        }
        Some(devmode)
    } else {
        None
    };

    let mut session = match crate::documents::image_print::NupPrintSession::new(
        &printer_name,
        active_devmode.as_deref(),
        layout,
    ) {
        Ok(s) => s,
        Err(err) => {
            return PrintBatchResult {
                succeeded: 0,
                failed: total as u32,
                skipped: 0,
                results: request
                    .items
                    .into_iter()
                    .map(|item| PrintBatchResultItem {
                        queue_item_id: item.queue_item_id,
                        path: item.path,
                        file_name: item.file_name,
                        status: "failed".to_string(),
                        message: Some(format!("初始化打印会话失败：{err}")),
                        error_kind: Some(PrintItemErrorKind::PrinterUnavailable),
                    })
                    .collect(),
            };
        }
    };

    let slots = session.slots;
    let mut page_buffer: Vec<crate::documents::image_print::DecodedImage> = Vec::new();
    let mut temporary_paths: Vec<PathBuf> = Vec::new();

    let mut processed_items: Vec<PrintQueueItemPayload> = Vec::new();
    let mut items_iter = request.items.into_iter().enumerate();
    let mut abort_reason: Option<String> = None;
    let mut cancel_encountered = false;

    while let Some((index, item)) = items_iter.next() {
        let action = batch_control.wait_at_safe_boundary(|| {
            if let Some(app_handle) = app {
                use tauri::Emitter;
                let _ = app_handle.emit(
                    "print-batch-state-changed",
                    serde_json::json!({
                        "state": "paused",
                        "completed": index,
                        "total": total,
                    }),
                );
            }
        });

        if action == SafeBoundaryAction::Terminate {
            session.abort();
            cancel_encountered = true;
            let result_item = PrintBatchResultItem {
                queue_item_id: item.queue_item_id.clone(),
                path: item.path.clone(),
                file_name: item.file_name.clone(),
                status: "skipped".to_string(),
                message: Some("用户已终止打印".to_string()),
                error_kind: None,
            };
            results.push(result_item);
            break;
        }

        if let Some(app_handle) = app {
            use tauri::Emitter;
            let _ = app_handle.emit(
                "print-item-started",
                serde_json::json!({
                    "queueItemId": item.queue_item_id,
                    "index": index,
                    "total": total,
                }),
            );
        }

        let copies = item.settings.copies.max(1);
        let mut item_pages: Vec<crate::documents::image_print::DecodedImage> = Vec::new();

        let stream_res = stream_item_pages(&item, &mut temporary_paths, layout, |page| {
            item_pages.push(page);
            Ok(())
        });

        match stream_res {
            Ok(count) => {
                if count == 0 {
                    session.abort();
                    abort_reason = Some(format!("文件“{}”未包含任何有效页面", item.file_name));
                    processed_items.push(item);
                    break;
                }

                // Add logical pages to buffer according to copies
                let mut draw_err = None;
                for _copy in 0..copies {
                    for page in &item_pages {
                        page_buffer.push(page.clone());
                        if page_buffer.len() >= slots {
                            let sheet: Vec<crate::documents::image_print::DecodedImage> =
                                page_buffer.drain(..slots).collect();
                            let refs: Vec<&crate::documents::image_print::DecodedImage> =
                                sheet.iter().collect();
                            if let Err(e) = session.draw_physical_sheet(&refs) {
                                draw_err = Some(e);
                                break;
                            }
                        }
                    }
                    if draw_err.is_some() {
                        break;
                    }
                }

                processed_items.push(item);

                if let Some(e) = draw_err {
                    session.abort();
                    abort_reason = Some(format!("绘制物理页失败：{e}"));
                    break;
                }
            }
            Err(error) => {
                session.abort();
                abort_reason = Some(error);
                processed_items.push(item);
                break;
            }
        }
    }

    // If abort was triggered
    if let Some(err_msg) = abort_reason {
        cleanup_temporary_paths(&temporary_paths);

        // Mark all processed items as failed
        for item in processed_items {
            let res_item = PrintBatchResultItem {
                queue_item_id: item.queue_item_id.clone(),
                path: item.path,
                file_name: item.file_name,
                status: "failed".to_string(),
                message: Some(err_msg.clone()),
                error_kind: Some(classify_error(&err_msg)),
            };
            if let Some(app_handle) = app {
                use tauri::Emitter;
                let _ = app_handle.emit(
                    "print-item-finished",
                    serde_json::json!({
                        "queueItemId": item.queue_item_id,
                        "status": "failed",
                        "message": err_msg.clone(),
                        "index": results.len(),
                        "total": total,
                        "succeeded": 0,
                        "failed": results.len() + 1,
                        "skipped": 0,
                    }),
                );
            }
            results.push(res_item);
        }

        // Mark any remaining unattempted items as failed
        for (index, item) in items_iter {
            let res_item = PrintBatchResultItem {
                queue_item_id: item.queue_item_id.clone(),
                path: item.path,
                file_name: item.file_name,
                status: "failed".to_string(),
                message: Some("前序页面拼接打印失败，后续任务已中止".to_string()),
                error_kind: Some(PrintItemErrorKind::General),
            };
            if let Some(app_handle) = app {
                use tauri::Emitter;
                let _ = app_handle.emit(
                    "print-item-finished",
                    serde_json::json!({
                        "queueItemId": item.queue_item_id,
                        "status": "failed",
                        "message": "前序页面拼接打印失败，后续任务已中止",
                        "index": index,
                        "total": total,
                        "succeeded": 0,
                        "failed": results.len() + 1,
                        "skipped": 0,
                    }),
                );
            }
            results.push(res_item);
        }

        let failed_count = results.len() as u32;
        return PrintBatchResult {
            succeeded: 0,
            failed: failed_count,
            skipped: 0,
            results,
        };
    }

    // If cancel was triggered during the item loop
    if cancel_encountered {
        cleanup_temporary_paths(&temporary_paths);
        for item in processed_items {
            results.push(PrintBatchResultItem {
                queue_item_id: item.queue_item_id,
                path: item.path,
                file_name: item.file_name,
                status: "skipped".to_string(),
                message: Some("用户已取消打印".to_string()),
                error_kind: None,
            });
        }
        for (_, item) in items_iter {
            results.push(PrintBatchResultItem {
                queue_item_id: item.queue_item_id,
                path: item.path,
                file_name: item.file_name,
                status: "skipped".to_string(),
                message: Some("用户已取消打印".to_string()),
                error_kind: None,
            });
        }
        let skipped_count = results.len() as u32;
        return PrintBatchResult {
            succeeded: 0,
            failed: 0,
            skipped: skipped_count,
            results,
        };
    }

    // Flush remaining physical sheet
    if !page_buffer.is_empty() {
        let refs: Vec<&crate::documents::image_print::DecodedImage> = page_buffer.iter().collect();
        if let Err(e) = session.draw_physical_sheet(&refs) {
            session.abort();
            cleanup_temporary_paths(&temporary_paths);
            let err_msg = format!("绘制尾页物理页失败：{e}");
            for item in processed_items {
                results.push(PrintBatchResultItem {
                    queue_item_id: item.queue_item_id,
                    path: item.path,
                    file_name: item.file_name,
                    status: "failed".to_string(),
                    message: Some(err_msg.clone()),
                    error_kind: Some(classify_error(&err_msg)),
                });
            }
            let failed_count = results.len() as u32;
            return PrintBatchResult {
                succeeded: 0,
                failed: failed_count,
                skipped: 0,
                results,
            };
        }
        page_buffer.clear();
    }

    // EndDoc / commit job
    if let Err(e) = session.finish() {
        cleanup_temporary_paths(&temporary_paths);
        let err_msg = format!("提交打印作业失败（EndDoc）：{e}");
        for item in processed_items {
            results.push(PrintBatchResultItem {
                queue_item_id: item.queue_item_id,
                path: item.path,
                file_name: item.file_name,
                status: "failed".to_string(),
                message: Some(err_msg.clone()),
                error_kind: Some(PrintItemErrorKind::PrinterUnavailable),
            });
        }
        let failed_count = results.len() as u32;
        return PrintBatchResult {
            succeeded: 0,
            failed: failed_count,
            skipped: 0,
            results,
        };
    }

    // All sheets committed and EndDoc succeeded!
    cleanup_temporary_paths(&temporary_paths);
    let mut succeeded = 0_u32;
    for (index, item) in processed_items.into_iter().enumerate() {
        succeeded += 1;
        let res_item = PrintBatchResultItem {
            queue_item_id: item.queue_item_id.clone(),
            path: item.path,
            file_name: item.file_name,
            status: "succeeded".to_string(),
            message: None,
            error_kind: None,
        };
        if let Some(app_handle) = app {
            use tauri::Emitter;
            let _ = app_handle.emit(
                "print-item-finished",
                serde_json::json!({
                    "queueItemId": item.queue_item_id,
                    "status": "succeeded",
                    "message": null,
                    "index": index,
                    "total": total,
                    "succeeded": succeeded,
                    "failed": 0,
                    "skipped": 0,
                }),
            );
        }
        results.push(res_item);
    }

    PrintBatchResult {
        succeeded,
        failed: 0,
        skipped: 0,
        results,
    }
}

fn validate_printer_capabilities(
    item: &PrintQueueItemPayload,
    cached_printers: Option<&[crate::contracts::SystemPrinter]>,
) -> Result<(), String> {
    let owned_printers;
    let printers = match cached_printers {
        Some(p) => p,
        None => {
            owned_printers = printers::list_system_printers_sync()?;
            &owned_printers[..]
        }
    };
    let printer = printers
        .iter()
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

pub fn classify_error(msg: &str) -> PrintItemErrorKind {
    let lower = msg.to_lowercase();
    if lower.contains("0x800a14bb")
        || lower.contains("正在被另一进程使用")
        || lower.contains("被占用")
        || lower.contains("正由另一进程使用")
        || lower.contains("文件被锁定")
    {
        PrintItemErrorKind::FileLocked
    } else if lower.contains("密码") || lower.contains("password") {
        PrintItemErrorKind::PasswordProtected
    } else if msg.contains("未检测到可用的 Microsoft Office 或 WPS Office")
        || msg.contains("请确认已安装")
        || msg.contains("未检测到已安装组件")
        || msg.contains("kwps.application")
        || msg.contains("ket.application")
        || msg.contains("kwpp.application")
        || msg.contains("Word.Application")
        || msg.contains("Excel.Application")
        || msg.contains("PowerPoint.Application")
        || msg.contains("CLSIDFromProgID")
    {
        PrintItemErrorKind::OfficeMissing
    } else if msg.contains("不支持") || msg.contains("格式不支持") {
        PrintItemErrorKind::Unsupported
    } else if msg.contains("打印机") {
        PrintItemErrorKind::PrinterUnavailable
    } else {
        PrintItemErrorKind::General
    }
}

fn failed_item(
    item: PrintQueueItemPayload,
    message: &str,
    explicit_kind: Option<PrintItemErrorKind>,
) -> PrintBatchResultItem {
    let kind = explicit_kind.unwrap_or_else(|| classify_error(message));
    PrintBatchResultItem {
        queue_item_id: item.queue_item_id,
        path: item.path,
        file_name: item.file_name,
        status: "failed".to_string(),
        message: Some(message.to_string()),
        error_kind: Some(kind),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{
        NupLayout, PrintBatchRequest, PrintQueueItemPayload, ResolvedPrintSettingsPayload,
    };

    fn make_test_item(path: &str, printer: &str, copies: u32) -> PrintQueueItemPayload {
        PrintQueueItemPayload {
            queue_item_id: "item-1".to_string(),
            path: path.to_string(),
            file_name: "test.pdf".to_string(),
            settings: ResolvedPrintSettingsPayload {
                printer_name: printer.to_string(),
                color_mode: "monochrome".to_string(),
                sides_mode: "simplex".to_string(),
                flip_mode: "none".to_string(),
                copies,
                page_range_mode: "all".to_string(),
                page_range_expression: "".to_string(),
                source_code: None,
                source_name: None,
                scale_mode: None,
                collate: None,
                driver_profile_id: None,
                nup_layout: None,
                nup_scope: None,
            },
            allow_association_fallback: false,
        }
    }

    #[test]
    fn batch_lock_mutual_exclusion_and_raii_release() {
        let (guard1, control) = try_acquire_batch_lock().expect("acquire lock 1");
        assert_eq!(control.current_state(), BatchControlState::Running);

        // Second acquire while lock1 is held must fail
        let second_res = try_acquire_batch_lock();
        assert!(second_res.is_err());
        assert!(second_res.unwrap_err().contains("已有打印任务正在执行中"));

        // Terminate sets state
        terminate_current_batch();
        assert_eq!(control.current_state(), BatchControlState::TerminateRequested);

        // Dropping guard1 releases the lock
        drop(guard1);

        // Now acquire succeeds again
        let (guard2, control2) = try_acquire_batch_lock().expect("acquire lock 2");
        assert_eq!(control2.current_state(), BatchControlState::Running);
        drop(guard2);
    }

    #[test]
    fn batch_control_pause_resume_and_terminate_flow() {
        let control = Arc::new(BatchControl::new());
        assert_eq!(control.current_state(), BatchControlState::Running);

        // 1. Pause request
        control.request_pause();
        assert_eq!(control.current_state(), BatchControlState::PauseRequested);

        let paused_notified = Arc::new(AtomicBool::new(false));
        let paused_notified_clone = Arc::clone(&paused_notified);
        let control_clone = Arc::clone(&control);

        let worker = thread::spawn(move || {
            control_clone.wait_at_safe_boundary(move || {
                paused_notified_clone.store(true, Ordering::SeqCst);
            })
        });

        // Give thread a moment to reach safe boundary and enter paused state
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !paused_notified.load(Ordering::SeqCst) {
            assert!(std::time::Instant::now() < deadline, "timeout waiting for paused state");
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(control.current_state(), BatchControlState::Paused);

        // 2. Resume
        control.request_resume();
        assert_eq!(control.current_state(), BatchControlState::Running);

        let action = worker.join().expect("worker join");
        assert_eq!(action, SafeBoundaryAction::Continue);

        // 3. Terminate while running
        control.request_terminate();
        assert_eq!(control.current_state(), BatchControlState::TerminateRequested);

        let term_action = control.wait_at_safe_boundary(|| {});
        assert_eq!(term_action, SafeBoundaryAction::Terminate);
    }

    #[test]
    fn batch_validation_rejects_empty_queue() {
        let req = PrintBatchRequest {
            items: vec![],
            nup_layout: None,
            nup_scope: None,
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn batch_validation_rejects_invalid_copies() {
        let item = make_test_item("some_file.pdf", "Printer1", 0);
        let req = PrintBatchRequest {
            items: vec![item],
            nup_layout: None,
            nup_scope: None,
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn batch_validation_rejects_cross_file_text_files() {
        let temp_txt = std::env::temp_dir().join(format!("test-{}.txt", uuid::Uuid::new_v4()));
        let _ = fs::write(&temp_txt, b"hello text");

        let mut item = make_test_item(temp_txt.to_str().unwrap(), "Printer1", 1);
        item.file_name = "test.txt".to_string();

        let req = PrintBatchRequest {
            items: vec![item],
            nup_layout: Some(NupLayout { cols: 2, rows: 2 }),
            nup_scope: Some("crossFile".to_string()),
        };
        let res = req.validate();
        let _ = fs::remove_file(temp_txt);

        assert!(res.is_err());
        assert!(res.unwrap_err().contains("跨文件多页拼接不支持纯文本文件"));
    }

    #[test]
    fn batch_validation_rejects_mismatched_printers_in_cross_file() {
        let temp_pdf = std::env::temp_dir().join(format!("test-{}.pdf", uuid::Uuid::new_v4()));
        let _ = fs::write(&temp_pdf, b"%PDF-1.4 dummy");

        let item1 = make_test_item(temp_pdf.to_str().unwrap(), "Printer1", 1);
        let mut item2 = make_test_item(temp_pdf.to_str().unwrap(), "Printer2", 1);
        item2.queue_item_id = "item-2".to_string();

        let req = PrintBatchRequest {
            items: vec![item1, item2],
            nup_layout: Some(NupLayout { cols: 2, rows: 1 }),
            nup_scope: Some("crossFile".to_string()),
        };
        let res = req.validate();
        let _ = fs::remove_file(temp_pdf);

        assert!(res.is_err());
        assert!(res
            .unwrap_err()
            .contains("跨文件多页拼接要求队列中所有文件使用同一台打印机"));
    }

    #[test]
    fn test_classify_error() {
        assert_eq!(
            classify_error("CLSIDFromProgID failed for Word.Application"),
            PrintItemErrorKind::OfficeMissing
        );
        assert_eq!(
            classify_error("文件正在被另一进程使用，无法打开"),
            PrintItemErrorKind::FileLocked
        );
        assert_eq!(
            classify_error("文档受密码保护"),
            PrintItemErrorKind::PasswordProtected
        );
        assert_eq!(
            classify_error("不支持的文件类型"),
            PrintItemErrorKind::Unsupported
        );
        assert_eq!(
            classify_error("未找到指定的打印机"),
            PrintItemErrorKind::PrinterUnavailable
        );
        assert_eq!(
            classify_error("未知内部错误"),
            PrintItemErrorKind::General
        );
    }
}

