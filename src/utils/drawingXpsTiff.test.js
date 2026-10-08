import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { Resvg } from '@resvg/resvg-js';
import { tiffFixture } from './fixtures/tiff.js';
import { readDrawingXpsImage } from './drawingXpsImages.js';
import { readDrawingXpsScene, drawingXpsSceneSvg } from './drawingXpsScene.js';

const pixels = async link => {
    const image = await loadImage(link); const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return context;
};

test('XPS TIFF density uses inches for unitless metadata and ignores orientation and subsequent directories', async () => {
    for (const unit of [1, 2, 3]) for (const orientation of [1, 6, 8]) {
        const bytes = tiffFixture({ tags: [[296, 3, [unit]], [274, 3, [orientation]]] });
        // Other IFDs are intentionally ignored by the XPS specification, even a cyclic next pointer.
        const view = new DataView(bytes.buffer); view.setUint32(10 + view.getUint16(8, true) * 12, 8, true);
        const image = readDrawingXpsImage(bytes); const factor = unit === 3 ? 2.54 : 1;
        assert.equal(image.widthUnits, 1 / factor); assert.equal(image.heightUnits, 2 / factor);
        const context = await pixels(image.link);
        assert.deepEqual([...context.getImageData(0, 0, 2, 2).data],
            [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
    }
    assert.throws(() => readDrawingXpsImage(tiffFixture({ compression: 6 })), /dwfxUnsupported/);
    assert.throws(() => readDrawingXpsImage(tiffFixture(), { maxPixels: 3 }), /dwfxLimit/);
    assert.throws(() => readDrawingXpsImage(tiffFixture().slice(0, -1)), /dwfxImage/);
});

test('TIFF brushes share XPS physical viewbox placement, clipping and encoded PNG previews', async () => {
    const xml = '<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="30" Height="30"><Path Data="M0 0H30V30H0Z"><Path.Fill><ImageBrush ImageSource="image.tif" Viewbox="0 0 1 2" Viewport="5 5 20 20" ViewboxUnits="Absolute" ViewportUnits="Absolute" TileMode="None"/></Path.Fill></Path></FixedPage>';
    const scene = readDrawingXpsScene(new Map([['page', new TextEncoder().encode(xml)], ['image.tif', tiffFixture()]]), { path: 'page' });
    const context = await pixels(new Resvg(drawingXpsSceneSvg(scene)).render().asPng());
    assert.equal(context.getImageData(1, 1, 1, 1).data[3], 0);
    assert.deepEqual([...context.getImageData(6, 6, 1, 1).data], [255, 0, 0, 255]);
    assert.deepEqual([...context.getImageData(23, 23, 1, 1).data], [255, 255, 0, 255]);
});
