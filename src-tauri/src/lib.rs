pub mod commands;
pub mod contracts;
pub mod documents;
pub mod ingress;
pub mod printers;
pub mod printing;
pub mod shell_integration;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Ok(Some(req)) = ingress::parse_external_request(&args) {
                if req.activate_window.unwrap_or(true) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_focus();
                    }
                }
                let _ = app.emit("external-request", &req);
                if !req.paths.is_empty() {
                    let _ = app.emit("files-added", &req.paths);
                }
            } else if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.set_icon(
                    tauri::image::Image::from_bytes(include_bytes!("../icons/icon.ico"))
                        .expect("Failed to load icon"),
                )?;
                let _ = window.set_focus();
            }

            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("com.ws1993.printassist"));
            let storage_dir =
                printers::PersistentPrinterProfileStore::resolve_storage_dir(&app_data_dir);
            let persistent_store = printers::PersistentPrinterProfileStore::new(&storage_dir);
            app.manage(persistent_store);

            let launch_args: Vec<String> = std::env::args().collect();
            if let Ok(Some(req)) = ingress::parse_external_request(&launch_args) {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    let _ = handle.emit("external-request", &req);
                    if !req.paths.is_empty() {
                        let _ = handle.emit("files-added", &req.paths);
                    }
                });
            }
            Ok(())
        })
        .manage(printers::PrinterProfileStore::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_system_printers,
            commands::list_printer_paper_sources,
            commands::open_printer_properties,
            commands::list_saved_printer_profiles,
            commands::save_printer_profile,
            commands::load_printer_profile,
            commands::rename_printer_profile,
            commands::duplicate_printer_profile,
            commands::delete_printer_profile,
            commands::set_default_printer_profile,
            commands::reorder_printer_profiles,
            commands::rebuild_printer_profile,
            commands::export_printer_profile,
            commands::export_all_printer_profiles,
            commands::import_printer_profile,
            commands::import_printer_profiles,
            commands::save_export_profile_path,
            commands::pick_import_profile_file,
            commands::pick_import_profile_files,
            commands::pick_files,
            commands::pick_folder_files,
            commands::expand_file_paths,
            commands::run_print_batch,
            commands::pause_print_batch,
            commands::resume_print_batch,
            commands::terminate_print_batch,
            commands::cancel_print_batch,
            commands::validate_supported_path,
            commands::validate_supported_paths,
            commands::show_in_folder,
            commands::get_file_metadata,
            commands::open_file,
            commands::get_shell_integration_status,
            commands::register_shell_integration,
            commands::unregister_shell_integration,
            commands::repair_shell_integration,
            commands::get_app_executable_path,
            commands::write_external_request_result
        ])
        .run(tauri::generate_context!())
        .expect("error while running PrintAssist");
}
