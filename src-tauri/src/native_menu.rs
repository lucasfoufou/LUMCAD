use tauri::AppHandle;

pub const SETTINGS_MENU_ID: &str = "lumcad-settings";

#[cfg(target_os = "macos")]
pub fn install(app: &AppHandle, language: &str) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

    let menu = Menu::default(app).map_err(|error| error.to_string())?;
    let app_submenu = menu
        .items()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find_map(|item| item.as_submenu().cloned())
        .ok_or_else(|| "the macOS application menu is unavailable".to_string())?;
    let label = if language == "fr" {
        "Réglages…"
    } else {
        "Settings…"
    };
    let settings = MenuItem::with_id(app, SETTINGS_MENU_ID, label, true, Some("CmdOrCtrl+,"))
        .map_err(|error| error.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
    app_submenu
        .insert_items(&[&settings, &separator], 2)
        .map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &AppHandle, _language: &str) -> Result<(), String> {
    Ok(())
}
