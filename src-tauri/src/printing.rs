use std::{
    collections::HashSet,
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{self, BufWriter, Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use zip::ZipArchive;

const POINTS_PER_MM: f64 = 72.0 / 25.4;
const PAPER_POINT_QUANTUM: f64 = 1_000.0;
const MIN_PAPER_MM: f64 = 10.0;
const MAX_PAPER_MM: f64 = 5_000.0;
const MAX_PLOT_FILE_BYTES: usize = 512 * 1024 * 1024;
const MAX_PUBLISH_PATH_CHARS: usize = 32_768;
const MAX_DWFX_ENTRIES: usize = 10_000;
const MAX_DWFX_ENTRY_BYTES: u64 = 256 * 1024 * 1024;
const MAX_DWFX_UNCOMPRESSED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_DWFX_XML_BYTES: u64 = 4 * 1024 * 1024;
const PDF_TRAILER_SEARCH_BYTES: usize = 64 * 1024;
const TEMP_FILE_ATTEMPTS: u64 = 64;

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishPlotResult {
    path: String,
    format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_count: Option<usize>,
    bytes_written: u64,
    replaced: bool,
    published_at: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishPlotErrorPayload {
    code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PublishFormat {
    Pdf,
    Dwfx,
}

impl PublishFormat {
    fn parse(value: &str) -> ValidationResult<Self> {
        match value {
            "pdf" => Ok(Self::Pdf),
            "dwfx" => Ok(Self::Dwfx),
            _ => Err(ValidationError::new(
                "invalid_publish_format",
                Some("Expected `pdf` or `dwfx`.".into()),
            )),
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Dwfx => "dwfx",
        }
    }

    fn as_str(self) -> &'static str {
        self.extension()
    }
}

#[derive(Debug, PartialEq, Eq)]
struct ValidationError {
    code: &'static str,
    detail: Option<String>,
}

impl ValidationError {
    fn new(code: &'static str, detail: Option<String>) -> Self {
        Self { code, detail }
    }
}

type ValidationResult<T> = Result<T, ValidationError>;

#[derive(Debug, Default, PartialEq, Eq)]
struct ValidationSummary {
    page_count: Option<usize>,
}

/// Validate the WMF container before replacing an existing export atomically.
#[tauri::command]
pub fn write_drawing_wmf(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = validate_publish_path(&path)
        .map_err(|error| publish_error(error.code, raw_error_path(&path), error.detail))?;
    if !target.is_absolute() || !target.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("wmf")) {
        return Err("wmfInvalid".into());
    }
    validate_wmf_export(&bytes)?;
    atomic_write_plot_file(&target, &bytes)?;
    Ok(())
}

fn validate_wmf_export(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 64 * 1024 * 1024 { return Err("wmfLimit".into()); }
    if bytes.len() < 24 || bytes.len() % 2 != 0 { return Err("wmfInvalid".into()); }
    let word = |i: usize| u16::from_le_bytes([bytes[i], bytes[i + 1]]);
    let dword = |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as usize;
    let mut offset = 0;
    if dword(0) == 0x9ac6cdd7 {
        if bytes.len() < 46 || (0..20).step_by(2).fold(0u16, |sum, i| sum ^ word(i)) != word(20)
            || word(6) == word(10) || word(8) == word(12) || word(14) == 0 { return Err("wmfInvalid".into()); }
        offset = 22;
    }
    if ![1, 2].contains(&word(offset)) || word(offset + 2) != 9 || ![0x100, 0x300].contains(&word(offset + 4))
        || dword(offset + 6) != (bytes.len() - offset) / 2 { return Err("wmfInvalid".into()); }
    let maximum = dword(offset + 12);
    if maximum < 3 { return Err("wmfInvalid".into()); }
    offset += 18;
    let mut records = 0;
    while bytes.len() - offset >= 6 {
        records += 1;
        if records > 100000 { return Err("wmfLimit".into()); }
        let words = dword(offset);
        if words < 3 || words > maximum || words > (bytes.len() - offset) / 2 { return Err("wmfInvalid".into()); }
        let end = offset + words * 2;
        if word(offset + 4) == 0 {
            return if words == 3 && end == bytes.len() { Ok(()) } else { Err("wmfInvalid".into()) };
        }
        offset = end;
    }
    Err("wmfInvalid".into())
}

/// Bounded image output with extension/signature checks and atomic replacement.
#[tauri::command]
pub fn write_drawing_image(path: String, bytes: Vec<u8>, format: String) -> Result<(), String> {
    let target = validate_publish_path(&path)
        .map_err(|error| publish_error(error.code, raw_error_path(&path), error.detail))?;
    let extension = target.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let valid_extension = extension == format || format == "jpg" && extension == "jpeg";
    if !target.is_absolute() || !valid_extension || bytes.is_empty() || bytes.len() > 64 * 1024 * 1024 {
        return Err("imageExportInvalid".into());
    }
    let valid = match format.as_str() {
        "png" => bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") && &bytes[12..16] == b"IHDR",
        "jpg" => bytes.len() >= 4 && bytes.starts_with(b"\xff\xd8\xff") && bytes.ends_with(b"\xff\xd9"),
        "svg" => std::str::from_utf8(&bytes).map(|text| text.trim_start().starts_with("<svg")
            && text.contains("http://www.w3.org/2000/svg") && text.trim_end().ends_with("</svg>")).unwrap_or(false),
        _ => false,
    };
    if !valid { return Err("imageExportInvalid".into()); }
    atomic_write_plot_file(&target, &bytes).map(|_| ())
}

/// Validate the destination and bounded CFB payload before atomic replacement.
#[tauri::command]
pub fn write_spreadsheet_export(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = validate_publish_path(&path)
        .map_err(|error| publish_error(error.code, raw_error_path(&path), error.detail))?;
    if !target.is_absolute()
        || target.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase()) != Some("xls".into())
        || bytes.len() < 512 || bytes.len() > 64 * 1024 * 1024
        || !bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) {
        return Err("attributeExtractionFormat".into());
    }
    atomic_write_plot_file(&target, &bytes)?;
    Ok(())
}

