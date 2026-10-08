import test from 'node:test';
import assert from 'node:assert/strict';
import { writeDrawingDgnFile } from './drawingDgnWriterFile.js';
import { writeDrawingDgnElements } from './drawingDgnWriterElements.js';
import { readDrawingDgnRecords } from './drawingDgnRecords.js';
import { importDrawingDgn } from './drawingDgnImport.js';
import { dgnFile } from './fixtures/dgn.js';
import { createLcadDocument } from './lcadDocument.js';
import { measureDrawingEntity } from './drawingInquiry.js';

const semicircle = { type: 'polyline', closed: true, parts: [
    { type: 'arc', cx: 0, cy: 0, r: 1, startAngle: 0, endAngle: Math.PI, counterClockwise: true },
    { type: 'line', x1: -1, y1: 0, x2: 1, y2: 0 },
] };

test('DGN compound shape records retain exact arcs, member counts and byte extent', () => {
    const before = structuredClone(semicircle);
    const bytes = writeDrawingDgnFile([{ geometry: semicircle, appearance: { level: 3, color: 2 } }], { seed: dgnFile() });
    const { records } = readDrawingDgnRecords(bytes);
    assert.deepEqual(records.map(record => record.type), [9, 14, 16, 3]);
    assert.ok(records.slice(1).every(record => record.complex));
    const parent = new DataView(records[1].bytes.buffer, records[1].bytes.byteOffset, records[1].length);
    assert.equal(parent.getUint16(38, true), 2);
    assert.equal(38 + parent.getUint16(36, true) * 2, records.slice(1).reduce((sum, record) => sum + record.length, 0));
    const entity = importDrawingDgn(createLcadDocument(), bytes).content.entities[0];
    assert.deepEqual(entity.parts.map(part => part.type), ['ellipse', 'line']);
    assert.equal(entity.closed, true);
    assert.ok(Math.abs(measureDrawingEntity(entity).area - Math.PI / 2) < 1e-9);
    assert.deepEqual(semicircle, before);
});

test('DGN long point polylines split into connected bounded members while retaining all segments', () => {
    const points = Array.from({ length: 251 }, (_, x) => ({ x, y: x % 2 }));
    for (const closed of [false, true]) {
        const source = { type: 'polyline', points, closed };
        const bytes = writeDrawingDgnFile([{ geometry: source }], { seed: dgnFile() });
        const { records } = readDrawingDgnRecords(bytes);
        assert.deepEqual(records.map(record => record.type), [9, closed ? 14 : 12, 4, 4, 4]);
        assert.ok(records.slice(2).every(record => record.length <= 38 + 101 * 8));
        const imported = importDrawingDgn(createLcadDocument(), bytes).content.entities[0];
        assert.equal(imported.parts.length, closed ? 251 : 250);
        assert.equal(imported.closed, closed);
        assert.equal(points.length, 251);
    }
});

test('DGN compound export refuses disconnected/unsupported paths and counts every member against file budgets', () => {
    assert.throws(() => writeDrawingDgnFile([{ geometry: semicircle }], { seed: dgnFile(), maxRecords: 3 }), /dgnLimit/);
    const disconnected = structuredClone(semicircle); disconnected.parts[1].x1 = -2;
    assert.throws(() => writeDrawingDgnElements(disconnected), /dgnUnsupported/);
    assert.throws(() => writeDrawingDgnElements({ type: 'polyline', parts: [{ type: 'spline', controlPoints: [
        { x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 0 },
    ] }] }), /dgnUnsupported/);
});
