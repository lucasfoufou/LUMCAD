import test from 'node:test';
import assert from 'node:assert/strict';
import { readDrawingCffIndex, readDrawingCffDict, readDrawingCffData } from './drawingCffData.js';

test('CFF INDEX resolves one-based variable-width offsets and empty objects within table bounds', () => {
    for (const size of [1, 2, 3, 4]) {
        const data = [0, 3, size];
        for (const value of [1, 3, 3, 4]) for (let shift = size - 1; shift >= 0; shift--) data.push(value >>> (shift * 8) & 255);
        data.push(10, 20, 30);
        const result = readDrawingCffIndex(Uint8Array.from(data));
        assert.deepEqual(result.entries.map(value => [...value]), [[10, 20], [], [30]]);
        assert.equal(result.end, data.length);
    }
    assert.deepEqual(readDrawingCffIndex(Uint8Array.of(0, 0)), { entries: [], end: 2 });
    for (const bytes of [[0], [0, 1, 0], [0, 1, 5], [0, 1, 1, 0, 1], [0, 2, 1, 1, 3, 2, 8, 9], [0, 1, 1, 1, 3, 8]]) {
        assert.throws(() => readDrawingCffIndex(Uint8Array.from(bytes)), /dwfxFont/);
    }
});

test('CFF DICT decodes signed integer and real operands and escaped operators', () => {
    const dict = readDrawingCffDict(Uint8Array.from([139, 247, 0, 251, 0, 28, 255, 254, 29, 255, 255, 255, 253, 5,
        30, 0x0a, 0x00, 0x1f, 12, 7]));
    assert.deepEqual(dict.get('5'), [0, 108, -108, -2, -3]);
    assert.deepEqual(dict.get('12 7'), [.001]);
    assert.deepEqual(readDrawingCffDict(Uint8Array.of(30, 0xe1, 0x2c, 0x3f, 0)).get('0'), [-.012]);
    for (const data of [[28, 1], [29, 1], [30, 0x1d], [30, 0x1a], [255], [12], [139], [139, 0, 139, 0], Array(49).fill(139)]) {
        assert.throws(() => readDrawingCffDict(Uint8Array.from(data)), /dwfxFont/);
    }
});

test('CFF font data locates charstrings and checks OpenType glyph count before interpretation', () => {
    // Header, Name INDEX, Top DICT INDEX (CharStrings offset 21), empty strings/global subrs, charstrings.
    const bytes = Uint8Array.from([1, 0, 4, 4, 0, 1, 1, 1, 2, 65, 0, 1, 1, 1, 3, 160, 17, 0, 0, 0, 0, 0, 1, 1, 1, 2, 14]);
    const resource = { tables: new Map([['CFF ', { bytes }]]) };
    const result = readDrawingCffData(resource, 1);
    assert.deepEqual([...result.charStrings[0]], [14]);
    assert.deepEqual(result.matrix, [.001, 0, 0, .001, 0, 0]);
    assert.throws(() => readDrawingCffData(resource, 2), /dwfxFont/);
    bytes[15] = 140;
    assert.throws(() => readDrawingCffData(resource, 1), /dwfxFont/);
});

test('CFF private subroutines resolve relative to the private dictionary and reject overlap', () => {
    const bytes = Uint8Array.from([1, 0, 4, 4, 0, 1, 1, 1, 2, 65,
        0, 1, 1, 1, 6, 163, 17, 141, 169, 18, 0, 0, 0, 0,
        0, 1, 1, 1, 2, 14, 141, 19, 0, 1, 1, 1, 2, 11]);
    const resource = { tables: new Map([['CFF ', { bytes }]]) };
    assert.deepEqual([...readDrawingCffData(resource, 1).localSubrs[0]], [11]);
    bytes[30] = 139;
    assert.throws(() => readDrawingCffData(resource, 1), /dwfxFont/);
    bytes[30] = 150;
    assert.throws(() => readDrawingCffData(resource, 1), /dwfxFont/);
});
