//! Bounded DXF files and optional LibreDWG conversion, isolated from user files.
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const LIMIT: u64 = 64 * 1024 * 1024;

fn validate_path(path: &Path, format: &str) -> Result<(), String> {
    if !["dxf", "dwg"].contains(&format)
        || !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case(format))
    {
        return Err("cadInvalid".into());
    }
    Ok(())
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|_| "cadInvalid")?;
    let metadata = file.metadata().map_err(|_| "cadInvalid")?;
    if !metadata.is_file() {
        return Err("cadInvalid".into());
    }
    if metadata.len() > LIMIT {
        return Err("cadLimit".into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "cadInvalid")?;
    if bytes.len() as u64 > LIMIT {
        return Err("cadLimit".into());
    }
    Ok(bytes)
}

fn validate_dxf(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 > LIMIT {
        return Err("cadLimit".into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "cadEncoding")?;
    let lines: Vec<_> = text.trim_end().lines().collect();
    if lines.len() % 2 != 0 {
        return Err("cadInvalid".into());
    }
    let mut section = false;
    let mut eof = false;
    for pair in lines.chunks_exact(2) {
        let code: u16 = pair[0].trim().parse().map_err(|_| "cadInvalid")?;
        if eof {
            return Err("cadInvalid".into());
        }
        section |= code == 0 && pair[1].trim() == "SECTION";
        eof = code == 0 && pair[1].trim() == "EOF";
    }
    if !section || !eof {
        return Err("cadInvalid".into());
    }
    Ok(())
}

fn executable(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Usual install folders. Applications launched from Finder or a desktop menu do
/// not inherit the shell PATH, so Homebrew/MacPorts/local prefixes are probed too.
fn standard_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if cfg!(target_os = "macos") {
        directories
            .extend(["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"].map(PathBuf::from));
    } else if cfg!(windows) {
        for variable in ["ProgramFiles", "LOCALAPPDATA"] {
            if let Some(root) = std::env::var_os(variable) {
                let base = PathBuf::from(root).join(if variable == "LOCALAPPDATA" {
                    "Programs\\LibreDWG"
                } else {
                    "LibreDWG"
                });
                directories.push(base.join("bin"));
                directories.push(base);
            }
        }
    } else {
        directories.extend(["/usr/local/bin", "/usr/bin"].map(PathBuf::from));
        if let Some(home) = std::env::var_os("HOME") {
            directories.push(PathBuf::from(home).join(".local/bin"));
        }
    }
    directories
}

/// Lookup order: LUMCAD_LIBREDWG_DIR, then the Settings folder when one is set,
/// otherwise PATH and standard folders. An explicit Settings folder is
/// authoritative: a wrong folder reports LibreDWG as missing instead of silently
/// using another installation. The first folder containing both converters
/// wins, so read and write use one installation.
fn locate_converters(configured: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = std::env::var_os("LUMCAD_LIBREDWG_DIR")
        .map(PathBuf::from)
        .into_iter()
        .collect();
    if !configured.is_empty() {
        candidates.push(PathBuf::from(configured));
    } else if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path));
    }
    if configured.is_empty() {
        candidates.extend(standard_directories());
    }
    candidates.into_iter().find(|directory| {
        directory.is_absolute()
            && ["dwgread", "dwgwrite"]
                .iter()
                .all(|name| directory.join(executable(name)).is_file())
    })
}

fn configured_directory(settings: &tauri::State<'_, crate::settings::AppSettingsState>) -> String {
    settings.snapshot().cad_interchange.libredwg_directory
}

fn convert(input: &[u8], to_dwg: bool, configured: &str) -> Result<Vec<u8>, String> {
    let directory = locate_converters(configured).ok_or("cadConverterMissing")?;
    let work = tempfile::tempdir().map_err(|_| "cadConversionFailed")?;
    let source = work
        .path()
        .join(if to_dwg { "source.dxf" } else { "source.dwg" });
    let output = work
        .path()
        .join(if to_dwg { "result.dwg" } else { "result.dxf" });
    fs::write(&source, input).map_err(|_| "cadConversionFailed")?;
    let mut command =
        Command::new(directory.join(executable(if to_dwg { "dwgwrite" } else { "dwgread" })));
    command
        .current_dir(work.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if to_dwg {
        command.arg("--as=r2000");
    } else {
        command.args(["-O", "DXF"]);
    }
    command.arg("-o").arg(&output).arg(&source);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW, including headless runs.
    }
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "cadConverterMissing"
        } else {
            "cadConversionFailed"
        }
    })?;
    let start = Instant::now();
    loop {
        let too_large = fs::metadata(&output).is_ok_and(|metadata| metadata.len() > LIMIT);
        if too_large || start.elapsed() > Duration::from_secs(90) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(if too_large {
                "cadLimit"
            } else {
                "cadConversionTimeout"
            }
            .into());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err("cadConversionFailed".into());
                }
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("cadConversionFailed".into());
            }
        }
    }
    let bytes = read_bounded(&output)?;
    if to_dwg {
        if !bytes.starts_with(b"AC1015") {
            return Err("cadConversionFailed".into());
        }
    } else {
        validate_dxf(&bytes)?;
    }
    Ok(bytes)
}

