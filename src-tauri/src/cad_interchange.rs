//! Bounded DXF files and optional LibreDWG conversion, isolated from user files.
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const LIMIT: u64 = 128 * 1024 * 1024;
const DWG_INPUT_LIMIT: u64 = 64 * 1024 * 1024;

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
    // Validate the container without interpreting text values. DXF uses legacy
    // code pages as well as UTF-8; the frontend owns text decoding and reporting.
    let mut lines = bytes.trim_ascii_end().split(|byte| *byte == b'\n');
    let mut section = false;
    let mut eof = false;
    while let Some(raw_code) = lines.next() {
        let value = lines.next().ok_or("cadInvalid")?.trim_ascii();
        let code: u16 = std::str::from_utf8(raw_code.trim_ascii())
            .map_err(|_| "cadInvalid")?.parse().map_err(|_| "cadInvalid")?;
        if code > 1071 { return Err("cadInvalid".into()); }
        if eof {
            return Err("cadInvalid".into());
        }
        section |= code == 0 && value == b"SECTION";
        eof = code == 0 && value == b"EOF";
    }
    if !section || !eof {
        return Err("cadInvalid".into());
    }
    Ok(())
}

/// LibreDWG writes CRLF through fopen(..., "w"). Windows text-mode output
/// can expand each LF again, producing CRCRLF. Repair only converter output;
/// preserve empty DXF values, legacy text bytes and ordinary line endings.
fn normalize_converter_dxf(mut bytes: Vec<u8>) -> Vec<u8> {
    let mut read = 0;
    let mut write = 0;
    while read < bytes.len() {
        if bytes[read..].starts_with(b"\r\r\n") {
            bytes[write..write + 2].copy_from_slice(b"\r\n");
            read += 3;
            write += 2;
        } else {
            bytes[write] = bytes[read];
            read += 1;
            write += 1;
        }
    }
    bytes.truncate(write);
    bytes
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

/// Folder of a LibreDWG copy shipped in the application resources
/// (`<resources>/libredwg`, bundled by the Windows installer when available).
pub(crate) fn bundled_directory(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path().resource_dir().ok().map(|directory| directory.join("libredwg"))
}

/// Lookup order: LUMCAD_LIBREDWG_DIR, then the Settings folder when one is set,
/// otherwise the copy bundled with LUMCAD (`libredwg` and `libredwg/bin` in the
/// resources), PATH and standard folders. An explicit Settings folder is
/// authoritative: a wrong folder reports LibreDWG as missing instead of silently
/// using another installation. The first folder containing both converters
/// wins, so read and write use one installation.
fn locate_converters(configured: &str, bundled: Option<&Path>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = std::env::var_os("LUMCAD_LIBREDWG_DIR")
        .map(PathBuf::from)
        .into_iter()
        .collect();
    if !configured.is_empty() {
        candidates.push(PathBuf::from(configured));
    } else {
        if let Some(bundled) = bundled {
            candidates.push(bundled.to_path_buf());
            candidates.push(bundled.join("bin"));
        }
        if let Some(path) = std::env::var_os("PATH") {
            candidates.extend(std::env::split_paths(&path));
        }
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

fn convert(input: &[u8], to_dwg: bool, configured: &str, bundled: Option<&Path>) -> Result<Vec<u8>, String> {
    let directory = locate_converters(configured, bundled).ok_or("cadConverterMissing")?;
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
        Ok(bytes)
    } else {
        let bytes = normalize_converter_dxf(bytes);
        validate_dxf(&bytes)?;
        Ok(bytes)
    }
}

fn read_cad(path: &str, format: &str, configured: &str, bundled: Option<&Path>) -> Result<Vec<u8>, String> {
    validate_path(Path::new(path), format)?;
    let bytes = read_bounded(Path::new(path))?;
    if format == "dwg" {
        if bytes.len() as u64 > DWG_INPUT_LIMIT { return Err("cadLimit".into()); }
        if !bytes.starts_with(b"AC10") {
            return Err("cadInvalid".into());
        }
        convert(&bytes, false, configured, bundled)
    } else {
        Ok(bytes)
    }
}

fn write_cad(path: &str, format: &str, text: &str, configured: &str, bundled: Option<&Path>) -> Result<(), String> {
    validate_path(Path::new(path), format)?;
    validate_dxf(text.as_bytes())?;
    let bytes = if format == "dwg" {
        convert(text.as_bytes(), true, configured, bundled)?
    } else {
        text.as_bytes().to_vec()
    };
    crate::printing::atomic_write_plot_file(Path::new(path), &bytes).map(|_| ())
}

#[tauri::command]
pub async fn read_drawing_cad(
    app: tauri::AppHandle,
    path: String,
    format: String,
    settings: tauri::State<'_, crate::settings::AppSettingsState>,
) -> Result<tauri::ipc::Response, String> {
    let configured = configured_directory(&settings);
    let bundled = bundled_directory(&app);
    tauri::async_runtime::spawn_blocking(move || {
        read_cad(&path, &format, &configured, bundled.as_deref()).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|_| "cadConversionFailed".to_string())?
}

#[tauri::command]
pub async fn write_drawing_cad(
    app: tauri::AppHandle,
    path: String,
    format: String,
    text: String,
    settings: tauri::State<'_, crate::settings::AppSettingsState>,
) -> Result<(), String> {
    let configured = configured_directory(&settings);
    let bundled = bundled_directory(&app);
    tauri::async_runtime::spawn_blocking(move || write_cad(&path, &format, &text, &configured, bundled.as_deref()))
        .await
        .map_err(|_| "cadConversionFailed".to_string())?
}

/// Reports the LibreDWG folder that conversions would use with `directory` as the
/// Settings value. It only checks that the files exist; nothing is executed.
#[tauri::command]
pub fn locate_libredwg(app: tauri::AppHandle, directory: String) -> Option<String> {
    locate_libredwg_with(&directory, bundled_directory(&app).as_deref())
}

fn locate_libredwg_with(directory: &str, bundled: Option<&Path>) -> Option<String> {
    let configured = crate::settings::CadInterchangePreferences {
        libredwg_directory: directory.into(),
    }
    .normalized();
    locate_converters(&configured.libredwg_directory, bundled)
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn converter_dxf_repairs_windows_text_mode_without_changing_values() {
        let expected = b"999\r\nLibreDWG 0.14\r\n0\r\nSECTION\r\n2\r\nHEADER\r\n9\r\n$PROJECTNAME\r\n1\r\n\r\n0\r\nENDSEC\r\n0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nMTEXT\r\n1\r\n Caf\xe9 \r\n0\r\nENDSEC\r\n0\r\nEOF\r\n";
        let windows = expected.iter().flat_map(|byte| {
            if *byte == b'\n' { vec![b'\r', b'\n'] } else { vec![*byte] }
        }).collect();
        // Container validation alone already accepts CRCRLF; the frontend
        // would interpret its extra CR as an empty group line and reject it.
        let repaired = normalize_converter_dxf(windows);
        assert_eq!(repaired, expected);
        assert!(validate_dxf(&repaired).is_ok());
        assert_eq!(normalize_converter_dxf(expected.to_vec()), expected);
        let lf = b"0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n";
        assert_eq!(normalize_converter_dxf(lf.to_vec()), lf);
        assert!(normalize_converter_dxf(Vec::new()).is_empty());
    }

    #[test]
    fn dxf_container_validation_accepts_legacy_text_without_losing_bytes() {
        let bytes = b"0\nSECTION\n2\nENTITIES\n0\nMTEXT\n1\nCaf\xe9\n0\nENDSEC\n0\nEOF\n";
        assert!(validate_dxf(bytes).is_ok());
        assert!(validate_dxf(b"0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n0\nLINE\n").is_err());
        assert!(validate_dxf(b"0\nSECTION\n2\nENTITIES\nno-code\nvalue\n0\nEOF\n").is_err());
    }

    #[test]
    fn expanded_dxf_limit_does_not_expand_the_dwg_input_limit() {
        let work = tempfile::tempdir().unwrap();
        let dxf = work.path().join("large.dxf");
        File::create(&dxf).unwrap().set_len(DWG_INPUT_LIMIT + 1).unwrap();
        assert_eq!(read_bounded(&dxf).unwrap().len() as u64, DWG_INPUT_LIMIT + 1);
        let dwg = work.path().join("large.dwg");
        fs::rename(dxf, &dwg).unwrap();
        assert_eq!(read_cad(dwg.to_str().unwrap(), "dwg", "", None).unwrap_err(), "cadLimit");
    }
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
        assert!(write_cad(path.to_str().unwrap(), "dxf", "invalid", "", None).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        let text = "999\nLibreDWG comment\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n";
        write_cad(path.to_str().unwrap(), "dxf", text, "", None).unwrap();
        assert_eq!(
            read_cad(path.to_str().unwrap(), "dxf", "", None).unwrap(),
            text.as_bytes()
        );
    }
    #[test]
    fn converters_are_found_in_the_configured_folder_only_as_a_pair() {
        let work = tempfile::tempdir().unwrap();
        let folder = work.path().to_str().unwrap();
        File::create(work.path().join(executable("dwgread"))).unwrap();
        let configured_only = |found: Option<PathBuf>| found.filter(|path| path == work.path());
        assert_eq!(configured_only(locate_converters(folder, None)), None);
        File::create(work.path().join(executable("dwgwrite"))).unwrap();
        if std::env::var_os("LUMCAD_LIBREDWG_DIR").is_none() {
            // A wrong explicit folder never falls back to another installation.
            let missing = work.path().join("missing");
            assert_eq!(locate_converters(missing.to_str().unwrap(), None), None);
            assert_eq!(locate_converters(folder, None).as_deref(), Some(work.path()));
            assert_eq!(locate_libredwg_with(folder, None).as_deref(), Some(folder));
        }
        assert_eq!(
            configured_only(locate_libredwg_with("relative/bin", None).map(PathBuf::from)),
            None
        );
    }

    #[test]
    fn bundled_converters_follow_the_settings_folder_and_precede_path() {
        let bundled = tempfile::tempdir().unwrap();
        let nested = bundled.path().join("bin");
        fs::create_dir_all(&nested).unwrap();
        for name in ["dwgread", "dwgwrite"] {
            File::create(nested.join(executable(name))).unwrap();
        }
        let configured = tempfile::tempdir().unwrap();
        let folder = configured.path().to_str().unwrap();
        if std::env::var_os("LUMCAD_LIBREDWG_DIR").is_none() {
            // Automatic lookup: the copy shipped with LUMCAD (here in its bin folder) comes first.
            assert_eq!(locate_converters("", Some(bundled.path())).as_deref(), Some(nested.as_path()));
            // An explicit Settings folder stays authoritative, even when it is empty.
            assert_eq!(locate_converters(folder, Some(bundled.path())), None);
            for name in ["dwgread", "dwgwrite"] {
                File::create(configured.path().join(executable(name))).unwrap();
            }
            assert_eq!(locate_converters(folder, Some(bundled.path())).as_deref(), Some(configured.path()));
            assert_eq!(locate_libredwg_with("", Some(bundled.path())).map(PathBuf::from), Some(nested.clone()));
        }
        // A bundled folder holding a single converter is ignored.
        let partial = tempfile::tempdir().unwrap();
        File::create(partial.path().join(executable("dwgread"))).unwrap();
        assert_ne!(locate_converters("", Some(partial.path())).as_deref(), Some(partial.path()));
    }
}
