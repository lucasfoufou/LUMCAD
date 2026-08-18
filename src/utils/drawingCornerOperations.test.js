import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultDrawingContent } from './drawingDocument.js';
import {
    curveLength,
    curvePointAt,
    curveTangentAt,
    getCurveEnd,
    getCurveStart,
    reverseCurve,
} from './drawingCurveKernel.js';
import {
    blendDrawingEntities,
    blendPickedCurves,
    chamferDrawingEntities,
    chamferPickedCurves,
    chamferWholePath,
    createBlendPreviewEntities,
    createChamferPreviewEntities,
    createFilletPathPreviewEntities,
    createFilletPreviewEntities,
    filletDrawingEntities,
    filletDrawingPath,
    filletPickedCurves,
    filletWholePath,
} from './drawingCornerOperations.js';

const EPSILON = 1e-7;

function close(actual, expected, tolerance = EPSILON) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

function pointClose(actual, expected, tolerance = EPSILON) {
    close(actual.x, expected.x, tolerance);
    close(actual.y, expected.y, tolerance);
}

function vectorFrom(first, second) {
    return { x: second.x - first.x, y: second.y - first.y };
}

function cross(first, second) {
    return first.x * second.y - first.y * second.x;
}

function line(x1, y1, x2, y2, properties = {}) {
    return { type: 'line', x1, y1, x2, y2, ...properties };
}

function lineBetween(actual, first, second) {
    const start = { x: actual.x1, y: actual.y1 };
    const end = { x: actual.x2, y: actual.y2 };
    const direct = Math.hypot(start.x - first.x, start.y - first.y)
        + Math.hypot(end.x - second.x, end.y - second.y);
    const reversed = Math.hypot(start.x - second.x, start.y - second.y)
        + Math.hypot(end.x - first.x, end.y - first.y);
    assert.ok(Math.min(direct, reversed) <= EPSILON * 2, 'line must preserve the selected outward branch');
}

function previewGeometry(entity) {
    const { id: _id, previewMode: _previewMode, ...geometry } = entity;
    return geometry;
}

test('FILLET chooses all four picked line branches and creates exact tangent quadrants', () => {
    const horizontal = line(-10, 0, 10, 0);
    const vertical = line(0, -10, 0, 10);
    for (const horizontalSign of [-1, 1]) {
        for (const verticalSign of [-1, 1]) {
            const result = filletPickedCurves(
                horizontal,
                { x: horizontalSign * 5, y: 0 },
                vertical,
                { x: 0, y: verticalSign * 5 },
                1,
            );
            assert.equal(result.changed, true);
            pointClose(result.center, { x: horizontalSign, y: verticalSign });
            pointClose(result.tangentPoints[0], { x: horizontalSign, y: 0 });
            pointClose(result.tangentPoints[1], { x: 0, y: verticalSign });
            close(result.connector.r, 1);
        }
    }
});

test('FILLET and CHAMFER keep endpoint-selected rays after snapping and endpoint reversal', () => {
    for (const reversed of [false, true]) {
        const horizontal = reversed ? line(10, 0, 0, 0) : line(0, 0, 10, 0);
        const vertical = reversed ? line(0, 10, 0, 0) : line(0, 0, 0, 10);
        const cornerPick = { x: 0, y: 0 };
        const fillet = filletPickedCurves(horizontal, cornerPick, vertical, cornerPick, 1);
        assert.equal(fillet.changed, true);
        pointClose(fillet.center, { x: 1, y: 1 });
        lineBetween(fillet.first, { x: 1, y: 0 }, { x: 10, y: 0 });
        lineBetween(fillet.second, { x: 0, y: 1 }, { x: 0, y: 10 });
        close(curveLength(fillet.connector), Math.PI / 2);

        const chamfer = chamferPickedCurves(horizontal, cornerPick, vertical, cornerPick, {
            distance1: 1,
            distance2: 2,
        });
        assert.equal(chamfer.changed, true);
        lineBetween(chamfer.first, { x: 1, y: 0 }, { x: 10, y: 0 });
        lineBetween(chamfer.second, { x: 0, y: 2 }, { x: 0, y: 10 });
        lineBetween(chamfer.connector, { x: 1, y: 0 }, { x: 0, y: 2 });
    }
});

