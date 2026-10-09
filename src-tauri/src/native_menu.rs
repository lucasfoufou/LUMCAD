use tauri::AppHandle;

pub const SETTINGS_MENU_ID: &str = "lumcad-settings";

#[cfg(target_os = "macos")]
pub fn install(app: &AppHandle, language: &str) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

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
    // Keep the system Edit menu for native text fields. Drawing actions are
    // explicit and share the frontend dispatch path; no duplicate accelerators.
    let drawing = Submenu::new(
        app,
        if language == "fr" {
            "Dessin"
        } else {
            "Drawing"
        },
        true,
    )
    .map_err(|error| error.to_string())?;
    for (action, english, french) in DRAWING_ACTIONS {
        let item = MenuItem::with_id(
            app,
            format!("lumcad-drawing-{action}"),
            if language == "fr" { *french } else { *english },
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        drawing.append(&item).map_err(|error| error.to_string())?;
    }
    menu.insert(&drawing, 3)
        .map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &AppHandle, _language: &str) -> Result<(), String> {
    Ok(())
}

const DRAWING_ACTIONS: &[(&str, &str, &str)] = &[
    ("newDocument", "New drawing", "Nouveau dessin"),
    ("open", "Open drawing…", "Ouvrir un dessin…"),
    ("saveAs", "Save drawing as…", "Enregistrer le dessin sous…"),
    (
        "undo",
        "Undo drawing edit",
        "Annuler la modification du dessin",
    ),
    (
        "redo",
        "Redo drawing edit",
        "Rétablir la modification du dessin",
    ),
    ("copy", "Copy objects", "Copier les objets"),
    ("cut", "Cut objects", "Couper les objets"),
    ("paste", "Paste objects", "Coller les objets"),
    (
        "delete",
        "Delete selected objects",
        "Supprimer les objets sélectionnés",
    ),
];

pub fn drawing_action(id: &str) -> Option<&'static str> {
    let name = id.strip_prefix("lumcad-drawing-")?;
    DRAWING_ACTIONS
        .iter()
        .find(|(action, _, _)| *action == name)
        .map(|(action, _, _)| *action)
}

#[cfg(test)]
mod tests {
    #[test]
    fn menu_dispatch_is_limited_to_known_drawing_actions() {
        for (action, english, french) in super::DRAWING_ACTIONS {
            assert_eq!(
                super::drawing_action(&format!("lumcad-drawing-{action}")),
                Some(*action)
            );
            assert!(!english.is_empty() && !french.is_empty());
        }
        assert_eq!(super::drawing_action("lumcad-settings"), None);
        assert_eq!(super::drawing_action("lumcad-drawing-command"), None);
    }
}
