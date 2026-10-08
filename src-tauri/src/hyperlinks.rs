fn validated_web_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.encode_utf16().count() > 4096 || value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}') {
        return Err("hyperlinkUrl".into());
    }
    let url = url::Url::parse(value).map_err(|_| "hyperlinkUrl".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some() {
        return Err("hyperlinkUrl".into());
    }
    Ok(url.into())
}

#[tauri::command]
pub fn open_drawing_hyperlink(url: String) -> Result<(), String> {
    let url = validated_web_url(&url)?;
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("/usr/bin/open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32.exe").arg("url.dll,FileProtocolHandler").arg(&url).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(&url).status();
    if result.map(|status| status.success()).unwrap_or(false) { Ok(()) } else { Err("hyperlinkOpen".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_bounded_web_links_without_credentials_can_open() {
        assert_eq!(validated_web_url(" https://example.com/a.pdf#page=2 ").unwrap(), "https://example.com/a.pdf#page=2");
        for value in ["file:///tmp/a", "javascript:alert(1)", "data:text/plain,hello", "https://user:pass@example.com", "https://exa\nmple.com", "relative"] {
            assert!(validated_web_url(value).is_err(), "{value}");
        }
        assert!(validated_web_url(&format!("https://example.com/{}", "x".repeat(4096))).is_err());
    }
}
