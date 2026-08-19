use std::{
    collections::HashSet,
    env,
    fs::{self, File, OpenOptions},
    io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const LCAD_FORMAT: &str = "lumcad";
const LCAD_FORMAT_VERSION: u64 = 2;
const LCAD_MIN_READABLE_FORMAT_VERSION: u64 = 1;
const LCAD_MANIFEST_PATH: &str = "manifest.json";
const LCAD_ASSET_DIRECTORY: &str = "assets/";
const RECOVERY_FILENAME: &str = "recovery.lcad";
const MAX_MANIFEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_ASSET_BYTES: usize = 25 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES: usize = 200 * 1024 * 1024;
const MAX_ASSET_COUNT: usize = 512;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageErrorPayload {
    code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_version: Option<u64>,
}

#[derive(Default)]
pub struct PendingOpen(Mutex<Option<PathBuf>>);

impl PendingOpen {
    pub fn remember(&self, path: PathBuf) {
        if let Ok(mut pending) = self.0.lock() {
            *pending = Some(path);
        }
    }

    fn take(&self) -> Option<PathBuf> {
        self.0.lock().ok()?.take()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDocument {
    path: Option<String>,
    envelope: Value,
    recovered: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    path: Option<String>,
    saved_at: u128,
    recovery: bool,
}

fn validate_envelope(envelope: &Value) -> Result<(), String> {
    let object = envelope
        .as_object()
        .ok_or_else(|| storage_error("invalid_json_object", None, None, None))?;

    if object.get("format").and_then(Value::as_str) != Some(LCAD_FORMAT) {
        return Err(storage_error("invalid_format", None, None, None));
    }

    if !object
        .get("formatVersion")
        .and_then(Value::as_u64)
        .is_some_and(|version| {
            (LCAD_MIN_READABLE_FORMAT_VERSION..=LCAD_FORMAT_VERSION).contains(&version)
        })
    {
        return Err(storage_error(
            "unsupported_version",
            None,
            None,
            Some(LCAD_FORMAT_VERSION),
        ));
    }

    if !object.get("document").is_some_and(Value::is_object) {
        return Err(storage_error("invalid_document", None, None, None));
    }

    Ok(())
}

fn read_envelope(path: &Path) -> Result<Value, String> {
    let mut file = File::open(path).map_err(|error| format_io_error("open_file", path, error))?;
    let mut signature = [0_u8; 4];
    let signature_length = file
        .read(&mut signature)
        .map_err(|error| format_io_error("open_file", path, error))?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| format_io_error("open_file", path, error))?;

    if !is_zip_signature(&signature[..signature_length]) {
        return Err(storage_error("invalid_archive", Some(path), None, None));
    }
    read_archive(BufReader::new(file), path)
}

fn read_archive(reader: BufReader<File>, path: &Path) -> Result<Value, String> {
    let mut archive = ZipArchive::new(reader).map_err(|error| {
        storage_error("invalid_archive", Some(path), Some(error.to_string()), None)
    })?;
    if archive.len() > MAX_ASSET_COUNT + 1 {
        return Err(storage_error("too_many_assets", Some(path), None, None));
    }

    let manifest_bytes = {
        let mut entry = archive.by_name(LCAD_MANIFEST_PATH).map_err(|error| {
            storage_error(
                "missing_manifest",
                Some(path),
                Some(error.to_string()),
                None,
            )
        })?;
        read_limited_entry(&mut entry, MAX_MANIFEST_BYTES, "manifest_too_large", path)?
    };
    let mut manifest: Value = serde_json::from_slice(&manifest_bytes).map_err(|error| {
        storage_error(
            "invalid_manifest",
            Some(path),
            Some(error.to_string()),
            None,
        )
    })?;
    validate_envelope(&manifest)?;

    let descriptors = archive_asset_descriptors(&manifest, path)?;
    let referenced_paths: HashSet<&str> = descriptors
        .iter()
        .map(|descriptor| descriptor.path.as_str())
        .collect();
    let mut archive_paths = HashSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| {
            storage_error("invalid_archive", Some(path), Some(error.to_string()), None)
        })?;
        let name = entry.name().to_string();
        if !archive_paths.insert(name.clone())
            || (name != LCAD_MANIFEST_PATH && !referenced_paths.contains(name.as_str()))
        {
            return Err(storage_error(
                "invalid_archive_entry",
                Some(path),
                Some(name),
                None,
            ));
        }
    }

    let mut total_asset_bytes = 0_usize;
    for descriptor in descriptors {
        let bytes = {
            let mut entry = archive.by_name(&descriptor.path).map_err(|error| {
                storage_error(
                    "missing_asset",
                    Some(path),
                    Some(format!("{}: {error}", descriptor.id)),
                    None,
                )
            })?;
            read_limited_entry(&mut entry, MAX_ASSET_BYTES, "asset_too_large", path)?
        };
        total_asset_bytes = total_asset_bytes.saturating_add(bytes.len());
        if total_asset_bytes > MAX_TOTAL_ASSET_BYTES {
            return Err(storage_error("asset_too_large", Some(path), None, None));
        }
        let link = format!(
            "data:{};base64,{}",
            descriptor.mime_type,
            BASE64.encode(bytes)
        );
        let asset = manifest
            .pointer_mut(&format!("/document/assets/{}", descriptor.index))
            .and_then(Value::as_object_mut)
            .ok_or_else(|| storage_error("invalid_asset", Some(path), Some(descriptor.id), None))?;
        asset.remove("path");
        asset.insert("link".into(), Value::String(link));
    }

    Ok(manifest)
}

