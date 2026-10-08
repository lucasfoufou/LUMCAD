import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingWmfWriter, drawingWmfWords } from './drawingWmfWriter.js';
import { readDrawingWmfRecords } from './drawingWmfRecords.js';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';

test('WMF writer matches independently authored standard binary reference exactly', () => {
    const writer = createDrawingWmfWriter();
    writer.append(0x214, drawingWmfWords(20, 10));
    writer.append(0x213, drawingWmfWords(40, 30));
    assert.equal(Buffer.from(writer.finish()).toString('hex'),
        '01000900000316000000000005000000000005000000140214000a0005000000130228001e00030000000000');
});

test('placeable writer preserves signed coordinates, units, checksum and record size', () => {
    const placeable = { left: -100, top: -200, right: 1100, bottom: 2200, unitsPerInch: 1440 };
    const writer = createDrawingWmfWriter({ placeable, objects: 2 });
    writer.append(0x214, drawingWmfWords(-200, -100));
    writer.append(0x213, drawingWmfWords(2200, 1100));
    const bytes = writer.finish(); const decoded = readDrawingWmfRecords(bytes);
    assert.deepEqual(decoded.placeable, placeable);
    assert.equal(decoded.header.words * 2, bytes.length - 22);
    assert.equal(decoded.header.objects, 2);
    const line = readDrawingWmfGraphics(bytes).primitives[0];
    assert.ok(Math.abs(line.points[0].x - -100 * .0254 / 1440) < 1e-12);
    assert.ok(Math.abs(line.points[1].y - 2200 * .0254 / 1440) < 1e-12);
});

test('writer snapshots parameter slices and returns independent outputs', () => {
    const writer = createDrawingWmfWriter(); const source = Buffer.from([9, 9, 20, 0, 10, 0, 8, 8]);
    writer.append(0x214, source.subarray(2, 6)); source.fill(0);
    const first = writer.finish(); first.fill(0);
    assert.deepEqual([...readDrawingWmfRecords(writer.finish()).records[0].parameters], [20, 0, 10, 0]);
});

test('writer rejects truncating numbers, malformed records and resource overflow without appending them', () => {
    for (const values of [[NaN], [1.5], [-32769], [65536], [Infinity]]) assert.throws(() => drawingWmfWords(...values), /wmfPlacement/);
    assert.deepEqual([...drawingWmfWords(-32768, 65535)], [0, 128, 255, 255]);
    assert.throws(() => createDrawingWmfWriter({ objects: 65536 }), /wmfObjects/);
    assert.throws(() => createDrawingWmfWriter({ maxBytes: 23 }), /wmfLimit/);
    assert.throws(() => createDrawingWmfWriter({ placeable: { left: 0, top: 0, right: 0, bottom: 10, unitsPerInch: 1440 } }), /wmfPlacement/);
    const writer = createDrawingWmfWriter({ maxRecords: 2, maxBytes: 34 });
    for (const [opcode, bytes] of [[0, new Uint8Array()], [65536, new Uint8Array()], [1, new Uint8Array(1)]]) {
        assert.throws(() => writer.append(opcode, bytes), /wmfInvalid/);
    }
    writer.append(0x214, drawingWmfWords(1, 2));
    assert.throws(() => writer.append(0x213, drawingWmfWords(3, 4)), /wmfLimit/);
    assert.equal(readDrawingWmfRecords(writer.finish()).records.length, 2);
});
