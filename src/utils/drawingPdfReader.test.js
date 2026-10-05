import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { drawingPdfBytes, drawingPdfDataUrl, readDrawingPdfPage } from './drawingPdfReader.js';
import { createLayeredPdfFixture } from './fixtures/pdf.js';
import { drawingPdfSnapEntities } from './drawingPdfUnderlay.js';

test('PDF reader renders the chosen page and returns vectors, text and physical page dimensions', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');
    const document = new jsPDF({ unit: 'mm', format: 'a4' });
    document.text('First page', 10, 20); document.line(10, 30, 50, 30);
    document.addPage('a5', 'landscape'); document.text('Second page', 10, 20);
    const bytes = new Uint8Array(document.output('arraybuffer'));
    const before = bytes.slice();
    const result = await readDrawingPdfPage(bytes, { pdfjs, createCanvas, pageNumber: 2 });
    assert.equal(result.pageCount, 2); assert.equal(result.pageNumber, 2);
    assert.ok(Math.abs(result.width - 0.21) < 1e-5);
    assert.ok(Math.abs(result.height - 0.148) < 1e-5);
    assert.ok(result.text.items.some(item => item.str === 'Second page'));
    assert.ok(result.preview.link.startsWith('data:image/png;base64,'));
    assert.ok(result.preview.width > 0 && result.preview.height > 0);
    assert.deepEqual(bytes, before);
    assert.deepEqual(drawingPdfBytes(drawingPdfDataUrl(bytes)), bytes);
    await assert.rejects(readDrawingPdfPage(bytes, { pdfjs, createCanvas, pageNumber: 3 }));
    assert.throws(() => drawingPdfBytes('data:application/pdf;base64,AAAA'));
});

test('PDF optional-content toggles refresh both the rendered preview and vector visibility', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');
    const bytes = createLayeredPdfFixture();
    const initial = await readDrawingPdfPage(bytes, { pdfjs, createCanvas });
    assert.deepEqual(initial.layers.map(layer => [layer.name, layer.visible]), [['Red layer', true], ['Blue layer', false]]);
    assert.deepEqual(initial.paths.records.map(record => record.visible), [true, false]);
    const visibility = Object.fromEntries(initial.layers.map(layer => [layer.id, layer.name === 'Blue layer']));
    const changed = await readDrawingPdfPage(bytes, { pdfjs, createCanvas, layerVisibility: visibility });
    assert.deepEqual(changed.paths.records.map(record => record.visible), [false, true]);
    assert.notEqual(changed.preview.link, initial.preview.link);
    assert.deepEqual(changed.paths.records.map(record => record.paths), initial.paths.records.map(record => record.paths));
});

test('PDF page bounds clip native snaps just like the preview canvas', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');
    const document = new jsPDF({ unit: 'mm', format: [100, 100] });
    document.line(-20, 50, 120, 50);
    document.line(-20, -10, 120, -10);
    const page = await readDrawingPdfPage(new Uint8Array(document.output('arraybuffer')), { pdfjs, createCanvas });
    const snaps = drawingPdfSnapEntities(page.paths.records);
    assert.equal(snaps.length, 1);
    assert.ok(Math.abs(snaps[0].x1) < 1e-9);
    assert.ok(Math.abs(snaps[0].x2 - page.width) < 1e-9);
    assert.ok(Math.abs(snaps[0].y1 - 0.05) < 1e-5);
});
