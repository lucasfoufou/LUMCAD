import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readDrawingPdfPage, drawingPdfDataUrl } from './drawingPdfReader.js';
import { attachDrawingPdfUnderlay } from './drawingPdfUnderlay.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { exportDrawingWmfWithAssets } from './drawingWmfExport.js';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';
import { readDrawingRasterImage } from './drawingRasterImage.js';
import { materializeDrawingBlockReference } from './drawingBlocks.js';

test('WMF PDF underlays export archived page previews and placement without emitting snap-only geometry', async () => {
    const pdf = new jsPDF({ unit: 'mm', format: [40, 40] });
    pdf.setFillColor(255, 255, 255); pdf.rect(-1, -1, 42, 42, 'F');
    pdf.setFillColor(255, 0, 0); pdf.rect(0, 0, 20, 20, 'F');
    const bytes = new Uint8Array(pdf.output('arraybuffer'));
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const page = await readDrawingPdfPage(bytes, { pdfjs, createCanvas });
    const source = { id: 'pdf', name: 'page.pdf', mimeType: 'application/pdf', width: 1, height: 1, link: drawingPdfDataUrl(bytes) };
    const attached = attachDrawingPdfUnderlay(createLcadDocument(), page, source, { x: 10, y: 20, scale: 100 });
    attached.content.entities[0].blockClip = { points: [{ x: 0, y: 0 }, { x: .02, y: 0 }, { x: .02, y: .04 }, { x: 0, y: .04 }] };
    const host = readLcadArchive(createLcadArchive(createLcadEnvelope(attached))).document;
    const before = structuredClone(host);
    assert.equal(materializeDrawingBlockReference(host.content.entities[0], host.content.blocks).length, 0);
    const result = await exportDrawingWmfWithAssets(host.content, host.assets, { createCanvas, loadImage });
    const decoded = readDrawingWmfGraphics(result.bytes).primitives;
    const preview = await readDrawingRasterImage(page.preview.link, { createCanvas, loadImage });
    assert.equal(decoded.length, 1); assert.equal(decoded[0].kind, 'bitmap');
    assert.deepEqual(decoded[0].bitmap.pixels, preview.pixels);
    assert.ok(result.report.warnings.includes('pdfUnderlayPreview'));
    assert.ok(Math.abs(decoded[0].points[0].x + result.report.origin.x - 10) <= result.report.coordinateStep);
    assert.ok(Math.abs(decoded[0].points[0].y + result.report.origin.y - 20) <= result.report.coordinateStep);
    assert.ok(Math.abs(decoded[0].deviceClip.maxX + result.report.origin.x - 12) <= result.report.coordinateStep);
    assert.deepEqual(host, before);
});

test('PDF preview partial alpha rejects atomically until WMF compositing is supported', async () => {
    const canvas = createCanvas(2, 2); const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(255,0,0,.5)'; context.fillRect(0, 0, 2, 2);
    const page = { width: .1, height: .1, pageNumber: 1, pageCount: 1, layers: [], paths: { records: [] },
        preview: { width: 2, height: 2, link: canvas.toDataURL('image/png') } };
    const source = { id: 'pdf', name: 'alpha.pdf', mimeType: 'application/pdf', width: 1, height: 1, link: 'data:application/pdf;base64,JVBERi0xLjcKJSVFT0Y=' };
    const host = attachDrawingPdfUnderlay(createLcadDocument(), page, source);
    const before = structuredClone(host);
    await assert.rejects(exportDrawingWmfWithAssets(host.content, host.assets, { createCanvas, loadImage }), /wmfExportTransparency/);
    assert.deepEqual(host, before);
});
