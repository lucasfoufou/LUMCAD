import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getAdvancedEntityBounds,
    normalizeDrawingHatch,
    sampleAdvancedCurvePoints,
    transformEllipseAffine,
    transformPointAffine,
} from './drawingAdvancedEntities.js';
import {
    createAnonymousDrawingBlock,
    createAnonymousDrawingBlockReference,
    materializeDrawingBlockReference,
    multiplyAffineMatrices,
    rotationAffineMatrix,
    scaleAffineMatrix,
    translationAffineMatrix,
} from './drawingBlocks.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { getEntityBounds, snapDrawingPoint } from './drawingGeometry.js';
import { getEntitySegments, mirrorEntity, rotateEntity, scaleEntity, translateEntity } from './drawingPrimitives.js';
import { baseSnapCandidates, nearestSnapCandidate } from './drawingSnapGeometry.js';
import { editEntityGrip, entityMatchesSelectionWindow, getEntityGrips } from './drawingSelection.js';
import { closestPointOnCurve, curvePointAt, curveTangentAt } from './drawingCurveKernel.js';

const EPSILON = 1e-7;

function close(actual, expected, tolerance = EPSILON) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

function pointClose(actual, expected, tolerance = EPSILON) {
    close(actual.x, expected.x, tolerance);
    close(actual.y, expected.y, tolerance);
}

function ellipse(properties = {}) {
    return {
        id: 'ellipse', type: 'ellipse', layerId: 'geometry',
        cx: 0, cy: 0, rx: 4, ry: 2, rotation: 0,
        ...properties,
    };
}

function spline(properties = {}) {
    return {
        id: 'spline', type: 'spline', layerId: 'geometry',
        controlPoints: [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 0 }],
        ...properties,
    };
}

function hatch(properties = {}) {
    return {
        id: 'hatch', type: 'hatch', layerId: 'geometry',
        boundaries: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]],
        pattern: { name: 'solid' },
        ...properties,
    };
}

test('document normalization canonicalizes ellipse, cubic spline, and solid hatch schemas', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        {
            id: 'ellipse', type: 'ellipseArc', layerId: 'geometry',
            cx: '2', cy: 3, radiusX: -4, radiusY: 2, rotation: -30,
            startAngle: 0, endAngle: Math.PI, counterClockwise: false,
        },
        {
            id: 'spline', type: 'bezier', layerId: 'geometry',
            p0: { x: 0, y: 0 }, p1: { x: 1, y: 2 }, p2: { x: 2, y: 2 }, p3: { x: 3, y: 0 },
        },
        hatch({
            loops: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }]],
            boundaries: undefined,
            pattern: 'solid',
            color: '#123456', transparency: 40,
        }),
    ];
    const normalized = normalizeDrawingContent(content);
    assert.deepEqual(normalized.entities[0], {
        id: 'ellipse', type: 'ellipse', layerId: 'geometry',
        cx: 2, cy: 3, rx: 4, ry: 2, rotation: 330,
        startAngle: 0, endAngle: Math.PI, counterClockwise: false, fullEllipse: false,
    });
    assert.equal(normalized.entities[1].type, 'spline');
    assert.equal(normalized.entities[1].degree, 3);
    assert.deepEqual(normalized.entities[1].controlPoints, [
        { x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 0 },
    ]);
    const normalizedHatch = normalized.entities[2];
    assert.equal(Object.hasOwn(normalizedHatch, 'loops'), false);
    assert.equal(normalizedHatch.pattern.name, 'solid');
    assert.equal(normalizedHatch.boundaries.length, 1);
    assert.equal(normalizedHatch.boundaries[0].type, 'polyline');
    assert.equal(normalizedHatch.boundaries[0].closed, true);
    assert.deepEqual(normalizedHatch.boundaries[0].parts.map(part => part.type), ['line', 'line', 'line']);
    assert.equal(normalizedHatch.color, '#123456');
    assert.equal(normalizedHatch.transparency, 40);
});

test('normalization bounds hatch loops and rejects open or invalid boundaries', () => {
    const normalized = normalizeDrawingHatch({
        type: 'hatch',
        boundaries: [
            { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }], closed: false },
            [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }],
            [{ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 0, y: 2 }],
        ],
        pattern: { name: '', angle: 450, scale: -1, spacing: 0, origin: { x: 2, y: 3 } },
    });
    assert.equal(normalized.boundaries.length, 1);
    assert.equal(normalized.pattern.name, 'solid');
    assert.equal(normalized.pattern.angle, 90);
    assert.equal(normalized.pattern.scale, 1);
    assert.equal(normalized.pattern.spacing, 1);
    assert.deepEqual(normalized.pattern.origin, { x: 2, y: 3 });
});

