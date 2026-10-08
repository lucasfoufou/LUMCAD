use std::{fs::File, io::{ErrorKind, Read}, path::{Path, PathBuf}, sync::Mutex};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const MAX_BYTES: u64 = 256 * 1024;
const MAX_ENTRIES: usize = 12;
static HISTORY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryHistoryEntry {
    id: String,
    recorded_at: u64,
    source_path: Option<String>,
    source_name: String,
    kind: String,
    complete: bool,
    limited: bool,
    files: usize,
    ready: usize,
    unresolved: usize,
    failed: usize,
    quarantined: usize,
    issues: usize,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RecoveryHistory { version: u8, entries: Vec<RecoveryHistoryEntry> }

fn valid_text(value: &str, maximum: usize) -> bool {
    !value.is_empty() && value.len() <= maximum && !value.chars().any(|c| c <= '\u{1f}')
}

impl RecoveryHistoryEntry {
    fn valid(&self) -> bool {
        valid_text(&self.id, 128) && valid_text(&self.source_name, 256)
            && self.source_path.as_ref().is_none_or(|path| valid_text(path, 4096))
            && matches!(self.kind.as_str(), "single" | "batch")
            && (1..=8640000000000000).contains(&self.recorded_at)
            && (1..=32).contains(&self.files) && self.ready <= 32 && self.unresolved <= 32 && self.failed <= 32
            && self.ready + self.unresolved + self.failed == self.files
            && (!self.complete || !self.limited && self.ready == self.files)
            && self.quarantined <= 10000000 && self.issues <= 10000000
    }
}

fn read_history(path: &Path) -> Result<RecoveryHistory, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(RecoveryHistory { version: 1, entries: vec![] }),
        Err(error) => return Err(error.to_string()),
    };
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES { return Err("Invalid recovery history size.".into()); }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_BYTES { return Err("Invalid recovery history size.".into()); }
    let history: RecoveryHistory = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    let mut ids = std::collections::HashSet::new();
    if history.version != 1 || history.entries.len() > MAX_ENTRIES
        || history.entries.iter().any(|entry| !entry.valid() || !ids.insert(&entry.id)) { return Err("Invalid recovery history.".into()); }
    Ok(history)
}

fn record_history(path: &Path, entry: RecoveryHistoryEntry) -> Result<RecoveryHistory, String> {
    if !entry.valid() { return Err("Invalid recovery history record.".into()); }
    let _guard = HISTORY_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let mut history = read_history(path)?;
    history.entries.retain(|previous| previous.id != entry.id
        && !(entry.source_path.is_some() && previous.kind == entry.kind && previous.source_path == entry.source_path));
    history.entries.insert(0, entry);
    history.entries.truncate(MAX_ENTRIES);
    let bytes = serde_json::to_vec(&history).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_BYTES { return Err("Recovery history exceeds its size limit.".into()); }
    crate::storage::write_metadata_atomic(path, &bytes)?;
    Ok(history)
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|directory| directory.join("recovery-history.json")).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_recovery_history(app: AppHandle) -> Result<RecoveryHistory, String> { read_history(&history_path(&app)?) }

#[tauri::command]
pub fn record_recovery_history(app: AppHandle, entry: RecoveryHistoryEntry) -> Result<RecoveryHistory, String> {
    record_history(&history_path(&app)?, entry)
}

fn forget_history(path: &Path, id: &str) -> Result<RecoveryHistory, String> {
    let _guard = HISTORY_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let mut history = read_history(path)?;
    let count = history.entries.len();
    history.entries.retain(|entry| entry.id != id);
    if count != history.entries.len() {
        crate::storage::write_metadata_atomic(path, &serde_json::to_vec(&history).map_err(|error| error.to_string())?)?;
    }
    Ok(history)
}

#[tauri::command]
pub fn forget_recovery_history(app: AppHandle, id: String) -> Result<RecoveryHistory, String> {
    forget_history(&history_path(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(id: usize) -> RecoveryHistoryEntry {
        RecoveryHistoryEntry { id: id.to_string(), recorded_at: 100, source_path: Some(format!("/tmp/{id}.lcad")), source_name: "Drawing.lcad".into(), kind: "single".into(), complete: true, limited: false, files: 1, ready: 1, unresolved: 0, failed: 0, quarantined: 2, issues: 0 }
    }
    #[test]
    fn history_round_trip_retention_refresh_and_remove_preserve_source() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("history.json");
        let source = directory.path().join("source.lcad");
        std::fs::write(&source, b"original drawing").unwrap();
        assert!(read_history(&path).unwrap().entries.is_empty());
        for id in 0..15 { record_history(&path, entry(id)).unwrap(); }
        let history = read_history(&path).unwrap();
        assert_eq!(history.entries.len(), 12);
        assert_eq!(history.entries.last().unwrap().id, "3");
        let mut refreshed = entry(99);
        refreshed.source_path = entry(10).source_path;
        let history = record_history(&path, refreshed).unwrap();
        assert!(!history.entries.iter().any(|entry| entry.id == "10"));
        assert_eq!(read_history(&path).unwrap(), history);
        let mut source_entry = entry(100);
        source_entry.source_path = Some(source.to_string_lossy().into());
        record_history(&path, source_entry).unwrap();
        assert_eq!(forget_history(&path, "100").unwrap().entries.len(), 11);
        assert_eq!(std::fs::read(source).unwrap(), b"original drawing");
    }
    #[test]
    fn corrupt_or_oversized_history_is_never_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("history.json");
        for bytes in [b"invalid json".to_vec(), vec![b' '; MAX_BYTES as usize + 1]] {
            std::fs::write(&path, &bytes).unwrap();
            assert!(read_history(&path).is_err());
            assert!(record_history(&path, entry(1)).is_err());
            assert!(forget_history(&path, "1").is_err());
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
    }
    #[test]
    fn invalid_records_do_not_create_history() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("history.json");
        let mut invalid = entry(1);
        invalid.limited = true;
        assert!(record_history(&path, invalid).is_err());
        assert!(!path.exists());
    }
}
