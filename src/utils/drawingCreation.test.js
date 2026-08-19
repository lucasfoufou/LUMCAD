import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyDrawingCreationMode,
    buildArcCreationEntity,
    buildCircleCreationEntity,
    buildRectangleCreationEntity,
    buildRegularPolygonCreationEntity,
    createDefaultDrawingCreationConfig,
    getDrawingCreationOptionSuggestions,
    parseDrawingCreationInput,
} from './drawingCreation.js';
import {
    arcContainsAngle,
    arcEndPoint,
    arcMidpoint,
    arcStartPoint,
    arcSweep,
    circleFromThreePoints,
    createTangentCircle,
    DRAWING_CURVE_MAX_SEGMENTS,
    findTangentCircleCandidates,
    findThreeEntityTangentCircles,
    findThreeLineTangentCircles,
    getArcBounds,
    getArcPoints,
    getRectangleOutlinePoints,
    getRegularPolygonApothem,
    getRegularPolygonVertices,
    isFiniteBoundedCircle,
} from './drawingCurves.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { offsetEntity, offsetEntityTowardPoint, snapDrawingPoint, trimEntityAtPoint } from './drawingGeometry.js';
import { mirrorEntity, rotateEntity, scaleEntity } from './drawingPrimitives.js';
import { editEntityGrip, getEntityGrips } from './drawingSelection.js';

const closeTo = (actual, expected, tolerance = 1e-8) => {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
};

test('creation commands accept full names and shortcuts with construction options', () => {
    assert.deepEqual(parseDrawingCreationInput('circle', 'C 3P'), { kind: 'mode', mode: 'threePoint', args: [] });
    assert.deepEqual(parseDrawingCreationInput('arc', 'A SER 5'), { kind: 'mode', mode: 'startEndRadius', args: [5] });
    assert.deepEqual(parseDrawingCreationInput('polygon', 'POL C 8'), {
        kind: 'options', options: { mode: 'circumscribed', sides: 8 },
    });
    assert.deepEqual(parseDrawingCreationInput('rectangle', 'REC D 6 4'), {
        kind: 'options', options: { width: 6, height: 4 },
    });
    assert.equal(parseDrawingCreationInput('polygon', 'RECTANGLE 4 2'), null);
    assert.equal(parseDrawingCreationInput('rectangle', 'UNKNOWN 4'), null);
    assert.deepEqual(
        applyDrawingCreationMode('arc', { mode: 'threePoint', options: {} }, 'A SCA 135'),
        { mode: 'startCenterAngle', modeArgs: [135], options: { angle: 135 } },
    );
});

test('creation tools expose only their exhaustive contextual options', () => {
    assert.deepEqual(
        getDrawingCreationOptionSuggestions('arc', '').map(item => item.name),
        ['3POINT', 'CCW', 'CW', 'STARTCENTERANGLE', 'STARTCENTEREND', 'STARTENDRADIUS'],
    );
    assert.deepEqual(getDrawingCreationOptionSuggestions('arc', 'LINE'), []);
    assert.deepEqual(getDrawingCreationOptionSuggestions('text', ''), []);
    assert.deepEqual(createDefaultDrawingCreationConfig('rectangle'), { mode: 'corner', options: {} });
    assert.deepEqual(createDefaultDrawingCreationConfig('polygon'), {
        mode: 'centerRadius', options: { sides: 6, mode: 'inscribed' },
    });
    assert.deepEqual(createDefaultDrawingCreationConfig('text'), {
        mode: 'corner',
        options: {
            textMode: 'singleLine',
            wrapMode: 'none',
            textStyleId: 'text-style-standard',
            horizontalAlign: 'left',
            verticalAlign: 'top',
        },
    });
});

