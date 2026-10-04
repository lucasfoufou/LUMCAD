import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSplineCreationEntity, buildSplineCreationPreview, MAX_SPLINE_CREATION_POINTS } from './drawingSplineCreation.js';
import { curvePointAt, extractEntityPaths } from './drawingCurveKernel.js';
import { createDefaultDrawingCreationConfig, applyDrawingCreationMode } from './drawingCreation.js';
import { getEntityGrips, editEntityGrip } from './drawingSelection.js';
import { baseSnapCandidates } from './drawingSnapGeometry.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const nearPoint = (a, b) => { near(a.x, b.x); near(a.y, b.y); };
const points = [{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 5, y: -2 }, { x: 9, y: 1 }, { x: 10, y: 6 }];

test('fit splines interpolate every point with natural endpoints and C2 chord-parameter continuity', () => {
    const spline = buildSplineCreationEntity(points, 'geometry');
    assert.equal(spline.parts.length, points.length - 1);
    spline.parts.forEach((part, index) => {
        nearPoint(curvePointAt(part, 0), points[index]);
        nearPoint(curvePointAt(part, 1), points[index + 1]);
    });
    const derivatives = (part, interval, end) => {
        const [a, b, c, d] = part.controlPoints;
        return Object.fromEntries(['x', 'y'].map(axis => [axis, [
            3 * (end ? d[axis] - c[axis] : b[axis] - a[axis]) / interval,
            6 * (end ? d[axis] - 2 * c[axis] + b[axis] : a[axis] - 2 * b[axis] + c[axis]) / interval ** 2,
        ]]));
    };
    const intervals = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    for (const axis of ['x', 'y']) {
        near(derivatives(spline.parts[0], intervals[0], false)[axis][1], 0);
        near(derivatives(spline.parts.at(-1), intervals.at(-1), true)[axis][1], 0);
        for (let index = 1; index < spline.parts.length; index += 1) {
            const left = derivatives(spline.parts[index - 1], intervals[index - 1], true)[axis];
            const right = derivatives(spline.parts[index], intervals[index], false)[axis];
            near(left[0], right[0]); near(left[1], right[1]);
        }
    }
});

test('control-vertex spline knot insertion matches independent Cox-de Boor evaluation', () => {
    const controls = [...points, { x: 12, y: 0 }, { x: 13, y: 2 }];
    const spline = buildSplineCreationEntity(controls, 'geometry', 'control');
    const spans = controls.length - 3;
    const knots = [0, 0, 0, 0, ...Array.from({ length: spans - 1 }, (_, i) => (i + 1) / spans), 1, 1, 1, 1];
    const basis = (i, degree, t) => {
        if (degree === 0) return knots[i] <= t && t < knots[i + 1] ? 1 : 0;
        const left = knots[i + degree] - knots[i];
        const right = knots[i + degree + 1] - knots[i + 1];
        return (left ? (t - knots[i]) / left * basis(i, degree - 1, t) : 0)
            + (right ? (knots[i + degree + 1] - t) / right * basis(i + 1, degree - 1, t) : 0);
    };
    spline.parts.forEach((part, index) => {
        for (const local of [0, 0.1, 0.3, 0.7, 0.99]) {
            const t = (index + local) / spans;
            const expected = controls.reduce((sum, point, i) => ({ x: sum.x + basis(i, 3, t) * point.x, y: sum.y + basis(i, 3, t) * point.y }), { x: 0, y: 0 });
            nearPoint(curvePointAt(part, local), expected);
        }
    });
    nearPoint(curvePointAt(spline.parts.at(-1), 1), controls.at(-1));
    assert.equal(extractEntityPaths(spline).length, 1);
});

test('creation rejects invalid/oversized inputs and keeps unfinished previews separate', () => {
    assert.equal(buildSplineCreationEntity(points.slice(0, 3), 'geometry', 'control'), null);
    assert.equal(buildSplineCreationPreview(points.slice(0, 3), 'geometry', 'control').type, 'polyline');
    assert.equal(buildSplineCreationEntity([points[0], points[0]], 'geometry'), null);
    assert.equal(buildSplineCreationEntity([{ x: Infinity, y: 0 }, points[1]], 'geometry'), null);
    assert.equal(buildSplineCreationEntity(Array(MAX_SPLINE_CREATION_POINTS + 1).fill(points[0]), 'geometry'), null);
    assert.equal(buildSplineCreationEntity(points, 'geometry', 'invalid'), null);
    const straight = buildSplineCreationEntity(points.slice(0, 2), 'geometry');
    nearPoint(curvePointAt(straight, 0.5), { x: 1, y: 2 });
    const config = applyDrawingCreationMode('spline', createDefaultDrawingCreationConfig('spline'), 'SPLINE CV');
    assert.equal(config.mode, 'control');
});

test('native spans retain editable controls, curve snaps, and exact archive round trips', () => {
    const single = buildSplineCreationEntity(points.slice(0, 4), 'geometry', 'control', 'single');
    assert.equal(single.type, 'spline');
    assert.deepEqual(single.controlPoints, points.slice(0, 4));
    const grip = getEntityGrips(single)[1];
    const edited = editEntityGrip(single, grip.id, { x: 3, y: 7 });
    assert.deepEqual(edited.controlPoints[1], { x: 3, y: 7 });
    const snaps = baseSnapCandidates(single, { endpoint: true, midpoint: true });
    assert.equal(snaps.filter(snap => snap.type === 'endpoint').length, 2);
    nearPoint(snaps.find(snap => snap.type === 'midpoint'), curvePointAt(single, 0.5));
    const document = createLcadDocument({ name: 'Splines' });
    document.content.entities = [single, buildSplineCreationEntity(points, 'geometry', 'fit', 'fit')];
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content.entities, document.content.entities);
});
