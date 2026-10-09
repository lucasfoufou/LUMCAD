import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeUpdaterUrls } from './normalize-updater-urls.mjs';

export async function createUpdaterManifest(directory, release, tag) {
    if (!/^v\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(tag) || release.tag_name !== tag) {
        throw new Error('Release and requested tag must have matching versions.');
    }
    const version = tag.slice(1);
    // tauri-action's default asset names; keep this contract explicit so a naming
    // change fails before publication instead of guessing the target architecture.
    const payloads = [
        ['darwin-aarch64', 'app', `LUMCAD_${version}_aarch64.app.tar.gz`],
        ['darwin-x86_64', 'app', `LUMCAD_${version}_x64.app.tar.gz`],
        ['linux-x86_64', 'appimage', `LUMCAD_${version}_amd64.AppImage`],
        ['windows-x86_64', 'nsis', `LUMCAD_${version}_x64-setup.exe`],
    ];
    const platforms = {};
    for (const [platform, bundle, name] of payloads) {
        const matches = release.assets.filter(asset => asset.name === name);
        if (matches.length !== 1) throw new Error(`Expected exactly one release asset ${name}.`);
        const signature = (await readFile(resolve(directory, `${name}.sig`), 'utf8')).trim();
        if (!signature) throw new Error(`Empty updater signature for ${name}.`);
        const entry = { signature, url: matches[0].url };
        platforms[platform] = entry;
        platforms[`${platform}-${bundle}`] = entry;
    }
    return normalizeUpdaterUrls({
        version,
        notes: release.body || '',
        pub_date: new Date().toISOString(),
        platforms,
    }, release, tag);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const [directory, metadataPath, tag] = process.argv.slice(2);
    const release = JSON.parse(await readFile(metadataPath, 'utf8'));
    const manifest = await createUpdaterManifest(directory, release, tag);
    await writeFile(resolve(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Assembled updater manifest for all four targets of ${tag}.`);
}