test('rectangle construction supports size, area, rotation, chamfer, fillet and width', () => {
    const dimensions = buildRectangleCreationEntity(
        { x: 2, y: 3 }, { x: -2, y: -1 }, 'geometry',
        { width: 6, height: 4, rotation: 30, chamfer: 0.5, lineWidth: 3 },
    );
    assert.deepEqual(dimensions, {
        id: 'draft', type: 'rectangle', layerId: 'geometry', x: 2, y: 3,
        width: -6, height: -4, rotation: 30, cornerStyle: 'chamfer', cornerValue: 0.5, lineWidth: 3,
    });
    assert.equal(getRectangleOutlinePoints(dimensions).length, 8);

    const area = buildRectangleCreationEntity(
        { x: 0, y: 0 }, { x: 4, y: 2 }, 'geometry', { area: 32, fillet: 1 },
    );
    closeTo(Math.abs(area.width * area.height), 32);
    assert.equal(area.cornerStyle, 'fillet');
    assert.ok(getRectangleOutlinePoints(area).length > 8);
});

test('regular polygons preserve side count and inscribed or circumscribed radius semantics', () => {
    const inscribed = buildRegularPolygonCreationEntity(
        { x: 1, y: 1 }, { x: 5, y: 1 }, 'geometry', { sides: 5, mode: 'inscribed' },
    );
    const inscribedVertices = getRegularPolygonVertices(inscribed);
    assert.equal(inscribedVertices.length, 5);
    closeTo(Math.hypot(inscribedVertices[0].x - inscribed.cx, inscribedVertices[0].y - inscribed.cy), 4);

    const circumscribed = buildRegularPolygonCreationEntity(
        { x: 0, y: 0 }, { x: 3, y: 0 }, 'geometry', { sides: 6, mode: 'circumscribed' },
    );
    closeTo(getRegularPolygonApothem(circumscribed), 3);
    assert.ok(Math.hypot(getRegularPolygonVertices(circumscribed)[0].x, getRegularPolygonVertices(circumscribed)[0].y) > 3);
});

test('regular-polygon offsets preserve physical edge distance and use the actual boundary for side choice', () => {
    const square = {
        id: 'square', type: 'polygon', cx: 0, cy: 0, r: 10,
        sides: 4, mode: 'inscribed', rotation: 0,
    };
    const originalApothem = getRegularPolygonApothem(square);
    closeTo(getRegularPolygonApothem(offsetEntity(square, 2)) - originalApothem, 2);
    closeTo(originalApothem - getRegularPolygonApothem(offsetEntityTowardPoint(square, 2, { x: 0, y: 0 })), 2);
    closeTo(getRegularPolygonApothem(offsetEntityTowardPoint(square, 2, { x: 6, y: 6 })) - originalApothem, 2);
});

test('circle construction covers center-radius, two-point and three-point modes', () => {
    const centerRadius = buildCircleCreationEntity([{ x: 1, y: 2 }, { x: 4, y: 6 }], 'geometry');
    assert.deepEqual(centerRadius, { id: 'draft', type: 'circle', layerId: 'geometry', cx: 1, cy: 2, r: 5 });

    const fixedRadius = buildCircleCreationEntity(
        [{ x: 1, y: 2 }, { x: 2, y: 2 }], 'geometry', 'centerRadius', { radius: 7 },
    );
    assert.deepEqual(fixedRadius, { id: 'draft', type: 'circle', layerId: 'geometry', cx: 1, cy: 2, r: 7 });

    const twoPoint = buildCircleCreationEntity([{ x: -2, y: 0 }, { x: 4, y: 0 }], 'geometry', 'twoPoint');
    assert.deepEqual(twoPoint, { id: 'draft', type: 'circle', layerId: 'geometry', cx: 1, cy: 0, r: 3 });

    const threePoint = buildCircleCreationEntity(
        [{ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 }],
        'geometry', 'threePoint', {}, 'circle-test',
    );
    closeTo(threePoint.cx, 0);
    closeTo(threePoint.cy, 0);
    closeTo(threePoint.r, 5);
    assert.equal(buildCircleCreationEntity([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], 'geometry', 'threePoint'), null);
});

