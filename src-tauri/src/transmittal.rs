use std::{collections::HashSet, io::{Cursor, Read}, path::Path};
use zip::ZipArchive;

const MAX_BYTES: usize = 300 * 1024 * 1024;

fn validate(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES { return Err("Invalid transmittal size".into()); }
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    if archive.len() < 3 || archive.len() > 514 { return Err("Invalid transmittal file count".into()); }
    let mut paths = HashSet::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_owned();
        let root = name == "sheet-set.json" || name == "transmittal.json";
        let drawing = name.strip_prefix("drawings/file-").is_some_and(|tail| {
            tail.rsplit_once('.').is_some_and(|(number, extension)| !number.is_empty()
                && number.bytes().all(|c| c.is_ascii_digit()) && ["lcad", "csv"].contains(&extension))
        });
        if (!root && !drawing) || entry.encrypted() || entry.is_symlink() || entry.is_dir() || !paths.insert(name.clone()) {
            return Err("Unsafe transmittal entry".into());
        }
        total = total.checked_add(entry.size()).filter(|size| *size <= MAX_BYTES as u64).ok_or("Transmittal exceeds size limit")?;
        if root {
            if entry.size() > 4 * 1024 * 1024 { return Err("Transmittal index exceeds size limit".into()); }
            let mut text = String::new();
            entry.by_ref().take(4 * 1024 * 1024 + 1).read_to_string(&mut text).map_err(|e| e.to_string())?;
            let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let format = if name == "sheet-set.json" { "lumcad-sheet-set" } else { "lumcad-transmittal" };
            if json["format"] != format || json["version"] != 1 { return Err("Invalid transmittal index".into()); }
        }
    }
    if !paths.contains("sheet-set.json") || !paths.contains("transmittal.json") { return Err("Missing transmittal index".into()); }
    Ok(())
}

#[tauri::command]
pub fn write_drawing_transmittal(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.is_absolute() || !target.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("zip")) {
        return Err("Transmittal requires an absolute ZIP destination".into());
    }
    validate(&bytes)?;
    crate::storage::write_metadata_atomic(target, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn package(extra: &str) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, text) in [("sheet-set.json", r#"{"format":"lumcad-sheet-set","version":1}"#),
            ("transmittal.json", r#"{"format":"lumcad-transmittal","version":1}"#), (extra, "sample")] {
            zip.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }
    #[test]
    fn writes_only_bounded_safe_zip_packages_and_preserves_existing_output_on_failure() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("project.zip").to_string_lossy().into_owned();
        let bytes = package("drawings/file-1.csv");
        write_drawing_transmittal(path.clone(), bytes.clone()).unwrap();
        for bad in [package("../escape.csv"), package("drawings/file-1.exe"), b"bad zip".to_vec()] {
            assert!(write_drawing_transmittal(path.clone(), bad).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
        assert!(write_drawing_transmittal("relative.zip".into(), bytes.clone()).is_err());
        assert!(write_drawing_transmittal(directory.path().join("original.lcad").to_string_lossy().into_owned(), bytes).is_err());
    }
}