#[tauri::command]
pub fn write_attribute_export(path: String, text: String, format: String) -> Result<(), String> {
    let target = validate_publish_path(&path)
        .map_err(|error| publish_error(error.code, raw_error_path(&path), error.detail))?;
    if !target.is_absolute() || !["csv", "json"].contains(&format.as_str())
        || target.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase()) != Some(format.clone())
        || text.is_empty() || text.len() > 64 * 1024 * 1024 {
        return Err("attributeExtractionFormat".into());
    }
    if format == "json" && serde_json::from_str::<serde_json::Value>(&text).is_err() {
        return Err("attributeExtractionFormat".into());
    }
    atomic_write_plot_file(&target, text.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub fn publish_plot_file(
    path: String,
    bytes: Vec<u8>,
    format: String,
) -> Result<PublishPlotResult, String> {
    let target = validate_publish_path(&path)
        .map_err(|error| publish_error(error.code, raw_error_path(&path), error.detail))?;
    let publish_format = PublishFormat::parse(&format)
        .map_err(|error| publish_error(error.code, Some(&target), error.detail))?;
    validate_publish_extension(&target, publish_format)
        .map_err(|error| publish_error(error.code, Some(&target), error.detail))?;
    let summary = validate_plot_payload(&bytes, publish_format)
        .map_err(|error| publish_error(error.code, Some(&target), error.detail))?;
    let replaced = atomic_write_plot_file(&target, &bytes)?;

    Ok(PublishPlotResult {
        path: target.to_string_lossy().into_owned(),
        format: publish_format.as_str().into(),
        page_count: summary.page_count,
        bytes_written: bytes.len() as u64,
        replaced,
        published_at: published_at_millis(),
    })
}

fn validate_publish_path(value: &str) -> ValidationResult<PathBuf> {
    if value.is_empty() || value.contains('\0') || value.chars().count() > MAX_PUBLISH_PATH_CHARS {
        return Err(ValidationError::new("invalid_publish_path", None));
    }
    let path = PathBuf::from(value);
    if path.file_name().is_none() {
        return Err(ValidationError::new("invalid_publish_path", None));
    }
    Ok(path)
}

fn validate_publish_extension(path: &Path, format: PublishFormat) -> ValidationResult<()> {
    let extension = path.extension().and_then(|value| value.to_str());
    if !extension.is_some_and(|value| value.eq_ignore_ascii_case(format.extension())) {
        return Err(ValidationError::new(
            "publish_extension_mismatch",
            Some(format!("Expected a .{} file.", format.extension())),
        ));
    }
    Ok(())
}

fn validate_plot_payload(
    bytes: &[u8],
    format: PublishFormat,
) -> ValidationResult<ValidationSummary> {
    validate_plot_payload_size(bytes.len())?;
    match format {
        PublishFormat::Pdf => validate_pdf(bytes),
        PublishFormat::Dwfx => validate_dwfx(bytes),
    }
}

fn validate_plot_payload_size(size: usize) -> ValidationResult<()> {
    if size == 0 {
        return Err(ValidationError::new("empty_publish_payload", None));
    }
    if size > MAX_PLOT_FILE_BYTES {
        return Err(ValidationError::new(
            "publish_payload_too_large",
            Some(format!(
                "The published file exceeds the {} byte limit.",
                MAX_PLOT_FILE_BYTES
            )),
        ));
    }
    Ok(())
}

fn validate_pdf(bytes: &[u8]) -> ValidationResult<ValidationSummary> {
    let valid_version = bytes.get(5..8).is_some_and(|version| {
        (version[0] == b'1' && version[1] == b'.' && (b'0'..=b'7').contains(&version[2]))
            || version == b"2.0"
    });
    if !bytes.starts_with(b"%PDF-") || !valid_version {
        return Err(invalid_pdf("The PDF header or version is invalid."));
    }

    let trimmed = trim_ascii_whitespace_end(bytes);
    if !trimmed.ends_with(b"%%EOF") {
        return Err(invalid_pdf("The PDF end-of-file marker is missing."));
    }
    let trailer_start = trimmed.len().saturating_sub(PDF_TRAILER_SEARCH_BYTES);
    if !contains_bytes(&trimmed[trailer_start..], b"startxref") {
        return Err(invalid_pdf("The PDF cross-reference trailer is missing."));
    }

    Ok(ValidationSummary::default())
}

fn invalid_pdf(detail: &str) -> ValidationError {
    ValidationError::new("invalid_pdf", Some(detail.into()))
}

fn validate_dwfx(bytes: &[u8]) -> ValidationResult<ValidationSummary> {
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err(invalid_dwfx("The DWFx ZIP signature is invalid."));
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| invalid_dwfx(&format!("The DWFx package cannot be opened: {error}")))?;
    if archive.len() == 0 || archive.len() > MAX_DWFX_ENTRIES {
        return Err(invalid_dwfx("The DWFx package entry count is invalid."));
    }

    let mut paths = HashSet::with_capacity(archive.len());
    let mut uncompressed_bytes = 0_u64;
    let mut content_types = None;
    let mut root_relationships = None;
    let mut fixed_document_sequence = None;
    let mut dwf_document_sequence = None;
    let mut dwf_manifest = None;
    let mut eplot_descriptor = None;
    let mut eplot_descriptor_relationships = Vec::new();
    let mut fixed_document_count = 0_usize;
    let mut fixed_page_count = 0_usize;
    let mut graphics_extension_count = 0_usize;
    let mut dwf_properties_count = 0_usize;
    let mut dwf_sequence_relationships = 0_usize;
    let mut manifest_relationships = 0_usize;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| {
            invalid_dwfx(&format!("A DWFx package entry is unreadable: {error}"))
        })?;
        let name = entry.name().to_string();
        if entry.encrypted()
            || entry.is_symlink()
            || entry.is_dir()
            || entry.enclosed_name().is_none()
            || !is_safe_opc_part_name(&name)
            || !paths.insert(name.clone())
        {
            return Err(invalid_dwfx(&format!(
                "The DWFx package contains an unsafe or duplicate entry: {name}"
            )));
        }
        if entry.size() > MAX_DWFX_ENTRY_BYTES {
            return Err(invalid_dwfx(&format!(
                "The DWFx package entry is too large: {name}"
            )));
        }
        uncompressed_bytes = uncompressed_bytes
            .checked_add(entry.size())
            .filter(|total| *total <= MAX_DWFX_UNCOMPRESSED_BYTES)
            .ok_or_else(|| invalid_dwfx("The expanded DWFx package is too large."))?;

        let lower_name = name.to_ascii_lowercase();
        if name == "[Content_Types].xml" {
            content_types = Some(read_dwfx_xml(&mut entry, &name)?);
        } else if name == "_rels/.rels" {
            root_relationships = Some(read_dwfx_xml(&mut entry, &name)?);
        } else if lower_name.ends_with(".fdseq") {
            if fixed_document_sequence.is_some() {
                return Err(invalid_dwfx(
                    "The DWFx package contains more than one fixed document sequence.",
                ));
            }
            fixed_document_sequence = Some(read_dwfx_xml(&mut entry, &name)?);
        } else if lower_name.ends_with(".dwfseq") {
            if dwf_document_sequence.is_some() {
                return Err(invalid_dwfx(
                    "The DWFx package contains more than one DWF document sequence.",
                ));
            }
            dwf_document_sequence = Some(read_dwfx_xml(&mut entry, &name)?);
        } else if lower_name.ends_with("/_rels/manifest.xml.rels") {
            manifest_relationships += 1;
        } else if lower_name == "_rels/dwfdocumentsequence.dwfseq.rels" {
            dwf_sequence_relationships += 1;
        } else if lower_name.starts_with("dwf/documents/") && lower_name.ends_with("/manifest.xml")
        {
            if dwf_manifest.is_some() {
                return Err(invalid_dwfx(
                    "The DWFx package contains more than one DWF manifest.",
                ));
            }
            dwf_manifest = Some(read_dwfx_xml(&mut entry, &name)?);
        } else if lower_name.ends_with("dwfproperties.xml") {
            dwf_properties_count += 1;
        } else if lower_name.contains("/sections/com.autodesk.dwf.eplot_")
            && lower_name.ends_with("/descriptor.xml")
            && eplot_descriptor.is_none()
        {
            eplot_descriptor = Some(read_dwfx_xml(&mut entry, &name)?);
        } else if lower_name.contains("/sections/com.autodesk.dwf.eplot_")
            && lower_name.ends_with("/_rels/descriptor.xml.rels")
        {
            eplot_descriptor_relationships.push(read_dwfx_xml(&mut entry, &name)?);
        } else if lower_name.contains("/sections/com.autodesk.dwf.eplot_")
            && lower_name.ends_with(".xml")
        {
            let extension = read_dwfx_xml(&mut entry, &name)?.to_ascii_lowercase();
            if extension.contains("<w2x")
                && extension.contains("versionmajor=\"7\"")
                && (extension.contains("<renditionsync")
                    || (extension.contains("<units ")
                        && extension.contains("<named_view ")
                        && extension.contains("<png_group4_image ")
                        && extension.contains("ref=\"page.png\"")))
            {
                graphics_extension_count += 1;
            }
        } else if lower_name.ends_with(".fdoc") {
            fixed_document_count += 1;
        } else if lower_name.ends_with(".fpage") {
            fixed_page_count += 1;
        }
    }

    let content_types = content_types
        .ok_or_else(|| invalid_dwfx("The DWFx content-type manifest is missing."))?
        .to_ascii_lowercase();
    for required in [
        "application/vnd.adsk-package.dwfx-dwfdocumentsequence+xml",
        "application/vnd.ms-package.xps-fixeddocumentsequence+xml",
        "application/vnd.ms-package.xps-fixeddocument+xml",
        "application/vnd.ms-package.xps-fixedpage+xml",
    ] {
        if !content_types.contains(required) {
            return Err(invalid_dwfx(
                "The DWFx content-type manifest is incomplete.",
            ));
        }
    }

    let root_relationships = root_relationships
        .ok_or_else(|| invalid_dwfx("The DWFx root relationships are missing."))?
        .to_ascii_lowercase();
    if !root_relationships.contains("fixedrepresentation") {
        return Err(invalid_dwfx(
            "The DWFx fixed-representation relationship is missing.",
        ));
    }
    if !root_relationships.contains("schemas.autodesk.com/dwfx/2007/relationships/documentsequence")
    {
        return Err(invalid_dwfx(
            "The Autodesk DWF document-sequence relationship is missing.",
        ));
    }

    let fixed_document_sequence = fixed_document_sequence
        .ok_or_else(|| invalid_dwfx("The DWFx fixed document sequence is missing."))?
        .to_ascii_lowercase();
    if !fixed_document_sequence.contains("fixeddocumentsequence")
        || !fixed_document_sequence.contains("documentreference")
        || fixed_document_count == 0
        || fixed_page_count == 0
    {
        return Err(invalid_dwfx(
            "The DWFx fixed document structure is incomplete.",
        ));
    }
    if graphics_extension_count != fixed_page_count {
        return Err(invalid_dwfx(
            "Every DWFx ePlot page requires one W2X graphics extension.",
        ));
    }

    let dwf_document_sequence = dwf_document_sequence
        .ok_or_else(|| invalid_dwfx("The Autodesk DWF document sequence is missing."))?
        .to_ascii_lowercase();
    if !dwf_document_sequence.contains("dwfdocumentsequence")
        || !dwf_document_sequence.contains("manifestreference")
        || dwf_sequence_relationships != 1
    {
        return Err(invalid_dwfx(
            "The Autodesk DWF document sequence is incomplete.",
        ));
    }

    let dwf_manifest = dwf_manifest
        .ok_or_else(|| invalid_dwfx("The Autodesk DWF manifest is missing."))?
        .to_ascii_lowercase();
    if !dwf_manifest.contains("dwf-manifest:6.0")
        || !dwf_manifest.contains("com.autodesk.dwf.eplot")
        || !dwf_manifest.contains("application/vnd.adsk-package.dwfx-fixedpage+xml")
        || !dwf_manifest.contains("role=\"descriptor\"")
        || manifest_relationships != 1
        || dwf_properties_count != 1
    {
        return Err(invalid_dwfx("The Autodesk DWF manifest is incomplete."));
    }

    let eplot_descriptor = eplot_descriptor
        .ok_or_else(|| invalid_dwfx("The DWFx ePlot descriptor is missing."))?
        .to_ascii_lowercase();
    if !eplot_descriptor.contains("dwf-eplot:1.2")
        || !eplot_descriptor.contains("graphicresource")
        || !eplot_descriptor.contains("2d streaming graphics")
        || !eplot_descriptor.contains("2d graphics extension")
    {
        return Err(invalid_dwfx("The DWFx ePlot descriptor is incomplete."));
    }
    if !eplot_descriptor_relationships.iter().any(|relationships| {
        let relationships = relationships.to_ascii_lowercase();
        relationships.contains("schemas.autodesk.com/dwfx/2007/relationships/requiredresource")
            && relationships.contains(
                "schemas.autodesk.com/dwfx/2007/relationships/graphics2dextensionresource",
            )
    }) {
        return Err(invalid_dwfx(
            "The DWFx 2D graphics-extension relationships are incomplete.",
        ));
    }
    if eplot_descriptor.contains("raster reference")
        && !eplot_descriptor_relationships.iter().any(|relationships| {
            let relationships = relationships.to_ascii_lowercase();
            relationships.contains("schemas.autodesk.com/dwfx/2007/relationships/requiredresource")
                && relationships.contains(
                    "schemas.autodesk.com/dwfx/2007/relationships/rasterreferenceresource",
                )
        })
    {
        return Err(invalid_dwfx(
            "The DWFx raster-reference dependency relationships are incomplete.",
        ));
    }
    if eplot_descriptor.contains("raster overlay")
        && !eplot_descriptor_relationships.iter().any(|relationships| {
            let relationships = relationships.to_ascii_lowercase();
            relationships.contains("schemas.autodesk.com/dwfx/2007/relationships/requiredresource")
                && relationships.contains(
                    "schemas.autodesk.com/dwfx/2007/relationships/rasteroverlayresource",
                )
        })
    {
        return Err(invalid_dwfx(
            "The DWFx raster-overlay dependency relationships are incomplete.",
        ));
    }

    Ok(ValidationSummary {
        page_count: Some(fixed_page_count),
    })
}