test('FILLET branch picks choose inside and outside quadrants without retaining the cut side', () => {
    const horizontal = line(-10, 0, 10, 0);
    const vertical = line(0, -10, 0, 10);
    for (const [horizontalSign, verticalSign] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const result = filletPickedCurves(
            horizontal, { x: horizontalSign * 0.05, y: 0 },
            vertical, { x: 0, y: verticalSign * 0.05 },
            1,
        );
        assert.equal(result.changed, true);
        pointClose(result.center, { x: horizontalSign, y: verticalSign });
        lineBetween(
            result.first,
            { x: horizontalSign, y: 0 },
            { x: horizontalSign * 10, y: 0 },
        );
        lineBetween(
            result.second,
            { x: 0, y: verticalSign },
            { x: 0, y: verticalSign * 10 },
        );
    }
});

test('FILLET handles acute, obtuse, and endpoint-reversed lines consistently', () => {
    for (const angleDegrees of [60, 120]) {
        const angle = angleDegrees * Math.PI / 180;
        const first = line(0, 0, 10, 0);
        const second = line(0, 0, 10 * Math.cos(angle), 10 * Math.sin(angle));
        const pick1 = { x: 5, y: 0 };
        const pick2 = { x: 5 * Math.cos(angle), y: 5 * Math.sin(angle) };
        const forward = filletPickedCurves(first, pick1, second, pick2, 1);
        const reversed = filletPickedCurves(
            line(first.x2, first.y2, first.x1, first.y1),
            pick1,
            line(second.x2, second.y2, second.x1, second.y1),
            pick2,
            1,
        );
        assert.equal(forward.changed, true);
        assert.equal(reversed.changed, true);
        pointClose(forward.center, reversed.center);
        pointClose(forward.tangentPoints[0], reversed.tangentPoints[0]);
        pointClose(forward.tangentPoints[1], reversed.tangentPoints[1]);
        close(forward.center.x, 1 / Math.tan(angle / 2));
        close(forward.center.y, 1);
    }
});

test('FILLET rejects parallel and oversized bounded corners without corrupting inputs', () => {
    const first = line(0, 0, 10, 0);
    const second = line(0, 2, 10, 2);
    const parallel = filletPickedCurves(first, { x: 4, y: 0 }, second, { x: 4, y: 2 }, 1);
    assert.deepEqual(parallel, { changed: false, reason: 'no-solution' });
    assert.deepEqual(first, line(0, 0, 10, 0));

    const shortPath = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] };
    const oversized = filletWholePath(shortPath, 2);
    assert.equal(oversized.changed, false);
    assert.match(oversized.reason, /^corner-1:/);

    const oversizedPicked = filletPickedCurves(
        line(0, 0, 1, 0), { x: 0.5, y: 0 },
        line(0, 0, 0, 1), { x: 0, y: 0.5 },
        2,
    );
    assert.deepEqual(oversizedPicked, { changed: false, reason: 'no-solution' });
    assert.equal(chamferPickedCurves(
        line(0, 0, 1, 0), { x: 0.5, y: 0 },
        line(0, 0, 0, 1), { x: 0, y: 0.5 },
        { distance1: 2, distance2: 2 },
    ).reason, 'outside-source');
});

