mod hyperlinks;
mod clipboard;
mod image_source;
mod mcp;
mod native_menu;
mod printing;
mod recovery_history;
mod settings;
mod storage;
mod transmittal;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(mcp::McpBridge::default())
        .manage(mcp::McpRuntimeState::default())
        .manage(storage::PendingOpen::default())
        .invoke_handler(tauri::generate_handler![
            transmittal::write_drawing_transmittal,
            storage::resolve_table_csv_path,
            image_source::read_image_source,
            image_source::read_pdf_source,
            image_source::read_dwfx_source,
            image_source::read_shx_source,
            clipboard::write_drawing_clipboard,
            clipboard::read_drawing_clipboard,
            storage::read_lcad_document,
            storage::read_lcad_recovery_source,
            storage::resolve_lcad_recovery_path,
            storage::read_table_csv,
            storage::read_drawing_wmf,
            storage::read_drawing_dgn,
            storage::read_standards_json,
            storage::read_drawing_json,
            storage::read_lcad_reference,
            storage::write_lcad_reference,
            storage::write_lcad_document,
            storage::export_lcad_document,
            storage::autosave_lcad_document,
            storage::load_startup_document,
            storage::clear_recovery,
            recovery_history::list_recovery_history,
            recovery_history::record_recovery_history,
            recovery_history::forget_recovery_history,
            mcp::set_mcp_frontend_ready,
            mcp::complete_mcp_request,
            mcp::get_mcp_status,
            settings::get_app_settings,
            settings::update_app_settings,
            printing::prepare_print_page,
            printing::publish_plot_file,
            printing::write_attribute_export,
            printing::write_spreadsheet_export,
            printing::write_drawing_wmf,
            printing::write_drawing_image,
            hyperlinks::open_drawing_hyperlink,
        ])
        .setup(|app| {
            let settings = settings::load(app.handle()).map_err(std::io::Error::other)?;
            let language = settings.snapshot().language;
            if !app.manage(settings) {
                return Err(
                    std::io::Error::other("LUMCAD settings were already initialized").into(),
                );
            }
            native_menu::install(app.handle(), &language).map_err(std::io::Error::other)?;
            mcp::start(app.handle().clone());
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == native_menu::SETTINGS_MENU_ID {
                let _ = app.emit("lumcad://open-settings", ());
            } else if let Some(action) = native_menu::drawing_action(event.id().as_ref()) {
                let _ = app.emit("lumcad://drawing-action", action);
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build LUMCAD");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            app_handle.state::<mcp::McpRuntimeState>().cancel();
        }

        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            if let Some(path) = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .find(|path| storage::is_lcad_path(path))
            {
                app_handle
                    .state::<storage::PendingOpen>()
                    .remember(path.clone());
                let _ = app_handle.emit("lumcad://open-file", path.to_string_lossy().into_owned());
            }
        }
    });
}
