import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingDgnInt32, drawingDgnVaxDouble, writeDrawingDgnInt32, writeDrawingDgnVaxDouble } from './drawingDgnNumbers.js';

test('DGN integer writing matches high-word-first byte vectors including signed extrema', () => {
    for (const [value, expected] of [[0, [0, 0, 0, 0]], [0x12345678, [0x34, 0x12, 0x78, 0x56]],
        [-1, [255, 255, 255, 255]], [-2147483648, [0, 128, 0, 0]], [2147483647, [255, 127, 255, 255]]]) {
        const bytes = new Uint8Array(8).fill(99); const view = new DataView(bytes.buffer, 2, 4);
        writeDrawingDgnInt32(view, 0, value);
        assert.deepEqual([...bytes], [99, 99, ...expected, 99, 99]);
        assert.equal(drawingDgnInt32(view, 0), value);
    }
});

test('DGN VAX writing matches independent binary vectors and preserves all binary64 fraction bits', () => {
    const vectors = [[0, [0, 0]], [-0, [0, 0]], [1, [0x80, 0x40]], [1.25, [0xa0, 0x40]],
        [-0.5, [0, 0xc0]], [8, [0, 0x42]], [2 ** -128, [0x80, 0]], [2 ** 126, [0x80, 0x7f]]];
    for (const [value, first] of vectors) {
        const bytes = new Uint8Array(8); writeDrawingDgnVaxDouble(new DataView(bytes.buffer), 0, value);
        assert.deepEqual([...bytes], [...first, 0, 0, 0, 0, 0, 0]);
    }
    const leastBit = new Uint8Array(8);
    writeDrawingDgnVaxDouble(new DataView(leastBit.buffer), 0, 1 + Number.EPSILON);
    assert.deepEqual([...leastBit], [0x80, 0x40, 0, 0, 0, 0, 8, 0]);
    const bytes = new Uint8Array(12).fill(99); const view = new DataView(bytes.buffer, 2, 8);
    for (const value of [1 + Number.EPSILON, Math.PI, -Math.PI, 0.1, 1e-30, 1e30, (2 - Number.EPSILON) * 2 ** 126]) {
        writeDrawingDgnVaxDouble(view, 0, value);
        assert.equal(drawingDgnVaxDouble(view, 0), value);
        assert.deepEqual([...bytes.slice(0, 2), ...bytes.slice(10)], [99, 99, 99, 99]);
    }
});

test('DGN writers refuse overflow, underflow and invalid views without partial buffer writes', () => {
    const bytes = new Uint8Array(12).fill(77); const before = bytes.slice(); const view = new DataView(bytes.buffer);
    for (const value of [NaN, Infinity, -Infinity, 2 ** 127, -(2 ** 127), 2 ** -129, Number.MIN_VALUE]) {
        assert.throws(() => writeDrawingDgnVaxDouble(view, 2, value), /dgnRange/);
        assert.deepEqual(bytes, before);
    }
    for (const value of [NaN, Infinity, 1.5, 2147483648, -2147483649]) {
        assert.throws(() => writeDrawingDgnInt32(view, 2, value), /dgnRange/);
        assert.deepEqual(bytes, before);
    }
    for (const write of [writeDrawingDgnInt32, writeDrawingDgnVaxDouble]) {
        for (const offset of [-1, 0.5, 10, NaN]) assert.throws(() => write(view, offset, 1), /dgnInvalid/);
        assert.throws(() => write(bytes, 0, 1), /dgnInvalid/);
    }
    assert.deepEqual(bytes, before);
});
