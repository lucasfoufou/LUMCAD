import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyReleaseAssets } from './verify-release-assets.mjs';

test('release verification accepts complete signed multi-platform assets', async () => {
    const fixture = await createReleaseFixture();
    try {
        const result = await verifyReleaseAssets(fixture.directory, 'v0.2.0');
        assert.equal(result.version, '0.2.0');
        assert.deepEqual(result.platforms, [
            'darwin-aarch64',
            'darwin-x86_64',
            'linux-x86_64',
            'windows-x86_64',
        ]);
    } finally {
        await rm(fixture.directory, { recursive: true, force: true });
    }
});

test('release verification rejects missing platforms and mismatched signatures', async () => {
    const missingPlatform = await createReleaseFixture(manifest => {
        delete manifest.platforms['darwin-x86_64'];
    });
    try {
        await assert.rejects(
            verifyReleaseAssets(missingPlatform.directory, 'v0.2.0'),
            /missing darwin-x86_64/,
        );
    } finally {
        await rm(missingPlatform.directory, { recursive: true, force: true });
    }

    const mismatchedSignature = await createReleaseFixture(manifest => {
        manifest.platforms['windows-x86_64'].signature = 'unexpected-signature';
    });
    try {
        await assert.rejects(
            verifyReleaseAssets(mismatchedSignature.directory, 'v0.2.0'),
            /Signature mismatch for windows-x86_64/,
        );
    } finally {
        await rm(mismatchedSignature.directory, { recursive: true, force: true });
    }
});

test('release verification rejects wrong versions and untrusted URLs', async () => {
    const wrongVersion = await createReleaseFixture(manifest => {
        manifest.version = '0.3.0';
    });
    try {
        await assert.rejects(verifyReleaseAssets(wrongVersion.directory, 'v0.2.0'), /expected 0.2.0/);
    } finally {
        await rm(wrongVersion.directory, { recursive: true, force: true });
    }

    const untrustedUrl = await createReleaseFixture(manifest => {
        manifest.platforms['darwin-aarch64'].url = 'https://example.com/LUMCAD.app.tar.gz';
    });
    try {
        await assert.rejects(verifyReleaseAssets(untrustedUrl.directory, 'v0.2.0'), /HTTPS github.com/);
    } finally {
        await rm(untrustedUrl.directory, { recursive: true, force: true });
    }
});

async function createReleaseFixture(mutateManifest = () => {}) {
    const directory = await mkdtemp(join(tmpdir(), 'lumcad-release-'));
    const artifacts = {
        'darwin-aarch64': 'LUMCAD_0.2.0_macos_aarch64.app.tar.gz',
        'darwin-x86_64': 'LUMCAD_0.2.0_macos_x64.app.tar.gz',
        'linux-x86_64': 'LUMCAD_0.2.0_linux_amd64.AppImage',
        'windows-x86_64': 'LUMCAD_0.2.0_windows_x64-setup.exe',
    };
    const manifest = { version: '0.2.0', notes: 'Fixture', platforms: {} };
    const writes = [
        writeFile(join(directory, 'LUMCAD_0.2.0_macos_aarch64.dmg'), 'arm dmg'),
        writeFile(join(directory, 'LUMCAD_0.2.0_macos_x64.dmg'), 'intel dmg'),
        writeFile(join(directory, 'LUMCAD_0.2.0_linux_amd64.deb'), 'deb'),
    ];
    for (const [platform, artifactName] of Object.entries(artifacts)) {
        const signature = `signature-${platform}`;
        manifest.platforms[platform] = {
            signature,
            url: `https://github.com/lucasfoufou/LUMCAD/releases/download/v0.2.0/${artifactName}`,
        };
        writes.push(writeFile(join(directory, artifactName), platform));
        writes.push(writeFile(join(directory, `${artifactName}.sig`), `${signature}\n`));
    }
    mutateManifest(manifest);
    writes.push(writeFile(join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`));
    await Promise.all(writes);
    return { directory };
}
