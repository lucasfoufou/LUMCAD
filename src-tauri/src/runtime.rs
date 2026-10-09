//! Process-local unattended mode. No preferences or recovery from the GUI session.
use std::sync::OnceLock;

pub fn is_headless() -> bool {
    static HEADLESS: OnceLock<bool> = OnceLock::new();
    *HEADLESS.get_or_init(|| std::env::args_os().any(|arg| arg == "--headless"))
}

#[tauri::command]
pub fn fail_headless_startup(app: tauri::AppHandle, error: String) {
    if is_headless() {
        eprintln!("LUMCAD headless startup failed: {error}");
        app.exit(1);
    }
}
