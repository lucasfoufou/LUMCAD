import test from 'node:test';
import assert from 'node:assert/strict';
import { offsetEllipseEntity, ellipseOffsetPoint, ellipseOffsetThroughParameters, ELLIPSE_OFFSET_TOLERANCE } from './drawingEllipseOffset.js';
import { closestPointOnPath, curveTangentAt, normalizeCurvePath } from './drawingCurveKernel.js';
import { getOffsetThroughParameters, offsetEntityTowardPoint } from './drawingGeometry.js';
import { transformEntity } from './drawingPrimitives.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { createOffsetPreviewEntities } from './drawingOperations.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const ellipse = { id: 'ellipse', layerId: 'geometry', type: 'ellipse', cx: 0, cy: 0, rx: 4, ry: 2, rotation: 0, fullEllipse: true, startAngle: 0, endAngle: 0, counterClockwise: true, color: '#123456' };
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('full ellipse offset creates a closed cubic path at a constant normal distance', () => {
    const result = offsetEllipseEntity(ellipse, 0.5);
    assert.equal(result.type, 'polyline');
    assert.equal(result.closed, true);
    assert.equal(result.color, ellipse.color);
    assert.ok(result.parts.every(part => part.type === 'spline'));
    assert.ok(normalizeCurvePath(result));
    assert.deepEqual(result.parts[0].controlPoints[0], result.parts.at(-1).controlPoints[3]);
    for (let index = 0; index <= 40; index += 1) {
        const expected = ellipseOffsetPoint(ellipse, index / 40, 0.5);
        assert.ok(closestPointOnPath(result, expected).distance < ELLIPSE_OFFSET_TOLERANCE);
    }
    for (let index = 1; index < result.parts.length; index += 1) {
        const a = curveTangentAt(result.parts[index - 1], 1);
        const b = curveTangentAt(result.parts[index], 0);
        near(a.x * b.x + a.y * b.y, 1);
    }
});

test('rotated elliptical arc offsets retain endpoints and clockwise traversal', () => {
    for (const counterClockwise of [true, false]) {
        const arc = { ...ellipse, fullEllipse: false, startAngle: 0.4, endAngle: 2.1, rotation: 37, counterClockwise };
        const result = offsetEllipseEntity(arc, -0.25);
        assert.equal(result.closed, false);
        const start = ellipseOffsetPoint(arc, 0, -0.25);
        const end = ellipseOffsetPoint(arc, 1, -0.25);
        near(result.parts[0].controlPoints[0].x, start.x);
        near(result.parts.at(-1).controlPoints[3].y, end.y);
        for (let index = 0; index <= 20; index += 1) {
            assert.ok(closestPointOnPath(result, ellipseOffsetPoint(arc, index / 20, -0.25)).distance < ELLIPSE_OFFSET_TOLERANCE);
        }
    }
});

test('distance and through-point entry points choose the correct side', () => {
    const point = ellipseOffsetPoint(ellipse, 0.17, 0.4);
    const through = getOffsetThroughParameters(ellipse, point);
    near(through.distance, 0.4);
    assert.equal(through.side, 1);
    const inside = getOffsetThroughParameters(ellipse, { x: 3.5, y: 0 });
    near(inside.distance, 0.5);
    assert.equal(inside.side, -1);
    assert.deepEqual(offsetEntityTowardPoint(ellipse, 0.5, { x: 5, y: 0 }), offsetEllipseEntity(ellipse, 0.5));
    const arc = { ...ellipse, fullEllipse: false, endAngle: Math.PI / 2 };
    assert.equal(ellipseOffsetThroughParameters(arc, { x: 4, y: -1 }), null);
});

test('invalid, singular and work-limited offsets fail without returning partial geometry', () => {
    for (const distance of [0, -1, -2, Infinity, NaN]) assert.equal(offsetEllipseEntity(ellipse, distance), null);
    assert.equal(offsetEllipseEntity(ellipse, 1, { maximumParts: 2 }), null);
    assert.equal(offsetEllipseEntity({ ...ellipse, ry: 0 }, 1), null);
    // A partial arc away from the tight tips can admit a larger inward offset.
    const top = { ...ellipse, fullEllipse: false, startAngle: 1.4, endAngle: 1.7 };
    assert.ok(offsetEllipseEntity(top, -2));
});

test('offset preview is immutable and native cubic results survive reload and transforms', () => {
    const content = { ...createDefaultDrawingContent(), entities: [ellipse] };
    const before = structuredClone(content);
    const previews = createOffsetPreviewEntities(content, [ellipse.id], 0.5, { x: 5, y: 0 });
    assert.equal(previews.length, 1);
    assert.deepEqual(content, before);
    const document = createLcadDocument({ name: 'Ellipse offsets' });
    document.content.entities = [offsetEllipseEntity(ellipse, 0.5)];
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content.entities[0], document.content.entities[0]);
    const scaled = transformEntity(restored.content.entities[0], { scaleX: 2, scaleY: 3 });
    near(scaled.parts[0].controlPoints[0].x, 9);
    assert.equal(scaled.parts.length, restored.content.entities[0].parts.length);
});
