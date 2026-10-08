import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { Resvg } from '@resvg/resvg-js';
import { createDrawingDwfxPackage } from './drawingPublish.js';
import { prepareDrawingDwfxPage, readDrawingDwfxPage } from './drawingDwfxReader.js';

function fixture() {
    const canvas = createCanvas(4, 4); const context = canvas.getContext('2d');
    return createDrawingDwfxPackage(['#ff0000', '#0000ff'].map((color, index) => {
        context.fillStyle = color; context.fillRect(0, 0, 4, 4);
        return { id: `p${index}`, name: `Page ${index}`, paper: { width: 100 + index * 100, height: 100 }, png: new Uint8Array(canvas.toBuffer('image/png')) };
    }));
}
const renderSvg = link => loadImage(new Resvg(Buffer.from(link.split(',')[1], 'base64')).render().asPng());

test('DWFx page preparation preserves selected page units while bounding intrinsic raster size', () => {
    const bytes = fixture(); const before = bytes.slice();
    const page = prepareDrawingDwfxPage(bytes, { pageNumber: 2, maxPreviewPixels: 10000 });
    assert.equal(page.pageCount, 2); assert.ok(Math.abs(page.width - .2) < 1e-8);
    assert.ok(Math.abs(page.height - .1) < 1e-8);
    assert.ok(page.previewSize.width * page.previewSize.height <= 10000);
    assert.match(page.svg, new RegExp(`width="${page.previewSize.width}" height="${page.previewSize.height}" viewBox="0 0`));
    assert.deepEqual(bytes, before);
    for (const pageNumber of [0, 3, 1.2, Infinity]) assert.throws(() => prepareDrawingDwfxPage(bytes, { pageNumber }), /dwfxPage/);
});

test('DWFx preview pipeline renders selected page pixels and releases the canvas on success and failure', async () => {
    const canvases = [];
    const makeCanvas = (width, height) => {
        const canvas = createCanvas(width, height);
        const observed = { width, height, getContext: () => canvas.getContext('2d'), toDataURL: () => canvas.toDataURL('image/png') };
        canvases.push(observed); return observed;
    };
    const result = await readDrawingDwfxPage(fixture(), { pageNumber: 2, maxPreviewPixels: 10000, createCanvas: makeCanvas, loadImage: renderSvg });
    const image = await loadImage(result.preview.link); const canvas = createCanvas(image.width, image.height); const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    assert.deepEqual([...context.getImageData(20,20,1,1).data], [0,0,255,255]);
    assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
    const fake = { width: 1, height: 1, getContext: () => ({ drawImage() { throw new Error('decode failure'); } }) };
    await assert.rejects(() => readDrawingDwfxPage(fixture(), { createCanvas: () => fake, loadImage: renderSvg }), /decode failure/);
    assert.equal(fake.width, 0); assert.equal(fake.height, 0);
});
