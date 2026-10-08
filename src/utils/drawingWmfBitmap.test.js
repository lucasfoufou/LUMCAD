import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { importDrawingWmf } from './drawingWmfImport.js';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

function bitmapWmf() {
    const parameters = Buffer.alloc(22 + 40 + 8);
    parameters.writeUInt32LE(0x00cc0020, 0);
    [0, 2, 1, 0, 0, 200, 100, 20, 10].forEach((value, index) => parameters.writeInt16LE(value, 4 + index * 2));
    parameters.writeUInt32LE(40, 22); parameters.writeInt32LE(1, 26); parameters.writeInt32LE(2, 30);
    parameters.writeUInt16LE(1, 34); parameters.writeUInt16LE(24, 36);
    parameters.set([0, 0, 255, 0, 255, 0, 0, 0], 62);
    const result = Buffer.alloc(18 + 6 + parameters.length + 6);
    result.writeUInt16LE(1, 0); result.writeUInt16LE(9, 2); result.writeUInt16LE(0x300, 4);
    result.writeUInt32LE(result.length / 2, 6); result.writeUInt32LE(3 + parameters.length / 2, 12);
    result.writeUInt32LE(3 + parameters.length / 2, 18); result.writeUInt16LE(0x0f43, 22);
    result.set(parameters, 24); result.writeUInt32LE(3, result.length - 6); return result;
}

test('WMF embedded DIB imports as a PNG asset with physical placement and survives archives', async () => {
    const source = createLcadDocument(); const before = structuredClone(source);
    const result = importDrawingWmf(source, bitmapWmf(), { createCanvas, scale: 2, x: 3, y: 4 });
    assert.deepEqual(source, before); assert.equal(result.assets.length, 1);
    assert.equal(result.content.entities[0].type, 'image');
    assert.equal(result.content.entities[0].assetId, result.assets[0].id);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(loaded.assets[0], result.assets[0]);
    assert.equal(loaded.content.entities[0].opacity, 1);
    assert.equal(loaded.content.entities[0].includeInPdf, true);
    const image = await loadImage(result.assets[0].link); const canvas = createCanvas(1, 2);
    canvas.getContext('2d').drawImage(image, 0, 0);
    assert.deepEqual([...canvas.getContext('2d').getImageData(0, 0, 1, 2).data], [0, 0, 255, 255, 255, 0, 0, 255]);
    const frame = result.content.entities[0].affineFrame;
    assert.ok(Math.abs(frame.e - (3 + 20 * .0254 / 96)) < 1e-12);
    assert.ok(Math.abs(frame.d - 400 * .0254 / 96) < 1e-12);
    const repeated = importDrawingWmf(result, bitmapWmf(), { createCanvas });
    assert.equal(repeated.assets.length, 1);
});

test('WMF bitmap operations reject unsupported raster operations and pixel budgets atomically', () => {
    const bytes = bitmapWmf(); bytes.writeUInt32LE(0, 24);
    assert.throws(() => readDrawingWmfGraphics(bytes), /wmfUnsupportedRasterOperation/);
    assert.throws(() => readDrawingWmfGraphics(bitmapWmf(), { maxPixels: 1 }), /wmfLimit/);
});

test('WMF RGB565 masks survive bitmap conversion, PNG embedding and portable reload', async () => {
    const original = bitmapWmf();
    const bytes = Buffer.alloc(original.length + 12);
    bytes.set(original.subarray(0, 86));
    bytes.writeUInt16LE(16, 60); bytes.writeUInt32LE(3, 62);
    [0xf800, 0x07e0, 0x001f].forEach((mask, index) => bytes.writeUInt32LE(mask, 86 + index * 4));
    // Bottom-up rows: red below green, with DWORD row alignment.
    bytes.set([0, 0xf8, 0, 0, 0xe0, 0x07, 0, 0], 98);
    bytes.writeUInt32LE(3, bytes.length - 6);
    bytes.writeUInt32LE(bytes.length / 2, 6);
    bytes.writeUInt32LE((bytes.length - 24) / 2, 12);
    bytes.writeUInt32LE((bytes.length - 24) / 2, 18);
    const source = createLcadDocument(); const snapshot = structuredClone(source);
    const imported = importDrawingWmf(source, bytes, { createCanvas });
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
    const canvas = createCanvas(1, 2);
    canvas.getContext('2d').drawImage(await loadImage(loaded.assets[0].link), 0, 0);
    assert.deepEqual([...canvas.getContext('2d').getImageData(0, 0, 1, 2).data], [0, 255, 0, 255, 255, 0, 0, 255]);
    assert.deepEqual(source, snapshot);
    bytes.writeUInt32LE(0xf800, 90);
    assert.throws(() => importDrawingWmf(source, bytes, { createCanvas }), /wmfInvalidBitmapMasks/);
    assert.deepEqual(source, snapshot);
});

