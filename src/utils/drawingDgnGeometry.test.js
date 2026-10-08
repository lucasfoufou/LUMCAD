import test from 'node:test';
import assert from 'node:assert/strict';
import { readDrawingDgnElementGeometry } from './drawingDgnGeometry.js';
import { dgnElement as element } from './fixtures/dgn.js';
import { curvePointAt } from './drawingCurveKernel.js';

const header = { dimension: 2, uorPerMaster: 1000, originUor: { x: 100, y: -200, z: 0 } };
test('DGN linear elements retain signed coordinates, global origin and appearance indices in master units', () => {
    const { record, integer } = element(3, 52);
    [1100, -2200, -3900, 4800].forEach((value, i) => integer(36 + i * 4, value));
    const before = record.bytes.slice(); const result = readDrawingDgnElementGeometry(record, header);
    assert.deepEqual(result.geometry, { type: 'line', x1: 1, y1: -2, x2: -4, y2: 5 });
    assert.deepEqual([result.level, result.colorIndex, result.weight, result.style], [7, 83, 5, 2]);
    assert.deepEqual(record.bytes, before);
    for (const type of [4, 6]) {
        const polygon = element(type, 62); polygon.view.setUint16(36, 3, true);
        [1100, -2200, -3900, 4800, 2100, 2800].forEach((v, i) => polygon.integer(38 + i * 4, v));
        const decoded = readDrawingDgnElementGeometry(polygon.record, header).geometry;
        assert.deepEqual(decoded.points, [{ x: 1, y: -2 }, { x: -4, y: 5 }, { x: 2, y: 3 }]);
        assert.equal(decoded.closed, type === 6);
    }
});

test('DGN ellipse and signed-magnitude arc angles retain native curves and VAX origins', () => {
    const units = { dimension: 2, uorPerMaster: 1, originUor: { x: 0, y: 0 } };
    for (const type of [15, 16]) for (const clockwise of [true, false]) {
        const { record, view, integer } = element(type, type === 15 ? 72 : 80);
        const offset = type === 16 ? 8 : 0;
        // VAX D: radii 8 and 4, centre (2,1).
        view.setUint16(36 + offset, 0x4200, true); view.setUint16(44 + offset, 0x4180, true);
        view.setUint16(56 + offset, 0x4100, true); view.setUint16(64 + offset, 0x4080, true);
        integer(52 + offset, 90 * 360000);
        if (type === 16) { integer(36, 0); integer(40, 90 * 360000 | (clockwise ? 0x80000000 : 0)); }
        const before = record.bytes.slice(); const curve = readDrawingDgnElementGeometry(record, units).geometry;
        assert.equal(curve.cx, 2); assert.equal(curve.cy, 1); assert.equal(curve.rx, 8); assert.equal(curve.ry, 4);
        assert.equal(curve.fullEllipse, type === 15); assert.equal(curve.rotation, 90);
        if (type === 16) {
            assert.equal(curve.counterClockwise, !clockwise);
            const end = curvePointAt(curve, 1);
            assert.ok(Math.abs(end.x - (clockwise ? 6 : -2)) < 1e-10);
            assert.ok(Math.abs(end.y - 1) < 1e-10);
        }
        assert.deepEqual(record.bytes, before);
    }
});

test('DGN geometry preserves owned linkage bytes and rejects truncated/unsupported geometry atomically', () => {
    const line = element(3, 56); line.view.setUint16(32, 0x0800, true); line.view.setUint16(30, 10, true);
    line.bytes.set([1, 2, 3, 4], 52);
    const result = readDrawingDgnElementGeometry(line.record, header);
    assert.deepEqual([...result.attributes], [1, 2, 3, 4]); line.bytes[52] = 9;
    assert.equal(result.attributes[0], 1);
    line.view.setUint16(30, 9, true);
    assert.throws(() => readDrawingDgnElementGeometry(line.record, header), /dgnInvalid/);
    assert.throws(() => readDrawingDgnElementGeometry(element(3, 50).record, header), /dgnInvalid/);
    assert.throws(() => readDrawingDgnElementGeometry(element(17, 60).record, header), /dgnUnsupported/);
    assert.throws(() => readDrawingDgnElementGeometry(element(3, 52).record, { ...header, dimension: 3 }), /dgnUnsupported/);
    const poly = element(4, 54); poly.view.setUint16(36, 100, true);
    assert.throws(() => readDrawingDgnElementGeometry(poly.record, header, { maxPoints: 50 }), /dgnLimit/);
    assert.throws(() => readDrawingDgnElementGeometry(poly.record, header), /dgnInvalid/);
    const deleted = element(3, 4); deleted.bytes[1] |= 128;
    assert.equal(readDrawingDgnElementGeometry(deleted.record, header), null);
});
