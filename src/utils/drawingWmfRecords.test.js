import test from 'node:test';
import assert from 'node:assert/strict';
import { readDrawingWmfRecords } from './drawingWmfRecords.js';

// Independently authored little-endian fixture: header, MOVETO(20,10), LINETO(40,30), EOF.
const standard = () => Uint8Array.from(Buffer.from('01000900000316000000000005000000000005000000140214000a0005000000130228001e00030000000000', 'hex'));
function placeable() {
    const body = standard(); const bytes = new Uint8Array(body.length + 22); bytes.set(body, 22);
    const view = new DataView(bytes.buffer); view.setUint32(0, 0x9ac6cdd7, true);
    view.setInt16(6, -100, true); view.setInt16(8, -200, true); view.setInt16(10, 1100, true); view.setInt16(12, 2200, true); view.setUint16(14, 1440, true);
    let checksum = 0; for (let i = 0; i < 20; i += 2) checksum ^= view.getUint16(i, true);
    view.setUint16(20, checksum, true); return bytes;
}

test('WMF record boundaries preserve signed placeable coordinates, scale and independent input slices', () => {
    const bytes = placeable(); const padded = new Uint8Array(bytes.length + 12); padded.set(bytes, 8);
    const result = readDrawingWmfRecords(padded.subarray(8, 8 + bytes.length));
    assert.deepEqual(result.placeable, { left: -100, top: -200, right: 1100, bottom: 2200, unitsPerInch: 1440 });
    assert.deepEqual(result.records.map(record => record.opcode), [0x214, 0x213, 0]);
    padded.fill(0);
    assert.deepEqual([...result.records[0].parameters], [20, 0, 10, 0]);
    assert.equal(readDrawingWmfRecords(standard()).placeable, null);
    const buffer = Buffer.from(standard()); const fromBuffer = readDrawingWmfRecords(buffer);
    buffer.fill(0);
    assert.equal(fromBuffer.records[0].parameters[0], 20);
});

test('WMF malformed checksums, size overflows, truncated records and missing/early EOF reject', () => {
    const corrupt = (offset, value, size = 2) => {
        const bytes = standard(); const view = new DataView(bytes.buffer);
        if (size === 4) view.setUint32(offset, value, true); else view.setUint16(offset, value, true);
        return bytes;
    };
    for (const bytes of [corrupt(0, 7), corrupt(2, 8), corrupt(4, 0x200), corrupt(6, 0xffffffff, 4),
        corrupt(18, 0, 4), corrupt(18, 0xffffffff, 4), corrupt(22, 0), corrupt(42, 0x214), standard().slice(0, -2)]) {
        assert.throws(() => readDrawingWmfRecords(bytes), /wmfInvalid/);
    }
    const badChecksum = placeable(); badChecksum[20] ^= 1;
    assert.throws(() => readDrawingWmfRecords(badChecksum), /wmfInvalid/);
});

test('WMF byte and record limits bound work before semantic decoding', () => {
    assert.throws(() => readDrawingWmfRecords(standard(), { maxBytes: 20 }), /wmfLimit/);
    assert.throws(() => readDrawingWmfRecords(standard(), { maxRecords: 2 }), /wmfLimit/);
});