function copyVariant(opcode, values) {
    const dib = bitmapWmf().subarray(46, -6);
    const parameters = Buffer.alloc(4 + values.length * 2 + dib.length);
    parameters.writeUInt32LE(0xcc0020);
    values.forEach((value, i) => parameters.writeInt16LE(value, 4 + i * 2));
    parameters.set(dib, 4 + values.length * 2);
    const result = Buffer.alloc(30 + parameters.length);
    result.writeUInt16LE(1); result.writeUInt16LE(9, 2); result.writeUInt16LE(0x300, 4);
    result.writeUInt32LE(result.length / 2, 6); result.writeUInt32LE(3 + parameters.length / 2, 12);
    result.writeUInt32LE(3 + parameters.length / 2, 18); result.writeUInt16LE(opcode, 22);
    result.set(parameters, 24); result.writeUInt32LE(3, result.length - 6); return result;
}

test('DIBSTRETCHBLT shares the embedded bitmap pipeline with signed destination mirroring', () => {
    const bytes = copyVariant(0x0b41, [2, 1, 0, 0, 200, -100, 20, 10]);
    const primitive = readDrawingWmfGraphics(bytes).primitives[0];
    assert.deepEqual(primitive.crop, { x: 0, y: 0, width: 1, height: 2 });
    assert.ok(primitive.points[1].x < primitive.points[0].x);
    const result = importDrawingWmf(createLcadDocument(), bytes, { createCanvas });
    assert.ok(result.content.entities[0].affineFrame.a < 0);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(loaded.content.entities[0].affineFrame, result.content.entities[0].affineFrame);
});

test('DIBBITBLT keeps matching source/destination dimensions and crops the specified source row', async () => {
    const bytes = copyVariant(0x0940, [0, 0, 1, 1, 20, 10]);
    const primitive = readDrawingWmfGraphics(bytes).primitives[0];
    assert.deepEqual(primitive.crop, { x: 0, y: 1, width: 1, height: 1 });
    assert.ok(Math.abs(primitive.points[1].x - primitive.points[0].x - .0254 / 96) < 1e-12);
    const result = importDrawingWmf(createLcadDocument(), bytes, { createCanvas });
    const canvas = createCanvas(1, 1); canvas.getContext('2d').drawImage(await loadImage(result.assets[0].link), 0, 0);
    assert.deepEqual([...canvas.getContext('2d').getImageData(0, 0, 1, 1).data], [255, 0, 0, 255]);
    assert.throws(() => readDrawingWmfGraphics(copyVariant(0x0940, [2, 0, 1, 1, 20, 10])), /wmfUnsupportedBitmapCrop/);
});

