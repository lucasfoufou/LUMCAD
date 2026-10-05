import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readDrawingPdfPage } from './drawingPdfReader.js';
import { readDrawingPdfImages } from './drawingPdfImages.js';
import { importDrawingPdfImages } from './drawingPdfImageImport.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { getEntityBounds } from './drawingGeometry.js';

const matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const base = { visible: true, alpha: 1, clips: [], matrix };

test('PDF image decoding preserves RGB, RGBA alpha and padded monochrome rows, sharing repeated sources', async () => {
    for (const [kind, data, expected] of [
        [1, [0x80, 0x40], [255,255,255,255,0,0,0,255,0,0,0,255,255,255,255,255]],
        [2, [255,0,0,0,255,0,0,0,255,255,255,255], [255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]],
        [3, [255,0,0,255,0,255,0,255,0,0,255,255,0,0,0,0], [255,0,0,255,0,255,0,255,0,0,255,255,0,0,0,0]],
    ]) {
        const source = { width: 2, height: 2, kind, data: Uint8Array.from(data) };
        const records = readDrawingPdfImages([{ ...base, source }, { ...base, source }], { createCanvas });
        assert.equal(records[0].image, records[1].image);
        const image = await loadImage(records[0].image.link);
        const canvas = createCanvas(2, 2); canvas.getContext('2d').drawImage(image, 0, 0);
        assert.deepEqual([...canvas.getContext('2d').getImageData(0, 0, 2, 2).data], expected);
    }
});

test('real PDF image imports preserve physical placement, top-down pixels, repeated assets and archive persistence', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const canvas = createCanvas(2, 2); const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 1, 1); ctx.fillStyle = 'blue'; ctx.fillRect(1, 1, 1, 1);
    const pdf = new jsPDF({ unit: 'mm', format: [100, 100] });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 20, 30, 40, 'sample');
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 50, 10, 20, 20, 'sample');
    const page = await readDrawingPdfPage(new Uint8Array(pdf.output('arraybuffer')), { pdfjs, createCanvas, readImages: true });
    assert.equal(page.paths.images.length, 2);
    const result = importDrawingPdfImages(createLcadDocument(), page, { scale: 100, x: 5, y: 6 });
    assert.equal(result.assets.length, 1); assert.equal(result.content.entities.length, 2);
    const entity = result.content.entities[0]; const bounds = getEntityBounds(entity);
    for (const [key, value] of Object.entries({ minX: 6, minY: 8, maxX: 9, maxY: 12 })) assert.ok(Math.abs(bounds[key] - value) < 1e-5, `${key}: ${bounds[key]}`);
    assert.ok(entity.affineFrame.a > 0 && entity.affineFrame.d > 0);
    const image = await loadImage(result.assets[0].link);
    const restoredPixels = createCanvas(2, 2); restoredPixels.getContext('2d').drawImage(image, 0, 0);
    assert.deepEqual([...restoredPixels.getContext('2d').getImageData(0, 0, 2, 2).data], [255,0,0,255,0,0,0,0,0,0,0,0,0,0,255,255]);
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(restored.content.entities, result.content.entities);
    assert.equal(restored.assets[0].link, result.assets[0].link);
});

test('PDF image decoding rejects invalid dimensions and pixels before allocation', () => {
    for (const source of [{ width: 100000, height: 100000 }, { width: 2, height: 2, kind: 3, data: new Uint8Array(2) }]) {
        assert.throws(() => readDrawingPdfImages([{ ...base, source }], { createCanvas }));
    }
});

test('PDF images use native clipping blocks and do not retain assets for invisible placements', async () => {
    const { decodeDrawingPdfPath } = await import('./drawingPdfGeometry.js');
    const image = { link: createCanvas(2, 2).toDataURL('image/png'), width: 2, height: 2 };
    const clip = { rule: 'nonzero', paths: decodeDrawingPdfPath([0,0,0,1,0.5,0,1,0.5,1,1,0,1,4]) };
    const records = [{ ...base, image, clips: [clip], alpha: 0.25 }, { ...base, image, visible: false }];
    const result = importDrawingPdfImages(createLcadDocument(), { paths: { images: records } });
    assert.equal(result.assets.length, 1); assert.equal(result.content.entities.length, 1);
    assert.equal(result.content.entities[0].type, 'blockReference');
    assert.equal(result.content.entities[0].blockClip.points.length, 4);
    assert.equal(result.content.blocks[0].entities[0].opacity, 0.25);
    assert.equal(result.content.blocks[0].entities[0].transparency, 0);
});

test('PDF optimized repeated and atlas image operators retain every placement and crop', async () => {
    const { extractDrawingPdfPaths } = await import('./drawingPdfOperators.js');
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const result = extractDrawingPdfPaths({
        fnArray: [OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup],
        argsArray: [['shared', 2, 3, [10, 20, 30, 40]], [{ width: 4, height: 4 }, [{ transform: [1,0,0,1,4,5], x: 1, y: 1, w: 2, h: 2 }]]],
    }, OPS, { transform: [1,0,0,-1,0,100] });
    assert.equal(result.images.length, 3);
    assert.equal(result.images[0].source, result.images[1].source);
    assert.ok(result.images[1].matrix.e > result.images[0].matrix.e);
    assert.deepEqual(result.images[2].crop, { x: 1, y: 1, width: 2, height: 2 });
});
