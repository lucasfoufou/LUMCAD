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
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const LCAD_FORMAT: &str = "lumcad";
const LCAD_FORMAT_VERSION: u64 = 2;
const LCAD_MIN_READABLE_FORMAT_VERSION: u64 = 1;
const LCAD_MANIFEST_PATH: &str = "manifest.json";
const LCAD_ASSET_DIRECTORY: &str = "assets/";
const RECOVERY_FILENAME: &str = "recovery.lcad";
const MAX_MANIFEST_BYTES: usize = 64 * 1024 * 1024;
const MAX_ASSET_BYTES: usize = 25 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES: usize = 200 * 1024 * 1024;
const MAX_ASSET_COUNT: usize = 512;
const MAX_REFERENCE_BYTES: u64 = 300 * 1024 * 1024;
static DOCUMENT_WRITE_LOCK: Mutex<()> = Mutex::new(());

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
    let mut manifest_bytes = serde_json::to_vec(manifest)
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
    atomic_write_checked(path, envelope, None)
}

/// Small sidecar metadata uses the same synchronized temporary-file replacement as drawings.
pub(crate) fn write_metadata_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| storage_error("create_folder", Some(path), None, None))?;
    fs::create_dir_all(parent).map_err(|error| format_io_error("create_folder", parent, error))?;
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let temporary = parent.join(format!(".metadata.{}.{}.tmp", std::process::id(), nonce));
    let result = (|| {
        let mut file = OpenOptions::new().create_new(true).write(true).open(&temporary)
            .map_err(|error| format_io_error("create_temporary_file", &temporary, error))?;
        file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|error| format_io_error("sync_file", &temporary, error))?;
        replace_file(&temporary, path).map_err(|error| format_io_error("replace_file", path, error))
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

fn atomic_write_checked(path: &Path, envelope: &Value, revision: Option<&str>) -> Result<(), String> {
    let _guard = DOCUMENT_WRITE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
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

        if let Some(expected) = revision {
            if reference_revision(path)? != expected {
                return Err(storage_error("reference_changed", Some(path), None, None));
            }
        }
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
        "application/pdf" => Some("application/pdf"),
        "model/vnd.dwfx+xps" => Some("model/vnd.dwfx+xps"),
        "image/vnd.dgn" => Some("image/vnd.dgn"),
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
        "application/pdf" => "pdf",
        "model/vnd.dwfx+xps" => "dwfx",
        "image/vnd.dgn" => "dgn",
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
pub fn read_table_csv(path: String) -> Result<String, String> {
    read_bounded_utf8(&path, "csv")
}

#[tauri::command]
pub fn read_drawing_wmf(path: String) -> Result<tauri::ipc::Response, String> {
    read_wmf_bytes(Path::new(&path)).map(tauri::ipc::Response::new)
}

#[tauri::command]
pub fn read_drawing_dgn(path: String) -> Result<tauri::ipc::Response, String> {
    read_interchange_bytes(Path::new(&path), "dgn").map(tauri::ipc::Response::new)
}

fn read_wmf_bytes(path: &Path) -> Result<Vec<u8>, String> {
    read_interchange_bytes(path, "wmf")
}

fn read_interchange_bytes(path: &Path, format: &str) -> Result<Vec<u8>, String> {
    let invalid = format!("{format}Invalid");
    let limit_error = format!("{format}Limit");
    const LIMIT: u64 = 64 * 1024 * 1024;
    if !path.is_absolute() || !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case(format)) {
        return Err(invalid.clone());
    }
    let file = File::open(path).map_err(|_| invalid.clone())?;
    let metadata = file.metadata().map_err(|_| invalid.clone())?;
    if !metadata.is_file() { return Err(invalid.clone()); }
    if metadata.len() > LIMIT { return Err(limit_error.clone()); }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut bytes).map_err(|_| invalid.clone())?;
    if bytes.len() as u64 > LIMIT { return Err(limit_error.clone()); }
    Ok(bytes)
}

#[tauri::command]
pub fn read_standards_json(path: String) -> Result<String, String> {
    read_drawing_json(path)
}

#[tauri::command]
pub fn read_drawing_json(path: String) -> Result<String, String> {
    let text = read_bounded_utf8(&path, "json")?;
    serde_json::from_str::<serde_json::Value>(&text).map_err(|_| "importInvalid")?;
    Ok(text)
}

fn read_bounded_utf8(path: &str, extension: &str) -> Result<String, String> {
    let target = Path::new(&path);
    if !target.is_absolute() || !target.extension().is_some_and(|value| value.eq_ignore_ascii_case(extension)) {
        return Err("importInvalid".into());
    }
    let file = File::open(target).map_err(|_| "importInvalid")?;
    let metadata = file.metadata().map_err(|_| "importInvalid")?;
    const LIMIT: u64 = 4 * 1024 * 1024;
    if !metadata.is_file() || metadata.len() > LIMIT { return Err("importInvalid".into()); }
    let mut text = String::new();
    file.take(LIMIT + 1).read_to_string(&mut text).map_err(|_| "importInvalid")?;
    if text.len() as u64 > LIMIT { return Err("importInvalid".into()); }
    Ok(text)
}

#[tauri::command]
pub fn read_lcad_document(path: String) -> Result<LoadedDocument, String> {
    load_from_path(Path::new(&path), false)
}

// Recovery must see the original bytes before ZIP validation or normalization.
// This read-only entry point never changes the active file or recovery snapshot.
#[tauri::command]
pub fn read_lcad_recovery_source(path: String, protected_path: Option<String>, max_bytes: Option<u64>) -> Result<tauri::ipc::Response, String> {
    if let Some(protected) = protected_path {
        ensure_distinct_drawing_path(Path::new(&path), Path::new(&protected))?;
    }
    read_recovery_bytes(Path::new(&path), max_bytes.unwrap_or(MAX_REFERENCE_BYTES).min(MAX_REFERENCE_BYTES)).map(tauri::ipc::Response::new)
}

#[tauri::command]
pub fn resolve_lcad_recovery_path(path: String, relative_to: Option<String>) -> Result<String, String> {
    resolve_dependency_path(path, relative_to, "lcad")
}

