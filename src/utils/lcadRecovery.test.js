import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, LCAD_MANIFEST_PATH, readLcadArchive } from './lcadArchive.js';
import { prepareLcadRecovery, parseLcadRecoveryInput, parseLcadRecoveryManagerInput, lcadRecoveryReport, createLcadRecoveredSession } from './lcadRecovery.js';

test('RECOVER input separates inspection, report and explicit opening without interpreting malformed paths', () => {
    assert.deepEqual(parseLcadRecoveryInput(''), { action: 'read', path: null });
    assert.deepEqual(parseLcadRecoveryInput('FROM "/tmp/damaged drawing.lcad"'), { action: 'read', path: '/tmp/damaged drawing.lcad' });
    assert.deepEqual(parseLcadRecoveryInput('open'), { action: 'open' });
    assert.deepEqual(parseLcadRecoveryInput('REPORT'), { action: 'report' });
    for (const input of ['FROM', 'FROM ""', 'FROM "unterminated', 'OPEN unexpected', 'FROM a b']) assert.equal(parseLcadRecoveryInput(input), null);
});

test('recovery manager input selects bounded one-based file numbers', () => {
    assert.deepEqual(parseLcadRecoveryManagerInput(''), { action: 'report' });
    assert.deepEqual(parseLcadRecoveryManagerInput('SELECT 2'), { action: 'select', id: 'recovery-2' });
    assert.deepEqual(parseLcadRecoveryManagerInput('open 32'), { action: 'open', id: 'recovery-32' });
    for (const value of ['SELECT 0', 'OPEN 33', 'SELECT 1.5', 'OPEN', 'DELETE 1']) assert.equal(parseLcadRecoveryManagerInput(value), null);
});

test('recovered sessions are independent unsaved copies retaining the complete loss report and source identity', () => {
    const prepared = prepareLcadRecovery(createLcadArchive(createLcadEnvelope(createLcadDocument())));
    const result = { ...prepared, sourcePath: '/tmp/source.lcad', sourceName: 'source.lcad' };
    const saved = structuredClone(result);
    const graph = { entries: [{ id: 'recovery-1', sourcePath: result.sourcePath, result }] };
    const session = createLcadRecoveredSession(result, 'Recovered copy', graph);
    assert.equal(session.recoveryGraph, graph);
    assert.equal(session.path, null);
    assert.equal(session.recovered, true);
    assert.equal(session.document.name, 'Recovered copy');
    assert.equal(session.recoveryReport.path, result.sourcePath);
    assert.equal(session.recoveryReport.opened, true);
    assert.deepEqual(session.recoveryReport.quarantine, result.report.quarantine);
    session.document.content.entities.push({ id: 'edit' });
    assert.deepEqual(result, saved);
    assert.equal(lcadRecoveryReport(result).opened, false);
    assert.equal(lcadRecoveryReport(result).envelope, undefined);
    assert.equal(createLcadRecoveredSession({ ...result, ready: false }, 'No'), null);
    assert.equal(createLcadRecoveredSession({ ...result, report: { valid: false } }, 'No'), null);
});

test('archive recovery preserves surviving drawing objects and retains raw missing-image evidence', () => {
    const document = createLcadDocument();
    document.assets = [{ id: 'lost', name: 'lost.png', width: 1, height: 1, mimeType: 'image/png', link: 'data:image/png;base64,AAECAw==' }];
    document.content.entities = [
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 1, x2: 4, y2: 2 },
        { id: 'image', type: 'image', layerId: 'geometry', assetId: 'lost', x: 1, y: 2, width: 3, height: 4 },
    ];
    const files = unzipSync(createLcadArchive(createLcadEnvelope(document)));
    const manifest = JSON.parse(strFromU8(files[LCAD_MANIFEST_PATH]));
    delete files[manifest.document.assets[0].path];
    const bytes = zipSync(files); const saved = bytes.slice();
    const result = prepareLcadRecovery(bytes);
    assert.equal(result.ready, true);
    assert.deepEqual(result.envelope.document.content.entities.map(entity => entity.id), ['line']);
    assert.equal(result.report.archiveIssues[0].assetId, 'lost');
    assert.equal(result.report.quarantine[0].value.assetId, 'lost');
    assert.deepEqual(readLcadArchive(createLcadArchive(result.envelope)).document.content.entities, result.envelope.document.content.entities);
    assert.deepEqual(bytes, saved);
});

