import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSplineCreationEntity, normalizeSplineDefinition, reconcileSplineDefinition, rebuildDefinedSpline } from './drawingSplineCreation.js';
import { applySplineEditInput } from './drawingSplineEditing.js';
import { getEntityGrips, editEntityGrip } from './drawingSelection.js';
import { curvePointAt } from './drawingCurveKernel.js';
import { translateEntity, rotateEntity, mirrorEntity, transformEntity } from './drawingPrimitives.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';
import { normalizeDrawingContent, createDefaultDrawingContent } from './drawingDocument.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const points = [{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 5, y: -2 }, { x: 9, y: 1 }, { x: 10, y: 6 }];
const near = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-7, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

test('fit-point definitions survive archive reload and remain editable through their point grips', () => {
    const entity = buildSplineCreationEntity(points, 'geometry', 'fit', 'defined');
    const document = createLcadDocument({ name: 'Defined spline' });
    document.content.entities = [entity];
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content.entities[0];
    assert.deepEqual(restored, entity);
    assert.equal(getEntityGrips(restored).length, points.length);
    const edited = editEntityGrip(restored, 'spline-point-2', { x: 6, y: 3 });
    near(curvePointAt(edited.parts[1], 1), { x: 6, y: 3 });
    near(curvePointAt(edited.parts[2], 0), { x: 6, y: 3 });
    assert.deepEqual(edited.splineDefinition.knots, entity.splineDefinition.knots);
    assert.equal(edited.id, entity.id);
});

test('all affine transforms preserve fit definitions and exactly transform existing geometry', () => {
    const source = buildSplineCreationEntity(points, 'geometry', 'fit', 'source');
    const { splineDefinition, ...plain } = source;
    const transforms = [
        entity => translateEntity(entity, 4, -2),
        entity => rotateEntity(entity, 35, { x: 1, y: 2 }),
        entity => mirrorEntity(entity, { x: 0, y: 1 }, { x: 2, y: 4 }),
        entity => transformEntity(entity, { scaleX: 2, scaleY: 0.3, origin: { x: 1, y: 2 } }),
        entity => transformDrawingEntityAffine(entity, { a: 2, b: 0.4, c: 1.3, d: 0.7, e: 4, f: 8 }),
    ];
    for (const transform of transforms) {
        const actual = transform(source);
        const expected = transform(plain);
        assert.ok(actual.splineDefinition);
        assert.ok(reconcileSplineDefinition(actual).splineDefinition);
        actual.parts.forEach((part, index) => part.controlPoints.forEach((point, control) => near(point, expected.parts[index].controlPoints[control])));
        const edited = applySplineEditInput(actual, 'POINT 2 3 6');
        near(edited.splineDefinition.points[1], { x: 3, y: 6 });
    }
});

test('B-spline knots and original vertices remain editable and validate monotonicity', () => {
    const source = buildSplineCreationEntity([...points, { x: 12, y: 0 }], 'geometry', 'control', 'source');
    const edited = applySplineEditInput(source, 'KNOT 5 0.2');
    assert.equal(edited.splineDefinition.knots[4], 0.2);
    assert.notDeepEqual(edited.parts, source.parts);
    const changed = applySplineEditInput(edited, 'POINT 3 6 2');
    assert.deepEqual(changed.splineDefinition.points[2], { x: 6, y: 2 });
    assert.equal(applySplineEditInput(source, 'KNOT 5 0.9'), source);
    assert.equal(applySplineEditInput(source, 'KNOT 1 0.2'), source);
    assert.equal(applySplineEditInput(source, 'POINT 99 0 0'), source);
    assert.equal(applySplineEditInput(source, 'POINT 1 Infinity 0'), source);
    const repeated = applySplineEditInput(source, 'KNOT 5 0.6666666666666666');
    assert.equal(repeated.parts.length, 2);
    near(curvePointAt(repeated.parts[0], 1), curvePointAt(repeated.parts[1], 0));
    for (const candidate of [edited, repeated]) {
        const { knots, points: controls } = candidate.splineDefinition;
        const basis = (index, degree, t) => {
            if (degree === 0) return knots[index] <= t && t < knots[index + 1] ? 1 : 0;
            const left = knots[index + degree] - knots[index];
            const right = knots[index + degree + 1] - knots[index + 1];
            return (left ? (t - knots[index]) / left * basis(index, degree - 1, t) : 0)
                + (right ? (knots[index + degree + 1] - t) / right * basis(index + 1, degree - 1, t) : 0);
        };
        const unique = [...new Set(knots)];
        candidate.parts.forEach((part, index) => {
            for (const parameter of [0, 0.23, 0.61, 0.99]) {
                const t = unique[index] + (unique[index + 1] - unique[index]) * parameter;
                const expected = controls.reduce((sum, point, control) => ({
                    x: sum.x + point.x * basis(control, 3, t), y: sum.y + point.y * basis(control, 3, t),
                }), { x: 0, y: 0 });
                near(curvePointAt(part, parameter), expected);
            }
        });
    }
});

test('stale or corrupt definitions detach without reverting authoritative edited geometry', () => {
    const source = buildSplineCreationEntity(points, 'geometry', 'fit', 'source');
    const changed = structuredClone(source);
    changed.parts[0].controlPoints[1].x += 1;
    const content = normalizeDrawingContent({ ...createDefaultDrawingContent(), entities: [changed] });
    assert.equal(content.entities[0].splineDefinition, undefined);
    assert.deepEqual(content.entities[0].parts, changed.parts);
    const invalid = { ...source.splineDefinition, knots: [0, 0, 0, 0, 1] };
    assert.equal(normalizeSplineDefinition(invalid), null);
    assert.equal(rebuildDefinedSpline(source, invalid), null);
    const bezier = applySplineEditInput(source, 'BEZIER');
    assert.equal(bezier.splineDefinition, undefined);
    assert.deepEqual(bezier.parts, source.parts);
    assert.equal(applySplineEditInput(source, 'CONTROL 1 2 1 3').splineDefinition, undefined);
});
