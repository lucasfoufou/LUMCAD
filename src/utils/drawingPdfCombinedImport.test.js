import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { createCanvas } from '@napi-rs/canvas';
import { importDrawingPdfCombined } from './drawingPdfCombinedImport.js';
import { readDrawingPdfPage } from './drawingPdfReader.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { decodeDrawingPdfPath } from './drawingPdfGeometry.js';

async function read(pdf) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return readDrawingPdfPage(new Uint8Array(pdf.output('arraybuffer')), { pdfjs, createCanvas, readImages: true });
}

test('combined PDF import interleaves fills, text, images and strokes in source paint order', async () => {
    const pdf = new jsPDF({ unit: 'mm', format: [100, 100] });
    pdf.setFillColor(0,0,255); pdf.rect(10,10,60,60,'F');
    pdf.text('Behind image', 20, 30);
    const canvas = createCanvas(2,2); canvas.getContext('2d').fillRect(0,0,2,2);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 15, 15, 30, 30);
    pdf.setFillColor(0,255,0); pdf.rect(30,30,30,30,'FD');
    pdf.text('Front', 40, 50);
    const page = await read(pdf);
    const document = createLcadDocument();
    const old = { id: 'existing', type: 'line', layerId: document.content.activeLayerId, x1: 0, y1: 0, x2: 1, y2: 1 };
    document.content.entities.push(old);
    const before = structuredClone(document);
    const result = importDrawingPdfCombined(document, page, { scale: 100 });
    assert.deepEqual(document, before);
    assert.equal(result.content.entities[0], old);
    assert.deepEqual(result.content.entities.slice(1).map(entity => entity.type), ['hatch','text','image','hatch','line','line','line','line','text']);
    assert.equal(result.selectedIds.length, 9); assert.equal(result.report.imported, 9);
    assert.equal(result.assets.length, 1);
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(restored.content.entities.map(entity => entity.id), result.content.entities.map(entity => entity.id));
});

test('combined PDF import accepts pages without every category and rejects empty pages', async () => {
    const pdf = new jsPDF(); pdf.line(10,10,20,20);
    const result = importDrawingPdfCombined(createLcadDocument(), await read(pdf));
    assert.deepEqual(result.content.entities.map(entity => entity.type), ['line']);
    assert.throws(() => importDrawingPdfCombined(createLcadDocument(), { paths: { records: [], texts: [], images: [], unsupported: [] } }), /no supported visible objects/);
});

test('combined import preserves clipped root ordering and rejects unsupported text without partial mutations', () => {
    const document = createLcadDocument(); const before = structuredClone(document);
    const paths = decodeDrawingPdfPath([0,0,0,1,2,0,1,2,2,1,0,2,4]);
    const clip = { paths: decodeDrawingPdfPath([0,0,0,1,1,0,1,1,2,1,0,2,4]), rule: 'nonzero' };
    const records = [{ order: 1, paint: 'fill', visible: true, fill: '#ff0000', fillAlpha: 1, paths, clips: [clip] }];
    const image = { link: createCanvas(2,2).toDataURL('image/png'), width: 2, height: 2 };
    const images = [{ order: 0, visible: true, alpha: 1, clips: [], image, matrix: { a: 1,b: 0,c: 0,d: 1,e: 0,f: 0 } }];
    const page = { paths: { records, images, texts: [], unsupported: [] } };
    const result = importDrawingPdfCombined(document, page);
    assert.deepEqual(result.content.entities.map(entity => entity.type), ['image', 'blockReference']);
    assert.equal(result.content.blocks.length, 1);
    page.paths.unsupported.push('text-font');
    assert.throws(() => importDrawingPdfCombined(document, page), /text/i);
    assert.deepEqual(document, before);
});
