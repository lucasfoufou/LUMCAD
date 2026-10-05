import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createImageMaskPdfFixture } from './fixtures/pdf.js';
import { readDrawingPdfPage } from './drawingPdfReader.js';
import { readDrawingPdfImages } from './drawingPdfImages.js';
import { extractDrawingPdfPaths } from './drawingPdfOperators.js';
import { importDrawingPdfCombined } from './drawingPdfCombinedImport.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg } from './drawingClipboard.js';
import { createLcadEnvelope, createLcadDocument } from './lcadDocument.js';

async function pixels(link) {
    const image = await loadImage(link); const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return [...canvas.getContext('2d').getImageData(0,0,image.width,image.height).data];
}

test('real PDF stencil masks preserve fill colour, transparent bits and inverse decoding', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const page = await readDrawingPdfPage(createImageMaskPdfFixture(), { pdfjs, createCanvas, readImages: true });
    assert.deepEqual(page.paths.unsupported, []);
    assert.equal(page.paths.images.length, 3);
    const result = importDrawingPdfCombined(createLcadDocument(), page);
    assert.equal(result.assets.length, 3);
    assert.deepEqual(await pixels(result.assets[0].link), [255,0,0,255,0,0,0,0,0,0,0,0,255,0,0,255]);
    assert.deepEqual(await pixels(result.assets[1].link), [0,0,255,255,0,0,0,0,0,0,0,0,0,0,255,255]);
    assert.deepEqual(await pixels(result.assets[2].link), [0,0,0,0,0,255,0,255,0,255,0,255,0,0,0,0]);
    assert.ok(result.content.entities.every(entity => entity.type === 'image' && entity.opacity === 1 && entity.imageRendering === 'pixelated'));
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(restored.content.entities, result.content.entities);
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(restored, result.selectedIds));
    assert.equal((svg.match(/image-rendering:pixelated/g) || []).length, 3);
});

test('mask variants share pixels only for equal colours and preserve bitmap alpha', async () => {
    const bitmap = createCanvas(2,2); bitmap.getContext('2d').fillRect(0,0,1,1);
    const source = { width: 2, height: 2, bitmap };
    const base = { visible: true, alpha: 1, source, maskColor: '#ff0000' };
    const result = readDrawingPdfImages([base, base, { ...base, maskColor: '#0000ff' }], { createCanvas });
    assert.equal(result[0].image, result[1].image); assert.notEqual(result[0].image, result[2].image);
    assert.deepEqual(await pixels(result[2].image.link), [0,0,255,255,0,0,0,0,0,0,0,0,0,0,0,0]);
});

test('optimized image masks retain repeated/skewed placements and restore fill state', async () => {
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const source = { width: 1, height: 1, data: Uint8Array.of(0) };
    const list = { fnArray: [OPS.setFillRGBColor, OPS.paintImageMaskXObjectRepeat, OPS.save, OPS.setFillRGBColor,
        OPS.paintImageMaskXObjectGroup, OPS.restore, OPS.paintSolidColorImageMask, OPS.setFillColorN, OPS.paintImageMaskXObject],
        argsArray: [['#ff0000'], [source,2,1,0,3,[10,20,30,40]], [], ['#0000ff'],
            [[{ ...source, transform: [1,0,0,1,4,5] }]], [], [], ['pattern'], [source]] };
    const result = extractDrawingPdfPaths(list, OPS, { transform: [1,0,0,-1,0,100] });
    assert.deepEqual(result.images.map(record => record.maskColor), ['#ff0000','#ff0000','#0000ff','#ff0000']);
    assert.ok(result.images[0].matrix.b < 0);
    assert.ok(result.unsupported.includes('pattern-image-mask'));
    const images = readDrawingPdfImages(result.images, { createCanvas });
    assert.deepEqual(await pixels(images[3].image.link), [255,0,0,255]);
});