test('ellipse and cubic bounds are exact, including rotation and derivative extrema', () => {
    assert.deepEqual(getAdvancedEntityBounds(ellipse({ rotation: 90 })), {
        minX: -2, minY: -4, maxX: 2, maxY: 4,
    });
    assert.deepEqual(getAdvancedEntityBounds(spline()), {
        minX: 0, minY: 0, maxX: 2, maxY: 1.5,
    });
    const partial = getAdvancedEntityBounds(ellipse({
        startAngle: 0, endAngle: Math.PI, counterClockwise: true, fullEllipse: false,
    }));
    close(partial.minX, -4);
    close(partial.maxX, 4);
    close(partial.minY, 0);
    close(partial.maxY, 2);
});

test('arbitrary affine transforms retain exact native ellipse and cubic geometry', () => {
    const source = ellipse({
        cx: 1, cy: 2, rotation: 45,
        startAngle: 0.2, endAngle: 2.4, counterClockwise: true, fullEllipse: false,
    });
    const matrix = { a: 2, b: 0.2, c: 0.4, d: 1.2, e: 3, f: -1 };
    const transformed = transformEllipseAffine(source, matrix);
    assert.equal(transformed.type, 'ellipse');
    assert.equal(transformed.fullEllipse, false);
    for (const parameter of [0, 0.2, 0.5, 0.8, 1]) {
        const expected = transformPointAffine(curvePointAt(source, parameter), matrix);
        const closest = closestPointOnCurve(transformed, expected);
        assert.ok(closest.distance < 1e-6);
    }
    pointClose(curvePointAt(transformed, 0), transformPointAffine(curvePointAt(source, 0), matrix));
    pointClose(curvePointAt(transformed, 1), transformPointAffine(curvePointAt(source, 1), matrix));

    const scaledSpline = scaleEntity(spline(), { origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 3 });
    assert.equal(scaledSpline.type, 'spline');
    assert.deepEqual(scaledSpline.controlPoints, [
        { x: 0, y: 0 }, { x: 0, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 0 },
    ]);
});

test('translate, rotate, scale, and mirror preserve native advanced types and hatch boundaries', () => {
    const moved = translateEntity(ellipse(), 3, -2);
    assert.equal(moved.type, 'ellipse');
    pointClose({ x: moved.cx, y: moved.cy }, { x: 3, y: -2 });
    const rotated = rotateEntity(ellipse(), 90, { x: 0, y: 0 });
    assert.equal(rotated.type, 'ellipse');
    close(rotated.rotation, 90);
    const scaled = scaleEntity(ellipse({ rotation: 30 }), {
        origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 0.5,
    });
    assert.equal(scaled.type, 'ellipse');
    const mirrored = mirrorEntity(
        ellipse({ startAngle: 0.2, endAngle: 2, fullEllipse: false }),
        { x: 0, y: -1 },
        { x: 0, y: 1 },
    );
    assert.equal(mirrored.type, 'ellipse');
    assert.equal(mirrored.counterClockwise, false);

    const normalizedHatch = normalizeDrawingHatch(hatch({
        pattern: { name: 'ansi31', angle: 30, scale: 2, spacing: 0.25, origin: { x: 1, y: 1 } },
    }));
    const movedHatch = translateEntity(normalizedHatch, 5, 7);
    assert.equal(movedHatch.type, 'hatch');
    assert.equal(movedHatch.boundaries[0].type, 'polyline');
    pointClose(movedHatch.pattern.origin, { x: 6, y: 8 });
    assert.deepEqual(getEntityBounds(movedHatch), { minX: 5, minY: 7, maxX: 9, maxY: 10 });
});

test('segments, bounds, and selection include ellipses, splines, and solid hatch interiors', () => {
    const fullEllipse = ellipse();
    const ellipseSegments = getEntitySegments(fullEllipse);
    assert.equal(ellipseSegments.length, 96);
    pointClose(ellipseSegments[0][0], ellipseSegments.at(-1)[1]);
    assert.equal(getEntitySegments(spline()).length, 96);
    const normalizedHatch = normalizeDrawingHatch(hatch());
    assert.equal(getEntitySegments(normalizedHatch).length, 4);
    assert.deepEqual(getEntityBounds(normalizedHatch), { minX: 0, minY: 0, maxX: 4, maxY: 3 });

    assert.equal(entityMatchesSelectionWindow(fullEllipse, {
        minX: -5, minY: -3, maxX: 5, maxY: 3, mode: 'window',
    }), true);
    assert.equal(entityMatchesSelectionWindow(spline(), {
        minX: 0.9, minY: 1.4, maxX: 1.1, maxY: 1.6, mode: 'crossing',
    }), true);
    assert.equal(entityMatchesSelectionWindow(normalizedHatch, {
        minX: 1, minY: 1, maxX: 2, maxY: 2, mode: 'crossing',
    }), true);
    assert.equal(entityMatchesSelectionWindow(normalizedHatch, {
        minX: 8, minY: 8, maxX: 9, maxY: 9, mode: 'crossing',
    }), false);
});

