import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { drawingDgnDataUrl, drawingDgnBytes, DGN_SOURCE_MIME } from './drawingDgnSource.js';
import { drawingBinarySourceCodec } from './drawingBinarySource.js';
import { dgnFile, dgnRectangleShape, dgnCellGroup } from './fixtures/dgn.js';
import { createLcadDocument, createLcadEnvelope, normalizeLcadImageMimeType } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

test('DGN source bytes survive portable archive transport without entering the raster image catalog', () => {
    const bytes = dgnFile(...dgnCellGroup([dgnRectangleShape(0, 0, 10, 8)]));
    const document = createLcadDocument();
    document.assets = [{ id: 'dgn-source', name: 'source.dgn', mimeType: DGN_SOURCE_MIME,
        width: 1, height: 1, link: drawingDgnDataUrl(bytes) }];
    const archive = createLcadArchive(createLcadEnvelope(document));
    const entries = unzipSync(archive); const path = Object.keys(entries).find(path => path.endsWith('.dgn'));
    assert.ok(path); assert.deepEqual(entries[path], bytes);
    const loaded = readLcadArchive(archive).document;
    assert.deepEqual(loaded.assets, document.assets);
    assert.deepEqual(drawingDgnBytes(loaded.assets[0].link), bytes);
    assert.equal(normalizeLcadImageMimeType(DGN_SOURCE_MIME), null);
});

test('DGN source transport rejects malformed base64, truncated records and unsupported V8 containers', () => {
    for (const value of ['data:image/png;base64,CAk=', `data:${DGN_SOURCE_MIME};base64,!!!!`,
        `data:${DGN_SOURCE_MIME};base64,CAk=`]) assert.throws(() => drawingDgnBytes(value), /dgnInvalid/);
    const bytes = dgnFile();
    assert.throws(() => drawingDgnDataUrl(bytes.slice(0, -2)), /dgnInvalid/);
    assert.throws(() => drawingDgnDataUrl(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0])), /dgnUnsupported/);
});

test('shared binary source transport enforces decoded and encoded limits before source interpretation', () => {
    let calls = 0;
    const codec = drawingBinarySourceCodec({ mimeType: 'test/source', maxBytes: 2,
        validate: () => calls++, sourceError: 'invalid', limitError: 'limit' });
    assert.equal(codec.dataUrl(Uint8Array.from([0, 255])), 'data:test/source;base64,AP8=');
    assert.deepEqual(codec.bytes('data:test/source;base64,AP8='), Uint8Array.from([0, 255]));
    assert.equal(calls, 2);
    for (const value of ['data:test/source;base64,AQID', 'data:test/source;base64,AQIDBA==']) {
        assert.throws(() => codec.bytes(value), /limit/);
    }
    assert.throws(() => codec.dataUrl(new Uint8Array(3)), /limit/);
    assert.equal(calls, 2);
});