test('FILLET radius zero performs trim/extend cleanup without adding a connector', () => {
    const result = filletPickedCurves(
        line(0, 0, 1, 0),
        { x: 0.5, y: 0 },
        line(2, 1, 2, 2),
        { x: 2, y: 1.5 },
        0,
    );
    assert.equal(result.changed, true);
    assert.equal(result.connector, null);
    pointClose({ x: result.first.x2, y: result.first.y2 }, { x: 2, y: 0 });
    pointClose({ x: result.second.x1, y: result.second.y1 }, { x: 2, y: 0 });
    assert.equal(filletPickedCurves(
        line(0, 0, 1, 0), { x: 0.5, y: 0 },
        line(2, 1, 2, 2), { x: 2, y: 1.5 },
        0, { keepSources: true },
    ).changed, false);
});

test('FILLET solves tangent line-arc and arc-arc cases analytically', () => {
    const sourceArc = {
        type: 'arc', cx: 5, cy: 5, r: 3,
        startAngle: Math.PI, endAngle: 0, counterClockwise: true,
    };
    const lineArc = filletPickedCurves(
        line(-10, 0, 10, 0), { x: -5, y: 0 },
        sourceArc, { x: 2, y: 5 },
        1,
    );
    assert.equal(lineArc.changed, true);
    const lineRadius = vectorFrom(lineArc.center, lineArc.tangentPoints[0]);
    close(lineRadius.x, 0);
    close(Math.abs(lineRadius.y), 1);
    close(cross(
        vectorFrom({ x: sourceArc.cx, y: sourceArc.cy }, lineArc.tangentPoints[1]),
        vectorFrom(lineArc.center, lineArc.tangentPoints[1]),
    ), 0);

    const firstArc = {
        type: 'arc', cx: 0, cy: 0, r: 5,
        startAngle: 0, endAngle: Math.PI, counterClockwise: true,
    };
    const secondArc = { ...firstArc, cx: 8 };
    const arcArc = filletPickedCurves(
        firstArc, { x: 0, y: 5 },
        secondArc, { x: 8, y: 5 },
        1,
    );
    assert.equal(arcArc.changed, true);
    arcArc.tangentPoints.forEach((point, index) => {
        const source = index ? secondArc : firstArc;
        close(cross(
            vectorFrom({ x: source.cx, y: source.cy }, point),
            vectorFrom(arcArc.center, point),
        ), 0);
        close(Math.hypot(point.x - arcArc.center.x, point.y - arcArc.center.y), 1);
    });
});

test('FILLET keeps reversed arc geometry and connector direction equivalent', () => {
    const sourceLine = line(-10, 0, 10, 0);
    const sourceArc = {
        type: 'arc', cx: 5, cy: 5, r: 3,
        startAngle: Math.PI, endAngle: 0, counterClockwise: true,
    };
    const forward = filletPickedCurves(
        sourceLine, { x: -5, y: 0 }, sourceArc, { x: 2, y: 5 }, 1,
    );
    const reversed = filletPickedCurves(
        sourceLine, { x: -5, y: 0 }, reverseCurve(sourceArc), { x: 2, y: 5 }, 1,
    );
    assert.equal(forward.changed, true);
    assert.equal(reversed.changed, true);
    pointClose(forward.center, reversed.center);
    pointClose(forward.tangentPoints[1], reversed.tangentPoints[1]);
    const forwardEnds = [getCurveStart(forward.second), getCurveEnd(forward.second)];
    const reversedEnds = [getCurveStart(reversed.second), getCurveEnd(reversed.second)];
    pointClose(forwardEnds[0], reversedEnds[1]);
    pointClose(forwardEnds[1], reversedEnds[0]);
    close(curveLength(forward.connector), curveLength(reversed.connector));
    assert.ok(curveLength(forward.connector) <= Math.PI * forward.connector.r + EPSILON);
});

