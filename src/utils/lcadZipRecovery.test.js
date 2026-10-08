import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { recoverLcadLocalZipEntries } from './lcadZipRecovery.js';

const limits = {
    manifestPath: 'manifest.json', maxManifestBytes: 1024, maxAssetBytes: 64,
    maxTotalAssetBytes: 96, maxAssetCount: 2,
    isSafeAssetPath: name => /^assets\/[a-z]+$/.test(name),
};

function localRecords(entries) {
    const bytes = zipSync(entries, { level: 0 });
    const view = new DataView(bytes.buffer);
    let end = 0;
    while (view.getUint32(end, true) === 0x04034b50) {
        end += 30 + view.getUint16(end + 26, true) + view.getUint16(end + 28, true) + view.getUint32(end + 18, true);
    }
    return bytes.slice(0, end);
}

const manifest = () => ({ 'manifest.json': strToU8('{}') });

test('local recovery refuses unsafe and duplicate names before accepting a candidate', () => {
    assert.throws(() => recoverLcadLocalZipEntries(localRecords({ ...manifest(), 'assets/../escape': new Uint8Array(1) }), limits));
    const first = localRecords(manifest());
    const duplicate = new Uint8Array(first.length * 2);
    duplicate.set(first); duplicate.set(first, first.length);
    assert.throws(() => recoverLcadLocalZipEntries(duplicate, limits));
});

test('local recovery enforces manifest, per-asset, aggregate and entry-count limits', () => {
    for (const entries of [
        { 'manifest.json': new Uint8Array(1025) },
        { ...manifest(), 'assets/a': new Uint8Array(65) },
        { ...manifest(), 'assets/a': new Uint8Array(50), 'assets/b': new Uint8Array(50) },
        { ...manifest(), 'assets/a': new Uint8Array(1), 'assets/b': new Uint8Array(1), 'assets/c': new Uint8Array(1) },
    ]) assert.throws(() => recoverLcadLocalZipEntries(localRecords(entries), limits));
});

test('local recovery refuses encrypted records, unknown sizes and unsupported compression', () => {
    for (const [field, value] of [[6, 1], [6, 8], [8, 99]]) {
        const bytes = localRecords(manifest());
        new DataView(bytes.buffer).setUint16(field, value, true);
        assert.throws(() => recoverLcadLocalZipEntries(bytes, limits));
    }
});

test('local recovery reports a truncated final asset without inventing bytes', () => {
    const bytes = localRecords({ ...manifest(), 'assets/a': new Uint8Array(32) });
    const result = recoverLcadLocalZipEntries(bytes.slice(0, -10), limits);
    assert.deepEqual(Object.keys(result.files), ['manifest.json']);
    assert.ok(result.issues.some(issue => issue.code === 'truncatedZipEntry' && issue.path === 'assets/a'));
    assert.throws(() => recoverLcadLocalZipEntries(localRecords(manifest()).slice(0, -1), limits));
});

test('inflation exceeding a falsified local size is discarded even when its CRC is intact', () => {
    const bytes = localRecords({ ...manifest(), 'assets/a': [new Uint8Array(100000), { level: 6 }] });
    const view = new DataView(bytes.buffer);
    const assetOffset = 30 + view.getUint16(26, true) + view.getUint16(28, true) + view.getUint32(18, true);
    view.setUint32(assetOffset + 22, 32, true);
    const result = recoverLcadLocalZipEntries(bytes, limits);
    assert.deepEqual(Object.keys(result.files), ['manifest.json']);
    assert.ok(result.issues.some(issue => issue.code === 'corruptAssetEntry'));
});
