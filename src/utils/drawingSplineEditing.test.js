import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSplineCreationEntity } from './drawingSplineCreation.js';
import { editEntityGrip, getEntityGrips } from './drawingSelection.js';
import { extractEntityPaths, curveTangentAt } from './drawingCurveKernel.js';
import { editSplineControl, isEditableSpline, parseSplineControlInput } from './drawingSplineEditing.js';

const points = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 8, y: 1 }, { x: 10, y: 6 }];
const path = () => {
    const { splineDefinition, ...native } = buildSplineCreationEntity(points, 'geometry', 'fit', 'path');
    return { ...native, color: '#aabbcc' };
};
const nearPoint = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-8);

test('moving a spline joint translates both endpoints and their adjacent controls', () => {
    const source = path();
    const before = structuredClone(source);
    const edited = editEntityGrip(source, 'part-0:control-3', { x: 5, y: 7 });
    assert.equal(edited.id, 'path');
    assert.equal(edited.color, source.color);
    nearPoint(edited.parts[0].controlPoints[3], { x: 5, y: 7 });
    nearPoint(edited.parts[1].controlPoints[0], { x: 5, y: 7 });
    for (const [part, control] of [[0, 2], [1, 1]]) {
        nearPoint(edited.parts[part].controlPoints[control], {
            x: source.parts[part].controlPoints[control].x + 2,
            y: source.parts[part].controlPoints[control].y + 3,
        });
    }
    nearPoint(curveTangentAt(edited.parts[0], 1), curveTangentAt(edited.parts[1], 0));
    assert.equal(extractEntityPaths(edited).length, 1);
    assert.deepEqual(source, before);
    assert.deepEqual(editEntityGrip(source, 'part-1:control-0', { x: 5, y: 7 }), edited);
    assert.equal(getEntityGrips(source).length, 10);
});

test('moving a smooth tangent control preserves the opposite tangent ratio', () => {
    const source = path();
    const edited = editEntityGrip(source, 'part-0:control-2', { x: 1, y: 3 });
    nearPoint(curveTangentAt(edited.parts[0], 1), curveTangentAt(edited.parts[1], 0));
    nearPoint(edited.parts[0].controlPoints[3], points[1]);
    const ratio = entity => {
        const a = entity.parts[0].controlPoints[2];
        const b = entity.parts[1].controlPoints[1];
        return Math.hypot(a.x - 3, a.y - 4) / Math.hypot(b.x - 3, b.y - 4);
    };
    assert.ok(Math.abs(ratio(source) - ratio(edited)) < 1e-8);
    assert.deepEqual(source.parts[2], edited.parts[2]);
});

test('intentional corners and disconnected paths retain independent tangent controls', () => {
    const corner = path();
    corner.parts[1].controlPoints[1] = { x: 3, y: 7 };
    const edited = editEntityGrip(corner, 'part-0:control-2', { x: 1, y: 3 });
    assert.deepEqual(edited.parts[1], corner.parts[1]);
    const disconnected = path();
    disconnected.parts[1].controlPoints[0] = { x: 4, y: 4 };
    const moved = editEntityGrip(disconnected, 'part-0:control-3', { x: 5, y: 7 });
    assert.deepEqual(moved.parts[1], disconnected.parts[1]);
    assert.equal(getEntityGrips(disconnected).length, 11);
});

test('closed cubic path seam remains closed, including a one-span loop', () => {
    const closed = { id: 'loop', type: 'polyline', closed: true, parts: [{ type: 'spline', controlPoints: [
        { x: 0, y: 0 }, { x: 3, y: 4 }, { x: -3, y: 4 }, { x: 0, y: 0 },
    ] }] };
    const edited = editEntityGrip(closed, 'part-0:control-0', { x: 1, y: 2 });
    nearPoint(edited.parts[0].controlPoints[3], { x: 1, y: 2 });
    nearPoint(edited.parts[0].controlPoints[1], { x: 4, y: 6 });
    nearPoint(edited.parts[0].controlPoints[2], { x: -2, y: 6 });
    assert.equal(getEntityGrips(edited).length, 3);
    assert.equal(extractEntityPaths(edited)[0].closed, true);
});

test('invalid control edits reject the complete change without mutating the path', () => {
    const source = path();
    assert.equal(editEntityGrip(source, 'part-0:control-3', { x: Infinity, y: 0 }), source);
    assert.equal(editEntityGrip(source, 'part-0:control-2', { x: 1e13, y: 0 }), source);
});

test('SPLINEDIT accepts bounded one-based controls and excludes associative arrays', () => {
    const input = parseSplineControlInput('CONTROL 2 1 -4.5 6');
    assert.deepEqual(input, { partIndex: 1, controlIndex: 0, point: { x: -4.5, y: 6 } });
    for (const text of ['CONTROL 0 1 2 3', 'CONTROL 1 5 2 3', 'CONTROL 1.5 1 2 3', 'CONTROL 1 1 NaN 3', 'CONTROL 1 1 2', 'FIT 1 1 2 3']) {
        assert.equal(parseSplineControlInput(text), null);
    }
    const source = path();
    assert.equal(isEditableSpline({ ...source, array: { kind: 'polar' } }), false);
    assert.equal(editSplineControl(source, 99, 0, { x: 0, y: 0 }), source);
    const single = source.parts[0];
    const edited = editSplineControl(single, 0, 1, { x: 1, y: 2 });
    nearPoint(edited.controlPoints[1], { x: 1, y: 2 });
    assert.equal(editSplineControl(single, 1, 1, { x: 1, y: 2 }), single);
});