test('whole-path FILLET rounds open, closed, polygon, and mixed line-arc paths', () => {
    const open = filletWholePath({
        type: 'polyline',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        closed: false,
    }, 1);
    assert.equal(open.changed, true);
    assert.deepEqual(open.entity.parts.map(part => part.type), ['line', 'arc', 'line']);

    const rectangle = filletWholePath({ type: 'rectangle', x: 0, y: 0, width: 10, height: 5 }, 1);
    assert.equal(rectangle.changed, true);
    assert.equal(rectangle.entity.closed, true);
    assert.equal(rectangle.entity.parts.length, 8);
    assert.equal(rectangle.entity.parts.filter(part => part.type === 'arc').length, 4);

    const polygon = filletWholePath({ type: 'polygon', cx: 0, cy: 0, r: 5, sides: 5, rotation: 0 }, 0.5);
    assert.equal(polygon.changed, true);
    assert.equal(polygon.entity.parts.length, 10);

    const mixed = filletWholePath({
        type: 'polyline',
        parts: [
            line(0, 0, 5, 0),
            {
                type: 'arc', cx: 7, cy: 0, r: 2,
                startAngle: Math.PI, endAngle: Math.PI / 2, counterClockwise: false,
            },
        ],
        closed: false,
    }, 0.5);
    assert.equal(mixed.changed, true);
    assert.deepEqual(mixed.entity.parts.map(part => part.type), ['line', 'arc', 'arc']);
});

test('CHAMFER supports two distances, distance plus angle, reversal, and bounded failure', () => {
    const first = line(-10, 0, 10, 0);
    const second = line(0, -10, 0, 10);
    const twoDistances = chamferPickedCurves(
        first, { x: 5, y: 0 }, second, { x: 0, y: 5 },
        { distance1: 2, distance2: 3 },
    );
    assert.equal(twoDistances.changed, true);
    pointClose(twoDistances.chamferPoints[0], { x: 2, y: 0 });
    pointClose(twoDistances.chamferPoints[1], { x: 0, y: 3 });

    const angle = chamferPickedCurves(
        line(10, 0, -10, 0), { x: 5, y: 0 },
        line(0, 10, 0, -10), { x: 0, y: 5 },
        { distance1: 2, angleDegrees: 45 },
    );
    assert.equal(angle.changed, true);
    close(angle.distances.second, 2);
    pointClose(angle.chamferPoints[0], twoDistances.chamferPoints[0]);

    const parallel = chamferPickedCurves(
        line(0, 0, 10, 0), { x: 5, y: 0 },
        line(0, 1, 10, 1), { x: 5, y: 1 },
        { distance1: 1, distance2: 1 },
    );
    assert.equal(parallel.reason, 'parallel');
    const oversized = chamferWholePath({
        type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    }, { distance1: 2, distance2: 2 });
    assert.equal(oversized.changed, false);
});

test('whole-path CHAMFER treats open and closed entities uniformly', () => {
    const open = chamferWholePath({
        type: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }],
    }, { distance1: 1, distance2: 1 });
    assert.equal(open.changed, true);
    assert.deepEqual(open.entity.parts.map(part => part.type), ['line', 'line', 'line']);
    const rectangle = chamferWholePath(
        { type: 'rectangle', x: 0, y: 0, width: 10, height: 5 },
        { distance1: 0.5, distance2: 1 },
    );
    assert.equal(rectangle.changed, true);
    assert.equal(rectangle.entity.closed, true);
    assert.equal(rectangle.entity.parts.length, 8);
});

