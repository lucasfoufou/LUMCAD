import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { rebuildDefinedSpline } from './drawingSplineCreation.js';
import { runDrawingConstraintCommand } from './drawingConstraintCommands.js';
import { drawingConstraintCoordinates, drawingConstraintIntrinsicResiduals, drawingConstraintRadiusIndices, translateDrawingConstraintSnapshot } from './drawingConstraintEntities.js';
import { curvePointAt } from './drawingCurveKernel.js';
import { prepareDrawingConstraintEdit } from './drawingConstraintEditing.js';

function fixture(entities) {
    const content = createDefaultDrawingContent();
    return { ...content, entities: entities.map(entity => ({ ...entity, layerId: entity.layerId || content.activeLayerId })) };
}
const line = (x1, y1, x2, y2) => ({ type: 'line', x1, y1, x2, y2 });

test('driving a mixed path span retains connected native joints and root metadata', () => {
    const path = { id: 'path', type: 'polyline', color: '#123456', closed: false,
        parts: [line(0, 0, 3, 0.2), line(3, 0.2, 4, 3)] };
    const content = fixture([path]);
    const result = runDrawingConstraintCommand(content, 'gcHorizontal', '1@0:', ['path']);
    assert.ok(!result.error, JSON.stringify(result));
    const solved = result.content.entities[0];
    assert.equal(solved.id, path.id); assert.equal(solved.color, path.color);
    assert.ok(Math.abs(solved.parts[0].y1 - solved.parts[0].y2) < 1e-7);
    assert.ok(drawingConstraintIntrinsicResiduals(path, solved).every(value => Math.abs(value) < 1e-7));
    assert.ok(Math.abs(solved.parts[1].y1 - solved.parts[0].y2) < 1e-7);
    assert.deepEqual(content.entities[0].parts, path.parts);
    assert.equal(normalizeDrawingContent(result.content).geometricConstraints.length, 1);
});

test('circular span radii use positive parametrization and preserve adjacent joins', () => {
    const path = { id: 'path', type: 'polyline', closed: false, parts: [line(-2, 0, 1, 0),
        { type: 'arc', cx: 1, cy: 1, r: 1, startAngle: -Math.PI / 2, endAngle: 0 }] };
    const content = fixture([path, { id: 'circle', type: 'circle', cx: 10, cy: 0, r: 2 }]);
    assert.deepEqual(drawingConstraintRadiusIndices(path), [6]);
    const fixed = runDrawingConstraintCommand(content, 'gcFix', '', ['circle']).content;
    const result = runDrawingConstraintCommand(fixed, 'gcEqual', '1@1: 2', ['path', 'circle']);
    assert.ok(!result.error, JSON.stringify(result));
    const solved = result.content.entities[0];
    assert.ok(Math.abs(solved.parts[1].r - 2) < 1e-7);
    const end = curvePointAt(solved.parts[0], 1); const start = curvePointAt(solved.parts[1], 0);
    assert.ok(Math.hypot(end.x - start.x, end.y - start.y) < 1e-7);
});

test('fit and control splines solve by definition coordinates while preserving knots and regenerated geometry', () => {
    for (const mode of ['fit', 'control']) {
        const definition = { mode, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 0 }],
            knots: mode === 'fit' ? [0, 0.3, 0.7, 1] : [0, 0, 0, 0, 1, 1, 1, 1] };
        const spline = rebuildDefinedSpline({ id: 'spline', color: '#123456' }, definition);
        const content = fixture([spline, { id: 'point', type: 'point', x: 0, y: 2 }]);
        const fixed = runDrawingConstraintCommand(content, 'gcFix', '', ['point']).content;
        const result = runDrawingConstraintCommand(fixed, 'gcCoincident', '1@spline-point-0 2@node', ['spline', 'point']);
        assert.ok(!result.error, JSON.stringify(result));
        const solved = result.content.entities[0];
        assert.equal(solved.color, '#123456'); assert.equal(solved.splineDefinition.mode, mode);
        assert.deepEqual(solved.splineDefinition.knots, definition.knots);
        assert.ok(Math.abs(solved.splineDefinition.points[0].y - 2) < 1e-7);
        assert.deepEqual(solved, rebuildDefinedSpline(solved, solved.splineDefinition));
        assert.ok(normalizeDrawingContent(result.content).entities[0].splineDefinition);
    }
});

test('fit derivative snapshots translate points but retain derivative vectors', () => {
    const spline = rebuildDefinedSpline({ id: 'fit' }, { mode: 'fit', points: [{ x: 0, y: 0 }, { x: 3, y: 2 }], knots: [0, 1],
        startTangent: { x: 1, y: 2 }, endTangent: { x: 3, y: 4 } });
    const values = drawingConstraintCoordinates(spline);
    assert.deepEqual(values, [0, 0, 3, 2, 1, 2, 3, 4]);
    assert.deepEqual(translateDrawingConstraintSnapshot(spline, values, { x: 10, y: 20 }), [10, 20, 13, 22, 1, 2, 3, 4]);
});

