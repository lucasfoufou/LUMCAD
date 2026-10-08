import test from 'node:test';
import assert from 'node:assert/strict';
import { writeDrawingDgnFile } from './drawingDgnWriterFile.js';
import { readDrawingDgnRecords } from './drawingDgnRecords.js';
import { readDrawingDgnLinkages, drawingDgnFillIndex } from './drawingDgnLinkages.js';
import { importDrawingDgn } from './drawingDgnImport.js';
import { createLcadDocument } from './lcadDocument.js';
import { dgnFile } from './fixtures/dgn.js';

const shapes = [
    { type: 'polyline', closed: true, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }] },
    { type: 'circle', cx: 4, cy: 4, r: 1 },
    { type: 'polyline', closed: true, parts: [
        { type: 'arc', cx: 0, cy: 0, r: 1, startAngle: 0, endAngle: Math.PI, counterClockwise: true },
        { type: 'line', x1: -1, y1: 0, x2: 1, y2: 0 },
    ] },
];

test('DGN filled shapes, ellipses and complex contours encode parent-only fill links and reimport', () => {
    for (const geometry of shapes) {
        const before = structuredClone(geometry);
        const bytes = writeDrawingDgnFile([{ geometry, appearance: { color: 1, fillColor: 3 } }], { seed: dgnFile() });
        const { records } = readDrawingDgnRecords(bytes);
        const parent = records[1];
        if (geometry.type === 'circle') {
            assert.equal(parent.type, 14);
            assert.equal(records[2].type, 15);
        }
        const view = new DataView(parent.bytes.buffer, parent.bytes.byteOffset, parent.length);
        const start = 32 + view.getUint16(30, true) * 2;
        assert.equal(parent.length - start, 16);
        assert.ok(view.getUint16(32, true) & 0x800);
        assert.equal(drawingDgnFillIndex(readDrawingDgnLinkages(parent.bytes.subarray(start))), 3);
        if (parent.type === 14) {
            assert.equal(38 + view.getUint16(36, true) * 2, records.slice(1).reduce((sum, record) => sum + record.length, 0));
            assert.ok(records.slice(2).every(record => !(new DataView(record.bytes.buffer, record.bytes.byteOffset).getUint16(32, true) & 0x800)));
        }
        const result = importDrawingDgn(createLcadDocument(), bytes);
        assert.equal(result.content.entities.find(entity => entity.type === 'hatch').color, '#ff0000');
        assert.ok(result.content.entities.some(entity => entity.color === '#0000ff' || entity.parts?.some(part => part.color === '#0000ff')));
        assert.deepEqual(geometry, before);
    }
});

test('DGN fill export refuses open geometry, invalid palette indices and file budget overflow', () => {
    const write = (geometry, fillColor, options = {}) => writeDrawingDgnFile([{ geometry, appearance: { fillColor } }], { seed: dgnFile(), ...options });
    for (const fillColor of [-1, 256, 1.5, '3', NaN]) assert.throws(() => write(shapes[0], fillColor), /dgnRange/);
    assert.throws(() => write({ ...shapes[0], closed: false }, 3), /dgnUnsupported/);
    assert.throws(() => write({ ...shapes[2], closed: false }, 3), /dgnUnsupported/);
    const plain = write(shapes[0], null);
    assert.throws(() => write(shapes[0], 3, { maxBytes: plain.length }), /dgnLimit/);
});