#[derive(Debug)]
struct ArchiveAssetDescriptor {
    index: usize,
    id: String,
    path: String,
    mime_type: String,
}

fn archive_asset_descriptors(
    manifest: &Value,
    source_path: &Path,
) -> Result<Vec<ArchiveAssetDescriptor>, String> {
    let Some(assets) = manifest.pointer("/document/assets") else {
        return Ok(Vec::new());
    };
    let assets = assets.as_array().ok_or_else(|| {
        storage_error(
            "invalid_asset",
            Some(source_path),
            Some("assets".into()),
            None,
        )
    })?;
    if assets.len() > MAX_ASSET_COUNT {
        return Err(storage_error(
            "too_many_assets",
            Some(source_path),
            None,
            None,
        ));
    }

    let mut seen_paths = HashSet::new();
    assets
        .iter()
        .enumerate()
        .map(|(index, asset)| {
            let object = asset.as_object().ok_or_else(|| {
                storage_error(
                    "invalid_asset",
                    Some(source_path),
                    Some(format!("asset {index}")),
                    None,
                )
            })?;
            let id = object
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("?")
                .to_string();
            let asset_path = object
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let mime_type = object
                .get("mimeType")
                .and_then(Value::as_str)
                .and_then(normalize_image_mime_type)
                .ok_or_else(|| {
                    storage_error("invalid_asset", Some(source_path), Some(id.clone()), None)
                })?
                .to_string();
            if !is_safe_asset_path(&asset_path) || !seen_paths.insert(asset_path.clone()) {
                return Err(storage_error(
                    "invalid_asset",
                    Some(source_path),
                    Some(id),
                    None,
                ));
            }
            Ok(ArchiveAssetDescriptor {
                index,
                id,
                path: asset_path,
                mime_type,
            })
        })
        .collect()
}

fn prepare_archive(envelope: &Value) -> Result<(Value, Vec<(String, Vec<u8>)>), String> {
    validate_envelope(envelope)?;
    let mut manifest = envelope.clone();
    let document = manifest
        .get_mut("document")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| storage_error("invalid_document", None, None, None))?;
    let assets_value = document
        .entry("assets")
        .or_insert_with(|| Value::Array(Vec::new()));
    let assets = assets_value
        .as_array_mut()
        .ok_or_else(|| storage_error("invalid_asset", None, Some("assets".into()), None))?;
    if assets.len() > MAX_ASSET_COUNT {
        return Err(storage_error("too_many_assets", None, None, None));
    }

    let mut archived_assets = Vec::with_capacity(assets.len());
    let mut total_asset_bytes = 0_usize;
    for (index, asset) in assets.iter_mut().enumerate() {
        let object = asset.as_object_mut().ok_or_else(|| {
            storage_error("invalid_asset", None, Some(format!("asset {index}")), None)
        })?;
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("?")
            .to_string();
        let link = object
            .get("link")
            .and_then(Value::as_str)
            .ok_or_else(|| storage_error("invalid_asset", None, Some(id.clone()), None))?;
        let (mime_type, bytes) = decode_image_data_url(link).map_err(|detail| {
            storage_error("invalid_asset", None, Some(format!("{id}: {detail}")), None)
        })?;
        let mime_type = mime_type.to_string();
        total_asset_bytes = total_asset_bytes.saturating_add(bytes.len());
        if bytes.len() > MAX_ASSET_BYTES || total_asset_bytes > MAX_TOTAL_ASSET_BYTES {
            return Err(storage_error("asset_too_large", None, Some(id), None));
        }
        let archive_path = archive_asset_path(&id, index, &mime_type);
        object.remove("link");
        object.insert("mimeType".into(), Value::String(mime_type));
        object.insert("path".into(), Value::String(archive_path.clone()));
        archived_assets.push((archive_path, bytes));
    }

    Ok((manifest, archived_assets))
}

