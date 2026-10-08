import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDrawingDib } from './drawingDib.js';

function dib(width, height, bits, bytes, palette = []) {
    const result = new Uint8Array(40 + palette.length + bytes.length); const data = new DataView(result.buffer);
    data.setUint32(0, 40, true); data.setInt32(4, width, true); data.setInt32(8, height, true);
    data.setUint16(12, 1, true); data.setUint16(14, bits, true); data.setUint32(32, palette.length / 4, true);
    result.set(palette, 40); result.set(bytes, 40 + palette.length); return result;
}

test('packed DIB BGR rows account for padding and top-down/bottom-up orientation', () => {
    const bytes = [0, 0, 255, 99, 255, 0, 0, 99];
    assert.deepEqual([...decodeDrawingDib(dib(1, 2, 24, bytes)).pixels], [0, 0, 255, 255, 255, 0, 0, 255]);
    assert.deepEqual([...decodeDrawingDib(dib(1, -2, 24, bytes)).pixels], [255, 0, 0, 255, 0, 0, 255, 255]);
    assert.deepEqual([...decodeDrawingDib(dib(1, 1, 32, [10, 20, 30, 0])).pixels], [30, 20, 10, 255]);
    assert.deepEqual([...decodeDrawingDib(dib(1, 1, 16, [0, 124, 0, 0])).pixels], [255, 0, 0, 255]);
});

test('indexed DIB pixels use high bits first and validate palette indices', () => {
    const palette = [0, 0, 0, 0, 0, 255, 0, 0];
    for (const [bits, row] of [[1, [0x80, 0, 0, 0]], [4, [0x10, 0, 0, 0]], [8, [1, 0, 0, 0]]]) {
        assert.deepEqual([...decodeDrawingDib(dib(2, 1, bits, row, palette)).pixels], [0, 255, 0, 255, 0, 0, 0, 255]);
    }
    assert.throws(() => decodeDrawingDib(dib(1, 1, 8, [2, 0, 0, 0], palette)), /wmfInvalidBitmapPalette/);
});

test('DIB validates dimensions, compression and allocation limits before decoding', () => {
    const valid = dib(1, 1, 24, [1, 2, 3, 0]);
    assert.throws(() => decodeDrawingDib(valid.subarray(0, 43)), /wmfInvalidBitmap/);
    assert.throws(() => decodeDrawingDib(valid, { maxBytes: 43 }), /wmfLimit/);
    assert.throws(() => decodeDrawingDib(valid, { colorUsage: 1 }), /wmfUnsupportedBitmapPalette/);
    const compressed = valid.slice(); new DataView(compressed.buffer).setUint32(16, 1, true);
    assert.throws(() => decodeDrawingDib(compressed), /wmfUnsupportedBitmapCompression/);
    assert.throws(() => decodeDrawingDib(dib(100000, 100000, 24, [])), /wmfLimit/);
    assert.throws(() => decodeDrawingDib(dib(0, 1, 24, [])), /wmfInvalidBitmap/);
});

test('OS2 core DIB headers use unsigned dimensions and three-byte palette entries', () => {
    const core = Uint8Array.from([12, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0,
        0, 0, 0, 30, 20, 10, 0x80, 0, 0, 0]);
    assert.deepEqual([...decodeDrawingDib(core).pixels], [10, 20, 30, 255]);
    const snapshot = core.slice(); const result = decodeDrawingDib(core); result.pixels[0] = 0;
    assert.deepEqual(core, snapshot);
});

function bitfields(bits, masks, bytes) {
    const source = dib(1, 1, bits, bytes);
    const result = new Uint8Array(source.length + 12); result.set(source.subarray(0, 40));
    const view = new DataView(result.buffer); view.setUint32(16, 3, true);
    masks.forEach((mask, index) => view.setUint32(40 + index * 4, mask, true));
    result.set(source.subarray(40), 52); return result;
}

