import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingDgnInt32, drawingDgnVaxDouble } from './drawingDgnNumbers.js';
import { dgnFile as file } from './fixtures/dgn.js';
import { readDrawingDgnRecords } from './drawingDgnRecords.js';

test('DGN integers use swapped words and VAX D values preserve sign and fractional origins', () => {
    const view = new DataView(Uint8Array.from([0x34, 0x12, 0x78, 0x56, 255, 255, 254, 255]).buffer);
    assert.equal(drawingDgnInt32(view, 0), 0x12345678); assert.equal(drawingDgnInt32(view, 4), -2);
    for (const [word, expected] of [[0x4080, 1], [0xc080, -1], [0x4000, 0.5], [0x40a0, 1.25], [0x0080, 2 ** -128], [0, 0]]) {
        const bytes = new Uint8Array(8); const number = new DataView(bytes.buffer); number.setUint16(0, word, true);
        assert.equal(drawingDgnVaxDouble(number, 0), expected);
    }
    const reserved = new DataView(Uint8Array.from([0, 128, 0, 0, 0, 0, 0, 0]).buffer);
    assert.throws(() => drawingDgnVaxDouble(reserved, 0), /dgnInvalid/);
    assert.throws(() => drawingDgnInt32(view, 5), /dgnInvalid/);
    assert.throws(() => drawingDgnVaxDouble(view, -1), /dgnInvalid/);
});

test('DGN container retains element flags, deleted boundaries, units and owned slice data', () => {
    const input = file([0x87, 0x83, 2, 0, 1, 2, 3, 4], [2, 4, 1, 0, 0, 0]);
    const padded = Uint8Array.from([9, 9, ...input, 9, 9]);
    const result = readDrawingDgnRecords(padded.subarray(2, -2));
    assert.deepEqual(result.header, { version: 7, dimension: 2, masterUnit: 'm', subUnit: 'mm',
        subunitsPerMaster: 1000, uorPerSubunit: 100, uorPerMaster: 100000, originUor: { x: 1.25, y: -0.5, z: 0 } });
    assert.equal(result.records.length, 3); assert.equal(result.trailingBytes, 0);
    const record = result.records[1];
    assert.deepEqual([record.type, record.level, record.complex, record.deleted, record.offset, record.length], [3, 7, true, true, 1536, 8]);
    padded.fill(0); assert.deepEqual([...record.bytes], [0x87, 0x83, 2, 0, 1, 2, 3, 4]);
});

test('DGN recognizes 3D metadata and ignores inactive block padding only after EOF', () => {
    const bytes = file(); bytes[0] = 0xc8; bytes[1214] = 64;
    const result = readDrawingDgnRecords(Uint8Array.from([...bytes, 123, 45, 67, 89]));
    assert.equal(result.header.dimension, 3); assert.equal(result.trailingBytes, 4);
    assert.equal(result.records.length, 1);
});

test('DGN rejects bad signatures, truncated records, missing EOF and invalid units before returning records', () => {
    const cases = [new Uint8Array(4), file().slice(0, -2), file([1, 3, 255, 255]), file([1, 0, 0, 0])];
    const units = file(); units.fill(0, 1112, 1116); cases.push(units);
    const negative = file(); negative.set([255, 255, 255, 255], 1116); cases.push(negative);
    const overflow = file(); overflow.set([255, 127, 255, 255], 1112); overflow.set([255, 127, 255, 255], 1116); cases.push(overflow);
    for (const bytes of cases) assert.throws(() => readDrawingDgnRecords(bytes), /dgnInvalid/);
    assert.throws(() => readDrawingDgnRecords(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0])), /dgnUnsupported/);
    assert.throws(() => readDrawingDgnRecords(Uint8Array.from([8, 5, 0x17, 0])), /dgnUnsupported/);
    assert.throws(() => readDrawingDgnRecords(file(), { maxBytes: 100 }), /dgnLimit/);
    assert.throws(() => readDrawingDgnRecords(file([1, 3, 0, 0]), { maxRecords: 1 }), /dgnLimit/);
    assert.throws(() => readDrawingDgnRecords(file(), { maxRecords: -1 }), /dgnLimit/);
});