fn write_archive<W: Write + Seek>(
    writer: W,
    manifest: &Value,
    assets: &[(String, Vec<u8>)],
) -> Result<W, String> {
    let mut manifest_bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| storage_error("serialize_drawing", None, Some(error.to_string()), None))?;
    manifest_bytes.push(b'\n');
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(storage_error("manifest_too_large", None, None, None));
    }

    let manifest_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(6));
    let asset_options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let mut archive = ZipWriter::new(writer);
    archive
        .start_file(LCAD_MANIFEST_PATH, manifest_options)
        .map_err(|error| storage_error("serialize_drawing", None, Some(error.to_string()), None))?;
    archive
        .write_all(&manifest_bytes)
        .map_err(|error| storage_error("serialize_drawing", None, Some(error.to_string()), None))?;
    for (asset_path, bytes) in assets {
        archive
            .start_file(asset_path, asset_options)
            .map_err(|error| {
                storage_error("serialize_drawing", None, Some(error.to_string()), None)
            })?;
        archive.write_all(bytes).map_err(|error| {
            storage_error("serialize_drawing", None, Some(error.to_string()), None)
        })?;
    }
    archive
        .finish()
        .map_err(|error| storage_error("finalize_file", None, Some(error.to_string()), None))
}

fn normalized_save_path(path: PathBuf) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err(storage_error("no_save_path", None, None, None));
    }

    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("lcad"))
    {
        return Ok(path);
    }

    Ok(path.with_extension("lcad"))
}

pub fn is_lcad_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("lcad"))
}

fn atomic_write(path: &Path, envelope: &Value) -> Result<(), String> {
    let (manifest, assets) = prepare_archive(envelope)?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|error| format_io_error("create_folder", parent, error))?;

    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("drawing.lcad");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary_path = parent.join(format!(".{filename}.{}.{}.tmp", std::process::id(), nonce));

    let write_result = (|| -> Result<(), String> {
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .map_err(|error| format_io_error("create_temporary_file", &temporary_path, error))?;
        let writer = BufWriter::new(file);
        let mut writer = write_archive(writer, &manifest, &assets)?;
        writer
            .flush()
            .map_err(|error| format_io_error("finalize_file", &temporary_path, error))?;
        writer
            .get_ref()
            .sync_all()
            .map_err(|error| format_io_error("sync_file", &temporary_path, error))?;

        replace_file(&temporary_path, path)
            .map_err(|error| format_io_error("replace_file", path, error))?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
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

fn recovery_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(RECOVERY_FILENAME))
        .map_err(|error| storage_error("recovery_directory", None, Some(error.to_string()), None))
}

fn remove_recovery(app: &AppHandle) -> Result<(), String> {
    let path = recovery_path(app)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format_io_error("remove_recovery", &path, error)),
    }
}

fn load_from_path(path: &Path, recovered: bool) -> Result<LoadedDocument, String> {
    Ok(LoadedDocument {
        path: if recovered {
            None
        } else {
            Some(path.to_string_lossy().into_owned())
        },
        envelope: read_envelope(path)?,
        recovered,
    })
}

fn saved_at_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn is_zip_signature(signature: &[u8]) -> bool {
    signature.len() >= 4
        && signature[0] == 0x50
        && signature[1] == 0x4b
        && matches!(
            (signature[2], signature[3]),
            (0x03, 0x04) | (0x05, 0x06) | (0x07, 0x08)
        )
}

fn read_limited_entry<R: Read>(
    reader: &mut R,
    maximum: usize,
    error_code: &'static str,
    path: &Path,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take((maximum + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            storage_error("invalid_archive", Some(path), Some(error.to_string()), None)
        })?;
    if bytes.len() > maximum {
        return Err(storage_error(error_code, Some(path), None, None));
    }
    Ok(bytes)
}

