import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { attachDrawingDwfUnderlay } from './drawingDwfUnderlay.js';
import { normalizeDrawingDwfUnderlay } from './drawingDwfMetadata.js';
import { createDrawingDwfxPackage } from './drawingPublish.js';
import { drawingDwfxDataUrl, DWFX_SOURCE_MIME } from './drawingDwfxSource.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, pasteDrawingClipboardPayload, validateDrawingClipboardPayload } from './drawingClipboard.js';

const canvas = createCanvas(2,2);
const source = { id: 'dwfx', name: 'plan.dwfx', width: 1, height: 1, mimeType: DWFX_SOURCE_MIME,
    link: drawingDwfxDataUrl(createDrawingDwfxPackage([{ id: 'p', name: 'A4', paper: { width: 210, height: 297 }, png: new Uint8Array(canvas.toBuffer('image/png')) }])) };
const page = { pageNumber: 1, pageCount: 1, width: .21, height: .297,
    preview: { width: 2, height: 2, link: canvas.toDataURL('image/png') } };

test('DWFx underlay attachment archives source, preview, placement and clip and remaps both assets on paste', () => {
    const document = createLcadDocument(); const before = structuredClone(document);
    const attached = attachDrawingDwfUnderlay(document, page, source, { x: 10, y: 20, scale: 100 });
    assert.deepEqual(document, before);
    const reference = attached.content.entities[0];
    reference.blockClip = { enabled: true, points: [{ x: 0, y: 0 }, { x: .1, y: 0 }, { x: .1, y: .1 }, { x: 0, y: .1 }] };
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(attached))).document;
    assert.deepEqual(restored.content.entities[0].dwfUnderlay, reference.dwfUnderlay);
    assert.deepEqual(restored.content.entities[0].transform, reference.transform);
    assert.deepEqual(restored.content.entities[0].blockClip, reference.blockClip);
    const payload = createDrawingClipboardPayload(restored, [reference.id]);
    assert.equal(payload.assets.length, 2);
    const destination = createLcadDocument();
    destination.assets = [{ ...source, link: 'data:model/vnd.dwfx+xps;base64,UEsDBGRpZmZlcmVudA==' }];
    const pasted = pasteDrawingClipboardPayload(destination, payload, { point: { x: 0, y: 0 } });
    const id = pasted.content.entities[0].dwfUnderlay.assetId;
    assert.notEqual(id, source.id);
    assert.equal(pasted.assets.find(asset => asset.id === id).link, source.link);
    const damaged = structuredClone(payload); damaged.assets = damaged.assets.filter(asset => asset.id !== source.id);
    assert.throws(() => validateDrawingClipboardPayload(damaged), /./);
});

test('DWFx metadata and attachment reject invalid pages, locked layers and overflowing placement atomically', () => {
    const valid = { version: 1, format: 'dwfx', assetId: 'a', pageNumber: 1, pageCount: 1, width: .2, height: .3 };
    for (const change of [{ version: 2 }, { format: 'dwf' }, { pageCount: 0 }, { pageNumber: 1.5 }, { width: NaN }, { assetId: '' }]) {
        assert.equal(normalizeDrawingDwfUnderlay({ ...valid, ...change }), null);
    }
    const document = createLcadDocument(); const before = structuredClone(document);
    for (const placement of [{ x: 1e10 }, { scale: 0 }, { scale: Infinity }, { x: 1e9, scale: 100 }]) {
        assert.throws(() => attachDrawingDwfUnderlay(document, page, source, placement), /dwfxPlacement/);
        assert.deepEqual(document, before);
    }
    document.content.layers.find(layer => layer.id === document.content.activeLayerId).locked = true;
    assert.throws(() => attachDrawingDwfUnderlay(document, page, source));
});
