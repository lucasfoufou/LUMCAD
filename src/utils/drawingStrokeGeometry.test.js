import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingLinearStrokeFill } from './drawingStrokeGeometry.js';
import { getEntityBounds } from './drawingGeometry.js';
import { curvePointAt } from './drawingCurveKernel.js';

test('linear stroke fills retain exact physical width and circular caps for reversed and diagonal lines', () => {
    for (const line of [
        { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { type: 'line', x1: 10, y1: 0, x2: 0, y2: 0 },
        { type: 'line', x1: 0, y1: 0, x2: 6, y2: 8 },
    ]) {
        const source = structuredClone(line);
        const hatch = createDrawingLinearStrokeFill([line], 2, '#123456');
        assert.deepEqual(line, source); assert.equal(hatch.fillRule, 'nonzero');
        assert.equal(hatch.boundaryStroke, false); assert.equal(hatch.boundaries.length, 1);
        const parts = hatch.boundaries[0].parts;
        assert.deepEqual(parts.map(part => part.type), ['line', 'arc', 'line', 'arc']);
        for (let i = 0; i < parts.length; i++) {
            const end = curvePointAt(parts[i], 1); const start = curvePointAt(parts[(i + 1) % parts.length], 0);
            assert.ok(Math.hypot(end.x - start.x, end.y - start.y) < 1e-10);
        }
        const bounds = getEntityBounds(hatch);
        assert.ok(Math.abs(bounds.minX - (Math.min(line.x1, line.x2) - 1)) < 1e-10);
        assert.ok(Math.abs(bounds.maxY - (Math.max(line.y1, line.y2) + 1)) < 1e-10);
    }
});

test('closed polyline strokes share nonzero fill and reject incomplete or oversized conversions', () => {
    const square = { type: 'polyline', closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
    const hatch = createDrawingLinearStrokeFill([square], 1, '#000000');
    assert.equal(hatch.boundaries.length, 4);
    assert.throws(() => createDrawingLinearStrokeFill([square], 1, '#000000', { maxSegments: 3 }), /strokeGeometryLimit/);
    assert.equal(createDrawingLinearStrokeFill([{ type: 'circle', cx: 0, cy: 0, r: 1 }], 1, '#000000'), null);
    assert.throws(() => createDrawingLinearStrokeFill([square], 0, '#000000'), /strokeGeometryInvalid/);
});

test('flat and square end caps affect only open ends and retain circular internal joins', () => {
    const line = { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    for (const [endCap, expectedMin, expectedMax] of [['flat', 0, 10], ['square', -1, 11]]) {
        const hatch = createDrawingLinearStrokeFill([line], 2, '#000000', { endCap });
        const bounds = getEntityBounds(hatch);
        assert.equal(bounds.minX, expectedMin); assert.equal(bounds.maxX, expectedMax);
        assert.equal(bounds.minY, -1); assert.equal(bounds.maxY, 1);
        assert.ok(hatch.boundaries[0].parts.every(part => part.type === 'line'));
        const bent = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };
        const joined = createDrawingLinearStrokeFill([bent], 2, '#000000', { endCap });
        assert.deepEqual(joined.boundaries.map(path => path.parts.filter(part => part.type === 'arc').length), [1, 1]);
        const closed = { ...bent, closed: true };
        const outline = createDrawingLinearStrokeFill([closed], 2, '#000000', { endCap });
        assert.ok(outline.boundaries.every(path => path.parts.filter(part => part.type === 'arc').length === 2));
    }
});

test('bevel and miter joins fill the outer corner with consistent winding on either turn', () => {
    for (const direction of [-1, 1]) {
        const path = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 * direction }] };
        for (const join of ['bevel', 'miter']) {
            const hatch = createDrawingLinearStrokeFill([path], 2, '#000000', { endCap: 'flat', join });
            assert.equal(hatch.boundaries.length, 3);
            const wedge = hatch.boundaries[1];
            assert.equal(wedge.parts.length, join === 'miter' ? 4 : 3);
            const area = wedge.parts.reduce((sum, part) => sum + part.x1 * part.y2 - part.x2 * part.y1, 0) / 2;
            assert.equal(area, join === 'miter' ? -1 : -0.5);
            if (join === 'miter') assert.ok(wedge.parts.some(part => part.x1 === 11 && part.y1 === -direction));
        }
        const limited = createDrawingLinearStrokeFill([path], 2, '#000000', { join: 'miter', miterLimit: 1 });
        assert.equal(limited.boundaries[1].parts.length, 3);
    }
});
