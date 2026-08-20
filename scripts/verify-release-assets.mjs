import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_PLATFORMS = Object.freeze({
    'darwin-aarch64': '.app.tar.gz',
    'darwin-x86_64': '.app.tar.gz',
    'linux-x86_64': '.AppImage',
    'windows-x86_64': '.exe',
});

export async function verifyReleaseAssets(assetDirectory, expectedTag) {
    const semverTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
    if (!semverTag.test(expectedTag || '')) {
        throw new Error(`Expected a semantic version tag, received "${expectedTag || '(empty)'}".`);
    }
    const directory = resolve(assetDirectory);
    const assetNames = new Set(await readdir(directory));
    requireAssetCount(assetNames, name => name.endsWith('.dmg'), 2, 'macOS DMG installers');
    requireAssetCount(assetNames, name => name.endsWith('.exe'), 1, 'Windows NSIS installer');
    requireAssetCount(assetNames, name => name.endsWith('.AppImage'), 1, 'Linux AppImage');
    requireAssetCount(assetNames, name => name.endsWith('.deb'), 1, 'Linux Debian package');
    if (!assetNames.has('latest.json')) throw new Error('Missing latest.json updater manifest.');

    const manifest = JSON.parse(await readFile(resolve(directory, 'latest.json'), 'utf8'));
    const expectedVersion = expectedTag.slice(1);
    if (manifest.version !== expectedVersion) {
        throw new Error(`latest.json version is ${String(manifest.version)}, expected ${expectedVersion}.`);
    }
    if (!manifest.platforms || typeof manifest.platforms !== 'object' || Array.isArray(manifest.platforms)) {
        throw new Error('latest.json does not contain a platforms object.');
    }

    for (const [platform, expectedExtension] of Object.entries(REQUIRED_PLATFORMS)) {
        const entry = manifest.platforms[platform];
        if (!entry || typeof entry !== 'object') throw new Error(`latest.json is missing ${platform}.`);
        if (typeof entry.url !== 'string' || typeof entry.signature !== 'string' || !entry.signature.trim()) {
            throw new Error(`latest.json contains an invalid ${platform} entry.`);
        }
        const url = new URL(entry.url);
        if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
            throw new Error(`${platform} must use an HTTPS github.com download URL.`);
        }
        const expectedPrefix = `/lucasfoufou/LUMCAD/releases/download/${expectedTag}/`;
        if (!decodeURIComponent(url.pathname).startsWith(expectedPrefix)) {
            throw new Error(`${platform} points outside ${expectedPrefix}.`);
        }
        const artifactName = decodeURIComponent(basename(url.pathname));
        if (!artifactName.endsWith(expectedExtension)) {
            throw new Error(`${platform} points to ${artifactName}, expected ${expectedExtension}.`);
        }
        if (!assetNames.has(artifactName)) throw new Error(`Missing updater artifact ${artifactName}.`);
        const signatureName = `${artifactName}.sig`;
        if (!assetNames.has(signatureName)) throw new Error(`Missing updater signature ${signatureName}.`);
        const signature = (await readFile(resolve(directory, signatureName), 'utf8')).trim();
        if (signature !== entry.signature.trim()) {
            throw new Error(`Signature mismatch for ${platform} and ${signatureName}.`);
        }
    }

    return {
        version: expectedVersion,
        assetCount: assetNames.size,
        platforms: Object.keys(REQUIRED_PLATFORMS),
    };
}

function requireAssetCount(assetNames, predicate, minimum, label) {
    const count = [...assetNames].filter(predicate).length;
    if (count < minimum) throw new Error(`Missing ${label}: found ${count}, expected at least ${minimum}.`);
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedUrl === import.meta.url) {
    const [assetDirectory, expectedTag] = process.argv.slice(2);
    if (!assetDirectory || !expectedTag) {
        console.error('Usage: node scripts/verify-release-assets.mjs <asset-directory> <vX.Y.Z>');
        process.exit(1);
    }
    try {
        const result = await verifyReleaseAssets(assetDirectory, expectedTag);
        console.log(`Verified ${result.assetCount} release assets for LUMCAD ${result.version}.`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
