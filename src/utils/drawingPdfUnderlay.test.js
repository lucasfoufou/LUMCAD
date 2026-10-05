import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDrawingPdfUnderlay, drawingPdfSnapEntities } from './drawingPdfUnderlay.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { drawingSnapEntities } from './drawingBlockSnapping.js';
import { createDrawingClipboardPayload, pasteDrawingClipboardPayload } from './drawingClipboard.js';
import { decodeDrawingPdfPath } from './drawingPdfGeometry.js';

const line = { type: 'line', x1: 0, y1: 0.1, x2: 0.2, y2: 0.1 };
const record = { paint: 'stroke', visible: true, strokeAlpha: 1, fillAlpha: 1, paths: [{ parts: [line], closed: false }], clips: [] };
const source = { id: 'pdf', name: 'plan.pdf', width: 1, height: 1, mimeType: 'application/pdf', link: 'data:application/pdf;base64,JVBERi0xLjcKJSVFT0Y=' };
const page = { pageNumber: 1, pageCount: 1, width: 0.21, height: 0.297, layers: [], paths: { records: [record] },
    preview: { width: 1, height: 1, link: 'data:image/png;base64,iVBORw0KGgo=' } };

test('PDF placement rejects overflowing transformed page bounds without changing the drawing', () => {
    const document = createLcadDocument();
    const before = structuredClone(document);
    for (const placement of [{ x: 1e10 }, { y: -1e10 }, { x: 1e9, scale: 100 }, { scale: Infinity }]) {
        assert.throws(() => attachDrawingPdfUnderlay(document, page, source, placement));
        assert.deepEqual(document, before);
    }
});

test('PDF underlay archives and clipboard retain original source, preview and transformed/clipped native snaps', () => {
    const attached = attachDrawingPdfUnderlay(createLcadDocument(), page, source, { x: 10, y: 20, scale: 100 });
    const reference = attached.content.entities[0];
    reference.blockClip = { enabled: true, points: [{ x: 0.05, y: 0 }, { x: 0.15, y: 0 }, { x: 0.15, y: 0.2 }, { x: 0.05, y: 0.2 }] };
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(attached))).document;
    const snaps = drawingSnapEntities(restored.content);
    assert.equal(snaps.length, 1);
    assert.ok(Math.abs(snaps[0].x1 - 15) < 1e-8); assert.ok(Math.abs(snaps[0].x2 - 25) < 1e-8);
    assert.equal(snaps[0].y1, 30);
    assert.equal(restored.assets.find(asset => asset.id === 'pdf').link, source.link);
    const payload = createDrawingClipboardPayload(restored, [reference.id]);
    assert.equal(payload.assets.length, 2);
    const destination = createLcadDocument();
    destination.assets = [{ ...source, link: 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0Y=' }];
    const pasted = pasteDrawingClipboardPayload(destination, payload, { point: { x: 0, y: 0 } });
    const pastedReference = pasted.content.entities[0];
    assert.notEqual(pastedReference.pdfUnderlay.assetId, 'pdf');
    assert.equal(pasted.assets.find(asset => asset.id === pastedReference.pdfUnderlay.assetId).link, source.link);
    assert.equal(drawingSnapEntities(pasted.content).length, 1);
});

test('PDF clipping respects even-odd holes and nonzero winding rather than snapping hidden segments', () => {
    const outer = decodeDrawingPdfPath([0, 0, 0, 1, 10, 0, 1, 10, 10, 1, 0, 10, 4])[0];
    const inner = decodeDrawingPdfPath([0, 3, 3, 1, 7, 3, 1, 7, 7, 1, 3, 7, 4])[0];
    const path = { parts: [{ type: 'line', x1: -1, y1: 5, x2: 11, y2: 5 }] };
    const make = rule => drawingPdfSnapEntities([{ ...record, paths: [path], clips: [{ paths: [outer, inner], rule }] }]);
    const evenOdd = make('evenodd');
    assert.equal(evenOdd.length, 2);
    assert.deepEqual(evenOdd.map(item => [Math.round(item.x1), Math.round(item.x2)]), [[0, 3], [7, 10]]);
    const winding = make('nonzero');
    assert.equal(winding.length, 3);
    assert.equal(drawingPdfSnapEntities([{ ...record, strokeAlpha: 0 }]).length, 0);
    assert.throws(() => drawingPdfSnapEntities([{ ...record, paths: [path], clips: [{ paths: [outer], rule: 'nonzero' }] }], { maxChecks: 1 }));
});