test('advanced grips expose and edit ellipse axes, spline controls, and hatch boundaries', () => {
    assert.deepEqual(getEntityGrips(ellipse()).map(grip => grip.id), ['center', 'radius-x', 'radius-y']);
    assert.equal(editEntityGrip(ellipse(), 'radius-x', { x: 6, y: 0 }).rx, 6);
    pointClose(getEntityGrips(editEntityGrip(ellipse(), 'center', { x: 3, y: 4 }))[0], { x: 3, y: 4 });

    assert.deepEqual(getEntityGrips(spline()).map(grip => grip.id), [
        'control-0', 'control-1', 'control-2', 'control-3',
    ]);
    assert.deepEqual(editEntityGrip(spline(), 'control-1', { x: 4, y: 5 }).controlPoints[1], { x: 4, y: 5 });

    const normalizedHatch = normalizeDrawingHatch(hatch());
    const hatchGrips = getEntityGrips(normalizedHatch);
    assert.ok(hatchGrips.length >= 4);
    assert.ok(hatchGrips.every(grip => grip.id.startsWith('boundary-0:')));
    const moved = editEntityGrip(normalizedHatch, hatchGrips[0].id, { x: -1, y: -1 });
    assert.notDeepEqual(moved.boundaries, normalizedHatch.boundaries);
});

test('ellipse and spline base, nearest, and intersection snaps use exact curve math', () => {
    const fullEllipse = ellipse();
    const ellipseCandidates = baseSnapCandidates(fullEllipse, {
        endpoint: true, midpoint: true, center: true,
    });
    assert.deepEqual(ellipseCandidates.map(candidate => candidate.type), ['midpoint', 'center']);
    const nearestEllipse = nearestSnapCandidate({ x: 0.1, y: 2.2 }, fullEllipse);
    assert.equal(nearestEllipse.type, 'nearest');
    assert.ok(closestPointOnCurve(fullEllipse, nearestEllipse).distance < EPSILON);

    const splineCandidates = baseSnapCandidates(spline(), {
        endpoint: true, midpoint: true, center: false,
    });
    assert.deepEqual(splineCandidates.map(candidate => candidate.type), ['endpoint', 'endpoint', 'midpoint']);
    pointClose(splineCandidates[0], { x: 0, y: 0 });
    pointClose(splineCandidates[1], { x: 2, y: 0 });
    const tangent = curveTangentAt(spline(), 0.5);
    close(splineCandidates[2].guideAngles[0], Math.atan2(tangent.y, tangent.x));

    const content = createDefaultDrawingContent();
    content.entities = [
        fullEllipse,
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: -4, x2: 0, y2: 4 },
    ];
    const intersection = snapDrawingPoint({ x: 0.02, y: 2.01 }, content, 0.1);
    assert.equal(intersection.type, 'intersection');
    pointClose(intersection, { x: 0, y: 2 });
});

test('block bounds and affine materialization preserve ellipse, spline, and hatch models', () => {
    const definition = createAnonymousDrawingBlock([
        ellipse({ id: 'ellipse', cx: 10, cy: 20 }),
        spline({
            id: 'spline',
            controlPoints: [{ x: 10, y: 20 }, { x: 11, y: 22 }, { x: 12, y: 22 }, { x: 13, y: 20 }],
        }),
        hatch({
            id: 'hatch',
            boundaries: [[{ x: 10, y: 20 }, { x: 14, y: 20 }, { x: 14, y: 23 }, { x: 10, y: 23 }]],
            pattern: { name: 'solid' },
        }),
    ], { basePoint: { x: 10, y: 20 }, id: 'advanced-block' });
    assert.deepEqual(definition.bounds, { minX: -4, minY: -2, maxX: 4, maxY: 3 });
    const reference = createAnonymousDrawingBlockReference(definition, {
        id: 'reference', insertionPoint: { x: 5, y: 6 }, layerId: 'geometry',
    });
    reference.transform = multiplyAffineMatrices(
        translationAffineMatrix(5, 6),
        multiplyAffineMatrices(rotationAffineMatrix(30), scaleAffineMatrix(2, 1)),
    );
    const materialized = materializeDrawingBlockReference(reference, [definition]);
    assert.deepEqual(materialized.map(entity => entity.type), ['ellipse', 'spline', 'hatch']);
    assert.equal(materialized[2].pattern.name, 'solid');
    assert.equal(materialized[2].boundaries[0].type, 'polyline');
    assert.ok(materialized.every(entity => getEntityBounds(entity)));
});

test('advanced curve sampling and invalid data stay deterministic and bounded', () => {
    assert.equal(sampleAdvancedCurvePoints(ellipse(), { segments: 10_000 }).length, 513);
    assert.deepEqual(sampleAdvancedCurvePoints(ellipse({ rx: 0 })), []);
    assert.equal(getAdvancedEntityBounds(spline({ controlPoints: [{ x: 0, y: 0 }] })), null);
    assert.equal(transformEllipseAffine(ellipse(), { a: 1, b: 0, c: 0, d: 0, e: 0, f: 0 }), null);
});
