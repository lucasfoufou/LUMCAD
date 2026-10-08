import test from 'node:test';
import assert from 'node:assert/strict';
import { writeDrawingDgnGeometry } from './drawingDgnWriterGeometry.js';
import { readDrawingDgnElementGeometry } from './drawingDgnGeometry.js';
import { curvePointAt } from './drawingCurveKernel.js';
import { getEntityBounds } from './drawingGeometry.js';

const header = { dimension: 2, uorPerMaster: 1000, originUor: { x: 100, y: -200, z: 0 } };
const read = bytes => readDrawingDgnElementGeometry({ type: bytes[1], bytes }, header);

test('DGN line records encode display headers, binary-offset bounds and signed point coordinates', () => {
    const source = { type: 'line', x1: -1, y1: -2, x2: 3, y2: 4 }; const before = structuredClone(source);
    const bytes = writeDrawingDgnGeometry(source, { ...header, level: 7, color: 83, weight: 5, style: 2, graphicGroup: 42, complex: true });
    assert.equal(bytes.length, 52);
    assert.deepEqual([...bytes.slice(0, 4)], [135, 3, 24, 0]);
    assert.deepEqual([...bytes.slice(28, 36)], [42, 0, 10, 0, 0, 0, 42, 83]);
    assert.deepEqual([...bytes.slice(4, 8)], [255, 127, 124, 252]); // -900 + 2^31, word swapped.
    assert.deepEqual([...bytes.slice(12, 16)], [0, 128, 0, 0]); // Z=0 binary offset.
    assert.deepEqual([...bytes.slice(36, 40)], [255, 255, 124, 252]);
    const decoded = read(bytes);
    assert.deepEqual(decoded.geometry, source);
    assert.deepEqual([decoded.level, decoded.colorIndex, decoded.weight, decoded.style, decoded.graphicGroup, decoded.complex], [7, 83, 5, 2, 42, true]);
    assert.deepEqual(source, before);
});

test('DGN linestrings and closed shapes retain point order with bounded UOR quantization', () => {
    const points = [{ x: 1.0002, y: 2.0003 }, { x: 3, y: -4 }, { x: -2, y: 1 }];
    for (const closed of [false, true]) {
        const bytes = writeDrawingDgnGeometry({ type: 'polyline', points, closed }, header);
        assert.equal(bytes[1], closed ? 6 : 4);
        const decoded = read(bytes).geometry;
        assert.equal(decoded.points.length, closed ? 4 : 3);
        assert.equal(decoded.closed, closed);
        points.forEach((point, i) => assert.ok(Math.hypot(point.x - decoded.points[i].x, point.y - decoded.points[i].y) <= .00071));
        if (closed) assert.deepEqual(decoded.points[0], decoded.points.at(-1));
    }
    assert.equal(points.length, 3);
});

test('DGN circular and elliptical records preserve exact axes, origins and directed arc geometry', () => {
    for (const counterClockwise of [false, true]) {
        for (const source of [
            { type: 'circle', cx: 4, cy: -3, r: 2, counterClockwise },
            { type: 'arc', cx: 4, cy: -3, r: 2, startAngle: .2, endAngle: 4.2, counterClockwise },
            { type: 'ellipse', cx: 4, cy: -3, rx: 3, ry: 1.25, rotation: 37, fullEllipse: true, counterClockwise: true },
            { type: 'ellipse', cx: 4, cy: -3, rx: 3, ry: 1.25, rotation: 37, startAngle: .2, endAngle: 4.2, counterClockwise },
        ]) {
            const bytes = writeDrawingDgnGeometry(source, header); const decoded = read(bytes).geometry;
            assert.equal(decoded.cx, source.cx); assert.equal(decoded.cy, source.cy);
            assert.equal(decoded.rx, source.rx ?? source.r); assert.equal(decoded.ry, source.ry ?? source.r);
            // Full closed elements have no directed angular domain in DGN.
            if (source.type === 'circle' && !counterClockwise) continue;
            for (const t of [0, .1, .4, .8, 1]) {
                const a = curvePointAt(source, t); const b = curvePointAt(decoded, t);
                assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-7);
            }
        }
    }
});

test('DGN geometry writing refuses unsupported primitives, oversized point records and unrepresentable coordinates', () => {
    const line = { type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 };
    for (const options of [{ level: 64 }, { color: -1 }, { weight: 32 }, { style: 8 }, { graphicGroup: 65536 },
        { uorPerMaster: 0 }, { originUor: { x: NaN, y: 0 } }, { uorPerMaster: 3000000000 }]) {
        assert.throws(() => writeDrawingDgnGeometry(line, options), /dgnRange/);
    }
    assert.throws(() => writeDrawingDgnGeometry({ type: 'text', text: 'unsupported' }), /dgnUnsupported/);
    assert.throws(() => writeDrawingDgnGeometry({ type: 'polyline', points: Array.from({ length: 102 }, (_, x) => ({ x, y: 0 })) }), /dgnLimit/);
    assert.throws(() => writeDrawingDgnGeometry({ type: 'polyline', points: [{ x: NaN, y: 0 }, { x: 1, y: 1 }] }), /dgnGeometry/);
});

test('DGN binary-offset ranges enclose the quantized elliptical geometry used by external spatial indexes', () => {
    for (const fullEllipse of [false, true]) {
        const source = { type: 'ellipse', cx: 1000, cy: -700, rx: 1250, ry: 30,
            rotation: 37.123456789, startAngle: .123456789, endAngle: 4.987654321,
            fullEllipse, counterClockwise: false };
        const bytes = writeDrawingDgnGeometry(source, header); const view = new DataView(bytes.buffer);
        const bounds = getEntityBounds(read(bytes).geometry);
        const integer = offset => view.getUint16(offset, true) * 65536 + view.getUint16(offset + 2, true) - 2147483648;
        assert.ok(integer(4) <= bounds.minX * 1000 + 100 + 1e-6);
        assert.ok(integer(8) <= bounds.minY * 1000 - 200 + 1e-6);
        assert.ok(integer(16) >= bounds.maxX * 1000 + 100 - 1e-6);
        assert.ok(integer(20) >= bounds.maxY * 1000 - 200 - 1e-6);
    }
});