test('unresolved parameter graphs keep recovery candidates out of the ready state', () => {
    const files = unzipSync(createLcadArchive(createLcadEnvelope(createLcadDocument())));
    const manifest = JSON.parse(strFromU8(files[LCAD_MANIFEST_PATH]));
    manifest.document.content.parameters = [{ name: 'a', type: 'number', expression: 'a' }];
    files[LCAD_MANIFEST_PATH] = strToU8(JSON.stringify(manifest));
    const result = prepareLcadRecovery(zipSync(files));
    assert.equal(result.ready, false);
    assert.equal(result.envelope, undefined);
    assert.ok(result.report.issues.some(issue => issue.code === 'invalidDimensionalConstraints'));
    assert.deepEqual(result.candidate.document.content.parameters, manifest.document.content.parameters);
});


test('cyclic block dependencies remain unresolved instead of producing a ready recovery', () => {
    const files = unzipSync(createLcadArchive(createLcadEnvelope(createLcadDocument())));
    const manifest = JSON.parse(strFromU8(files[LCAD_MANIFEST_PATH]));
    manifest.document.content.blocks = [{ id: 'cycle', name: 'Cycle', entities: [{ id: 'self', type: 'blockReference', layerId: 'geometry', blockId: 'cycle' }] }];
    files[LCAD_MANIFEST_PATH] = strToU8(JSON.stringify(manifest));
    const result = prepareLcadRecovery(zipSync(files));
    assert.equal(result.ready, false);
    assert.ok(result.report.issues.some(issue => issue.code === 'invalidBlockGraph'));
});


test('recovery rebuilds a truncated central directory from CRC-checked local records', () => {
    const document = createLcadDocument();
    document.content.entities = [{ id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 3 }];
    const bytes = createLcadArchive(createLcadEnvelope(document));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const central = Array.from({ length: bytes.length - 3 }, (_, index) => index).find(index => view.getUint32(index, true) === 0x02014b50);
    assert.ok(central > 0);
    const truncated = bytes.slice(0, central);
    assert.throws(() => readLcadArchive(truncated));
    const result = prepareLcadRecovery(truncated);
    assert.equal(result.ready, true);
    assert.ok(result.report.archiveIssues.some(issue => issue.code === 'rebuiltZipDirectory'));
    assert.deepEqual(result.envelope.document.content.entities, readLcadArchive(bytes).document.content.entities);
});

test('local-record recovery quarantines corrupt asset bytes while refusing a corrupt manifest', () => {
    const document = createLcadDocument();
    document.assets = [{ id: 'lost', name: 'lost.png', width: 1, height: 1, mimeType: 'image/png', link: 'data:image/png;base64,AAECAw==' }];
    const bytes = createLcadArchive(createLcadEnvelope(document));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0; let assetStart; let manifestStart;
    while (view.getUint32(offset, true) === 0x04034b50) {
        const nameLength = view.getUint16(offset + 26, true); const extraLength = view.getUint16(offset + 28, true);
        const name = strFromU8(bytes.subarray(offset + 30, offset + 30 + nameLength));
        const start = offset + 30 + nameLength + extraLength;
        if (name === LCAD_MANIFEST_PATH) manifestStart = start; else assetStart = start;
        offset = start + view.getUint32(offset + 18, true);
    }
    const damaged = bytes.slice(0, offset); damaged[assetStart] ^= 255;
    const result = prepareLcadRecovery(damaged);
    assert.equal(result.ready, true);
    assert.ok(result.report.archiveIssues.some(issue => issue.code === 'corruptAssetEntry'));
    assert.equal(result.envelope.document.assets.length, 0);
    const damagedWithDirectory = bytes.slice(); damagedWithDirectory[assetStart] ^= 255;
    const verified = prepareLcadRecovery(damagedWithDirectory);
    assert.equal(verified.envelope.document.assets.length, 0);
    assert.ok(verified.report.archiveIssues.some(issue => issue.code === 'corruptAssetEntry'));
    assert.ok(!verified.report.archiveIssues.some(issue => issue.code === 'rebuiltZipDirectory'));
    const brokenManifest = bytes.slice(0, offset); brokenManifest[manifestStart] ^= 255;
    assert.throws(() => prepareLcadRecovery(brokenManifest));
});

