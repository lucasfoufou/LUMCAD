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
    pub mcp: McpPreferences,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            language: "en".into(),
            autosave_delay_ms: 900,
            drawing_defaults: DrawingDefaults::default(),
            mcp: McpPreferences::default(),
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
        self
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DrawingDefaults {
    pub designer: String,
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
    write_settings(&settings_path(&app)?, &settings)?;
    state.replace(settings.clone());

    if previous.language != settings.language {
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
    fn settings_are_normalized_to_safe_supported_values() {
        let settings = AppSettings {
            version: 99,
            language: "unsupported".into(),
            autosave_delay_ms: 20,
            drawing_defaults: DrawingDefaults {
                designer: format!("  {}  ", "A".repeat(150)),
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
        }
        .normalized();

        assert_eq!(settings.version, SETTINGS_VERSION);
        assert_eq!(settings.language, "en");
        assert_eq!(settings.autosave_delay_ms, 300);
        assert_eq!(settings.drawing_defaults.designer.len(), 120);
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
            autosave_delay_ms: 1_500,
            drawing_defaults: DrawingDefaults {
                designer: "Lucas".into(),
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
