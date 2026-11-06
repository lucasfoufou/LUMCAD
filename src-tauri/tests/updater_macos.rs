#![cfg(target_os = "macos")]

use std::{
    io::{Read, Write},
    net::TcpListener,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::Path,
    time::Duration,
};

use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri_plugin_updater::{Update, UpdaterExt};

const ARCHIVE: &[u8] = include_bytes!("fixtures/updater/test.app.tar.gz");
const SIGNATURE: &str = include_str!("fixtures/updater/test.app.tar.gz.sig");
const INVALID_ARCHIVE_SIGNATURE: &str = include_str!("fixtures/updater/invalid-archive.sig");
const PUBLIC_KEY: &str = include_str!("fixtures/updater/public-key.txt");

// Obtain an Update through the real public API. Only the manifest is served here:
// installation is tested with a synthetic archive, never with the user's app.
fn test_update(executable: &Path) -> Update {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut request = [0; 4096];
        stream.read(&mut request).unwrap();
        let manifest = serde_json::json!({
            "version": "999.0.0",
            "url": "https://example.invalid/unused.app.tar.gz",
            "signature": SIGNATURE.trim(),
        })
        .to_string();
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", manifest.len(), manifest).unwrap();
    });
    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "dangerousInsecureTransportProtocol": true,
            "pubkey": PUBLIC_KEY.trim(),
        }),
    );
    let app = mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let updater = app
        .updater_builder()
        .executable_path(executable)
        .endpoints(vec![format!("http://{address}/latest.json")
            .parse()
            .unwrap()])
        .unwrap()
        .timeout(Duration::from_secs(10))
        .no_proxy()
        .build()
        .unwrap();
    let update = tauri::async_runtime::block_on(updater.check())
        .unwrap()
        .unwrap();
    server.join().unwrap();
    update
}

#[test]
fn updater_replaces_a_bundle_on_its_own_volume_and_preserves_it_on_extraction_failure() {
    let system_temp = tempfile::tempdir().unwrap();
    let directory = if let Some(root) = std::env::var_os("LUMCAD_UPDATER_TEST_ROOT") {
        let directory = tempfile::tempdir_in(root).unwrap();
        assert_ne!(
            directory.path().metadata().unwrap().dev(),
            system_temp.path().metadata().unwrap().dev(),
            "LUMCAD_UPDATER_TEST_ROOT must be on a different volume than system temp"
        );
        directory
    } else {
        tempfile::tempdir().unwrap()
    };
    let bundle = directory.path().join("LUMCAD.app");
    let executable = bundle.join("Contents/MacOS/lumcad");
    std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
    std::fs::write(&executable, b"original executable").unwrap();
    let mut update = test_update(&executable);

    assert!(update.install(b"invalid gzip archive").is_err());
    assert_eq!(std::fs::read(&executable).unwrap(), b"original executable");

    update.signature = INVALID_ARCHIVE_SIGNATURE.trim().into();
    assert!(matches!(
        update.install(b"invalid gzip archive"),
        Err(tauri_plugin_updater::Error::Io(_))
    ));
    assert_eq!(std::fs::read(&executable).unwrap(), b"original executable");

    update.signature = SIGNATURE.trim().into();
    update.install(ARCHIVE).unwrap();
    assert_eq!(std::fs::read(&executable).unwrap(), b"updated executable");
    assert_eq!(
        bundle.metadata().unwrap().permissions().mode() & 0o777,
        0o755
    );
    assert_eq!(
        executable.metadata().unwrap().permissions().mode() & 0o777,
        0o755
    );
    assert_eq!(
        std::fs::read_dir(directory.path()).unwrap().count(),
        1,
        "staging and backup directories must be cleaned up"
    );
}
