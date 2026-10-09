use std::{
    fs::{self, File, OpenOptions},
    io::{self, BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

const SETTINGS_FILENAME: &str = "settings.json";
const SETTINGS_VERSION: u8 = 1;
const DEFAULT_MCP_PORT: u16 = 43_622;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub version: u8,
    pub language: String,
    pub autosave_delay_ms: u64,
    pub drawing_defaults: DrawingDefaults,
    pub command_aliases: Vec<CommandAlias>,
    pub command_shortcuts: Vec<CommandShortcut>,
    pub mcp: McpPreferences,
    pub cad_interchange: CadInterchangePreferences,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            language: "en".into(),
            autosave_delay_ms: 900,
            drawing_defaults: DrawingDefaults::default(),
            command_aliases: Vec::new(),
            command_shortcuts: default_command_shortcuts(),
            mcp: McpPreferences::default(),
            cad_interchange: CadInterchangePreferences::default(),
        }
    }
}

impl AppSettings {
    fn normalized(mut self) -> Self {
        self.version = SETTINGS_VERSION;
        if !matches!(self.language.as_str(), "en" | "fr") {
            self.language = "en".into();
        }
        self.autosave_delay_ms = self.autosave_delay_ms.clamp(300, 10_000);
        self.drawing_defaults = self.drawing_defaults.normalized();
        self.mcp = self.mcp.normalized();
        self.cad_interchange = self.cad_interchange.normalized();
        self.command_aliases = normalize_command_aliases(self.command_aliases);
        self.command_shortcuts = normalize_command_shortcuts(self.command_shortcuts);
        self
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CommandShortcut {
    pub shortcut: String,
    pub command: String,
}

fn default_command_shortcuts() -> Vec<CommandShortcut> {
    serde_json::from_str(include_str!("../../src/settings/defaultShortcuts.json")).unwrap_or_default()
}

fn normalize_command_shortcuts(rows: Vec<CommandShortcut>) -> Vec<CommandShortcut> {
    let defaults = default_command_shortcuts();
    if rows.len() > 256 { return defaults; }
    let catalog: Vec<serde_json::Value> = serde_json::from_str(include_str!("../../src/mcp/commands.json")).unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for row in rows {
        let mut parts: Vec<String> = row.shortcut.split('+').map(|part| part.trim().to_ascii_uppercase()).collect();
        let key = parts.pop().unwrap_or_default();
        let modifiers: std::collections::HashSet<_> = parts.iter().map(String::as_str).collect();
        let letter = key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric();
        let function = (1..=12).any(|number| key == format!("F{number}"));
        if modifiers.len() != parts.len() || parts.iter().any(|part| !matches!(part.as_str(), "MOD" | "ALT" | "SHIFT"))
            || !(letter || function || key == "DELETE" || key == "BACKSPACE") || letter && parts.is_empty() {
            return defaults;
        }
        let mut ordered: Vec<&str> = ["MOD", "ALT", "SHIFT"].into_iter().filter(|part| modifiers.contains(part)).collect();
        ordered.push(&key);
        let shortcut = ordered.join("+");
        if matches!(shortcut.as_str(), "MOD+Q" | "MOD+W" | "MOD+S" | "ALT+F4") || !seen.insert(shortcut.clone()) { return defaults; }
        let valid = defaults.iter().any(|item| item.command == row.command)
            || catalog.iter().any(|item| item["command"].as_str() == Some(row.command.as_str()));
        if !valid { return defaults; }
        result.push(CommandShortcut { shortcut, command: row.command });
    }
    result
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CommandAlias {
    pub alias: String,
    pub command: String,
}

fn normalize_command_aliases(rows: Vec<CommandAlias>) -> Vec<CommandAlias> {
    if rows.len() > 256 { return Vec::new(); }
    let catalog: Vec<serde_json::Value> = serde_json::from_str(include_str!("../../src/mcp/commands.json")).unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for row in rows {
        let alias = row.alias.trim().to_ascii_uppercase();
        if alias.is_empty() || alias.len() > 32 || !alias.as_bytes()[0].is_ascii_alphabetic()
            || !alias.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || !seen.insert(alias.clone()) { return Vec::new(); }
        let mut target = None;
        for entry in &catalog {
            let mut tokens = vec![entry["name"].as_str().unwrap_or(""), entry["alias"].as_str().unwrap_or("")];
            if let Some(alternatives) = entry["alternatives"].as_array() {
                tokens.extend(alternatives.iter().filter_map(|value| value.as_str()));
            }
            if tokens.iter().any(|token| token.eq_ignore_ascii_case(&alias)) { return Vec::new(); }
            if entry["command"].as_str() == Some(row.command.as_str())
                || tokens.iter().any(|token| token.eq_ignore_ascii_case(row.command.trim())) {
                target = entry["command"].as_str().map(String::from);
            }
        }
        let Some(command) = target else { return Vec::new(); };
        result.push(CommandAlias { alias, command });
    }
    result
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DrawingDefaults {
    pub designer: String,
    pub template_path: String,
    pub grid_spacing: f64,
    pub tracking: bool,
    pub angle_unit: String,
    pub clockwise_angles: bool,
    pub mirror_text: bool,
}

impl Default for DrawingDefaults {
    fn default() -> Self {
        Self {
            designer: String::new(),
            template_path: String::new(),
            grid_spacing: 0.5,
            tracking: false,
            angle_unit: "degrees".into(),
            clockwise_angles: false,
            mirror_text: false,
        }
    }
}

impl DrawingDefaults {
    fn normalized(mut self) -> Self {
        self.designer = self.designer.trim().chars().take(120).collect();
        self.template_path = self.template_path.trim().to_string();
        if !is_safe_absolute_path(&self.template_path)
            || !self.template_path.to_ascii_lowercase().ends_with(".lcad") {
            self.template_path.clear();
        }
        if !self.grid_spacing.is_finite() {
            self.grid_spacing = 0.5;
        }
        self.grid_spacing = self.grid_spacing.clamp(0.0001, 1_000.0);
        if !matches!(self.angle_unit.as_str(), "degrees" | "radians" | "gradians") {
            self.angle_unit = "degrees".into();
        }
        self
    }
}

/// Absolute POSIX, drive or UNC path without control characters, bounded like the frontend.
fn is_safe_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    let absolute = path.starts_with('/') || path.starts_with("\\\\")
        || (bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'/' | b'\\'));
    absolute && path.encode_utf16().count() <= 4096 && !path.chars().any(|c| c <= '\u{1f}')
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CadInterchangePreferences {
    /// Folder containing LibreDWG `dwgread`/`dwgwrite`; empty means automatic lookup.
    pub libredwg_directory: String,
}

impl CadInterchangePreferences {
    pub(crate) fn normalized(mut self) -> Self {
        self.libredwg_directory = self.libredwg_directory.trim().to_string();
        if !is_safe_absolute_path(&self.libredwg_directory) {
            self.libredwg_directory.clear();
        }
        self
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct McpPreferences {
    pub enabled: bool,
    pub preferred_port: u16,
}

impl Default for McpPreferences {
    fn default() -> Self {
        Self {
            enabled: true,
            preferred_port: DEFAULT_MCP_PORT,
        }
    }
}

impl McpPreferences {
    fn normalized(mut self) -> Self {
        self.preferred_port = self.preferred_port.max(1_024);
        self
    }
}

pub struct AppSettingsState(Mutex<AppSettings>);

impl AppSettingsState {
    pub fn new(settings: AppSettings) -> Self {
        Self(Mutex::new(settings.normalized()))
    }

    pub fn snapshot(&self) -> AppSettings {
        self.0
            .lock()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    fn replace(&self, settings: AppSettings) {
        if let Ok(mut current) = self.0.lock() {
            *current = settings;
        }
    }
}

pub fn load(app: &AppHandle) -> Result<AppSettingsState, String> {
    if crate::runtime::is_headless() { return Ok(AppSettingsState::new(AppSettings::default())); }
    let path = settings_path(app)?;
    let settings = match File::open(&path) {
        Ok(file) => match serde_json::from_reader::<_, AppSettings>(BufReader::new(file)) {
            Ok(settings) => settings.normalized(),
            Err(error) => {
                eprintln!(
                    "LUMCAD ignored invalid settings from {}: {error}",
                    path.display()
                );
                AppSettings::default()
            }
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => AppSettings::default(),
        Err(error) => {
            eprintln!(
                "LUMCAD could not read settings from {}: {error}",
                path.display()
            );
            AppSettings::default()
        }
    };
    Ok(AppSettingsState::new(settings))
}

#[tauri::command]
pub fn get_app_settings(state: State<'_, AppSettingsState>) -> AppSettings {
    state.snapshot()
}

#[tauri::command]
pub fn update_app_settings(
    app: AppHandle,
    state: State<'_, AppSettingsState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let previous = state.snapshot();
    let settings = settings.normalized();
    if !crate::runtime::is_headless() { write_settings(&settings_path(&app)?, &settings)?; }
    state.replace(settings.clone());

    if previous.language != settings.language && !crate::runtime::is_headless() {
        crate::native_menu::install(&app, &settings.language)?;
    }
    if previous.mcp != settings.mcp {
        crate::mcp::restart(app.clone());
    }
    Ok(settings)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(SETTINGS_FILENAME))
        .map_err(|error| format!("cannot resolve LUMCAD settings directory: {error}"))
}

fn write_settings(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = parent.join(format!(".settings.{}.{}.tmp", std::process::id(), nonce));

    let result = (|| -> Result<(), String> {
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("cannot create {}: {error}", temporary.display()))?;
        let mut writer = BufWriter::new(file);
        serde_json::to_writer_pretty(&mut writer, settings)
            .map_err(|error| format!("cannot serialize LUMCAD settings: {error}"))?;
        writer
            .write_all(b"\n")
            .and_then(|_| writer.flush())
            .and_then(|_| writer.get_ref().sync_all())
            .map_err(|error| format!("cannot finalize {}: {error}", temporary.display()))?;
        replace_file(&temporary, path)
            .map_err(|error| format!("cannot replace {}: {error}", path.display()))
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(not(target_os = "windows"))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(target_os = "windows")]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    fs::rename(source, destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_settings_without_a_template_remain_compatible() {
        let mut stored = serde_json::to_value(AppSettings::default()).unwrap();
        stored["drawingDefaults"].as_object_mut().unwrap().remove("templatePath");
        let loaded: AppSettings = serde_json::from_value(stored).unwrap();
        assert_eq!(loaded.drawing_defaults.template_path, "");
        for path in ["/templates/office.lcad", "C:\\templates\\office.LCAD", "\\\\server\\share\\office.lcad"] {
            let defaults = DrawingDefaults { template_path: path.into(), ..DrawingDefaults::default() }.normalized();
            assert_eq!(defaults.template_path, path);
        }
        for path in ["relative.lcad", "/templates/file.dwt", "/templates/bad\0.lcad"] {
            let defaults = DrawingDefaults { template_path: path.into(), ..DrawingDefaults::default() }.normalized();
            assert!(defaults.template_path.is_empty());
        }
    }

    #[test]
    fn libredwg_directory_is_optional_and_must_be_absolute() {
        let mut stored = serde_json::to_value(AppSettings::default()).unwrap();
        stored.as_object_mut().unwrap().remove("cadInterchange");
        let loaded: AppSettings = serde_json::from_value(stored).unwrap();
        assert_eq!(loaded.cad_interchange.libredwg_directory, "");
        for (input, expected) in [(" /opt/libredwg/bin ", "/opt/libredwg/bin"), ("C:\\Tools\\LibreDWG", "C:\\Tools\\LibreDWG"),
            ("bin", ""), ("/opt/bad\nname", "")] {
            let preferences = CadInterchangePreferences { libredwg_directory: input.into() }.normalized();
            assert_eq!(preferences.libredwg_directory, expected);
        }
    }

    #[test]
    fn shortcut_preferences_preserve_rebindings_and_explicit_empty_lists() {
        assert_eq!(normalize_command_shortcuts(default_command_shortcuts()), default_command_shortcuts());
        assert!(normalize_command_shortcuts(Vec::new()).is_empty());
        let custom = vec![CommandShortcut { shortcut: "alt+F7".into(), command: "@toggleOrtho".into() }];
        assert_eq!(normalize_command_shortcuts(custom)[0].shortcut, "ALT+F7");
        let invalid = vec![CommandShortcut { shortcut: "MOD+Q".into(), command: "line".into() }];
        assert_eq!(normalize_command_shortcuts(invalid), default_command_shortcuts());
        let settings = AppSettings { command_shortcuts: Vec::new(), ..AppSettings::default() };
        let decoded: AppSettings = serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();
        assert!(decoded.normalized().command_shortcuts.is_empty());
    }

    #[test]
    fn personal_aliases_reject_collisions_and_normalize_catalog_targets() {
        let alias = |name: &str, command: &str| CommandAlias { alias: name.into(), command: command.into() };
        assert_eq!(normalize_command_aliases(vec![alias(" myline ", "LINE")]), vec![alias("MYLINE", "line")]);
        assert!(normalize_command_aliases(vec![alias("L", "circle")]).is_empty());
        assert!(normalize_command_aliases(vec![alias("CUSTOM", "line"), alias("custom", "circle")]).is_empty());
        assert!(normalize_command_aliases(vec![alias("CUSTOM", "missing")]).is_empty());
        assert!(normalize_command_aliases(vec![alias("1CUSTOM", "line")]).is_empty());
    }

    #[test]
    fn settings_are_normalized_to_safe_supported_values() {
        let settings = AppSettings {
            command_aliases: Vec::new(),
            command_shortcuts: default_command_shortcuts(),
            version: 99,
            language: "unsupported".into(),
            autosave_delay_ms: 20,
            drawing_defaults: DrawingDefaults {
                designer: format!("  {}  ", "A".repeat(150)),
                template_path: "relative.lcad".into(),
                grid_spacing: f64::NAN,
                tracking: true,
                angle_unit: "turns".into(),
                clockwise_angles: true,
                mirror_text: true,
            },
            mcp: McpPreferences {
                enabled: true,
                preferred_port: 80,
            },
            cad_interchange: CadInterchangePreferences { libredwg_directory: "relative/bin".into() },
        }
        .normalized();

        assert_eq!(settings.version, SETTINGS_VERSION);
        assert_eq!(settings.language, "en");
        assert_eq!(settings.autosave_delay_ms, 300);
        assert_eq!(settings.drawing_defaults.designer.len(), 120);
        assert_eq!(settings.drawing_defaults.template_path, "");
        assert_eq!(settings.cad_interchange.libredwg_directory, "");
        assert_eq!(settings.drawing_defaults.grid_spacing, 0.5);
        assert_eq!(settings.drawing_defaults.angle_unit, "degrees");
        assert!(settings.drawing_defaults.clockwise_angles);
        assert!(settings.drawing_defaults.mirror_text);
        assert_eq!(settings.mcp.preferred_port, 1_024);
    }

    #[test]
    fn settings_are_written_atomically_and_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(SETTINGS_FILENAME);
        let settings = AppSettings {
            language: "fr".into(),
            command_aliases: vec![CommandAlias { alias: "MYLINE".into(), command: "line".into() }],
            autosave_delay_ms: 1_500,
            drawing_defaults: DrawingDefaults {
                designer: "Lucas".into(),
                template_path: "/templates/office.lcad".into(),
                grid_spacing: 0.001,
                tracking: true,
                angle_unit: "radians".into(),
                clockwise_angles: true,
                mirror_text: true,
            },
            mcp: McpPreferences {
                enabled: false,
                preferred_port: 45_000,
            },
            ..AppSettings::default()
        };

        write_settings(&path, &settings).unwrap();
        let loaded: AppSettings =
            serde_json::from_reader(BufReader::new(File::open(path).unwrap())).unwrap();
        assert_eq!(loaded, settings);
    }
}