#[tauri::command]
pub fn resolve_table_csv_path(path: String, relative_to: Option<String>) -> Result<String, String> {
    resolve_dependency_path(path, relative_to, "csv")
}

fn resolve_dependency_path(path: String, relative_to: Option<String>, extension: &str) -> Result<String, String> {
    let mut target = PathBuf::from(path);
    if !target.is_absolute() {
        let parent = relative_to.as_deref().map(Path::new).filter(|value| value.is_absolute())
            .and_then(Path::parent).ok_or_else(|| storage_error("invalid_format", Some(&target), None, None))?;
        target = parent.join(target);
    }
    let supported = |path: &Path| path.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case(extension));
    if !supported(&target) { return Err(storage_error("invalid_format", Some(&target), None, None)); }
    let canonical = fs::canonicalize(&target).map_err(|error| format_io_error("open_file", &target, error))?;
    if !supported(&canonical) { return Err(storage_error("invalid_format", Some(&canonical), None, None)); }
    Ok(canonical.to_string_lossy().into_owned())
}

fn read_recovery_bytes(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    if !path.is_absolute() || !is_lcad_path(path) {
        return Err(storage_error("invalid_format", Some(path), None, None));
    }
    let file = File::open(path).map_err(|error| format_io_error("open_file", path, error))?;
    let metadata = file.metadata().map_err(|error| format_io_error("open_file", path, error))?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err(storage_error("reference_too_large", Some(path), None, None));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)
        .map_err(|error| format_io_error("open_file", path, error))?;
    if bytes.len() as u64 > limit {
        return Err(storage_error("reference_too_large", Some(path), None, None));
    }
    Ok(bytes)
}

#[derive(Debug, Serialize)]
pub struct LoadedReference {
    loaded: LoadedDocument,
    revision: String,
}

fn reference_path(path: &str) -> Result<PathBuf, String> {
    let target = Path::new(path);
    if !is_lcad_path(target) {
        return Err(storage_error("invalid_format", Some(target), None, None));
    }
    fs::canonicalize(target).map_err(|error| format_io_error("open_file", target, error))
}

