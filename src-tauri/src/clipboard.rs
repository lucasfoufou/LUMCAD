use std::collections::HashMap;

use serde::Serialize;

const LUMCAD_MIME_TYPE: &str = "application/x-lumcad-clipboard+json";
const SVG_MIME_TYPE: &str = "image/svg+xml";
const TEXT_MIME_TYPE: &str = "text/plain";
const MAX_CLIPBOARD_VALUE_BYTES: usize = 8 * 1024 * 1024;

#[cfg(target_os = "macos")]
const LUMCAD_PASTEBOARD_TYPE: &str = "com.lumcad.drawing-clipboard";
#[cfg(target_os = "macos")]
const SVG_PASTEBOARD_TYPES: [&str; 2] = ["public.svg-image", SVG_MIME_TYPE];
#[cfg(target_os = "macos")]
const TEXT_PASTEBOARD_TYPES: [&str; 3] = [
    "public.utf8-plain-text",
    "public.plain-text",
    TEXT_MIME_TYPE,
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawingClipboardWriteResult {
    types: Vec<String>,
}

#[tauri::command]
pub fn write_drawing_clipboard(
    formats: HashMap<String, String>,
) -> Result<DrawingClipboardWriteResult, String> {
    validate_write_formats(&formats)?;

    #[cfg(target_os = "macos")]
    {
        return macos::write(&formats);
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Native drawing clipboard formats are unavailable on this platform.".into())
    }
}

#[tauri::command]
pub fn read_drawing_clipboard() -> Result<HashMap<String, String>, String> {
    #[cfg(target_os = "macos")]
    {
        return macos::read();
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Native drawing clipboard formats are unavailable on this platform.".into())
    }
}

fn validate_write_formats(formats: &HashMap<String, String>) -> Result<(), String> {
    if formats.keys().any(|key| !matches!(
        key.as_str(),
        LUMCAD_MIME_TYPE | SVG_MIME_TYPE | TEXT_MIME_TYPE
    )) {
        return Err("The drawing clipboard contains an unsupported format.".into());
    }
    for format in [LUMCAD_MIME_TYPE, SVG_MIME_TYPE, TEXT_MIME_TYPE] {
        let value = formats
            .get(format)
            .ok_or_else(|| format!("The drawing clipboard is missing {format}."))?;
        if value.is_empty() || value.len() > MAX_CLIPBOARD_VALUE_BYTES {
            return Err(format!("The drawing clipboard {format} value is invalid."));
        }
    }
    let svg = formats.get(SVG_MIME_TYPE).expect("validated SVG format");
    let text = formats.get(TEXT_MIME_TYPE).expect("validated text format");
    if !svg.contains("<svg") || svg != text {
        return Err("The drawing clipboard SVG interchange is invalid.".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use std::collections::HashMap;

    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::NSString;

    use super::{
        DrawingClipboardWriteResult, LUMCAD_MIME_TYPE, LUMCAD_PASTEBOARD_TYPE,
        MAX_CLIPBOARD_VALUE_BYTES, SVG_MIME_TYPE, SVG_PASTEBOARD_TYPES, TEXT_MIME_TYPE,
        TEXT_PASTEBOARD_TYPES,
    };

    pub fn write(
        formats: &HashMap<String, String>,
    ) -> Result<DrawingClipboardWriteResult, String> {
        let pasteboard = NSPasteboard::generalPasteboard();
        write_to_pasteboard(&pasteboard, formats)
    }

    fn write_to_pasteboard(
        pasteboard: &NSPasteboard,
        formats: &HashMap<String, String>,
    ) -> Result<DrawingClipboardWriteResult, String> {
        pasteboard.clearContents();

        let json = formats.get(LUMCAD_MIME_TYPE).expect("validated JSON format");
        let svg = formats.get(SVG_MIME_TYPE).expect("validated SVG format");
        let values = [
            (LUMCAD_PASTEBOARD_TYPE, json.as_str()),
            (SVG_PASTEBOARD_TYPES[0], svg.as_str()),
            (SVG_PASTEBOARD_TYPES[1], svg.as_str()),
            (TEXT_PASTEBOARD_TYPES[0], svg.as_str()),
        ];
        let mut written = Vec::with_capacity(values.len());
        for (data_type, value) in values {
            let ns_type = NSString::from_str(data_type);
            let ns_value = NSString::from_str(value);
            if !pasteboard.setString_forType(&ns_value, &ns_type) {
                pasteboard.clearContents();
                return Err(format!("The operating system rejected clipboard type {data_type}."));
            }
            written.push(data_type.to_owned());
        }
        Ok(DrawingClipboardWriteResult { types: written })
    }

    pub fn read() -> Result<HashMap<String, String>, String> {
        let pasteboard = NSPasteboard::generalPasteboard();
        read_from_pasteboard(&pasteboard)
    }

    fn read_from_pasteboard(pasteboard: &NSPasteboard) -> Result<HashMap<String, String>, String> {
        let available_types = pasteboard.types()
            .map(|types| types.iter().map(|value| value.to_string()).collect::<Vec<_>>())
            .unwrap_or_default();
        let mut formats = HashMap::new();

        if available_types.iter().any(|value| value == LUMCAD_PASTEBOARD_TYPE) {
            if let Some(value) = read_utf8_value(&pasteboard, LUMCAD_PASTEBOARD_TYPE)? {
                formats.insert(LUMCAD_MIME_TYPE.to_owned(), value);
            }
        }
        for data_type in SVG_PASTEBOARD_TYPES {
            if !available_types.iter().any(|value| value == data_type) {
                continue;
            }
            if let Some(value) = read_utf8_value(&pasteboard, data_type)? {
                formats.entry(SVG_MIME_TYPE.to_owned()).or_insert(value);
            }
        }
        for data_type in TEXT_PASTEBOARD_TYPES {
            if !available_types.iter().any(|value| value == data_type) {
                continue;
            }
            if let Some(value) = read_utf8_value(&pasteboard, data_type)? {
                formats.entry(TEXT_MIME_TYPE.to_owned()).or_insert(value);
            }
        }
        if formats.is_empty() {
            return Err("The operating-system clipboard has no supported drawing or SVG text.".into());
        }
        Ok(formats)
    }

    fn read_utf8_value(
        pasteboard: &NSPasteboard,
        data_type: &str,
    ) -> Result<Option<String>, String> {
        let ns_type = NSString::from_str(data_type);
        if let Some(value) = pasteboard.stringForType(&ns_type) {
            let value = value.to_string();
            if value.len() > MAX_CLIPBOARD_VALUE_BYTES {
                return Err("The clipboard value exceeds LUMCAD's safety limit.".into());
            }
            return Ok(Some(value));
        }
        let Some(data) = pasteboard.dataForType(&ns_type) else {
            return Ok(None);
        };
        if data.len() > MAX_CLIPBOARD_VALUE_BYTES {
            return Err("The clipboard value exceeds LUMCAD's safety limit.".into());
        }
        String::from_utf8(data.to_vec())
            .map(Some)
            .map_err(|_| "The clipboard value is not UTF-8 text.".into())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn native_named_pasteboard_round_trips_custom_svg_and_text_flavors() {
            let pasteboard = NSPasteboard::pasteboardWithUniqueName();
            let svg = "<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
            let formats = HashMap::from([
                (LUMCAD_MIME_TYPE.into(), "{\"format\":\"lumcad-clipboard\"}".into()),
                (SVG_MIME_TYPE.into(), svg.into()),
                (TEXT_MIME_TYPE.into(), svg.into()),
            ]);
            let result = write_to_pasteboard(&pasteboard, &formats).expect("write native formats");
            assert_eq!(result.types, [
                LUMCAD_PASTEBOARD_TYPE,
                SVG_PASTEBOARD_TYPES[0],
                SVG_PASTEBOARD_TYPES[1],
                TEXT_PASTEBOARD_TYPES[0],
            ]);
            let restored = read_from_pasteboard(&pasteboard).expect("read native formats");
            assert_eq!(restored.get(LUMCAD_MIME_TYPE), formats.get(LUMCAD_MIME_TYPE));
            assert_eq!(restored.get(SVG_MIME_TYPE), formats.get(SVG_MIME_TYPE));
            assert_eq!(restored.get(TEXT_MIME_TYPE), formats.get(TEXT_MIME_TYPE));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_formats() -> HashMap<String, String> {
        let svg = "<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        HashMap::from([
            (LUMCAD_MIME_TYPE.into(), "{\"format\":\"lumcad-clipboard\"}".into()),
            (SVG_MIME_TYPE.into(), svg.into()),
            (TEXT_MIME_TYPE.into(), svg.into()),
        ])
    }

    #[test]
    fn validates_the_bounded_three_flavor_contract() {
        assert!(validate_write_formats(&valid_formats()).is_ok());
        let mut missing = valid_formats();
        missing.remove(TEXT_MIME_TYPE);
        assert!(validate_write_formats(&missing).is_err());
        let mut mismatched = valid_formats();
        mismatched.insert(TEXT_MIME_TYPE.into(), "plain JSON".into());
        assert!(validate_write_formats(&mismatched).is_err());
        let mut unsupported = valid_formats();
        unsupported.insert("application/pdf".into(), "PDF".into());
        assert!(validate_write_formats(&unsupported).is_err());
    }

    #[test]
    fn rejects_oversized_native_values_before_touching_the_pasteboard() {
        let mut formats = valid_formats();
        formats.insert(LUMCAD_MIME_TYPE.into(), "x".repeat(MAX_CLIPBOARD_VALUE_BYTES + 1));
        assert!(validate_write_formats(&formats).is_err());
    }
}