fn invalid_dwfx(detail: &str) -> ValidationError {
    ValidationError::new("invalid_dwfx", Some(detail.into()))
}

fn read_dwfx_xml<R: Read>(reader: &mut R, name: &str) -> ValidationResult<String> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_DWFX_XML_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            invalid_dwfx(&format!("The DWFx XML part {name} is unreadable: {error}"))
        })?;
    if bytes.len() as u64 > MAX_DWFX_XML_BYTES {
        return Err(invalid_dwfx(&format!(
            "The DWFx XML part is too large: {name}"
        )));
    }
    String::from_utf8(bytes)
        .map_err(|_| invalid_dwfx(&format!("The DWFx XML part is not UTF-8: {name}")))
}

fn is_safe_opc_part_name(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.contains('\0')
        && !value.contains("//")
        && !value
            .split('/')
            .any(|component| component.is_empty() || matches!(component, "." | ".."))
}

fn trim_ascii_whitespace_end(mut value: &[u8]) -> &[u8] {
    while value.last().is_some_and(u8::is_ascii_whitespace) {
        value = &value[..value.len() - 1];
    }
    value
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

pub(crate) fn atomic_write_plot_file(path: &Path, bytes: &[u8]) -> Result<bool, String> {
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent_metadata = fs::metadata(parent).map_err(|error| {
        publish_error(
            "publish_parent_unavailable",
            Some(path),
            Some(error.to_string()),
        )
    })?;
    if !parent_metadata.is_dir() {
        return Err(publish_error(
            "publish_parent_unavailable",
            Some(path),
            Some("The parent path is not a directory.".into()),
        ));
    }

    let replaced = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(publish_error("publish_target_is_symlink", Some(path), None));
        }
        Ok(metadata) if !metadata.is_file() => {
            return Err(publish_error(
                "publish_target_is_not_file",
                Some(path),
                None,
            ));
        }
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => {
            return Err(publish_error(
                "inspect_publish_target",
                Some(path),
                Some(error.to_string()),
            ));
        }
    };

    let (temporary_path, file) = create_neighbor_temporary_file(path).map_err(|error| {
        publish_error(
            "create_publish_temporary",
            Some(path),
            Some(error.to_string()),
        )
    })?;
    let result = (|| {
        let mut writer = BufWriter::new(file);
        writer.write_all(bytes).map_err(|error| {
            publish_error("write_publish_file", Some(path), Some(error.to_string()))
        })?;
        writer.flush().map_err(|error| {
            publish_error("flush_publish_file", Some(path), Some(error.to_string()))
        })?;
        writer.get_ref().sync_all().map_err(|error| {
            publish_error("sync_publish_file", Some(path), Some(error.to_string()))
        })?;
        drop(writer);

        replace_file(&temporary_path, path).map_err(|error| {
            publish_error("replace_publish_file", Some(path), Some(error.to_string()))
        })?;
        sync_parent_directory(parent).map_err(|error| {
            publish_error(
                "sync_publish_directory",
                Some(path),
                Some(error.to_string()),
            )
        })?;
        Ok(replaced)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

fn create_neighbor_temporary_file(path: &Path) -> io::Result<(PathBuf, File)> {
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing file name"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    for _ in 0..TEMP_FILE_ATTEMPTS {
        let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let mut temporary_name = OsString::from(".");
        temporary_name.push(file_name);
        temporary_name.push(format!(".{}.{}.{}.tmp", std::process::id(), nonce, counter));
        let temporary_path = parent.join(temporary_name);
        match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
        {
            Ok(file) => return Ok((temporary_path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a neighboring temporary file",
    ))
}

#[cfg(not(target_os = "windows"))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(target_os = "windows")]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x0000_0001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;

    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

fn raw_error_path(value: &str) -> Option<&Path> {
    (!value.is_empty()).then(|| Path::new(value))
}

fn publish_error(code: &'static str, path: Option<&Path>, detail: Option<String>) -> String {
    serde_json::to_string(&PublishPlotErrorPayload {
        code,
        path: path.map(|value| value.to_string_lossy().into_owned()),
        detail,
    })
    .expect("serializing a LUMCAD publish error cannot fail")
}

fn published_at_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintPageProfile {
    width_mm: f64,
    height_mm: f64,
    width_points: f64,
    height_points: f64,
}

#[tauri::command]
pub fn prepare_print_page(width_mm: f64, height_mm: f64) -> Result<PrintPageProfile, String> {
    let profile = print_page_profile(width_mm, height_mm)?;

    #[cfg(target_os = "macos")]
    configure_macos_print_info(profile);

    Ok(profile)
}

fn print_page_profile(width_mm: f64, height_mm: f64) -> Result<PrintPageProfile, String> {
    if !width_mm.is_finite()
        || !height_mm.is_finite()
        || !(MIN_PAPER_MM..=MAX_PAPER_MM).contains(&width_mm)
        || !(MIN_PAPER_MM..=MAX_PAPER_MM).contains(&height_mm)
    {
        return Err("The requested PDF paper size is invalid.".into());
    }
    Ok(PrintPageProfile {
        width_mm,
        height_mm,
        // Cocoa and WebKit do not always quantize physical sizes in the same
        // direction. Rounding the native paper outward to a thousandth of a
        // point prevents the requested sheet from becoming microscopically
        // smaller than the exact CSS @page boundary.
        width_points: round_paper_points_outward(width_mm * POINTS_PER_MM),
        height_points: round_paper_points_outward(height_mm * POINTS_PER_MM),
    })
}

fn round_paper_points_outward(points: f64) -> f64 {
    (points * PAPER_POINT_QUANTUM).ceil() / PAPER_POINT_QUANTUM
}

fn portrait_paper_points(profile: PrintPageProfile) -> (f64, f64) {
    if profile.width_mm >= profile.height_mm {
        (profile.height_points, profile.width_points)
    } else {
        (profile.width_points, profile.height_points)
    }
}

#[cfg(target_os = "macos")]
fn configure_macos_print_info(profile: PrintPageProfile) {
    use objc2_app_kit::{NSPaperOrientation, NSPrintInfo};
    use objc2_foundation::{NSSize, NSString};

    let print_info = NSPrintInfo::sharedPrintInfo();
    let landscape = profile.width_mm >= profile.height_mm;
    let (portrait_width, portrait_height) = portrait_paper_points(profile);
    let paper_name = NSString::from_str(&format!(
        "LUMCAD {:.0}x{:.0} mm",
        profile.width_mm, profile.height_mm
    ));
    print_info.setPaperName(Some(&paper_name));
    print_info.setPaperSize(NSSize::new(portrait_width, portrait_height));
    print_info.setOrientation(if landscape {
        NSPaperOrientation::Landscape
    } else {
        NSPaperOrientation::Portrait
    });
    print_info.setTopMargin(0.0);
    print_info.setRightMargin(0.0);
    print_info.setBottomMargin(0.0);
    print_info.setLeftMargin(0.0);
    print_info.setHorizontallyCentered(false);
    print_info.setVerticallyCentered(false);
    NSPrintInfo::setSharedPrintInfo(&print_info);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="dwfseq" ContentType="application/vnd.adsk-package.dwfx-dwfdocumentsequence+xml"/>
  <Override PartName="/FixedDocSeq.fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml"/>
  <Override PartName="/Documents/1/FixedDoc.fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml"/>
  <Override PartName="/Documents/1/Pages/1.fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml"/>
</Types>"#;
    const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="R1" Type="http://schemas.microsoft.com/xps/2005/06/fixedrepresentation" Target="/FixedDocSeq.fdseq"/>
  <Relationship Id="R2" Type="http://schemas.autodesk.com/dwfx/2007/relationships/documentsequence" Target="/DWFDocumentSequence.dwfseq"/>
</Relationships>"#;
    const FIXED_DOCUMENT_SEQUENCE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<FixedDocumentSequence xmlns="http://schemas.microsoft.com/xps/2005/06">
  <DocumentReference Source="/Documents/1/FixedDoc.fdoc"/>
</FixedDocumentSequence>"#;
    const FIXED_DOCUMENT: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<FixedDocument xmlns="http://schemas.microsoft.com/xps/2005/06">
  <PageContent Source="/dwf/documents/doc/sections/com.autodesk.dwf.ePlot_page/FixedPage.fpage"/>
</FixedDocument>"#;
    const FIXED_PAGE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="793.7" Height="1122.5"/>"#;
    const DWF_DOCUMENT_SEQUENCE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<DWFDocumentSequence xmlns="http://schemas.dwf.autodesk.com/dwfx/2006/11">
  <ManifestReference Source="/dwf/documents/doc/manifest.xml"/>
</DWFDocumentSequence>"#;
    const DWF_DOCUMENT_SEQUENCE_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="R1" Type="http://schemas.autodesk.com/dwfx/2007/relationships/document" Target="/dwf/documents/doc/manifest.xml"/>
</Relationships>"#;
    const DWF_MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<dwf:Manifest xmlns:dwf="DWF-Manifest:6.0" version="6.0">
  <dwf:Sections><dwf:Section type="com.autodesk.dwf.ePlot"><dwf:Toc>
    <dwf:Resource role="2d streaming graphics" mime="application/vnd.adsk-package.dwfx-fixedpage+xml" href="/dwf/documents/doc/sections/com.autodesk.dwf.ePlot_page/FixedPage.fpage?dwfresource_1"/>
    <dwf:Resource role="descriptor" mime="text/xml" href="/dwf/documents/doc/sections/com.autodesk.dwf.ePlot_page/descriptor.xml"/>
  </dwf:Toc></dwf:Section></dwf:Sections>
</dwf:Manifest>"#;
    const DWF_MANIFEST_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="R1" Type="http://schemas.autodesk.com/dwfx/2007/relationships/dwfproperties" Target="/dwf/documents/doc/DWFProperties.xml"/>
  <Relationship Id="R2" Type="http://schemas.autodesk.com/dwfx/2007/relationships/section" Target="/dwf/documents/doc/sections/com.autodesk.dwf.ePlot_page/descriptor.xml"/>
</Relationships>"#;
    const DWF_PROPERTIES: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<DWFProperties><Property name="DWFFormatVersion" value="7.00"/></DWFProperties>"#;
    const EPLOT_DESCRIPTOR: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<ePlot:Page xmlns:ePlot="DWF-ePlot:1.2" version="1.2">
  <ePlot:Resources><ePlot:Resource role="2d graphics extension" mime="text/xml"/><ePlot:GraphicResource role="2d streaming graphics" mime="application/vnd.adsk-package.dwfx-fixedpage+xml"/><ePlot:ImageResource role="raster reference" mime="image/png"/></ePlot:Resources>
</ePlot:Page>"#;
    const EPLOT_DESCRIPTOR_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="R1" Type="http://schemas.autodesk.com/dwfx/2007/relationships/requiredresource" Target="/dwf/documents/doc/sections/com.autodesk.dwf.ePlot_page/page.png"/>
  <Relationship Id="R2" Type="http://schemas.autodesk.com/dwfx/2007/relationships/rasterreferenceresource" Target="/dwf/documents/doc/sections/com.autodesk.dwf.ePlot_page/page.png"/>
  <Relationship Id="R3" Type="http://schemas.autodesk.com/dwfx/2007/relationships/graphics2dextensionresource" Target="/dwf/documents/doc/sections/com.autodesk.dwf.ePlot_page/graphics.w2x.xml"/>
</Relationships>"#;
    const EPLOT_GRAPHICS_EXTENSION: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<W2X VersionMajor="7" VersionMinor="0" NamePrefix="LUMCAD_1_">
  <View refName="LUMCAD_1_1" Area="0,0,1,1"/>
  <RenditionSync refName="LUMCAD_1_1"/>
</W2X>"#;

    #[test]
    fn image_exports_validate_destination_and_preserve_existing_files_on_failure() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("drawing.png");
        fs::write(&path, b"original").unwrap();
        let png = include_bytes!("../icons/128x128.png").to_vec();
        assert!(write_drawing_image(path.to_string_lossy().into_owned(), b"invalid".to_vec(), "png".into()).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert!(write_drawing_image("relative.png".into(), png.clone(), "png".into()).is_err());
        assert!(write_drawing_image(directory.path().join("wrong.lcad").to_string_lossy().into_owned(), png.clone(), "png".into()).is_err());
        write_drawing_image(path.to_string_lossy().into_owned(), png.clone(), "png".into()).unwrap();
        assert_eq!(fs::read(path).unwrap(), png);
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0L1 1\"/></svg>".to_vec();
        let vector_path = directory.path().join("drawing.svg");
        write_drawing_image(vector_path.to_string_lossy().into_owned(), svg.clone(), "svg".into()).unwrap();
        assert_eq!(fs::read(vector_path).unwrap(), svg);
    }

    #[test]
    fn accepts_raster_w2x_without_legacy_rendition_sync() {
        let raster = r#"<W2X VersionMajor="7" VersionMinor="0"><Units Label="inches"/><Named_View Area="0 0 210000 297000"/><PNG_Group4_Image Format="12" Ref="page.png" Width="1" Height="1"/></W2X>"#;
        let entries = valid_dwfx_entries()
            .into_iter()
            .map(|(name, value)| (name, if name.ends_with("graphics.w2x.xml") { raster } else { value }))
            .collect::<Vec<_>>();
        assert_eq!(validate_dwfx(&zip_entries(&entries)).unwrap().page_count, Some(1));
        let malformed = raster.replace("PNG_Group4_Image", "Unknown_Image");
        let invalid = entries.iter().map(|(name, value)| (*name, if name.ends_with("graphics.w2x.xml") { malformed.as_str() } else { *value })).collect::<Vec<_>>();
        assert!(validate_dwfx(&zip_entries(&invalid)).is_err());
    }

    #[test]
    fn validates_bounded_pdf_envelopes() {
        assert_eq!(
            validate_plot_payload(valid_pdf(), PublishFormat::Pdf).unwrap(),
            ValidationSummary::default()
        );
        for bytes in [
            b"not a PDF".as_slice(),
            b"%PDF-9.9\nstartxref\n0\n%%EOF".as_slice(),
            b"%PDF-1.7\n%%EOF".as_slice(),
            b"%PDF-1.7\nstartxref\n0".as_slice(),
        ] {
            assert_eq!(validate_pdf(bytes).unwrap_err().code, "invalid_pdf");
        }
        assert_eq!(
            validate_plot_payload_size(0).unwrap_err().code,
            "empty_publish_payload"
        );
        assert_eq!(
            validate_plot_payload_size(MAX_PLOT_FILE_BYTES + 1)
                .unwrap_err()
                .code,
            "publish_payload_too_large"
        );
    }

    #[test]
    fn validates_a_minimal_dwfx_package_and_counts_fixed_pages() {
        let bytes = valid_dwfx();
        assert_eq!(
            validate_plot_payload(&bytes, PublishFormat::Dwfx).unwrap(),
            ValidationSummary {
                page_count: Some(1)
            }
        );
    }

    #[test]
    fn rejects_unsafe_and_incomplete_dwfx_packages() {
        let mut unsafe_entries = valid_dwfx_entries();
        unsafe_entries.push(("../escape.xml", "<escape/>"));
        assert_eq!(
            validate_dwfx(&zip_entries(&unsafe_entries))
                .unwrap_err()
                .code,
            "invalid_dwfx"
        );

        let incomplete_entries = valid_dwfx_entries()
            .into_iter()
            .filter(|(name, _)| *name != "_rels/.rels")
            .collect::<Vec<_>>();
        assert_eq!(
            validate_dwfx(&zip_entries(&incomplete_entries))
                .unwrap_err()
                .code,
            "invalid_dwfx"
        );

        let missing_raster_dependencies = valid_dwfx_entries()
            .into_iter()
            .filter(|(name, _)| !name.ends_with("/_rels/descriptor.xml.rels"))
            .collect::<Vec<_>>();
        assert_eq!(
            validate_dwfx(&zip_entries(&missing_raster_dependencies))
                .unwrap_err()
                .code,
            "invalid_dwfx"
        );

        let xps_only_entries = valid_dwfx_entries()
            .into_iter()
            .filter(|(name, _)| {
                !name.contains("DWFDocumentSequence") && !name.starts_with("dwf/documents/")
            })
            .collect::<Vec<_>>();
        assert_eq!(
            validate_dwfx(&zip_entries(&xps_only_entries))
                .unwrap_err()
                .code,
            "invalid_dwfx"
        );
    }

    #[test]
    fn publishes_and_atomically_replaces_a_valid_pdf() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("drawing.PDF");
        let path_string = path.to_string_lossy().into_owned();

        let first =
            publish_plot_file(path_string.clone(), valid_pdf().to_vec(), "pdf".into()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), valid_pdf());
        assert_eq!(first.format, "pdf");
        assert_eq!(first.bytes_written, valid_pdf().len() as u64);
        assert_eq!(first.page_count, None);
        assert!(!first.replaced);

        let second_pdf = b"%PDF-2.0\n% second publish\nstartxref\n0\n%%EOF\n";
        let second = publish_plot_file(path_string, second_pdf.to_vec(), "pdf".into()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), second_pdf);
        assert!(second.replaced);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);

        let serialized = serde_json::to_value(second).unwrap();
        assert_eq!(serialized["bytesWritten"], second_pdf.len());
        assert!(serialized.get("publishedAt").is_some());
        assert!(serialized.get("pageCount").is_none());
    }

    #[test]
    fn spreadsheet_exports_validate_before_atomic_replacement() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("quantities.xls");
        std::fs::write(&path, b"original").unwrap();
        let name = path.to_string_lossy().to_string();
        assert!(write_spreadsheet_export(name.clone(), vec![0; 512]).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        let mut payload = vec![0; 512];
        payload[..8].copy_from_slice(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
        assert!(write_spreadsheet_export("relative.xls".into(), payload.clone()).is_err());
        assert!(write_spreadsheet_export(directory.path().join("wrong.lcad").to_string_lossy().to_string(), payload.clone()).is_err());
        write_spreadsheet_export(name, payload.clone()).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), payload);
    }

    #[test]
    fn wmf_exports_validate_before_atomic_replacement() {
        let hex = "01000900000316000000000005000000000005000000140214000a0005000000130228001e00030000000000";
        let valid: Vec<u8> = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect();
        let directory = tempdir().unwrap();
        let path = directory.path().join("drawing.wmf");
        let name = path.to_string_lossy().into_owned();
        fs::write(&path, b"original").unwrap();
        let mut oversized_record = valid.clone(); oversized_record[18..22].copy_from_slice(&u32::MAX.to_le_bytes());
        let mut early_end = valid.clone(); early_end[22..24].fill(0);
        let mut wrong_length = valid.clone(); wrong_length[6] = 0;
        for invalid in [vec![], valid[..valid.len() - 2].to_vec(), oversized_record, early_end, wrong_length] {
            assert!(write_drawing_wmf(name.clone(), invalid).is_err());
            assert_eq!(fs::read(&path).unwrap(), b"original");
        }
        assert!(write_drawing_wmf("relative.wmf".into(), valid.clone()).is_err());
        assert!(write_drawing_wmf(directory.path().join("wrong.lcad").to_string_lossy().into_owned(), valid.clone()).is_err());
        write_drawing_wmf(name, valid.clone()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), valid);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn wmf_placeable_checksum_and_short_inputs_are_validated_without_panics() {
        let mut bytes = vec![0u8; 46];
        bytes[..4].copy_from_slice(&0x9ac6cdd7u32.to_le_bytes());
        bytes[10..12].copy_from_slice(&100i16.to_le_bytes());
        bytes[12..14].copy_from_slice(&100i16.to_le_bytes());
        bytes[14..16].copy_from_slice(&1440u16.to_le_bytes());
        let checksum = (0..20).step_by(2).fold(0u16, |sum, i| sum ^ u16::from_le_bytes([bytes[i], bytes[i + 1]]));
        bytes[20..22].copy_from_slice(&checksum.to_le_bytes());
        bytes[22] = 1; bytes[24] = 9; bytes[27] = 3; bytes[28] = 12; bytes[34] = 3; bytes[40] = 3;
        assert!(validate_wmf_export(&bytes).is_ok());
        for end in 0..bytes.len() { assert!(validate_wmf_export(&bytes[..end]).is_err()); }
        bytes[20] ^= 1;
        assert!(validate_wmf_export(&bytes).is_err());
    }

    #[test]
    fn attribute_exports_validate_before_atomic_replacement() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("attributes.json");
        let name = path.to_string_lossy().into_owned();
        fs::write(&path, b"original").unwrap();
        assert!(write_attribute_export(name.clone(), "invalid".into(), "json".into()).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert!(write_attribute_export(name.clone(), "{}".into(), "csv".into()).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        write_attribute_export(name, "{\"records\":[]}".into(), "json".into()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"{\"records\":[]}");
        assert!(write_attribute_export("relative.csv".into(), "a,b".into(), "csv".into()).is_err());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn publishes_dwfx_with_a_structured_page_count() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("drawing.dwfx");
        let bytes = valid_dwfx();
        let result = publish_plot_file(
            path.to_string_lossy().into_owned(),
            bytes.clone(),
            "dwfx".into(),
        )
        .unwrap();
        assert_eq!(fs::read(path).unwrap(), bytes);
        assert_eq!(result.page_count, Some(1));
        let serialized = serde_json::to_value(result).unwrap();
        assert_eq!(serialized["pageCount"], 1);
    }

    #[test]
    fn rejects_mismatched_formats_and_preserves_an_existing_target() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("drawing.pdf");
        fs::write(&path, b"existing").unwrap();
        let path_string = path.to_string_lossy().into_owned();

        let invalid_format =
            publish_plot_file(path_string.clone(), valid_pdf().to_vec(), "PDF".into()).unwrap_err();
        assert_eq!(
            publish_error_code(&invalid_format),
            "invalid_publish_format"
        );

        let wrong_extension =
            publish_plot_file(path_string.clone(), valid_dwfx(), "dwfx".into()).unwrap_err();
        assert_eq!(
            publish_error_code(&wrong_extension),
            "publish_extension_mismatch"
        );

        let invalid_payload =
            publish_plot_file(path_string, b"broken".to_vec(), "pdf".into()).unwrap_err();
        assert_eq!(publish_error_code(&invalid_payload), "invalid_pdf");
        assert_eq!(fs::read(path).unwrap(), b"existing");
    }

    #[test]
    fn rejects_invalid_paths_and_non_file_targets() {
        assert_eq!(
            validate_publish_path("").unwrap_err().code,
            "invalid_publish_path"
        );
        assert_eq!(
            validate_publish_path(&"x".repeat(MAX_PUBLISH_PATH_CHARS + 1))
                .unwrap_err()
                .code,
            "invalid_publish_path"
        );

        let directory = tempdir().unwrap();
        let target_directory = directory.path().join("folder.pdf");
        fs::create_dir(&target_directory).unwrap();
        let error = publish_plot_file(
            target_directory.to_string_lossy().into_owned(),
            valid_pdf().to_vec(),
            "pdf".into(),
        )
        .unwrap_err();
        assert_eq!(publish_error_code(&error), "publish_target_is_not_file");

        let missing_parent = directory.path().join("missing/drawing.pdf");
        let error = publish_plot_file(
            missing_parent.to_string_lossy().into_owned(),
            valid_pdf().to_vec(),
            "pdf".into(),
        )
        .unwrap_err();
        assert_eq!(publish_error_code(&error), "publish_parent_unavailable");
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_replace_a_symbolic_link_target() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let destination = directory.path().join("destination.pdf");
        let link = directory.path().join("drawing.pdf");
        fs::write(&destination, b"destination").unwrap();
        symlink(&destination, &link).unwrap();
        let error = publish_plot_file(
            link.to_string_lossy().into_owned(),
            valid_pdf().to_vec(),
            "pdf".into(),
        )
        .unwrap_err();
        assert_eq!(publish_error_code(&error), "publish_target_is_symlink");
        assert_eq!(fs::read(destination).unwrap(), b"destination");
    }

    #[test]
    fn converts_a0_landscape_from_millimetres_to_native_points() {
        let profile = print_page_profile(1189.0, 841.0).unwrap();
        assert!((profile.width_points - 3370.394).abs() < 1e-9);
        assert!((profile.height_points - 2383.938).abs() < 1e-9);
    }

    #[test]
    fn rejects_unbounded_native_paper_sizes() {
        assert!(print_page_profile(0.0, 841.0).is_err());
        assert!(print_page_profile(f64::NAN, 841.0).is_err());
        assert!(print_page_profile(10_000.0, 841.0).is_err());
    }

    #[test]
    fn normalizes_native_paper_dimensions_before_applying_landscape_orientation() {
        let landscape = print_page_profile(1189.0, 841.0).unwrap();
        let portrait = print_page_profile(841.0, 1189.0).unwrap();
        let expected = (portrait.width_points, portrait.height_points);
        assert_eq!(portrait_paper_points(landscape), expected);
        assert_eq!(portrait_paper_points(portrait), expected);
    }

    #[test]
    fn preserves_every_iso_a_series_dimension_in_both_orientations() {
        for (short_side, long_side) in [
            (210.0, 297.0),
            (297.0, 420.0),
            (420.0, 594.0),
            (594.0, 841.0),
            (841.0, 1189.0),
        ] {
            let landscape = print_page_profile(long_side, short_side).unwrap();
            let portrait = print_page_profile(short_side, long_side).unwrap();
            let expected_portrait_points = (
                round_paper_points_outward(short_side * POINTS_PER_MM),
                round_paper_points_outward(long_side * POINTS_PER_MM),
            );

            assert_eq!(portrait_paper_points(landscape), expected_portrait_points);
            assert_eq!(portrait_paper_points(portrait), expected_portrait_points);
            assert!((landscape.width_mm - long_side).abs() < f64::EPSILON);
            assert!((landscape.height_mm - short_side).abs() < f64::EPSILON);
            assert!((portrait.width_mm - short_side).abs() < f64::EPSILON);
            assert!((portrait.height_mm - long_side).abs() < f64::EPSILON);
        }
    }

    #[test]
    fn native_point_rounding_never_reduces_exact_a_series_bounds() {
        for millimetres in [210.0, 297.0, 420.0, 594.0, 841.0, 1189.0] {
            let exact = millimetres * POINTS_PER_MM;
            let rounded = round_paper_points_outward(exact);
            assert!(rounded >= exact);
            assert!(rounded - exact < 0.001 + f64::EPSILON);
            assert!((rounded * PAPER_POINT_QUANTUM).fract().abs() < 1e-7);
        }
    }

    fn valid_pdf() -> &'static [u8] {
        b"%PDF-1.7\n% LUMCAD test PDF\nstartxref\n0\n%%EOF\n"
    }

    fn valid_dwfx() -> Vec<u8> {
        zip_entries(&valid_dwfx_entries())
    }

    fn valid_dwfx_entries() -> Vec<(&'static str, &'static str)> {
        vec![
            ("[Content_Types].xml", CONTENT_TYPES),
            ("_rels/.rels", ROOT_RELS),
            ("FixedDocSeq.fdseq", FIXED_DOCUMENT_SEQUENCE),
            ("Documents/1/FixedDoc.fdoc", FIXED_DOCUMENT),
            (
                "dwf/documents/doc/sections/com.autodesk.dwf.ePlot_page/FixedPage.fpage",
                FIXED_PAGE,
            ),
            ("DWFDocumentSequence.dwfseq", DWF_DOCUMENT_SEQUENCE),
            (
                "_rels/DWFDocumentSequence.dwfseq.rels",
                DWF_DOCUMENT_SEQUENCE_RELS,
            ),
            ("dwf/documents/doc/manifest.xml", DWF_MANIFEST),
            (
                "dwf/documents/doc/_rels/manifest.xml.rels",
                DWF_MANIFEST_RELS,
            ),
            ("dwf/documents/doc/DWFProperties.xml", DWF_PROPERTIES),
            (
                "dwf/documents/doc/sections/com.autodesk.dwf.ePlot_page/descriptor.xml",
                EPLOT_DESCRIPTOR,
            ),
            (
                "dwf/documents/doc/sections/com.autodesk.dwf.ePlot_page/_rels/descriptor.xml.rels",
                EPLOT_DESCRIPTOR_RELS,
            ),
            (
                "dwf/documents/doc/sections/com.autodesk.dwf.ePlot_page/graphics.w2x.xml",
                EPLOT_GRAPHICS_EXTENSION,
            ),
        ]
    }

    fn zip_entries(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, contents) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(contents.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn publish_error_code(error: &str) -> String {
        serde_json::from_str::<serde_json::Value>(error).unwrap()["code"]
            .as_str()
            .unwrap()
            .to_string()
    }
}