test('BLEND creates a cubic whose endpoint derivatives remain tangent to both sources', () => {
    const first = line(0, 0, 1, 0);
    const second = line(3, 1, 4, 1);
    const result = blendPickedCurves(first, { x: 1, y: 0 }, second, { x: 3, y: 1 });
    assert.equal(result.changed, true);
    assert.equal(result.connector.type, 'spline');
    assert.equal(result.connector.controlPoints.length, 4);
    pointClose(curvePointAt(result.connector, 0), { x: 1, y: 0 });
    pointClose(curvePointAt(result.connector, 1), { x: 3, y: 1 });
    close(cross(curveTangentAt(result.connector, 0), { x: 1, y: 0 }), 0);
    close(cross(curveTangentAt(result.connector, 1), { x: 1, y: 0 }), 0);

    const sourceSpline = {
        type: 'spline',
        controlPoints: [{ x: 4, y: 1 }, { x: 5, y: 2 }, { x: 6, y: 2 }, { x: 7, y: 1 }],
    };
    const curved = blendPickedCurves(second, { x: 4, y: 1 }, sourceSpline, { x: 4, y: 1 }, { tension: 0.2 });
    assert.equal(curved.changed, false, 'coincident picked endpoints must not create a degenerate spline');

    const pathBlend = blendPickedCurves(
        { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }] },
        { x: 2, y: 1 },
        sourceSpline,
        { x: 4, y: 1 },
    );
    assert.equal(pathBlend.changed, true);
    pointClose(pathBlend.connector.controlPoints[0], { x: 2, y: 1 });
    pointClose(pathBlend.connector.controlPoints[3], { x: 4, y: 1 });
    close(cross(
        curveTangentAt(pathBlend.connector, 1),
        curveTangentAt(sourceSpline, 0),
    ), 0);
});

test('document helpers preserve stable source IDs and appearance, and keep-sources only adds geometry', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        line(-10, 0, 10, 0, {
            id: 'first', layerId: 'geometry', color: '#123456', lineWeight: 3, transparency: 25,
        }),
        line(0, -10, 0, 10, { id: 'second', layerId: 'geometry' }),
    ];
    const replaced = filletDrawingEntities(
        content, 'first', { x: 5, y: 0 }, 'second', { x: 0, y: 5 }, 1,
    );
    assert.equal(replaced.changed, true);
    assert.deepEqual(replaced.selectedIds.slice(0, 2), ['first', 'second']);
    assert.equal(replaced.content.entities.find(entity => entity.id === 'first').color, '#123456');
    assert.equal(replaced.connector.layerId, 'geometry');
    assert.equal(replaced.connector.lineWeight, 3);
    assert.equal(replaced.connector.transparency, 25);

    const kept = chamferDrawingEntities(
        content, 'first', { x: 5, y: 0 }, 'second', { x: 0, y: 5 },
        { distance1: 1, distance2: 1, keepSources: true },
    );
    assert.equal(kept.changed, true);
    assert.equal(kept.content.entities.length, 3);
    assert.strictEqual(kept.content.entities[0], content.entities[0]);
    assert.strictEqual(kept.content.entities[1], content.entities[1]);
});

test('document helpers respect locks and replace whole paths while removing incompatible dependencies', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'rect', type: 'rectangle', layerId: 'geometry', color: '#abcdef', x: 0, y: 0, width: 10, height: 5 },
        {
            id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'rect', edgeIndex: 0,
            offset: 1,
        },
    ];
    const rounded = filletDrawingPath(content, 'rect', 0.5);
    assert.equal(rounded.changed, true);
    assert.equal(rounded.entity.id, 'rect');
    assert.equal(rounded.entity.type, 'polyline');
    assert.equal(rounded.entity.color, '#abcdef');
    assert.equal(rounded.content.entities.some(entity => entity.id === 'dimension'), false);

    const locked = createDefaultDrawingContent();
    locked.entities = [
        line(-10, 0, 10, 0, { id: 'first', layerId: 'geometry', locked: true }),
        line(0, -10, 0, 10, { id: 'second', layerId: 'geometry' }),
    ];
    const blocked = filletDrawingEntities(
        locked, 'first', { x: 5, y: 0 }, 'second', { x: 0, y: 5 }, 1,
    );
    assert.equal(blocked.changed, false);
    assert.equal(blocked.reason, 'not-editable');
    assert.strictEqual(blocked.content, locked);
});