fn archive_asset_path(id: &str, index: usize, mime_type: &str) -> String {
    let mut stem = id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(['-', '.'])
        .chars()
        .take(96)
        .collect::<String>();
    if stem.is_empty() {
        stem = format!("asset-{}", index + 1);
    }
    format!(
        "{LCAD_ASSET_DIRECTORY}{:04}-{stem}.{}",
        index + 1,
        image_extension(mime_type)
    )
}

fn decode_image_data_url(value: &str) -> Result<(&str, Vec<u8>), String> {
    let body = value
        .strip_prefix("data:")
        .ok_or_else(|| "not a data URL".to_string())?;
    let (header, payload) = body
        .split_once(',')
        .ok_or_else(|| "data URL payload is missing".to_string())?;
    let mut components = header.split(';');
    let mime_type = components
        .next()
        .and_then(normalize_image_mime_type)
        .ok_or_else(|| "unsupported image type".to_string())?;
    let is_base64 = components.any(|component| component.eq_ignore_ascii_case("base64"));
    let bytes = if is_base64 {
        BASE64
            .decode(
                payload
                    .bytes()
                    .filter(|byte| !byte.is_ascii_whitespace())
                    .collect::<Vec<_>>(),
            )
            .map_err(|error| error.to_string())?
    } else {
        percent_decode(payload)?
    };
    Ok((mime_type, bytes))
}

fn percent_decode(value: &str) -> Result<Vec<u8>, String> {
    let source = value.as_bytes();
    let mut bytes = Vec::with_capacity(source.len());
    let mut index = 0;
    while index < source.len() {
        if source[index] == b'%' {
            if index + 2 >= source.len() {
                return Err("truncated percent escape".into());
            }
            let high =
                hex_digit(source[index + 1]).ok_or_else(|| "invalid percent escape".to_string())?;
            let low =
                hex_digit(source[index + 2]).ok_or_else(|| "invalid percent escape".to_string())?;
            bytes.push(high * 16 + low);
            index += 3;
        } else {
            bytes.push(source[index]);
            index += 1;
        }
    }
    Ok(bytes)
}

fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn normalize_image_mime_type(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("image/png"),
        "image/jpeg" => Some("image/jpeg"),
        "image/jpg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        "image/svg+xml" => Some("image/svg+xml"),
        _ => None,
    }
}

fn image_extension(mime_type: &str) -> &'static str {
    match mime_type {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        _ => "bin",
    }
}

fn is_safe_asset_path(value: &str) -> bool {
    value.starts_with(LCAD_ASSET_DIRECTORY)
        && value.len() > LCAD_ASSET_DIRECTORY.len()
        && !value.contains('\\')
        && !value.contains("//")
        && !value.split('/').any(|component| component == "..")
}

fn format_io_error(code: &'static str, path: &Path, error: io::Error) -> String {
    storage_error(code, Some(path), Some(error.to_string()), None)
}

fn storage_error(
    code: &'static str,
    path: Option<&Path>,
    detail: Option<String>,
    expected_version: Option<u64>,
) -> String {
    serde_json::to_string(&StorageErrorPayload {
        code,
        path: path.map(|value| value.to_string_lossy().into_owned()),
        detail,
        expected_version,
    })
    .expect("serializing a LUMCAD storage error cannot fail")
}

#[tauri::command]
pub fn read_lcad_document(path: String) -> Result<LoadedDocument, String> {
    load_from_path(Path::new(&path), false)
}

#[tauri::command]
pub fn write_lcad_document(
    app: AppHandle,
    path: String,
    envelope: Value,
) -> Result<SaveResult, String> {
    let target = normalized_save_path(PathBuf::from(path))?;
    atomic_write(&target, &envelope)?;
    remove_recovery(&app)?;
    Ok(SaveResult {
        path: Some(target.to_string_lossy().into_owned()),
        saved_at: saved_at_millis(),
        recovery: false,
    })
}

