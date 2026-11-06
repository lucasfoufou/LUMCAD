# Updater test fixtures

`test.app.tar.gz` is a synthetic bundle with one text file at
`LUMCAD.app/Contents/MacOS/lumcad` (contents: `updated executable`, mode 0755).
It is not a runnable application. `invalid-archive.sig` signs the literal bytes
`invalid gzip archive`, so the test can reach extraction failure after valid
signature verification. Changing bytes without changing the signature tests
rejection before installation as well.

The public key and both signatures use Tauri's base64-encoded minisign format
(Ed25519 over BLAKE2b-512, with a signed trusted comment). The disposable test
key pair was generated solely for these fixtures; its private key was discarded.
This key has no relation to the LUMCAD release key, and production configuration
is never changed by the tests.
