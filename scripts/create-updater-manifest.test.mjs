import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createUpdaterManifest } from './create-updater-manifest.mjs';
import { verifyReleaseAssets } from './verify-release-assets.mjs';

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'lumcad-parallel-release-'));
    const names = [
        'LUMCAD_0.2.0_aarch64.app.tar.gz', 'LUMCAD_0.2.0_x64.app.tar.gz',
        'LUMCAD_0.2.0_amd64.AppImage', 'LUMCAD_0.2.0_x64-setup.exe',
        'LUMCAD_0.2.0_aarch64.dmg', 'LUMCAD_0.2.0_x64.dmg', 'LUMCAD_0.2.0_amd64.deb',
    ];
    const assets = [];
    for (const [index, name] of names.entries()) {
        assets.push({ name, url: `https://api.github.com/repos/lucasfoufou/LUMCAD/releases/assets/${index + 1}` });
        await writeFile(join(directory, name), 'payload');
        await writeFile(join(directory, `${name}.sig`), `signature-${name}\n`);
    }
    return { directory, release: { tag_name: 'v0.2.0', body: 'Release notes', assets } };
}

test('parallel build assets produce one complete verified manifest with public URLs and aliases', async () => {
    const { directory, release } = await fixture();
    try {
        // Completion/upload order is deliberately different from platform order.
        release.assets.reverse();
        const manifest = await createUpdaterManifest(directory, release, 'v0.2.0');
        assert.equal(manifest.notes, 'Release notes');
        assert.equal(Object.keys(manifest.platforms).length, 8);
        assert.deepEqual(manifest.platforms['windows-x86_64-nsis'], manifest.platforms['windows-x86_64']);
        assert.match(manifest.platforms['darwin-aarch64'].url, /\/v0\.2\.0\/LUMCAD_0\.2\.0_aarch64\.app\.tar\.gz$/);
        assert.match(manifest.platforms['darwin-x86_64'].url, /_x64\.app\.tar\.gz$/);
        assert.ok(Number.isFinite(Date.parse(manifest.pub_date)));
        await writeFile(join(directory, 'latest.json'), JSON.stringify(manifest));
        assert.equal((await verifyReleaseAssets(directory, 'v0.2.0')).platforms.length, 4);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('assembly refuses missing or ambiguous targets and wrong versions', async () => {
    const { directory, release } = await fixture();
    try {
        await assert.rejects(createUpdaterManifest(directory, { ...release, assets: release.assets.slice(1) }, 'v0.2.0'), /exactly one release asset/);
        await assert.rejects(createUpdaterManifest(directory, { ...release, assets: [...release.assets, release.assets[0]] }, 'v0.2.0'), /exactly one release asset/);
        await assert.rejects(createUpdaterManifest(directory, release, 'v0.3.0'), /matching versions/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('assembly refuses missing or empty signatures', async () => {
    const { directory, release } = await fixture();
    try {
        const signaturePath = join(directory, `${release.assets[0].name}.sig`);
        await writeFile(signaturePath, '\n');
        await assert.rejects(createUpdaterManifest(directory, release, 'v0.2.0'), /Empty updater signature/);
        await rm(signaturePath);
        await assert.rejects(createUpdaterManifest(directory, release, 'v0.2.0'), /ENOENT/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