#[tauri::command]
pub fn autosave_lcad_document(
    app: AppHandle,
    current_path: Option<String>,
    envelope: Value,
) -> Result<SaveResult, String> {
    if let Some(path) = current_path.filter(|path| !path.trim().is_empty()) {
        let target = normalized_save_path(PathBuf::from(path))?;
        atomic_write(&target, &envelope)?;
        remove_recovery(&app)?;
        return Ok(SaveResult {
            path: Some(target.to_string_lossy().into_owned()),
            saved_at: saved_at_millis(),
            recovery: false,
        });
    }

    let target = recovery_path(&app)?;
    atomic_write(&target, &envelope)?;
    Ok(SaveResult {
        path: None,
        saved_at: saved_at_millis(),
        recovery: true,
    })
}

#[tauri::command]
pub fn load_startup_document(
    app: AppHandle,
    pending_open: tauri::State<'_, PendingOpen>,
) -> Result<Option<LoadedDocument>, String> {
    if let Some(path) = pending_open.take() {
        return load_from_path(&path, false).map(Some);
    }
    if let Some(path) = env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| is_lcad_path(path))
    {
        return load_from_path(&path, false).map(Some);
    }

    let recovery = recovery_path(&app)?;
    if recovery.exists() {
        return load_from_path(&recovery, true).map(Some);
    }
    Ok(None)
}

#[tauri::command]
pub fn clear_recovery(app: AppHandle) -> Result<(), String> {
    remove_recovery(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PIXEL_DATA_URL: &str = "data:image/png;base64,iVBORw0KGgo=";

    fn valid_envelope(name: &str) -> Value {
        json!({
            "format": "lumcad",
            "formatVersion": 2,
            "appVersion": "0.1.0",
            "document": { "name": name, "content": {}, "assets": [] }
        })
    }

    fn envelope_with_asset(name: &str) -> Value {
        json!({
            "format": "lumcad",
            "formatVersion": 2,
            "appVersion": "0.1.0",
            "document": {
                "name": name,
                "content": {},
                "assets": [{
                    "id": "roof/reference",
                    "name": "roof.png",
                    "mimeType": "image/png",
                    "width": 1,
                    "height": 1,
                    "link": PIXEL_DATA_URL
                }]
            }
        })
    }

    #[test]
    fn validates_the_current_lcad_envelope() {
        assert!(validate_envelope(&valid_envelope("Plan")).is_ok());
        assert!(validate_envelope(
            &json!({ "format": "lumcad", "formatVersion": 1, "document": {} })
        )
        .is_ok());
        assert!(validate_envelope(
            &json!({ "format": "lumcad", "formatVersion": 3, "document": {} })
        )
        .is_err());
        assert!(validate_envelope(
            &json!({ "format": "other", "formatVersion": 1, "document": {} })
        )
        .is_err());
    }

    #[test]
    fn enforces_lcad_extension() {
        assert_eq!(
            normalized_save_path(PathBuf::from("plan")).unwrap(),
            PathBuf::from("plan.lcad")
        );
        assert_eq!(
            normalized_save_path(PathBuf::from("plan.json")).unwrap(),
            PathBuf::from("plan.lcad")
        );
        assert_eq!(
            normalized_save_path(PathBuf::from("plan.LCAD")).unwrap(),
            PathBuf::from("plan.LCAD")
        );
    }

    #[test]
    fn writes_a_zip_archive_and_hydrates_embedded_assets() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("plan.lcad");
        atomic_write(&path, &envelope_with_asset("Plan")).unwrap();

        let bytes = fs::read(&path).unwrap();
        assert!(is_zip_signature(&bytes[..4]));
        let mut archive = ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let manifest: Value = {
            let entry = archive.by_name(LCAD_MANIFEST_PATH).unwrap();
            serde_json::from_reader(entry).unwrap()
        };
        assert_eq!(manifest["formatVersion"], 2);
        assert!(manifest["document"]["assets"][0].get("link").is_none());
        assert_eq!(
            manifest["document"]["assets"][0]["path"],
            "assets/0001-roof-reference.png"
        );

        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["assets"][0]["link"], PIXEL_DATA_URL);
    }

    #[test]
    fn rejects_non_zip_lcad_data() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("invalid.lcad");
        fs::write(&path, b"{\"format\":\"lumcad\"}").unwrap();

        let error = read_envelope(&path).unwrap_err();
        assert!(error.contains("invalid_archive"));
    }

    #[test]
    fn writes_and_replaces_a_complete_document_atomically() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("plan.lcad");
        atomic_write(&path, &valid_envelope("Premier")).unwrap();
        atomic_write(&path, &valid_envelope("Second")).unwrap();

        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["name"], "Second");
        assert!(directory.path().read_dir().unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
    }
}
