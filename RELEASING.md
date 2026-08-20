# Releasing and updating LUMCAD

LUMCAD publishes installers and signed Tauri 2 updater artifacts through GitHub Releases. Ordinary branch pushes never create a release. A pushed semantic version tag such as `v0.2.0` is the only automatic release trigger.

## Update trust and key custody

Tauri updater signatures and operating-system code signing solve different problems:

- the Tauri updater key proves that an update was produced by the LUMCAD release process; this signature is mandatory and verified before installation;
- Apple Developer ID/notarization and Windows Authenticode identify the publisher to the operating system. LUMCAD currently uses ad-hoc macOS signing and an unsigned Windows installer, so Gatekeeper or SmartScreen may still warn on a manual download.

The public updater key is safe to distribute and is embedded in `src-tauri/tauri.conf.json`. The matching private key was initially generated at `.release-secrets/lumcad-updater.key`; that directory is ignored by Git. The private key has no password, so access to the file grants release-signing authority.

Before publishing anything:

1. copy the private key into an access-controlled password manager or offline backup;
2. verify the backup can be restored byte-for-byte;
3. add it to the GitHub repository as `TAURI_SIGNING_PRIVATE_KEY` without printing it:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < .release-secrets/lumcad-updater.key
```

Never commit, paste into an issue, or attach the private key to a release. Losing it prevents installed versions from accepting future updates. To rotate it, first publish a transition version signed by the old key and containing the new public key, then sign later versions with the new private key.

## What the workflow publishes

`.github/workflows/release.yml` performs these stages:

1. validate the tag against every declared project version, verify the updater secret, and run `npm run check`;
2. build macOS Apple Silicon, macOS Intel, Linux x64, and Windows x64 sequentially into one draft release;
3. sign each updater payload and let `tauri-action` merge every platform into `latest.json`;
4. download the draft assets and run `scripts/verify-release-assets.mjs`;
5. publish the GitHub release only after the complete manifest passes.

The expected user installers are two `.dmg` files, one NSIS `.exe`, one `.AppImage`, and one `.deb`. The updater additionally requires two macOS `.app.tar.gz` archives, their signatures, signatures for the Windows installer and Linux AppImage, and a `latest.json` containing `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`, and `linux-x86_64`.

Build jobs remain sequential because every `tauri-action` invocation updates the same draft release and manifest. Parallel jobs can overwrite a platform entry or create competing drafts.

## Prepare a version

Update the same semantic version in:

- `package.json` and `package-lock.json`;
- `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`;
- `src-tauri/tauri.conf.json`;
- `src/utils/lcadDocument.js`.

Then validate locally:

```bash
npm run check
npm run test:release
node scripts/check-release-version.mjs v0.2.0
```

To exercise a local Tauri bundle, provide the ignored private-key path explicitly. Environment files are not used by the Tauri signer:

```bash
TAURI_SIGNING_PRIVATE_KEY_PATH=.release-secrets/lumcad-updater.key \
APPLE_SIGNING_IDENTITY=- \
npm run tauri build -- --debug
```

`npm run tauri dev` does not bundle updater artifacts and does not need the private key.

## Publish a version

The release commit and workflow must be present on `main` before the tag is pushed. The exact Git commands remain a maintainer decision; the safe sequence is:

1. commit the version changes only after all checks pass;
2. push that commit to `main`;
3. create the matching annotated tag from the published commit;
4. push that single tag;
5. follow the workflow until the release is published.

Do not push several release tags together. Do not manually publish the draft while build jobs are still running. If any target or signature is missing, the verification job deliberately leaves the release as a draft.

The existing `v0.1.0` tag has no GitHub Release or workflow run, so its visible source archives are GitHub-generated tag snapshots, not LUMCAD installers. Publish a new version rather than rewriting that historical tag.

## Validate automatic updates

The first version containing the updater must be installed manually because older builds cannot discover it. A real end-to-end test therefore needs two versions:

1. manually install the first updater-enabled release on macOS Apple Silicon, macOS Intel, and Windows x64;
2. publish a higher patch version;
3. confirm each installed build offers the correct architecture and version;
4. edit both a named drawing and an untitled recovery drawing before installing;
5. confirm download progress, signature verification, installation, restart, new version, and restored drawing content;
6. repeat with the network disconnected, an interrupted download, a malformed test manifest, and an invalid test signature; the installed application and drawing must remain usable.

Also inspect `latest.json` directly and confirm every URL uses HTTPS and the matching tagged GitHub release. Stable applications use GitHub's latest non-prerelease release; prerelease channels require a separate endpoint and are not enabled by this workflow.