test('BLEND document and all preview helpers create deterministic preview identities', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        line(0, 0, 1, 0, { id: 'first', layerId: 'geometry' }),
        line(3, 1, 4, 1, { id: 'second', layerId: 'geometry' }),
    ];
    const blended = blendDrawingEntities(
        content, 'first', { x: 1, y: 0 }, 'second', { x: 3, y: 1 },
    );
    assert.equal(blended.changed, true);
    assert.equal(blended.content.entities.length, 3);
    assert.equal(blended.connector.type, 'spline');
    assert.ok(blended.connector.id.startsWith('spline-'));

    assert.deepEqual(
        createFilletPreviewEntities(
            content.entities[0], { x: 1, y: 0 },
            line(1, 0, 1, 4), { x: 1, y: 3 },
            0.25,
        ).map(entity => entity.id),
        ['fillet-preview-first', 'fillet-preview-second', 'fillet-preview-connector'],
    );
    assert.deepEqual(
        createChamferPreviewEntities(
            content.entities[0], { x: 1, y: 0 },
            line(1, 0, 1, 4), { x: 1, y: 3 },
            { distance1: 0.25, distance2: 0.25 },
        ).map(entity => entity.id),
        ['chamfer-preview-first', 'chamfer-preview-second', 'chamfer-preview-connector'],
    );
    assert.equal(createBlendPreviewEntities(
        content.entities[0], { x: 1, y: 0 }, content.entities[1], { x: 3, y: 1 },
    )[0].id, 'blend-preview');
    assert.equal(createFilletPathPreviewEntities(
        { type: 'rectangle', x: 0, y: 0, width: 10, height: 5 }, 0.5,
    )[0].id, 'fillet-path-preview');
});

test('FILLET and CHAMFER previews are geometrically identical to the committed result', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        line(0, 0, 10, 0, { id: 'horizontal', layerId: 'geometry' }),
        line(0, 0, 0, 10, { id: 'vertical', layerId: 'geometry' }),
    ];
    const pick = { x: 0, y: 0 };
    const filletPreview = createFilletPreviewEntities(
        content.entities[0], pick, content.entities[1], pick, 1,
    );
    const filletCommit = filletDrawingEntities(content, 'horizontal', pick, 'vertical', pick, 1);
    assert.equal(filletCommit.changed, true);
    assert.deepEqual(filletPreview.map(previewGeometry), [
        filletCommit.operationResult.first,
        filletCommit.operationResult.second,
        filletCommit.operationResult.connector,
    ].map(previewGeometry));

    const options = { distance1: 1, distance2: 2 };
    const chamferPreview = createChamferPreviewEntities(
        content.entities[0], pick, content.entities[1], pick, options,
    );
    const chamferCommit = chamferDrawingEntities(
        content, 'horizontal', pick, 'vertical', pick, options,
    );
    assert.equal(chamferCommit.changed, true);
    assert.deepEqual(chamferPreview.map(previewGeometry), [
        chamferCommit.operationResult.first,
        chamferCommit.operationResult.second,
        chamferCommit.operationResult.connector,
    ].map(previewGeometry));
});

test('corner operations reject non-finite and degenerate values before mutation', () => {
    const first = line(0, 0, 10, 0);
    const second = line(0, 0, 0, 10);
    assert.equal(filletPickedCurves(first, { x: 5, y: 0 }, second, { x: 0, y: 5 }, Number.NaN).changed, false);
    assert.equal(filletPickedCurves(first, { x: 5, y: 0 }, second, { x: 0, y: 5 }, null).changed, false);
    assert.equal(filletPickedCurves(first, { x: Infinity, y: 0 }, second, { x: 0, y: 5 }, 1).changed, false);
    assert.equal(chamferPickedCurves(
        first, { x: 5, y: 0 }, second, { x: 0, y: 5 }, { distance1: -1, distance2: 1 },
    ).changed, false);
    assert.equal(blendPickedCurves(first, { x: 0, y: 0 }, first, { x: 0, y: 0 }).changed, false);
});