fn read_cad(path: &str, format: &str, configured: &str) -> Result<Vec<u8>, String> {
    validate_path(Path::new(path), format)?;
    let bytes = read_bounded(Path::new(path))?;
    if format == "dwg" {
        if !bytes.starts_with(b"AC10") {
            return Err("cadInvalid".into());
        }
        convert(&bytes, false, configured)
    } else {
        Ok(bytes)
    }
}

fn write_cad(path: &str, format: &str, text: &str, configured: &str) -> Result<(), String> {
    validate_path(Path::new(path), format)?;
    validate_dxf(text.as_bytes())?;
    let bytes = if format == "dwg" {
        convert(text.as_bytes(), true, configured)?
    } else {
        text.as_bytes().to_vec()
    };
    crate::printing::atomic_write_plot_file(Path::new(path), &bytes).map(|_| ())
}

#[tauri::command]
pub async fn read_drawing_cad(
    path: String,
    format: String,
    settings: tauri::State<'_, crate::settings::AppSettingsState>,
) -> Result<tauri::ipc::Response, String> {
    let configured = configured_directory(&settings);
    tauri::async_runtime::spawn_blocking(move || {
        read_cad(&path, &format, &configured).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|_| "cadConversionFailed".to_string())?
}

#[tauri::command]
pub async fn write_drawing_cad(
    path: String,
    format: String,
    text: String,
    settings: tauri::State<'_, crate::settings::AppSettingsState>,
) -> Result<(), String> {
    let configured = configured_directory(&settings);
    tauri::async_runtime::spawn_blocking(move || write_cad(&path, &format, &text, &configured))
        .await
        .map_err(|_| "cadConversionFailed".to_string())?
}

/// Reports the LibreDWG folder that conversions would use with `directory` as the
/// Settings value. It only checks that the files exist; nothing is executed.
#[tauri::command]
pub fn locate_libredwg(directory: String) -> Option<String> {
    let configured = crate::settings::CadInterchangePreferences {
        libredwg_directory: directory,
    }
    .normalized();
    locate_converters(&configured.libredwg_directory)
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_and_limits_are_checked_before_conversion() {
        assert!(validate_path(Path::new("relative.dxf"), "dxf").is_err());
        let work = tempfile::tempdir().unwrap();
        assert!(validate_path(&work.path().join("drawing.lcad"), "dxf").is_err());
        assert!(validate_path(&work.path().join("drawing.DXF"), "dxf").is_ok());
        let path = work.path().join("large.dxf");
        File::create(&path).unwrap().set_len(LIMIT + 1).unwrap();
        assert_eq!(read_bounded(&path).unwrap_err(), "cadLimit");
    }
    #[test]
    fn invalid_export_preserves_destination_and_valid_dxf_replaces_atomically() {
        let work = tempfile::tempdir().unwrap();
        let path = work.path().join("plan.dxf");
        fs::write(&path, b"original").unwrap();
        assert!(write_cad(path.to_str().unwrap(), "dxf", "invalid", "").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        let text = "999\nLibreDWG comment\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n";
        write_cad(path.to_str().unwrap(), "dxf", text, "").unwrap();
        assert_eq!(
            read_cad(path.to_str().unwrap(), "dxf", "").unwrap(),
            text.as_bytes()
        );
    }
    #[test]
    fn converters_are_found_in_the_configured_folder_only_as_a_pair() {
        let work = tempfile::tempdir().unwrap();
        let folder = work.path().to_str().unwrap();
        File::create(work.path().join(executable("dwgread"))).unwrap();
        let configured_only = |found: Option<PathBuf>| found.filter(|path| path == work.path());
        assert_eq!(configured_only(locate_converters(folder)), None);
        File::create(work.path().join(executable("dwgwrite"))).unwrap();
        if std::env::var_os("LUMCAD_LIBREDWG_DIR").is_none() {
            // A wrong explicit folder never falls back to another installation.
            let missing = work.path().join("missing");
            assert_eq!(locate_converters(missing.to_str().unwrap()), None);
            assert_eq!(locate_converters(folder).as_deref(), Some(work.path()));
            assert_eq!(locate_libredwg(folder.into()).as_deref(), Some(folder));
        }
        assert_eq!(
            configured_only(locate_libredwg("relative/bin".into()).map(PathBuf::from)),
            None
        );
    }
}