test('three-point circles reject unsafe circumcircles and cap curve sampling', () => {
    const normal = circleFromThreePoints(
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 },
    );
    assert.ok(isFiniteBoundedCircle(normal));
    closeTo(normal.cx, 5);
    closeTo(normal.r, 13);

    const largeButBounded = circleFromThreePoints(
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1e-5 },
    );
    assert.ok(isFiniteBoundedCircle(largeButBounded));

    const nearCollinear = [
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1e-12 },
    ];
    assert.equal(circleFromThreePoints(...nearCollinear), null);
    assert.equal(buildCircleCreationEntity(nearCollinear, 'geometry', 'threePoint'), null);

    const sampled = getArcPoints({
        type: 'arc', cx: 0, cy: 0, r: 1e9,
        startAngle: 0, endAngle: Math.PI, counterClockwise: true,
    });
    assert.equal(sampled.length, DRAWING_CURVE_MAX_SEGMENTS + 1);
    assert.ok(sampled.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('tangent circles support fixed-radius pairs and three line/circle targets', () => {
    const horizontal = { type: 'line', x1: -10, y1: 0, x2: 10, y2: 0 };
    const vertical = { type: 'line', x1: 0, y1: -10, x2: 0, y2: 10 };
    const fixedRadius = createTangentCircle([horizontal, vertical], 2, { x: 2, y: 2 });
    closeTo(fixedRadius.cx, 2);
    closeTo(fixedRadius.cy, 2);
    closeTo(fixedRadius.r, 2);

    assert.deepEqual(findTangentCircleCandidates([
        horizontal,
        { type: 'line', x1: -10, y1: 5, x2: 10, y2: 5 },
    ], 1), []);

    const tangentCircle = { type: 'circle', cx: 0, cy: 4, r: 2 };
    const lineCircle = findTangentCircleCandidates([horizontal, tangentCircle], 1);
    assert.equal(lineCircle.length, 1);
    closeTo(lineCircle[0].cx, 0);
    closeTo(lineCircle[0].cy, 1);
    assert.deepEqual(findTangentCircleCandidates([horizontal, { ...tangentCircle, cy: 8 }], 1), []);

    const circlePair = findTangentCircleCandidates([
        { type: 'circle', cx: -4, cy: 0, r: 1 },
        { type: 'circle', cx: 4, cy: 0, r: 1 },
    ], 3);
    assert.equal(circlePair.length, 1);
    closeTo(circlePair[0].cx, 0);
    closeTo(circlePair[0].cy, 0);
    assert.deepEqual(findTangentCircleCandidates([
        { type: 'circle', cx: -10, cy: 0, r: 1 },
        { type: 'circle', cx: 10, cy: 0, r: 1 },
    ], 3), []);
    assert.deepEqual(findTangentCircleCandidates([
        { type: 'line', x1: 0, y1: 0, x2: Infinity, y2: 1 }, horizontal,
    ], 1), []);
    [...lineCircle, ...circlePair].forEach(candidate => assert.ok(isFiniteBoundedCircle(candidate)));

    const targetCircle = { type: 'circle', cx: 5, cy: 5, r: 2 };
    const mixed = findThreeEntityTangentCircles([horizontal, vertical, targetCircle]);
    assert.ok(mixed.length > 0);
    mixed.forEach(candidate => {
        closeTo(Math.abs(candidate.cy), candidate.r, 1e-7);
        closeTo(Math.abs(candidate.cx), candidate.r, 1e-7);
        assert.ok(circleTangencyError(candidate, targetCircle) <= 1e-7);
    });

    const threeLines = findThreeLineTangentCircles([
        horizontal,
        vertical,
        { type: 'line', x1: 20, y1: 0, x2: 0, y2: 20 },
    ]);
    assert.ok(threeLines.length > 0);
    threeLines.forEach(candidate => assert.ok(isFiniteBoundedCircle(candidate)));
    assert.deepEqual(findThreeLineTangentCircles([
        horizontal,
        { type: 'line', x1: -10, y1: 5, x2: 10, y2: 5 },
        { type: 'line', x1: -10, y1: 10, x2: 10, y2: 10 },
    ]), []);

    const lineAndTwoCircles = findThreeEntityTangentCircles([
        horizontal,
        { type: 'circle', cx: -3, cy: 2, r: 2 },
        { type: 'circle', cx: 3, cy: 2, r: 2 },
    ]);
    assert.ok(lineAndTwoCircles.some(candidate => (
        Math.abs(candidate.cx) <= 1e-8 && Math.abs(candidate.cy - 1.125) <= 1e-8
    )));
    lineAndTwoCircles.forEach(candidate => assert.ok(isFiniteBoundedCircle(candidate)));

    const threeCircles = findThreeEntityTangentCircles([
        { type: 'circle', cx: -4, cy: 0, r: 1 },
        { type: 'circle', cx: 4, cy: 0, r: 1 },
        { type: 'circle', cx: 0, cy: 6, r: 1 },
    ]);
    assert.ok(threeCircles.length > 0);
    threeCircles.forEach(candidate => assert.ok(isFiniteBoundedCircle(candidate)));
    assert.deepEqual(findThreeEntityTangentCircles([
        horizontal,
        { type: 'circle', cx: 0, cy: 0, r: Infinity },
        targetCircle,
    ]), []);
});

test('tangent-circle creation supports two-target and three-target construction data', () => {
    const horizontal = { type: 'line', x1: -20, y1: 0, x2: 20, y2: 0 };
    const vertical = { type: 'line', x1: 0, y1: -20, x2: 0, y2: 20 };
    const twoTarget = buildCircleCreationEntity(
        [{ x: 2, y: 2 }], 'geometry', 'tangentTangentRadius',
        { radius: 2, tangentEntities: [horizontal, vertical] }, 'ttr-test',
    );
    assert.deepEqual(twoTarget, { id: 'ttr-test', type: 'circle', layerId: 'geometry', cx: 2, cy: 2, r: 2 });

    const threeTargets = [
        horizontal,
        { type: 'circle', cx: -3, cy: 2, r: 2 },
        { type: 'circle', cx: 3, cy: 2, r: 2 },
    ];
    const threeTarget = buildCircleCreationEntity(
        [{ x: 0, y: 1 }], 'geometry', 'tangentTangentTangent',
        { tangentEntities: threeTargets }, 'ttt-test',
    );
    assert.ok(threeTarget);
    assert.ok(isFiniteBoundedCircle(threeTarget));
    assert.ok(findThreeEntityTangentCircles(threeTargets).some(candidate => (
        Math.abs(candidate.cx - threeTarget.cx) <= 1e-8
        && Math.abs(candidate.cy - threeTarget.cy) <= 1e-8
        && Math.abs(candidate.r - threeTarget.r) <= 1e-8
    )));
});

test('arc constructors cover three-point, start-center-end, radius and angle workflows', () => {
    const threePoint = buildArcCreationEntity(
        [{ x: 5, y: 0 }, { x: -5, y: 0 }, { x: 0, y: 5 }],
        'geometry', 'threePoint', {}, 'arc-three',
    );
    closeTo(arcStartPoint(threePoint).x, 5);
    closeTo(arcEndPoint(threePoint).x, -5);
    assert.ok(arcContainsAngle(threePoint, Math.PI / 2));

    const centerEndDirection = buildArcCreationEntity(
        [{ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 12 }],
        'geometry', 'startCenterEnd', {}, 'arc-center',
    );
    closeTo(centerEndDirection.r, 5);
    closeTo(arcEndPoint(centerEndDirection).x, 0);
    closeTo(arcEndPoint(centerEndDirection).y, 5);

    const radius = buildArcCreationEntity(
        [{ x: -3, y: 0 }, { x: 3, y: 0 }],
        'geometry', 'startEndRadius', { radius: 5 }, 'arc-radius',
    );
    closeTo(radius.r, 5);
    closeTo(arcStartPoint(radius).x, -3);
    closeTo(arcEndPoint(radius).x, 3);

    const angle = buildArcCreationEntity(
        [{ x: 4, y: 0 }, { x: 0, y: 0 }],
        'geometry', 'startCenterAngle', { angle: 120, counterClockwise: false }, 'arc-angle',
    );
    closeTo(angle.r, 4);
    assert.equal(angle.counterClockwise, false);
    const bounds = getArcBounds(angle);
    assert.ok(Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxY));

    const reflex = buildArcCreationEntity(
        [{ x: 4, y: 0 }, { x: 0, y: 0 }, { x: -2, y: -2 }],
        'geometry', 'startCenterAngle', { counterClockwise: true }, 'arc-reflex',
    );
    closeTo(arcSweep(reflex) * 180 / Math.PI, 225);
    closeTo(arcEndPoint(reflex).x, -Math.sqrt(8));
    closeTo(arcEndPoint(reflex).y, -Math.sqrt(8));

    const safety = { maxRadius: 1_000, maxCoordinate: 10_000 };
    assert.equal(buildArcCreationEntity(
        [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        'geometry', 'startEndRadius', { radius: 1e308, circleSafety: safety }, 'unsafe-radius',
    ), null);
    assert.equal(buildArcCreationEntity(
        [{ x: 1e9, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }],
        'geometry', 'startCenterEnd', { circleSafety: safety }, 'unsafe-center',
    ), null);
});

test('three-point arc keeps two snapped line-circle intersections as its endpoints', () => {
    const startIntersection = { x: -4, y: 3 };
    const endIntersection = { x: 4, y: 3 };
    const pointerPoint = { x: 0, y: 5 };
    const arc = buildArcCreationEntity(
        [startIntersection, endIntersection, pointerPoint],
        'geometry', 'threePoint', {}, 'arc-intersections',
    );

    closeTo(arcStartPoint(arc).x, startIntersection.x);
    closeTo(arcStartPoint(arc).y, startIntersection.y);
    closeTo(arcEndPoint(arc).x, endIntersection.x);
    closeTo(arcEndPoint(arc).y, endIntersection.y);
    closeTo(Math.hypot(pointerPoint.x - arc.cx, pointerPoint.y - arc.cy), arc.r);
    assert.ok(arcSweep(arc) < Math.PI);
});

test('circle and arc grips edit radius and curvature while transforms preserve curve geometry', () => {
    const circle = { id: 'circle', type: 'circle', cx: 0, cy: 0, r: 2 };
    assert.deepEqual(getEntityGrips(circle).map(grip => grip.id), ['center', 'radius']);
    assert.equal(editEntityGrip(circle, 'radius', { x: 3, y: 4 }).r, 5);

    const arc = {
        id: 'arc', type: 'arc', cx: 0, cy: 0, r: 5,
        startAngle: 0, endAngle: Math.PI, counterClockwise: true,
    };
    const edited = editEntityGrip(arc, 'midpoint', { x: 0, y: 3 });
    const midpoint = arcMidpoint(edited);
    closeTo(midpoint.x, 0, 1e-7);
    closeTo(midpoint.y, 3, 1e-7);

    closeTo(rotateEntity(arc, 90, { x: 0, y: 0 }).startAngle, Math.PI / 2);
    closeTo(scaleEntity(arc, 2, { x: 0, y: 0 }).r, 10);
    assert.equal(mirrorEntity(arc, { x: 0, y: -1 }, { x: 0, y: 1 }).counterClockwise, false);
});

test('arc entities normalize, snap, offset and trim as first-class drawing geometry', () => {
    const content = createDefaultDrawingContent();
    content.settings.snaps.grid = false;
    content.entities = [{
        id: 'arc', type: 'arc', layerId: 'geometry', cx: '0', cy: '0', r: '-5',
        startAngle: '0', endAngle: String(Math.PI), counterClockwise: true,
    }];
    const normalized = normalizeDrawingContent(content);
    const arc = normalized.entities[0];
    assert.equal(arc.r, 5);
    assert.equal(snapDrawingPoint({ x: 5.01, y: 0.01 }, normalized, 0.05).type, 'endpoint');
    assert.equal(offsetEntity(arc, 2).r, 7);

    const trimmed = trimEntityAtPoint(arc, { x: 0, y: 5 }, [
        { type: 'line', x1: -2, y1: -10, x2: -2, y2: 10 },
        { type: 'line', x1: 2, y1: -10, x2: 2, y2: 10 },
    ]);
    assert.equal(trimmed.status, 'trimmed');
    assert.equal(trimmed.fragments.length, 2);
});

function circleTangencyError(first, second) {
    const centerDistance = Math.hypot(first.cx - second.cx, first.cy - second.cy);
    return Math.min(
        Math.abs(centerDistance - (Math.abs(first.r) + Math.abs(second.r))),
        Math.abs(centerDistance - Math.abs(Math.abs(first.r) - Math.abs(second.r))),
    );
}