test('DIB bitfields decode RGB565 and arbitrary contiguous 32-bit channel positions', () => {
    assert.deepEqual([...decodeDrawingDib(bitfields(16, [0xf800, 0x07e0, 0x001f], [0xe0, 0x07, 0, 0])).pixels], [0, 255, 0, 255]);
    assert.deepEqual([...decodeDrawingDib(bitfields(32, [0xff, 0xff00, 0xff0000], [10, 20, 30, 0])).pixels], [10, 20, 30, 255]);
    assert.deepEqual([...decodeDrawingDib(bitfields(32, [0xff000000, 0xff0000, 0xff00], [0, 30, 20, 10])).pixels], [10, 20, 30, 255]);
});

test('DIB bitfields reject overlapping, empty, fragmented and out-of-range masks', () => {
    for (const masks of [[0, 0x7e0, 0x1f], [0xf800, 0xf800, 0x1f], [0xa800, 0x7e0, 0x1f], [0xff0000, 0x7e0, 0x1f]]) {
        assert.throws(() => decodeDrawingDib(bitfields(16, masks, [0, 0, 0, 0])), /wmfInvalidBitmapMasks/);
    }
    assert.throws(() => decodeDrawingDib(bitfields(16, [0xf800, 0x7e0, 0x1f], [0, 0, 0, 0]).subarray(0, 48)), /wmfInvalidBitmap/);
});

function rle(bits, width, height, bytes) {
    const palette = [0, 0, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0];
    const result = dib(width, height, bits, bytes, palette);
    const view = new DataView(result.buffer);
    view.setUint32(16, bits === 8 ? 1 : 2, true); view.setUint32(20, bytes.length, true);
    return result;
}

const red = [255, 0, 0, 255]; const green = [0, 255, 0, 255]; const clear = [0, 0, 0, 0];

test('RLE8 and RLE4 combine encoded runs, word-padded absolute runs and bottom-up scanlines', () => {
    for (const [bits, bytes] of [
        [8, [3, 1, 0, 0, 0, 3, 2, 1, 2, 0, 0, 1]],
        [4, [3, 0x11, 0, 0, 0, 3, 0x21, 0x20, 0, 1]],
    ]) {
        assert.deepEqual([...decodeDrawingDib(rle(bits, 3, 2, bytes)).pixels], [...green, ...red, ...green, ...red, ...red, ...red]);
    }
    assert.deepEqual([...decodeDrawingDib(rle(4, 5, 1, [5, 0x12, 0, 1])).pixels], [...red, ...green, ...red, ...green, ...red]);
    assert.deepEqual([...decodeDrawingDib(rle(4, 5, 1, [0, 5, 0x12, 0x12, 0x10, 0, 0, 1])).pixels], [...red, ...green, ...red, ...green, ...red]);
});

test('RLE delta moves leave skipped pixels untouched and can terminate before filling the image', () => {
    const bytes = [1, 1, 0, 2, 1, 1, 1, 2, 0, 1];
    assert.deepEqual([...decodeDrawingDib(rle(8, 3, 2, bytes)).pixels], [...clear, ...clear, ...green, ...red, ...clear, ...clear]);
});

test('RLE rejects truncated data, absent terminators, out-of-bounds runs and invalid palettes', () => {
    for (const bytes of [[3], [1, 1], [4, 1, 0, 1], [0, 2, 4, 0, 0, 1], [0, 2, 0, 2, 0, 1], [0, 3, 1, 1], [0, 0, 0, 0, 1, 1, 0, 1], [0, 1, 0, 0]]) {
        assert.throws(() => decodeDrawingDib(rle(8, 3, 2, bytes)), /wmfInvalidBitmap/);
    }
    assert.throws(() => decodeDrawingDib(rle(8, 3, -2, [0, 1])), /wmfInvalidBitmap/);
    assert.throws(() => decodeDrawingDib(rle(8, 3, 2, [1, 3, 0, 1])), /wmfInvalidBitmapPalette/);
    assert.throws(() => decodeDrawingDib(rle(4, 3, 2, [1, 0x30, 0, 1])), /wmfInvalidBitmapPalette/);
    const wrongSize = rle(8, 3, 2, [0, 1]); new DataView(wrongSize.buffer).setUint32(20, 0, true);
    assert.throws(() => decodeDrawingDib(wrongSize), /wmfInvalidBitmap/);
});
