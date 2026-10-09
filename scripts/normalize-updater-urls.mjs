import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Draft releases expose API URLs (and temporary untagged browser URLs).
// Resolve only assets belonging to this release to their final public URLs.
export function normalizeUpdaterUrls(manifest, release, tag) {
    if (!/^v\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(tag)
        || release.tag_name !== tag || manifest.version !== tag.slice(1)) {
        throw new Error('Release, manifest and requested tag must have matching versions.');
    }
    if (!manifest.platforms || !Array.isArray(release.assets)) {
        throw new Error('Missing manifest platforms or release assets.');
    }
    const assets = new Map();
    for (const asset of release.assets) {
        if (!/^https:\/\/api\.github\.com\/repos\/lucasfoufou\/LUMCAD\/releases\/assets\/\d+$/.test(asset.url)
            || typeof asset.name !== 'string' || !asset.name || /[/\\\0]/.test(asset.name)) {
            throw new Error('Invalid release asset metadata.');
        }
        const url = `https://github.com/lucasfoufou/LUMCAD/releases/download/${tag}/${encodeURIComponent(asset.name)}`;
        assets.set(asset.url, url);
        assets.set(url, url);
    }
    const platforms = Object.fromEntries(Object.entries(manifest.platforms).map(([platform, entry]) => {
        const url = assets.get(entry?.url);
        if (!url) throw new Error(`Unknown release asset for ${platform}.`);
        return [platform, { ...entry, url }];
    }));
    return { ...manifest, platforms };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const [manifestPath, metadataPath, tag] = process.argv.slice(2);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const release = JSON.parse(await readFile(metadataPath, 'utf8'));
    const normalized = normalizeUpdaterUrls(manifest, release, tag);
    await writeFile(manifestPath, `${JSON.stringify(normalized, null, 2)}\n`);
    console.log(`Normalized ${Object.keys(normalized.platforms).length} updater URLs for ${tag}.`);
}
