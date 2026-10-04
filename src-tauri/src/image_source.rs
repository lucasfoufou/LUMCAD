use std::{fs::File, io::Read, path::Path};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;

const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSource {
    path: String,
    name: String,
    mime_type: &'static str,
    link: String,
}

fn error(code: &str) -> String {
    serde_json::json!({ "code": code }).to_string()
}

#[tauri::command]
pub fn read_image_source(path: String) -> Result<ImageSource, String> {
    let path = Path::new(&path);
    if !path.is_absolute() {
        return Err(error("image_source_failed"));
    }
    let path = path.canonicalize().map_err(|_| error("image_source_failed"))?;
    if !path.is_file() {
        return Err(error("image_source_failed"));
    }
    let file = File::open(&path).map_err(|_| error("image_source_failed"))?;
    let metadata = file.metadata().map_err(|_| error("image_source_failed"))?;
    if !metadata.is_file() {
        return Err(error("image_source_failed"));
    }
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err(error("asset_too_large"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES + 1).read_to_end(&mut bytes).map_err(|_| error("image_source_failed"))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(error("asset_too_large"));
    }
    let extension = path.extension().and_then(|part| part.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime_type = image_mime_type(&bytes, &extension).ok_or_else(|| error("image_source_failed"))?;
    Ok(ImageSource {
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
