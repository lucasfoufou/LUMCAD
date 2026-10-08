import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDrawingDgnUnderlay } from './drawingDgnUnderlay.js';
import { normalizeDrawingDgnUnderlay } from './drawingDgnMetadata.js';
import { drawingDgnDataUrl, DGN_SOURCE_MIME } from './drawingDgnSource.js';
import { dgnFile, dgnCellGroup, dgnRectangleShape } from './fixtures/dgn.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, pasteDrawingClipboardPayload, validateDrawingClipboardPayload } from './drawingClipboard.js';
import { getDrawingBlockReferenceBounds } from './drawingBlocks.js';

function source() {
    const bytes = dgnFile(...dgnCellGroup([dgnRectangleShape(0, 0, 10, 8, { fill: 3 }),
        dgnRectangleShape(2, 2, 2, 2, { hole: true })]));
    bytes.fill(0, 1240, 1264);
    return { id: 'source-dgn', name: 'plan.dgn', width: 1, height: 1, mimeType: DGN_SOURCE_MIME, link: drawingDgnDataUrl(bytes) };
}

test('DGN vector reference retains embedded source, nested geometry, placement and clip through archives and paste', () => {
    const document = createLcadDocument(); const before = structuredClone(document);
    const asset = source(); const attached = attachDrawingDgnUnderlay(document, asset, { x: 10, y: 20, scale: 2 });
    assert.deepEqual(document, before);
    const reference = attached.content.entities[0];
    assert.deepEqual(getDrawingBlockReferenceBounds(reference, attached.content.blocks), { minX: 10, minY: 4, maxX: 30, maxY: 20 });
    assert.equal(reference.dgnUnderlay.metresPerMaster, 1);
    assert.deepEqual(attached.content.groups, document.content.groups);
    reference.blockClip = { enabled: true, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: -8 }, { x: 0, y: -8 }] };
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(attached))).document;
    assert.deepEqual(restored.content.entities[0], reference);
    assert.deepEqual(restored.content.blocks, attached.content.blocks);
    const payload = createDrawingClipboardPayload(restored, [reference.id]);
    assert.deepEqual(payload.assets, [asset]);
    const destination = createLcadDocument();
    destination.assets = [{ ...asset, name: 'collision.dgn', link: drawingDgnDataUrl(dgnFile()) }];
    const pasted = pasteDrawingClipboardPayload(destination, payload, { point: { x: 0, y: 0 } });
    const remapped = pasted.content.entities[0].dgnUnderlay.assetId;
    assert.notEqual(remapped, asset.id);
    assert.equal(pasted.assets.find(item => item.id === remapped).link, asset.link);
    const damaged = structuredClone(payload); damaged.assets = [];
    assert.throws(() => validateDrawingClipboardPayload(damaged));
});

test('DGN reference metadata, source identity, locked destinations and placement fail atomically', () => {
    const metadata = { version: 1, format: 'v7', assetId: 'source', metresPerMaster: 1 };
    for (const change of [{ version: 2 }, { format: 'v8' }, { assetId: '' }, { metresPerMaster: NaN }, { metresPerMaster: 0 }]) {
        assert.equal(normalizeDrawingDgnUnderlay({ ...metadata, ...change }), null);
    }
    const document = createLcadDocument(); const before = structuredClone(document);
    for (const placement of [{ scale: 0 }, { x: 1e9 }, { y: -1e9 }, { scale: Infinity }]) {
        assert.throws(() => attachDrawingDgnUnderlay(document, source(), placement), /dgnPlacement/);
        assert.deepEqual(document, before);
    }
    document.assets = [source()];
    assert.throws(() => attachDrawingDgnUnderlay(document, source()), /dgnInvalid/);
    document.assets = [];
    document.content.layers.find(layer => layer.id === document.content.activeLayerId).locked = true;
    assert.throws(() => attachDrawingDgnUnderlay(document, source()), /dgnLayer/);
});