test('WMF RLE bitmap preserves decoded colors and skipped pixels through PNG and archive conversion', async () => {
    for (const bits of [4, 8]) {
        const stream = [0, 2, 0, 1, 1, bits === 4 ? 0x10 : 1, 0, 1];
        const parameters = Buffer.alloc(22 + 40 + 8 + stream.length);
        parameters.set(bitmapWmf().subarray(24, 86));
        parameters.writeUInt16LE(bits, 36); parameters.writeUInt32LE(bits === 4 ? 2 : 1, 38);
        parameters.writeUInt32LE(stream.length, 42); parameters.writeUInt32LE(2, 54);
        parameters.set([0, 0, 0, 0, 0, 255, 0, 0], 62); parameters.set(stream, 70);
        const bytes = Buffer.alloc(30 + parameters.length);
        bytes.set(bitmapWmf().subarray(0, 24));
        bytes.writeUInt32LE(bytes.length / 2, 6); bytes.writeUInt32LE(3 + parameters.length / 2, 12);
        bytes.writeUInt32LE(3 + parameters.length / 2, 18); bytes.set(parameters, 24);
        bytes.writeUInt32LE(3, bytes.length - 6);
        const imported = importDrawingWmf(createLcadDocument(), bytes, { createCanvas });
        const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
        const canvas = createCanvas(1, 2);
        canvas.getContext('2d').drawImage(await loadImage(loaded.assets[0].link), 0, 0);
        assert.deepEqual([...canvas.getContext('2d').getImageData(0, 0, 1, 2).data], [0, 255, 0, 255, 0, 0, 0, 0]);
    }
});

function scanBitmap({ start = 0, count = 2, sourceY = 0, height = 2, topDown = false } = {}) {
    const dib = Buffer.from(bitmapWmf().subarray(46, -6));
    if (topDown) dib.writeInt32LE(-2, 8);
    const band = Buffer.concat([dib.subarray(0, 40), dib.subarray(40 + start * 4, 40 + (start + count) * 4)]);
    const parameters = Buffer.alloc(18 + band.length);
    [0, count, start, sourceY, 0, height, 1, 20, 10].forEach((v, i) => parameters.writeUInt16LE(v, i * 2));
    parameters.set(band, 18);
    const bytes = Buffer.alloc(30 + parameters.length);
    bytes.set(bitmapWmf().subarray(0, 24)); bytes.writeUInt16LE(0x0d33, 22);
    bytes.writeUInt32LE(bytes.length / 2, 6); bytes.writeUInt32LE(3 + parameters.length / 2, 12);
    bytes.writeUInt32LE(3 + parameters.length / 2, 18); bytes.set(parameters, 24); bytes.writeUInt32LE(3, bytes.length - 6);
    return bytes;
}

test('SETDIBTODEV imports full images and partial bottom-up scan bands at their original destination offset', async () => {
    const full = readDrawingWmfGraphics(scanBitmap()).primitives[0];
    assert.deepEqual(full.crop, { x: 0, y: 0, width: 1, height: 2 });
    for (const start of [0, 1]) {
        const bytes = scanBitmap({ start, count: 1 });
        const primitive = readDrawingWmfGraphics(bytes).primitives[0];
        assert.deepEqual(primitive.crop, { x: 0, y: 0, width: 1, height: 1 });
        assert.ok(Math.abs(primitive.points[0].y - (21 - start) * .0254 / 96) < 1e-12);
        const result = importDrawingWmf(createLcadDocument(), bytes, { createCanvas });
        const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
        const canvas = createCanvas(1, 1);
        canvas.getContext('2d').drawImage(await loadImage(loaded.assets[0].link), 0, 0);
        assert.deepEqual([...canvas.getContext('2d').getImageData(0, 0, 1, 1).data], start ? [0, 0, 255, 255] : [255, 0, 0, 255]);
    }
});

test('SETDIBTODEV intersects source crops with top-down bands and validates scan bounds', () => {
    const primitive = readDrawingWmfGraphics(scanBitmap({ start: 1, count: 1, topDown: true })).primitives[0];
    assert.ok(Math.abs(primitive.points[0].y - 21 * .0254 / 96) < 1e-12);
    assert.equal(readDrawingWmfGraphics(scanBitmap({ start: 1, count: 1, sourceY: 0, height: 1 })).primitives.length, 0);
    assert.throws(() => readDrawingWmfGraphics(scanBitmap({ start: 2, count: 1 })), /wmfInvalidBitmap/);
    assert.throws(() => readDrawingWmfGraphics(scanBitmap(), { maxPixels: 1 }), /wmfLimit/);
});