test('later edits to constrained path spans retain joints or reject atomically', () => {
    const content = fixture([{ id: 'path', type: 'polyline', parts: [line(0, 0, 3, 0), line(3, 0, 4, 3)] }]);
    const initial = runDrawingConstraintCommand(content, 'gcHorizontal', '1@0:', ['path']).content;
    const proposed = structuredClone(initial); proposed.entities[0].parts[1].y2 = 5;
    const result = prepareDrawingConstraintEdit(initial, proposed);
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(result.content.entities[0].parts[1].y2, 5);
    assert.ok(drawingConstraintIntrinsicResiduals(initial.entities[0], result.content.entities[0]).every(value => Math.abs(value) < 1e-7));
    const movedJoint = structuredClone(initial); movedJoint.entities[0].parts[1].x1 = 5;
    const joined = prepareDrawingConstraintEdit(initial, movedJoint);
    assert.ok(!joined.error, JSON.stringify(joined));
    assert.equal(joined.content.entities[0].parts[1].x1, 5);
    assert.ok(Math.abs(joined.content.entities[0].parts[0].x2 - 5) < 1e-7);
});

test('closed native contours retain their closing joint while a segment is constrained', () => {
    const path = { id: 'loop', type: 'polyline', closed: true,
        parts: [line(0, 0, 3, 0.2), line(3, 0.2, 3, 3), line(3, 3, 0, 3), line(0, 3, 0, 0)] };
    const result = runDrawingConstraintCommand(fixture([path]), 'gcHorizontal', '1@0:', ['loop']);
    assert.ok(!result.error, JSON.stringify(result));
    const solved = result.content.entities[0];
    assert.equal(solved.closed, true);
    const residuals = drawingConstraintIntrinsicResiduals(path, solved);
    assert.equal(residuals.length, 8);
    assert.ok(residuals.every(value => Math.abs(value) < 1e-7));
});

test('equal-length coordinate arrays do not authorize a change of constraint representation', () => {
    const content = fixture([{ id: 'path', type: 'polyline', parts: [line(0, 0, 3, 0), line(3, 0, 4, 3)] }]);
    const fixed = runDrawingConstraintCommand(content, 'gcFix', '', ['path']).content;
    const proposed = { ...fixed, entities: [{ id: 'path', type: 'polyline', layerId: content.activeLayerId,
        points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 3 }] }] };
    assert.equal(drawingConstraintCoordinates(proposed.entities[0]).length, drawingConstraintCoordinates(content.entities[0]).length);
    const result = prepareDrawingConstraintEdit(fixed, proposed);
    assert.equal(result.error, 'topology');
    assert.equal(result.content, undefined);
});

test('regular polygon constraints retain the native centre, radius, vertex identities and construction mode', () => {
    for (const mode of ['inscribed', 'circumscribed']) {
        const polygon = { id: 'polygon', type: 'polygon', cx: 10, cy: 20, r: 2, rotation: 0, sides: 5, mode };
        const content = fixture([polygon, { id: 'point', type: 'point', x: 12, y: 23 }]);
        const fixed = runDrawingConstraintCommand(content, 'gcFix', '', ['point']).content;
        const result = runDrawingConstraintCommand(fixed, 'gcCoincident', '1@center 2@node', ['polygon', 'point']);
        assert.ok(!result.error, JSON.stringify(result));
        const solved = result.content.entities[0];
        assert.ok(Math.abs(solved.cx - 12) < 1e-7 && Math.abs(solved.cy - 23) < 1e-7);
        assert.equal(solved.sides, 5); assert.equal(solved.mode, mode); assert.equal(solved.r, 2);
        assert.equal(solved.type, 'polygon');
        assert.deepEqual(translateDrawingConstraintSnapshot(polygon, drawingConstraintCoordinates(polygon), { x: 3, y: 4 }), [13, 24, 2, 0]);
        assert.deepEqual(drawingConstraintRadiusIndices(polygon), [2]);
        assert.equal(normalizeDrawingContent(result.content).entities[0].type, 'polygon');
        const proposed = structuredClone(result.content); proposed.entities[0].sides = 6;
        assert.equal(prepareDrawingConstraintEdit(result.content, proposed).error, 'topology');
    }
});

test('polygon edge equality changes the radius while preserving a fixed centre and regularity', () => {
    const content = fixture([{ id: 'polygon', type: 'polygon', cx: 0, cy: 0, r: 1, rotation: 0, sides: 4, mode: 'inscribed' },
        { id: 'line', type: 'line', x1: 10, y1: 0, x2: 14, y2: 0 }]);
    const fixed = runDrawingConstraintCommand(content, 'gcFix', '1@center', ['polygon']).content;
    const pinned = runDrawingConstraintCommand(fixed, 'gcFix', '', ['line']).content;
    const result = runDrawingConstraintCommand(pinned, 'gcEqual', '1@0: 2', ['polygon', 'line']);
    assert.ok(!result.error, JSON.stringify(result));
    const polygon = result.content.entities[0];
    assert.ok(Math.abs(polygon.r - 2 * Math.SQRT2) < 1e-7);
    assert.ok(Math.abs(polygon.cx) < 1e-7 && Math.abs(polygon.cy) < 1e-7);
    assert.equal(polygon.sides, 4);
});
