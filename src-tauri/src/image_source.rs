use std::{fs::File, io::Read, path::Path};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;

const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSource {
    path: String,
    name: String,
    mime_type: &'static str,
    link: String,
}

fn error(code: &str) -> String {
    serde_json::json!({ "code": code }).to_string()
}

#[tauri::command]
pub fn read_image_source(path: String) -> Result<ReferenceSource, String> {
    read_reference_source(path, SourceKind::Image)
}

#[tauri::command]
pub fn read_pdf_source(path: String) -> Result<ReferenceSource, String> {
    read_reference_source(path, SourceKind::Pdf)
}

#[tauri::command]
pub fn read_shx_source(path: String) -> Result<ReferenceSource, String> {
    read_reference_source(path, SourceKind::Shx)
}

#[tauri::command]
pub fn read_dwfx_source(path: String) -> Result<ReferenceSource, String> {
    read_reference_source(path, SourceKind::Dwfx)
}

enum SourceKind { Image, Pdf, Shx, Dwfx }

fn read_reference_source(path: String, kind: SourceKind) -> Result<ReferenceSource, String> {
    let failure = match kind { SourceKind::Image => "image_source_failed", SourceKind::Pdf => "pdf_source_failed", SourceKind::Shx => "shx_source_failed", SourceKind::Dwfx => "dwfx_source_failed" };
    let max_bytes = if matches!(kind, SourceKind::Shx) { 4 * 1024 * 1024 } else { MAX_IMAGE_BYTES };
    let path = Path::new(&path);
    if !path.is_absolute() {
        return Err(error(failure));
    }
    let path = path.canonicalize().map_err(|_| error(failure))?;
    if !path.is_file() {
        return Err(error(failure));
    }
    let file = File::open(&path).map_err(|_| error(failure))?;
    let metadata = file.metadata().map_err(|_| error(failure))?;
    if !metadata.is_file() {
        return Err(error(failure));
    }
    if metadata.len() > max_bytes {
        return Err(error("asset_too_large"));
    }
    let mut bytes = Vec::new();
    file.take(max_bytes + 1).read_to_end(&mut bytes).map_err(|_| error(failure))?;
    if bytes.len() as u64 > max_bytes {
        return Err(error("asset_too_large"));
    }
    let extension = path.extension().and_then(|part| part.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime_type = if matches!(kind, SourceKind::Pdf) {
        if extension != "pdf" || !bytes.iter().take(1024).copied().collect::<Vec<_>>().windows(5).any(|part| part == b"%PDF-") {
            return Err(error(failure));
        }
        "application/pdf"
    } else if matches!(kind, SourceKind::Dwfx) {
        // Detailed OPC/XPS validation occurs in the bounded document reader.
        if extension != "dwfx" || !bytes.starts_with(b"PK\x03\x04") {
            return Err(error(failure));
        }
        "model/vnd.dwfx+xps"
    } else if matches!(kind, SourceKind::Shx) {
        let valid = (extension == "shx" && bytes.starts_with(b"AutoCAD-86 "))
            || (extension == "shp" && std::str::from_utf8(&bytes).is_ok_and(|text| text.lines().any(|line| line.trim_start().starts_with('*'))));
        if !valid { return Err(error(failure)); }
        "application/octet-stream"
    } else { image_mime_type(&bytes, &extension).ok_or_else(|| error(failure))? };
    Ok(ReferenceSource {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        mime_type,
        link: format!("data:{mime_type};base64,{}", BASE64.encode(bytes)),
    })
}

fn image_mime_type(bytes: &[u8], extension: &str) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { return Some("image/png"); }
    if bytes.starts_with(b"\xff\xd8\xff") { return Some("image/jpeg"); }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { return Some("image/gif"); }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { return Some("image/webp"); }
    if extension == "svg" {
        let text = std::str::from_utf8(bytes).ok()?.trim_start_matches('\u{feff}').trim_start();
        if text.starts_with("<svg") || (text.starts_with("<?xml") && text.contains("<svg")) {
            return Some("image/svg+xml");
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_bounded_local_shape_fonts_without_accepting_other_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("font.shp");
        let bytes = b"*0,4,fixture\n10,2,0,0\n*65,4,A\n8,5,5,0";
        std::fs::write(&path, bytes).unwrap();
        let result = read_shx_source(path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.mime_type, "application/octet-stream");
        assert_eq!(result.link, format!("data:application/octet-stream;base64,{}", BASE64.encode(bytes)));
        assert!(read_shx_source("relative.shx".into()).is_err());
        std::fs::write(&path, b"not a font").unwrap();
        assert!(read_shx_source(path.to_string_lossy().into_owned()).is_err());
        File::create(&path).unwrap().set_len(4 * 1024 * 1024 + 1).unwrap();
        assert!(read_shx_source(path.to_string_lossy().into_owned()).unwrap_err().contains("asset_too_large"));
    }

    #[test]
    fn reads_dwfx_snapshots_with_the_same_asset_limits_and_separate_image_validation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.dwfx");
        let bytes = b"PK\x03\x04source snapshot";
        std::fs::write(&path, bytes).unwrap();
        let result = read_dwfx_source(path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.mime_type, "model/vnd.dwfx+xps");
        assert_eq!(result.link, format!("data:model/vnd.dwfx+xps;base64,{}", BASE64.encode(bytes)));
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert!(read_image_source(path.to_string_lossy().into_owned()).is_err());
        assert!(read_dwfx_source("relative.dwfx".into()).is_err());
        std::fs::write(&path, b"not a package").unwrap();
        assert!(read_dwfx_source(path.to_string_lossy().into_owned()).is_err());
        File::create(&path).unwrap().set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert!(read_dwfx_source(path.to_string_lossy().into_owned()).unwrap_err().contains("asset_too_large"));
    }

    #[test]
    fn reads_pdf_sources_without_accepting_them_as_images() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.pdf");
        let bytes = b"%PDF-1.7\n%%EOF";
        std::fs::write(&path, bytes).unwrap();
        let result = read_pdf_source(path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.mime_type, "application/pdf");
        assert_eq!(result.path, path.canonicalize().unwrap().to_string_lossy());
        assert_eq!(result.link, format!("data:application/pdf;base64,{}", BASE64.encode(bytes)));
        assert!(read_image_source(path.to_string_lossy().into_owned()).is_err());
        std::fs::write(&path, b"not a PDF").unwrap();
        assert!(read_pdf_source(path.to_string_lossy().into_owned()).is_err());
        assert!(read_pdf_source("relative.pdf".into()).is_err());
        File::create(&path).unwrap().set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert!(read_pdf_source(path.to_string_lossy().into_owned()).unwrap_err().contains("asset_too_large"));
    }

    #[test]
    fn reads_snapshot_and_canonical_path_without_writing_source() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("reference.png");
        let bytes = include_bytes!("../icons/128x128.png");
        std::fs::write(&path, bytes).unwrap();
        let result = read_image_source(path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.mime_type, "image/png");
        assert_eq!(result.path, path.canonicalize().unwrap().to_string_lossy());
        assert!(result.link.starts_with("data:image/png;base64,"));
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn rejects_missing_nonimage_directory_relative_and_oversized_sources() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("wrong.png");
        assert!(read_image_source(path.to_string_lossy().into_owned()).is_err());
        assert!(read_image_source(dir.path().to_string_lossy().into_owned()).is_err());
        assert!(read_image_source("relative.png".into()).is_err());
        std::fs::write(&path, b"not an image").unwrap();
        assert!(read_image_source(path.to_string_lossy().into_owned()).is_err());
        File::create(&path).unwrap().set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert!(read_image_source(path.to_string_lossy().into_owned()).unwrap_err().contains("asset_too_large"));
    }
}
