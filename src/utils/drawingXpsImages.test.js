import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { readDrawingXpsPng } from './drawingXpsImages.js';
import { crc32 } from './boundedZip.js';

test('XPS PNG viewbox units follow physical resolution independently on both axes', () => {
    const source = new Uint8Array(createCanvas(2, 3).toBuffer('image/png'));
    const defaultImage = readDrawingXpsPng(source);
    assert.equal(defaultImage.widthUnits, 2); assert.equal(defaultImage.heightUnits, 3);
    const chunk = new Uint8Array(21); const view = new DataView(chunk.buffer);
    view.setUint32(0, 9); chunk.set([112,72,89,115], 4);
    view.setUint32(8, 10000); view.setUint32(12, 5000); chunk[16] = 1;
    view.setUint32(17, crc32(chunk.subarray(4,17)));
    const bytes = new Uint8Array(source.length + chunk.length);
    bytes.set(source.subarray(0,33)); bytes.set(chunk,33); bytes.set(source.subarray(33),54);
    const image = readDrawingXpsPng(bytes);
    assert.ok(Math.abs(image.widthUnits - 2 * 96 / 254) < 1e-12);
    assert.ok(Math.abs(image.heightUnits - 3 * 96 / 127) < 1e-12);
});

test('PNG integrity and pixel budgets reject corrupt or excessive image candidates', () => {
    const bytes = new Uint8Array(createCanvas(2,3).toBuffer('image/png'));
    assert.throws(() => readDrawingXpsPng(bytes, { maxPixels: 5 }), /dwfxLimit/);
    const corrupt = bytes.slice(); corrupt[20] ^= 1;
    assert.throws(() => readDrawingXpsPng(corrupt), /dwfxImage/);
    assert.throws(() => readDrawingXpsPng(bytes.subarray(0, bytes.length - 1)), /dwfxImage/);
    assert.throws(() => readDrawingXpsPng(new Uint8Array(33)), /dwfxImage/);
});