test('a corrupt undeclared asset remains forbidden during local-record recovery', () => {
    const files = unzipSync(createLcadArchive(createLcadEnvelope(createLcadDocument())));
    files['assets/undeclared.png'] = new Uint8Array([1, 2, 3]);
    const bytes = zipSync(files, { level: 0 });
    const view = new DataView(bytes.buffer);
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
        const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
        const name = strFromU8(bytes.subarray(offset + 30, offset + 30 + view.getUint16(offset + 26, true)));
        if (name === 'assets/undeclared.png') bytes[start] ^= 255;
        offset = start + view.getUint32(offset + 18, true);
    }
    assert.throws(() => prepareLcadRecovery(bytes.slice(0, offset)));
});

test('opening and archiving a recovered copy preserves the source directory of relative references', () => {
    const document = createLcadDocument();
    document.content.blocks = [{ id: 'cached', name: 'Cache', entities: [] }];
    document.content.entities = [{ id: 'ref', type: 'blockReference', layerId: 'geometry', blockId: 'cached', x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
        externalReference: { version: 1, path: 'child.lcad', sourceDocumentId: 'child', loaded: false, mode: 'overlay' } }];
    const result = { ...prepareLcadRecovery(createLcadArchive(createLcadEnvelope(document))), sourcePath: '/original/root.lcad' };
    assert.equal(result.ready, true);
    const before = structuredClone(result);
    const session = createLcadRecoveredSession(result, 'Copy');
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(session.document))).document;
    assert.equal(loaded.content.entities[0].externalReference.path, '/original/child.lcad');
    assert.equal(loaded.content.entities[0].externalReference.loaded, false);
    assert.equal(session.recoveryReport.referencePaths.length, 1);
    assert.deepEqual(result, before);
});

test('reopening a saved recovered copy re-reads its edits and refuses substituted identities or missing files', async () => {
    const { readSavedRecoveredCandidate } = await import('./lcadRecovery.js');
    const result = { ...prepareLcadRecovery(createLcadArchive(createLcadEnvelope(createLcadDocument()))), sourcePath: '/source.lcad' };
    const saved = structuredClone(result.envelope);
    saved.document.name = 'Edited copy';
    const graph = { entries: [{ sourcePath: '/source.lcad', savedPath: '/copy.lcad' }] };
    const next = await readSavedRecoveredCandidate(result, graph, async path => { assert.equal(path, '/copy.lcad'); return { envelope: saved }; });
    assert.equal(next.envelope.document.name, 'Edited copy');
    assert.notEqual(result.envelope.document.name, 'Edited copy');
    assert.equal(next.sourcePath, '/source.lcad');
    assert.equal(next.report, result.report);
    await assert.rejects(readSavedRecoveredCandidate(result, graph, async () => ({ envelope: createLcadEnvelope(createLcadDocument()) })));
    await assert.rejects(readSavedRecoveredCandidate(result, graph, async () => { throw new Error('File removed'); }));
    assert.equal(await readSavedRecoveredCandidate(result, null, async () => { throw new Error('Must not read'); }), result);
    assert.deepEqual(parseLcadRecoveryManagerInput('RELINK'), { action: 'relink' });
    assert.equal(parseLcadRecoveryManagerInput('RELINK ALL'), null);
});
