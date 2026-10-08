import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDrawingDib } from './drawingDibWriter.js';
import { decodeDrawingDib } from './drawingDib.js';

test('DIB writer matches independent 24-bit bottom-up BGR bytes with row padding', () => {
    const image = { width: 1, height: 2, pixels: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) };
    const expected = '28000000010000000200000001001800000000000800000000000000000000000000000000000000ff0000000000ff00';
    const result = encodeDrawingDib(image);
    assert.equal(Buffer.from(result).toString('hex'), expected);
    assert.deepEqual(decodeDrawingDib(result), image);
    image.pixels.fill(0); assert.equal(Buffer.from(result).toString('hex'), expected);
});

test('DIB writer checks transparency, dimensions and allocation budgets before encoding', () => {
    const image = { width: 2, height: 1, pixels: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]) };
    assert.throws(() => encodeDrawingDib(image, { maxPixels: 1 }), /wmfLimit/);
    assert.throws(() => encodeDrawingDib(image, { maxBytes: 47 }), /wmfLimit/);
    assert.throws(() => encodeDrawingDib({ ...image, width: 32768 }), /wmfInvalidBitmap/);
    image.pixels[7] = 254;
    assert.throws(() => encodeDrawingDib(image), /wmfExportTransparency/);
});
