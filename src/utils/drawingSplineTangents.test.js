import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSplineCreationEntity, reconcileSplineDefinition } from './drawingSplineCreation.js';
import { applySplineEditInput, splineEndpointDerivative } from './drawingSplineEditing.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';
import { curvePointAt } from './drawingCurveKernel.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const nearPoint = (a, b) => { near(a.x, b.x); near(a.y, b.y); };
const points = [{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 5, y: -2 }, { x: 9, y: 1 }];

test('two-point clamped fit is the exact cubic Hermite curve', () => {
    const source = buildSplineCreationEntity([{ x: 0, y: 0 }, { x: 3, y: 0 }], 'geometry');
    const start = applySplineEditInput(source, 'TANGENT START 3 6');
    const both = applySplineEditInput(start, 'TANGENT END 3 -6');
    nearPoint(both.controlPoints[1], { x: 1, y: 2 });
    nearPoint(both.controlPoints[2], { x: 2, y: 2 });
    nearPoint(splineEndpointDerivative(both, 'start'), { x: 3, y: 6 });
    nearPoint(splineEndpointDerivative(both, 'end'), { x: 3, y: -6 });
});

test('clamped and mixed-natural fits interpolate points and preserve C2 parameter continuity', () => {
    const source = buildSplineCreationEntity(points, 'geometry');
    const start = applySplineEditInput(source, 'TANGENT START 10 0');
    const both = applySplineEditInput(start, 'TANGENT END 0 8');
    const end = applySplineEditInput(both, 'TANGENT START NATURAL');
    for (const entity of [start, both, end]) {
        const h = entity.splineDefinition.knots.slice(1).map((value, index) => value - entity.splineDefinition.knots[index]);
        entity.parts.forEach((part, index) => {
            nearPoint(curvePointAt(part, 0), points[index]);
            nearPoint(curvePointAt(part, 1), points[index + 1]);
        });
        for (let index = 1; index < entity.parts.length; index += 1) {
            const left = entity.parts[index - 1].controlPoints;
            const right = entity.parts[index].controlPoints;
            for (const axis of ['x', 'y']) {
                near(3 * (left[3][axis] - left[2][axis]) / h[index - 1], 3 * (right[1][axis] - right[0][axis]) / h[index]);
                near(6 * (left[3][axis] - 2 * left[2][axis] + left[1][axis]) / h[index - 1] ** 2,
                    6 * (right[0][axis] - 2 * right[1][axis] + right[2][axis]) / h[index] ** 2);
            }
        }
    }
    nearPoint(splineEndpointDerivative(start, 'start'), { x: 10, y: 0 });
    nearPoint(splineEndpointDerivative(both, 'end'), { x: 0, y: 8 });
    assert.equal(end.splineDefinition.startTangent, undefined);
    const natural = applySplineEditInput(end, 'TANGENT END NATURAL');
    natural.parts.forEach((part, index) => part.controlPoints.forEach((point, control) => nearPoint(point, source.parts[index].controlPoints[control])));
});

test('control-vertex tangents update the endpoint handle using the knot interval', () => {
    const source = buildSplineCreationEntity([...points, { x: 12, y: 0 }], 'geometry', 'control');
    const start = applySplineEditInput(source, 'TANGENT START 8 3');
    const both = applySplineEditInput(start, 'TANGENT END 4 -7');
    nearPoint(splineEndpointDerivative(both, 'start'), { x: 8, y: 3 });
    nearPoint(splineEndpointDerivative(both, 'end'), { x: 4, y: -7 });
    assert.equal(both.splineDefinition.mode, 'control');
    assert.equal(applySplineEditInput(both, 'TANGENT START NATURAL'), both);
});

test('tangent constraints survive archive and affine transforms as vectors', () => {
    const source = applySplineEditInput(buildSplineCreationEntity(points, 'geometry', 'fit', 'curve'), 'TANGENT START 10 2');
    const document = createLcadDocument({ name: 'Clamped spline' });
    document.content.entities = [source];
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content.entities[0];
    assert.deepEqual(restored, source);
    const matrix = { a: 2, b: 0.5, c: 1.5, d: 0.7, e: 40, f: 60 };
    const transformed = transformDrawingEntityAffine(restored, matrix);
    nearPoint(transformed.splineDefinition.startTangent, { x: 23, y: 6.4 });
    assert.ok(reconcileSplineDefinition(transformed).splineDefinition);
    const { splineDefinition, ...plain } = source;
    const expected = transformDrawingEntityAffine(plain, matrix);
    transformed.parts.forEach((part, index) => part.controlPoints.forEach((point, control) => nearPoint(point, expected.parts[index].controlPoints[control])));
    for (const input of ['TANGENT START 0 0', 'TANGENT END NaN 1', 'TANGENT START 1e13 0', 'TANGENT WRONG 1 2']) {
        assert.equal(applySplineEditInput(source, input), source);
    }
});