fn reference_revision(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|error| format_io_error("open_file", path, error))?;
    let mut reader = BufReader::new(file).take(MAX_REFERENCE_BYTES + 1);
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut size = 0_u64;
    loop {
        let count = reader.read(&mut buffer)
            .map_err(|error| format_io_error("open_file", path, error))?;
        if count == 0 { break; }
        size += count as u64;
        if size > MAX_REFERENCE_BYTES {
            return Err(storage_error("reference_too_large", Some(path), None, None));
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[tauri::command]
pub fn read_lcad_reference(path: String) -> Result<LoadedReference, String> {
    let target = reference_path(&path)?;
    let revision = reference_revision(&target)?;
    let loaded = load_from_path(&target, false)?;
    if reference_revision(&target)? != revision {
        return Err(storage_error("reference_changed", Some(&target), None, None));
    }
    Ok(LoadedReference { loaded, revision })
}

#[tauri::command]
pub fn write_lcad_reference(path: String, envelope: Value, expected_revision: String) -> Result<LoadedReference, String> {
    let target = reference_path(&path)?;
    if expected_revision.len() != 64 || !expected_revision.bytes().all(|value| value.is_ascii_hexdigit()) {
        return Err(storage_error("reference_changed", Some(&target), None, None));
    }
    atomic_write_checked(&target, &envelope, Some(&expected_revision))?;
    read_lcad_reference(target.to_string_lossy().into_owned())
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
pub fn export_lcad_document(path: String, envelope: Value, protected_path: Option<String>, protected_paths: Option<Vec<String>>) -> Result<SaveResult, String> {
    let target = normalized_save_path(PathBuf::from(path))?;
    if let Some(protected) = protected_path {
        ensure_distinct_drawing_path(&target, Path::new(&protected))?;
    }
    if let Some(paths) = protected_paths {
        if paths.len() > 64 { return Err(storage_error("invalid_document", None, None, None)); }
        for protected in paths { ensure_distinct_drawing_path(&target, Path::new(&protected))?; }
    }
    atomic_write(&target, &envelope)?;
    Ok(SaveResult { path: Some(target.to_string_lossy().into_owned()), saved_at: saved_at_millis(), recovery: false })
}

fn ensure_distinct_drawing_path(target: &Path, protected: &Path) -> Result<(), String> {
    if target == protected || fs::canonicalize(target).ok().zip(fs::canonicalize(protected).ok())
        .is_some_and(|(target, protected)| target == protected) {
        return Err(storage_error("protected_drawing", Some(target), None, None));
    }
    Ok(())
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

    #[test]
    fn dgn_reading_bounds_binary_files_and_requires_absolute_dgn_paths() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sample.DGN");
        std::fs::write(&path, [8, 9, 254, 2]).unwrap();
        assert_eq!(read_interchange_bytes(&path, "dgn").unwrap(), vec![8, 9, 254, 2]);
        assert_eq!(read_interchange_bytes(Path::new("relative.dgn"), "dgn").unwrap_err(), "dgnInvalid");
        let other = directory.path().join("sample.wmf");
        std::fs::write(&other, [1]).unwrap();
        assert!(read_interchange_bytes(&other, "dgn").is_err());
        let folder = directory.path().join("folder.dgn");
        std::fs::create_dir(&folder).unwrap();
        assert!(read_interchange_bytes(&folder, "dgn").is_err());
        File::create(&path).unwrap().set_len(64 * 1024 * 1024 + 1).unwrap();
        assert_eq!(read_interchange_bytes(&path, "dgn").unwrap_err(), "dgnLimit");
    }

    #[test]
    fn wmf_reading_bounds_binary_files_and_requires_absolute_wmf_paths() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sample.WMF");
        std::fs::write(&path, [1, 0, 255, 128]).unwrap();
        assert_eq!(read_wmf_bytes(&path).unwrap(), vec![1, 0, 255, 128]);
        assert!(read_wmf_bytes(Path::new("relative.wmf")).is_err());
        let other = directory.path().join("sample.txt");
        std::fs::write(&other, [1]).unwrap();
        assert!(read_wmf_bytes(&other).is_err());
        let folder = directory.path().join("folder.wmf");
        std::fs::create_dir(&folder).unwrap();
        assert!(read_wmf_bytes(&folder).is_err());
        File::create(&path).unwrap().set_len(64 * 1024 * 1024 + 1).unwrap();
        assert_eq!(read_wmf_bytes(&path).unwrap_err(), "wmfLimit");
    }

    #[test]
    fn recovery_paths_resolve_relative_sources_and_protect_all_batch_originals() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("root.lcad");
        let child = directory.path().join("child.lcad");
        atomic_write(&root, &valid_envelope("Root")).unwrap();
        atomic_write(&child, &valid_envelope("Child")).unwrap();
        let saved_root = fs::read(&root).unwrap();
        let saved_child = fs::read(&child).unwrap();
        let resolved = resolve_lcad_recovery_path("child.lcad".into(), Some(root.to_string_lossy().into_owned())).unwrap();
        assert_eq!(PathBuf::from(resolved), fs::canonicalize(&child).unwrap());
        assert!(resolve_lcad_recovery_path("child.lcad".into(), None).is_err());
        assert!(resolve_lcad_recovery_path("../secret.txt".into(), Some(root.to_string_lossy().into_owned())).is_err());
        assert!(read_lcad_recovery_source(child.to_string_lossy().into_owned(), None, Some(1)).is_err());
        let protected = vec![root.to_string_lossy().into_owned(), child.to_string_lossy().into_owned()];
        assert!(export_lcad_document(child.to_string_lossy().into_owned(), valid_envelope("Recovered"), None, Some(protected.clone())).unwrap_err().contains("protected_drawing"));
        #[cfg(unix)]
        {
            let alias = directory.path().join("alias.lcad");
            std::os::unix::fs::symlink(&child, &alias).unwrap();
            assert_eq!(resolve_lcad_recovery_path(alias.to_string_lossy().into_owned(), None).unwrap(), fs::canonicalize(&child).unwrap().to_string_lossy());
            assert!(export_lcad_document(alias.to_string_lossy().into_owned(), valid_envelope("Recovered"), None, Some(protected.clone())).is_err());
        }
        let output = directory.path().join("copy.lcad");
        export_lcad_document(output.to_string_lossy().into_owned(), valid_envelope("Recovered"), None, Some(protected)).unwrap();
        assert_eq!(read_envelope(&output).unwrap()["document"]["name"], "Recovered");
        assert_eq!(fs::read(&root).unwrap(), saved_root);
        assert_eq!(fs::read(&child).unwrap(), saved_child);
    }

    #[test]
    fn recovery_reader_preserves_damaged_bytes_and_enforces_read_limits() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("damaged.lcad");
        let bytes = b"PK\x03\x04incomplete archive";
        fs::write(&path, bytes).unwrap();
        assert!(load_from_path(&path, false).is_err());
        assert_eq!(read_recovery_bytes(&path, 64).unwrap(), bytes);
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert!(read_recovery_bytes(&path, 4).is_err());
        assert!(read_recovery_bytes(Path::new("relative.lcad"), 64).is_err());
        let other = directory.path().join("other.txt");
        fs::write(&other, bytes).unwrap();
        assert!(read_recovery_bytes(&other, 64).is_err());
        let folder = directory.path().join("folder.lcad");
        fs::create_dir(&folder).unwrap();
        assert!(read_recovery_bytes(&folder, 64).is_err());
        assert!(!directory.path().join(RECOVERY_FILENAME).exists());
        assert!(read_lcad_recovery_source(path.to_string_lossy().into_owned(), Some(path.to_string_lossy().into_owned()), None).is_err());
        #[cfg(unix)]
        {
            let alias = directory.path().join("alias.lcad");
            std::os::unix::fs::symlink(&path, &alias).unwrap();
            assert!(read_lcad_recovery_source(alias.to_string_lossy().into_owned(), Some(path.to_string_lossy().into_owned()), None).is_err());
        }
    }

    #[test]
    fn standards_json_reader_rejects_bad_paths_encoding_size_and_json() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("standards.JSON");
        let name = path.to_string_lossy().into_owned();
        fs::write(&path, "{\"name\":\"Bâtiment\"}").unwrap();
        assert_eq!(read_standards_json(name.clone()).unwrap(), "{\"name\":\"Bâtiment\"}");
        assert_eq!(read_drawing_json(name.clone()).unwrap(), read_standards_json(name.clone()).unwrap());
        assert!(read_standards_json("relative.json".into()).is_err());
        assert!(read_standards_json(directory.path().join("wrong.csv").to_string_lossy().into_owned()).is_err());
        fs::write(&path, "not JSON").unwrap();
        assert!(read_standards_json(name.clone()).is_err());
        fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(read_standards_json(name.clone()).is_err());
        File::create(&path).unwrap().set_len(4 * 1024 * 1024 + 1).unwrap();
        assert!(read_standards_json(name).is_err());
    }

    #[test]
    fn table_csv_reader_limits_paths_encoding_size_and_file_type() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("table.CSV");
        fs::write(&path, "\u{feff}Libellé;Valeur\r\nA;=2+3").unwrap();
        assert_eq!(read_table_csv(path.to_string_lossy().into_owned()).unwrap(), "\u{feff}Libellé;Valeur\r\nA;=2+3");
        assert!(read_table_csv("relative.csv".into()).is_err());
        assert!(read_table_csv(directory.path().join("no.json").to_string_lossy().into_owned()).is_err());
        fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(read_table_csv(path.to_string_lossy().into_owned()).is_err());
        File::create(&path).unwrap().set_len(4 * 1024 * 1024 + 1).unwrap();
        assert!(read_table_csv(path.to_string_lossy().into_owned()).is_err());
        let folder = directory.path().join("folder.csv");
        fs::create_dir(&folder).unwrap();
        assert!(read_table_csv(folder.to_string_lossy().into_owned()).is_err());
    }
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
    fn reference_edits_require_the_loaded_revision_and_preserve_external_changes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("source.lcad");
        let path_string = path.to_string_lossy().into_owned();
        atomic_write(&path, &valid_envelope("Original")).unwrap();
        let original = read_lcad_reference(path_string.clone()).unwrap();
        assert_eq!(original.revision.len(), 64);
        assert_eq!(original.loaded.path.unwrap(), fs::canonicalize(&path).unwrap().to_string_lossy());
        let edited = write_lcad_reference(path_string.clone(), valid_envelope("Edited"), original.revision.clone()).unwrap();
        assert_ne!(edited.revision, original.revision);
        assert_eq!(edited.loaded.envelope["document"]["name"], "Edited");
        let before = fs::read(&path).unwrap();
        let error = write_lcad_reference(path_string.clone(), valid_envelope("Stale"), original.revision).unwrap_err();
        assert!(error.contains("reference_changed"));
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
        assert!(write_lcad_reference(path_string, valid_envelope("Invalid"), String::new()).is_err());
    }

    #[test]
    fn layout_export_refuses_the_active_file_and_writes_a_separate_archive() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("host.lcad");
        let output = directory.path().join("sheet.lcad");
        atomic_write(&source, &valid_envelope("Host")).unwrap();
        let original = fs::read(&source).unwrap();
        let protected = Some(source.to_string_lossy().into_owned());
        assert!(export_lcad_document(source.to_string_lossy().into_owned(), valid_envelope("Export"), protected.clone(), None).unwrap_err().contains("protected_drawing"));
        export_lcad_document(output.to_string_lossy().into_owned(), valid_envelope("Export"), protected, None).unwrap();
        assert_eq!(fs::read(&source).unwrap(), original);
        assert_eq!(load_from_path(&output, false).unwrap().envelope["document"]["name"], "Export");
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
    fn preserves_units_ucs_and_plot_catalogs() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("presentation.lcad");
        let mut envelope = valid_envelope("Presentation");
        let settings = json!({"ucs": {"x": 10, "y": 20, "rotation": 90}, "units": {"display": "mm", "precision": 2}, "plotStyleMode": "color"});
        envelope["document"]["content"]["settings"] = settings.clone();
        let styles = json!([{"name": "Roof", "sourceColor": "#172033", "color": "#ff0000", "screening": 50}]);
        envelope["document"]["content"]["plotStyles"] = styles.clone();
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["settings"], settings);
        assert_eq!(loaded["document"]["content"]["plotStyles"], styles);
    }

    #[test]
    fn preserves_layer_state_flags() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("layers.lcad");
        let mut envelope = valid_envelope("Layers");
        let states = json!([{"name": "Roof", "activeLayerId": "geometry", "layers": [{"id": "geometry", "visible": true, "frozen": true, "newViewportFrozen": true, "plot": false}]}]);
        envelope["document"]["content"]["layerStates"] = states.clone();
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["layerStates"], states);
    }

    #[test]
    fn preserves_pdf_source_assets() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("pdf-source.lcad");
        let mut envelope = envelope_with_asset("PDF source");
        let link = "data:application/pdf;base64,JVBERi0xLjcKJSVFT0Y=";
        envelope["document"]["assets"][0]["link"] = json!(link);
        envelope["document"]["assets"][0]["mimeType"] = json!("application/pdf");
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["assets"][0]["link"], link);
        assert_eq!(loaded["document"]["assets"][0]["mimeType"], "application/pdf");
    }

    #[test]
    fn preserves_dwfx_source_assets() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("dwfx-source.lcad");
        let mut envelope = envelope_with_asset("DWFx source");
        let link = "data:model/vnd.dwfx+xps;base64,UEsDBHNvdXJjZQ==";
        envelope["document"]["assets"][0]["link"] = json!(link);
        envelope["document"]["assets"][0]["mimeType"] = json!("model/vnd.dwfx+xps");
        let mut preview = envelope["document"]["assets"][0].clone();
        preview["id"] = json!("preview"); preview["mimeType"] = json!("image/png"); preview["link"] = json!(PIXEL_DATA_URL);
        envelope["document"]["assets"].as_array_mut().unwrap().push(preview);
        let metadata = json!({"version": 1, "format": "dwfx", "assetId": "roof/reference", "name": "plan.dwfx",
            "pageNumber": 2, "pageCount": 3, "width": 0.21, "height": 0.297});
        envelope["document"]["content"]["entities"] = json!([{"id": "underlay", "type": "blockReference", "layerId": "geometry", "blockId": "cache",
            "transform": {"a": 2, "b": 0, "c": 0, "d": 2, "e": 10, "f": 20}, "dwfUnderlay": metadata.clone()}]);
        envelope["document"]["content"]["blocks"] = json!([{"id": "cache", "name": "Cached page", "basePoint": {"x": 0, "y": 0}, "entities": [
            {"id": "image", "type": "image", "assetId": "preview", "layerId": "geometry", "x": 0, "y": 0, "width": 0.21, "height": 0.297}
        ]}]);
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["entities"][0]["dwfUnderlay"], metadata);
        assert_eq!(loaded["document"]["assets"][1]["link"], PIXEL_DATA_URL);
        assert_eq!(loaded["document"]["assets"][0]["link"], link);
        assert_eq!(loaded["document"]["assets"][0]["mimeType"], "model/vnd.dwfx+xps");
    }

    #[test]
    fn preserves_dgn_source_assets() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("dgn-source.lcad");
        let mut envelope = envelope_with_asset("DGN source");
        let mut bytes = vec![0_u8; 1538];
        bytes[..4].copy_from_slice(&[8, 9, 254, 2]);
        bytes[1112..1116].copy_from_slice(&[0, 0, 232, 3]);
        bytes[1116..1120].copy_from_slice(&[0, 0, 100, 0]);
        bytes[1120..1124].copy_from_slice(b"m mm");
        bytes[1536..].copy_from_slice(&[255, 255]);
        let link = format!("data:image/vnd.dgn;base64,{}", BASE64.encode(&bytes));
        envelope["document"]["assets"][0]["link"] = json!(link);
        envelope["document"]["assets"][0]["mimeType"] = json!("image/vnd.dgn");
        let metadata = json!({"version": 1, "format": "v7", "assetId": "roof/reference", "name": "plan.dgn", "metresPerMaster": 0.001});
        envelope["document"]["content"]["blocks"] = json!([{"id": "cache", "name": "DGN cache", "basePoint": {"x": 0, "y": 0}, "entities": [
            {"id": "line", "type": "line", "layerId": "geometry", "x1": 0, "y1": 0, "x2": 1, "y2": 1}
        ]}]);
        envelope["document"]["content"]["entities"] = json!([{"id": "underlay", "type": "blockReference", "blockId": "cache", "layerId": "geometry",
            "transform": {"a": 2, "b": 0, "c": 0, "d": 2, "e": 10, "f": 20}, "dgnUnderlay": metadata.clone()}]);
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["assets"][0]["link"], link);
        assert_eq!(loaded["document"]["assets"][0]["mimeType"], "image/vnd.dgn");
        assert_eq!(loaded["document"]["content"]["entities"][0]["dgnUnderlay"], metadata);
        assert_eq!(image_extension("image/vnd.dgn"), "dgn");
    }

    #[test]
    fn preserves_native_curved_block_clips() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("curve-clips.lcad");
        let mut envelope = valid_envelope("Curve clips");
        let entities = json!([{"id": "clipped", "type": "blockReference", "layerId": "geometry", "blockId": "source",
            "transform": {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0},
            "blockClip": {"enabled": true, "rule": "evenodd", "paths": [{"closed": true, "parts": [
                {"type": "spline", "controlPoints": [{"x": 0, "y": 0}, {"x": 0, "y": 3}, {"x": 4, "y": 3}, {"x": 4, "y": 0}]},
                {"type": "line", "x1": 4, "y1": 0, "x2": 0, "y2": 0}
            ]}]}}]);
        envelope["document"]["content"]["entities"] = entities.clone();
        envelope["document"]["content"]["blocks"] = json!([{"id": "source", "name": "Source", "basePoint": {"x": 0, "y": 0}, "entities": [
            {"id": "line", "type": "line", "layerId": "geometry", "x1": -1, "y1": 1, "x2": 5, "y2": 1}
        ]}]);
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_native_paper_transfer_blocks() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("paper-transfer.lcad");
        let mut envelope = valid_envelope("Paper transfer");
        let blocks = json!([{"id": "transfer", "name": "Paper", "basePoint": {"x": 0, "y": 0}, "entities": [{"id": "source-circle", "type": "circle", "layerId": "geometry", "cx": 2, "cy": 3, "r": 1}]}]);
        let layouts = json!([{"id": "sheet", "name": "Sheet", "format": "A4", "viewports": [], "paperEntities": [{"id": "paper-block", "type": "blockReference", "layerId": "geometry", "blockId": "transfer", "spaceTransfer": true, "transform": {"a": 0, "b": 10, "c": -10, "d": 0, "e": 20, "f": 30}}]}]);
        envelope["document"]["content"]["blocks"] = blocks.clone();
        envelope["document"]["layouts"] = layouts.clone();
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["blocks"], blocks);
        assert_eq!(loaded["document"]["layouts"], layouts);
    }

    #[test]
    fn preserves_annotation_scale_representations() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("annotations.lcad");
        let mut envelope = valid_envelope("Annotations");
        let annotation = json!({"baseScale": 100, "scales": [{"scale": 50, "offset": {"x": 2, "y": 3}}, {"scale": 100, "offset": {"x": 0, "y": 0}}]});
        envelope["document"]["content"]["annotationScales"] = json!([50, 100]);
        envelope["document"]["content"]["settings"]["annotationScale"] = json!(50);
        envelope["document"]["content"]["entities"] = json!([{"id": "note", "type": "text", "layerId": "geometry", "x": 0, "y": 0, "width": 4, "height": 2, "fontSize": 0.35, "text": "Note", "annotation": annotation}]);
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["entities"][0]["annotation"], annotation);
        assert_eq!(loaded["document"]["content"]["settings"]["annotationScale"], 50);
        assert_eq!(loaded["document"]["content"]["annotationScales"], json!([50, 100]));
    }

    #[test]
    fn preserves_leader_metadata_and_styles() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("leaders.lcad");
        let mut envelope = valid_envelope("Leaders");
        let leader = json!({"version": 1, "branches": [[{"x": -5, "y": -2}, {"x": -2, "y": 0}]],
            "style": {"textSize": 0.35, "arrowSize": 0.2, "landingLength": 0.75, "arrowType": "closed"}});
        envelope["document"]["content"]["entities"] = json!([{"id": "leader-1", "type": "blockReference", "blockId": "b1", "layerId": "geometry", "leader": leader}]);
        envelope["document"]["content"]["leaderStyles"] = json!([{"name": "Standard", "textSize": 0.35}]);
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["entities"][0]["leader"], leader);
        assert_eq!(loaded["document"]["content"]["leaderStyles"], envelope["document"]["content"]["leaderStyles"]);
    }

    #[test]
    fn preserves_embedded_drawing_standards() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("standards.lcad");
        let mut envelope = valid_envelope("Standards");
        let binding = json!({"version": 1, "path": "/missing/office.json", "standard": {
            "format": "lumcad-standards", "version": 1, "name": "Office", "catalogs": {
                "layers": [], "textStyles": [], "dimensionStyles": [], "leaderStyles": [], "multilineStyles": [], "tableStyles": []
            }
        }});
        envelope["document"]["content"]["standards"] = binding.clone();
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["standards"], binding);
    }

    #[test]
    fn preserves_arc_text_definition_and_affine_glyphs() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("arc-text.lcad");
        let mut envelope = valid_envelope("Arc text");
        let entity = json!({"id":"label", "type":"polyline", "layerId":"geometry", "sourceId":"arc",
            "arcText":{"version":1, "text":"Roof", "arc":{"cx":0,"cy":0,"r":5,"startAngle":0,"endAngle":3.14},
                "offset":0.2,"spacing":0.1,"align":"center","reverse":false,
                "transform":{"a":1,"b":0,"c":0,"d":1,"e":0,"f":0},"style":{"fontSize":0.5},"status":"current"},
            "parts":[{"id":"glyph", "type":"text", "layerId":"geometry", "text":"R", "x":0,"y":0,"width":1,"height":1,
                "affineFrame":{"a":0,"b":1,"c":-1,"d":0,"e":5,"f":0}}]});
        envelope["document"]["content"]["entities"] = json!([entity]);
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["entities"][0], entity);
    }

    #[test]
    fn preserves_object_web_link_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("links.lcad");
        let mut envelope = valid_envelope("Links");
        let entity = json!({"id":"line", "type":"line", "layerId":"geometry", "x1":0, "y1":0, "x2":1, "y2":1,
            "hyperlink":{"url":"https://example.com/spec.pdf#page=2", "label":"Technical sheet"}});
        envelope["document"]["content"]["entities"] = json!([entity]);
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["entities"][0], entity);
    }

    #[test]
    fn preserves_saved_quantity_extractions() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("quantities.lcad");
        let mut envelope = valid_envelope("Quantities");
        let definitions = json!([{"id": "quantity-1", "name": "Lengths", "nested": true,
            "groupBy": ["type", "attribute:CODE"], "sums": ["length"], "selectedIds": ["source-1"]}]);
        envelope["document"]["content"]["dataExtractions"] = definitions.clone();
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["dataExtractions"], definitions);
        let link = json!({"definition": definitions[0], "headers": ["Type", "Code", "Count", "Length", "Measured"], "status": "current"});
        let table = json!({"id": "quantity-table", "type": "polyline", "layerId": "geometry", "parts": [],
            "table": {"cells": [[{"value": "Type"}, {"value": "Code"}, {"value": "Count"}, {"value": "Length"}, {"value": "Measured"}],
                [{"value": "line"}, {"value": ""}, {"value": "120"}, {"value": "600"}, {"value": "120"}]], "quantityLink": link}});
        envelope["document"]["content"]["entities"] = json!([table]);
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["entities"][0], table);
    }

    #[test]
    fn preserves_named_selection_filters() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("filters.lcad");
        let mut envelope = valid_envelope("Filters");
        let filters = json!([{"id": "filter-1", "name": "Lines", "criteria": [{"field": "TYPE", "operator": "=", "value": "line"}]}]);
        envelope["document"]["content"]["selectionFilters"] = filters.clone();
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["selectionFilters"], filters);
    }

    #[test]
    fn preserves_named_model_views() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("views.lcad");
        let mut envelope = valid_envelope("Views");
        let views = json!([{"id": "view-1", "name": "Roof", "x": 50, "y": -10, "width": 20, "height": 10}]);
        envelope["document"]["content"]["namedViews"] = views.clone();
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["namedViews"], views);
    }

    #[test]
    fn preserves_named_drawing_groups() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("groups.lcad");
        let mut envelope = valid_envelope("Groups");
        let groups = json!([{"id": "group-1", "name": "Roof", "entityIds": ["a", "b"], "selectable": true}]);
        envelope["document"]["content"]["groups"] = groups.clone();
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["groups"], groups);
    }

    #[test]
    fn preserves_elliptical_axis_dimension_associations() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ellipse-dimensions.lcad");
        let mut envelope = valid_envelope("Ellipse dimensions");
        let entities = json!([
            { "id": "ellipse", "type": "ellipse", "layerId": "geometry", "cx": 0, "cy": 0,
              "rx": 4, "ry": 2, "rotation": 30, "fullEllipse": true },
            { "id": "dimension", "type": "linearDimension", "layerId": "dimensions",
              "sourceId": "ellipse", "edgeIndex": 1, "measurementMode": "aligned", "offset": 0.6 },
            { "id": "series", "type": "linearDimension", "layerId": "dimensions",
              "sourcePointReferences": [
                  { "sourceId": "ellipse", "sourceType": "ellipse", "edgeIndex": 0, "endpointIndex": 0 },
                  { "sourceId": "ellipse", "sourceType": "ellipse", "edgeIndex": 0, "endpointIndex": 1 }
              ] }
        ]);
        envelope["document"]["content"]["entities"] = entities.clone();
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_native_points_and_point_defaults() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("points.lcad");
        let mut envelope = valid_envelope("Survey points");
        let style = json!({"symbol": "circle-cross", "size": 0.25});
        let entities = json!([{"id": "point-1", "type": "point", "layerId": "geometry",
            "x": 12.5, "y": -7.25, "pointStyle": style.clone()}]);
        envelope["document"]["content"]["entities"] = entities.clone();
        envelope["document"]["content"]["settings"]["pointStyle"] = style.clone();
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["entities"], entities);
        assert_eq!(loaded["document"]["content"]["settings"]["pointStyle"], style);
    }

    #[test]
    fn preserves_construction_lines_and_rays() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("construction.lcad");
        let mut envelope = valid_envelope("Construction");
        let entities = json!([
            { "id": "xline-1", "type": "xline", "layerId": "geometry", "x1": 0, "y1": 0, "x2": 1, "y2": 2 },
            { "id": "ray-1", "type": "ray", "layerId": "geometry", "x1": 4, "y1": 5, "x2": 3, "y2": 6 }
        ]);
        envelope["document"]["content"]["entities"] = entities.clone();
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_dimension_styles_and_detached_sources() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("dimensions.lcad");
        let mut envelope = valid_envelope("Dimensions");
        let styles = json!([{"id":"plans", "name":"Plans", "textSize":0.5, "arrowType":"closed"}]);
        let entities = json!([{"id":"radius", "type":"radialDimension", "layerId":"dimensions",
            "dimensionStyleId":"plans", "textSize":0.7, "dimensionStyleOverrides":{"textSize":0.7}, "dimensionTextOverride":"Value: <>", "dimensionTextPosition":{"x":12,"y":8}, "dimensionTextAngle":0.5, "dimensionExtensionAngle":0.8, "dimensionAutoBreak":{"gap":0.3,"sourceIds":["crossing"]}, "dimensionBreaks":[{"kind":"line","index":0,"start":0.2,"end":0.4}],
            "detachedSource":{"type":"circle", "cx":2, "cy":3, "r":4}},
            {"id":"centreline", "type":"centerLine", "layerId":"dimensions", "p1":{"x":0,"y":2}, "p2":{"x":10,"y":2}, "extension":0.25, "alternateBisector":false}]);
        envelope["document"]["content"]["dimensionStyles"] = styles.clone();
        envelope["document"]["content"]["activeDimensionStyleId"] = json!("plans");
        envelope["document"]["content"]["entities"] = entities.clone();
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["dimensionStyles"], styles);
        assert_eq!(loaded["document"]["content"]["activeDimensionStyleId"], "plans");
        assert_eq!(loaded["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_block_attribute_definitions_and_values() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("attributes.lcad");
        let mut envelope = valid_envelope("Attributes");
        let blocks = json!([{"id": "door", "name": "Door", "entities": [
            {"id": "code", "type": "text", "text": "D-01", "layerId": "geometry", "x": 0, "y": 0, "width": 4, "height": 1,
                "attributeDefinition": {"tag": "CODE", "prompt": "Door number", "constant": false, "invisible": true}}
        ]}]);
        let entities = json!([{"id": "instance", "type": "blockReference", "blockId": "door", "layerId": "geometry",
            "transform": {"a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0}, "attributeValues": {"CODE": "D-02"}}]);
        envelope["document"]["content"]["blocks"] = blocks.clone();
        envelope["document"]["content"]["entities"] = entities.clone();
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["blocks"], blocks);
        assert_eq!(loaded["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_image_and_text_affine_frames() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("affine-frames.lcad");
        let mut envelope = valid_envelope("Affine frames");
        let entities = json!([
            {"id": "image", "type": "image", "layerId": "geometry", "x": 1, "y": 2, "width": 4, "height": 3,
                "affineFrame": {"a": 2, "b": 0.5, "c": 0.75, "d": 1, "e": 10, "f": -3}},
            {"id": "text", "type": "text", "layerId": "geometry", "text": "Affine", "textMode": "singleLine", "fitWidth": true, "x": 1, "y": 2, "width": 4, "height": 3,
                "affineFrame": {"a": 2, "b": 0.5, "c": 0.75, "d": 1, "e": 10, "f": -3}}
        ]);
        envelope["document"]["content"]["entities"] = entities.clone();
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_geometric_constraints_without_solving_geometry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("geometric-constraints.lcad");
        let mut envelope = valid_envelope("Constraints");
        let entities = json!([
            {"id": "edge", "type": "line", "layerId": "geometry", "x1": 0, "y1": 0, "x2": 4, "y2": 0.2}
        ]);
        let constraints = json!([
            {"id": "horizontal", "type": "horizontal", "refs": [{"entityId": "edge"}]},
            {"id": "fixed", "type": "fix", "refs": [{"entityId": "edge", "point": "start"}], "values": [0, 0]}
        ]);
        envelope["document"]["content"]["entities"] = entities.clone();
        envelope["document"]["content"]["geometricConstraints"] = constraints.clone();
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["geometricConstraints"], constraints);
        assert_eq!(loaded["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_driving_dimensions_and_parameter_formulas_without_solving() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("driving-dimensions.lcad");
        let mut envelope = valid_envelope("Driving dimensions");
        let entities = json!([
            {"id": "edge", "type": "line", "layerId": "geometry", "x1": 0, "y1": 0, "x2": 3, "y2": 0}
        ]);
        let parameters = json!([{"name": "width", "type": "distance", "expression": "5m"}]);
        let dimensions = json!([
            {"id": "dimension", "name": "d1", "type": "aligned", "expression": "width",
                "refs": [{"entityId": "edge"}]}
        ]);
        envelope["document"]["content"]["entities"] = entities.clone();
        envelope["document"]["content"]["parameters"] = parameters.clone();
        envelope["document"]["content"]["dimensionalConstraints"] = dimensions.clone();
        let blocks = json!([{"id": "driven-block", "name": "Driven block", "entities": entities,
            "parameters": parameters, "dimensionalConstraints": dimensions}]);
        envelope["document"]["content"]["blocks"] = blocks.clone();
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["parameters"], parameters);
        assert_eq!(loaded["document"]["content"]["dimensionalConstraints"], dimensions);
        assert_eq!(loaded["document"]["content"]["blocks"], blocks);
        assert_eq!(loaded["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_block_library_metadata_and_base_point() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("library.lcad");
        let mut envelope = valid_envelope("Library");
        let metadata = json!({"basePoint": {"x": 12, "y": -3},
            "blockLibrary": {"version": 1, "entryBlockIds": ["symbol"]}});
        envelope["document"]["content"]["metadata"] = metadata.clone();
        envelope["document"]["content"]["blocks"] = json!([{"id": "symbol", "name": "Symbol", "entities": []}]);
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["metadata"], metadata);
    }

    #[test]
    fn preserves_wipeout_and_painter_order() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("wipeout.lcad");
        let mut envelope = valid_envelope("Wipeout");
        let entities = json!([
            {"id": "line", "type": "line", "layerId": "geometry", "x1": 0, "y1": 2, "x2": 8, "y2": 2},
            {"id": "mask", "type": "polyline", "layerId": "geometry", "closed": true, "wipeout": {"frame": false},
             "points": [{"x": 1, "y": 1}, {"x": 4, "y": 1}, {"x": 4, "y": 4}, {"x": 1, "y": 4}]}
        ]);
        envelope["document"]["content"]["entities"] = entities.clone();
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_nondestructive_image_adjustments() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("image-adjustments.lcad");
        let mut envelope = valid_envelope("Image adjustments");
        let entities = json!([{
            "id": "image", "type": "image", "layerId": "references", "x": 0, "y": 0, "width": 4, "height": 3,
            "imageSource": {"mode": "linked", "path": "/missing/reference.png"},
            "imageAdjustments": {"brightness": 130, "contrast": 80, "monochrome": true, "transparentColor": "#ffffff", "colorTolerance": 3},
            "imageRendering": "pixelated",
            "imageClip": {"enabled": true, "points": [{"x": 0.1, "y": 0.2}, {"x": 0.9, "y": 0.2}, {"x": 0.1, "y": 0.8}]}
        }]);
        envelope["document"]["content"]["entities"] = entities.clone();
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_native_region_loops() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("region.lcad");
        let mut envelope = valid_envelope("Region");
        let entities = json!([{
            "id": "region", "type": "region", "layerId": "geometry",
            "boundaries": [
                {"type": "polyline", "closed": true, "parts": [{"type": "circle", "cx": 0, "cy": 0, "r": 5}]},
                {"type": "polyline", "closed": true, "parts": [{"type": "circle", "cx": 0, "cy": 0, "r": 1}]}
            ]
        }]);
        envelope["document"]["content"]["entities"] = entities.clone();
        atomic_write(&path, &envelope).unwrap();
        assert_eq!(read_envelope(&path).unwrap()["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_associative_hatch_pattern_and_boundaries() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hatch.lcad");
        let mut envelope = valid_envelope("Hatch");
        let entities = json!([
            {"id": "circle", "type": "circle", "layerId": "geometry", "cx": 3, "cy": 4, "r": 2},
            {"id": "hatch", "type": "hatch", "layerId": "geometry", "sourceIds": ["circle"],
                "fillRule": "nonzero", "boundaryStroke": false,
                "boundaries": [{"type": "polyline", "closed": true, "parts": [{"type": "circle", "cx": 3, "cy": 4, "r": 2}]}],
                "pattern": {"name": "gradient", "endColor": "#112233", "angle": 30, "spacing": 0.25, "origin": {"x": 1, "y": 2}}}
        ]);
        envelope["document"]["content"]["entities"] = entities.clone();
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_editable_spline_definition() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("spline.lcad");
        let mut envelope = valid_envelope("Spline");
        let entities = json!([{
            "id": "spline-1", "type": "spline", "degree": 3, "layerId": "geometry",
            "controlPoints": [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 2, "y": 0}, {"x": 3, "y": 0}],
            "splineDefinition": { "mode": "fit", "points": [{"x": 0, "y": 0}, {"x": 3, "y": 0}], "knots": [0, 1], "startTangent": {"x": 3, "y": 0} }
        }]);
        envelope["document"]["content"]["entities"] = entities.clone();
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["entities"], entities);
    }

    #[test]
    fn preserves_rectangular_array_parameters_and_ordered_parts() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("array.lcad");
        let mut envelope = valid_envelope("Array");
        let entity = json!({
            "id": "array-1", "type": "polyline", "layerId": "geometry",
            "array": { "columns": 2, "rows": 1,
                "horizontal": { "x": 0, "y": 3 }, "vertical": { "x": -2, "y": 0 } },
            "parts": [
                { "type": "line", "x1": 0, "y1": 0, "x2": 1, "y2": 1 },
                { "type": "line", "x1": 0, "y1": 3, "x2": 1, "y2": 4 }
            ]
        });
        envelope["document"]["content"]["entities"] = json!([entity.clone()]);
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["entities"][0], entity);
    }

    #[test]
    fn preserves_polar_array_seed_and_affine_frame() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("polar.lcad");
        let mut envelope = valid_envelope("Polar");
        let entity = json!({
            "id": "polar-1", "type": "polyline", "layerId": "geometry",
            "array": { "kind": "polar", "count": 4, "angle": 360, "rotateItems": true,
                "center": { "x": 0, "y": 0 }, "basePoint": { "x": 2, "y": 0 },
                "seedParts": [{ "type": "line", "x1": 2, "y1": 0, "x2": 3, "y2": 0 }],
                "transform": { "a": 2, "b": 0, "c": 0, "d": 3, "e": 5, "f": -1 } },
            "parts": [{ "type": "line", "x1": 9, "y1": -1, "x2": 11, "y2": -1 }]
        });
        envelope["document"]["content"]["entities"] = json!([entity.clone()]);
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["entities"][0], entity);
    }

    #[test]
    fn preserves_path_array_association_and_spacing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("path-array.lcad");
        let mut envelope = valid_envelope("Path array");
        let source = json!({ "id": "path-1", "type": "line", "layerId": "geometry",
            "x1": 0, "y1": 0, "x2": 5, "y2": 0 });
        let entity = json!({ "id": "array-1", "type": "polyline", "layerId": "geometry", "sourceId": "path-1",
            "array": { "kind": "path", "count": 2, "mode": "measure", "spacing": 3, "offset": 1,
                "align": true, "reverse": false, "basePoint": { "x": 0, "y": 0 },
                "path": { "type": "path", "closed": false, "parts": [source.clone()] },
                "seedParts": [{ "type": "line", "x1": 0, "y1": 0, "x2": 1, "y2": 0 }],
                "transform": { "a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0 } },
            "parts": [
                { "type": "line", "x1": 1, "y1": 0, "x2": 2, "y2": 0 },
                { "type": "line", "x1": 4, "y1": 0, "x2": 5, "y2": 0 }
            ] });
        envelope["document"]["content"]["entities"] = json!([source.clone(), entity.clone()]);
        atomic_write(&path, &envelope).unwrap();
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["entities"], json!([source, entity]));
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

    #[test]
    fn writes_compact_manifests_for_drawings_beyond_the_former_limit() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("large.lcad");
        let entities: Vec<Value> = (0..150_000)
            .map(|index| json!({ "id": format!("line-{index}"), "type": "line", "layerId": "geometry", "x1": index, "y1": 0, "x2": index, "y2": 1 }))
            .collect();
        let mut envelope = valid_envelope("Large");
        envelope["document"]["content"]["entities"] = Value::Array(entities);
        assert!(serde_json::to_vec_pretty(&envelope).unwrap().len() > 8 * 1024 * 1024);
        atomic_write(&path, &envelope).unwrap();

        let mut archive = ZipArchive::new(std::io::Cursor::new(fs::read(&path).unwrap())).unwrap();
        let mut manifest = String::new();
        archive.by_name(LCAD_MANIFEST_PATH).unwrap().read_to_string(&mut manifest).unwrap();
        assert!(!manifest.contains("\n "));
        let loaded = read_envelope(&path).unwrap();
        assert_eq!(loaded["document"]["content"]["entities"].as_array().unwrap().len(), 150_000);
    }

    #[test]
    fn refuses_to_write_manifests_above_the_safety_limit() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("oversized.lcad");
        let mut envelope = valid_envelope("Oversized");
        envelope["document"]["content"]["note"] = Value::String("x".repeat(MAX_MANIFEST_BYTES));
        let error = atomic_write(&path, &envelope).unwrap_err();
        assert!(error.contains("manifest_too_large"));
        assert!(!path.exists());
    }
}
