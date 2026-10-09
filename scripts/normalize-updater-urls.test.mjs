import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUpdaterUrls } from './normalize-updater-urls.mjs';

const apiUrl = 'https://api.github.com/repos/lucasfoufou/LUMCAD/releases/assets/123';
const publicUrl = 'https://github.com/lucasfoufou/LUMCAD/releases/download/v0.2.0/LUMCAD.app.tar.gz';
const release = { tag_name: 'v0.2.0', assets: [{ url: apiUrl, name: 'LUMCAD.app.tar.gz',
    browser_download_url: 'https://github.com/lucasfoufou/LUMCAD/releases/download/untagged-temporary/LUMCAD.app.tar.gz' }] };
const manifest = { version: '0.2.0', notes: 'Keep notes', platforms: {
    'darwin-aarch64': { url: apiUrl, signature: 'unchanged-signature' },
    'darwin-aarch64-app': { url: apiUrl, signature: 'unchanged-signature' },
} };

test('draft API URLs become final tagged public URLs without changing signatures or input', () => {
    const normalized = normalizeUpdaterUrls(manifest, release, 'v0.2.0');
    assert.equal(normalized.notes, manifest.notes);
    for (const entry of Object.values(normalized.platforms)) {
        assert.deepEqual(entry, { url: publicUrl, signature: 'unchanged-signature' });
    }
    assert.equal(manifest.platforms['darwin-aarch64'].url, apiUrl);
    assert.deepEqual(normalizeUpdaterUrls(normalized, release, 'v0.2.0'), normalized);
});

test('normalization rejects mismatched versions, foreign URLs and unknown assets', () => {
    assert.throws(() => normalizeUpdaterUrls(manifest, release, 'v0.3.0'), /matching versions/);
    for (const url of ['https://example.com/payload', `${apiUrl}4`]) {
        assert.throws(() => normalizeUpdaterUrls({ ...manifest, platforms: { test: { url } } }, release, 'v0.2.0'), /Unknown release asset/);
    }
    assert.throws(() => normalizeUpdaterUrls(manifest, { ...release, assets: [{ url: apiUrl, name: '../payload' }] }, 'v0.2.0'), /Invalid release asset/);
});
