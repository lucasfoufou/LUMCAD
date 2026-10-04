import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DRAWING_CURVE_KERNEL_LIMITS,
    closestPointOnCurve,
    closestPointOnPath,
    createBoundaryExtractorRegistry,
    curveLength,
    curveLengthAtParameter,
    curveParameterAtLength,
    curvePointAt,
    curveSubcurve,
    curveTangentAt,
    extractEntityPaths,
    getCurveEnd,
    getCurveStart,
    intersectCurves,
    intersectPaths,
    normalizeCurvePath,
    normalizeCurvePrimitive,
    openClosedPathAt,
    pathLength,
    pathPointAt,
    pathSubpath,
    reverseCurve,
    reversePath,
    splitCurve,
    splitPath,
} from './drawingCurveKernel.js';

const TAU = Math.PI * 2;
const close = (actual, expected, tolerance = 1e-7) => {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
};
const closePoint = (actual, expected, tolerance = 1e-7) => {
    assert.ok(actual, 'expected a point');
    close(actual.x, expected.x, tolerance);
    close(actual.y, expected.y, tolerance);
};

test('primitive normalization rejects non-finite, degenerate and oversized geometry', () => {
    assert.equal(normalizeCurvePrimitive({ type: 'line', x1: 0, y1: 0, x2: 0, y2: 0 }), null);
    assert.equal(normalizeCurvePrimitive({ type: 'circle', cx: 0, cy: 0, r: 0 }), null);
    assert.equal(normalizeCurvePrimitive({ type: 'arc', cx: 0, cy: 0, r: 2, startAngle: 0, endAngle: 0 }), null);
    assert.equal(normalizeCurvePrimitive({ type: 'ellipse', cx: 0, cy: 0, rx: Infinity, ry: 1 }), null);
    assert.equal(normalizeCurvePrimitive({ type: 'line', x1: 0, y1: 0, x2: 1e13, y2: 0 }), null);
    assert.equal(normalizeCurvePrimitive({
        type: 'spline',
        controlPoints: Array.from({ length: 4 }, () => ({ x: 1, y: 1 })),
    }), null);
    assert.equal(normalizeCurvePrimitive({
        type: 'spline',
        controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    }), null);
    assert.equal(DRAWING_CURVE_KERNEL_LIMITS.maxParts, 4096);
});

test('aliases normalize to a native cubic spline and retain metadata', () => {
    const spline = normalizeCurvePrimitive({
        id: 'curve',
        type: 'cubicBezier',
        color: '#123456',
        p0: { x: 0, y: 0 },
        p1: { x: 1, y: 2 },
        p2: { x: 2, y: 2 },
        p3: { x: 3, y: 0 },
    });
    assert.equal(spline.type, 'spline');
    assert.equal(spline.id, 'curve');
    assert.equal(spline.color, '#123456');
    assert.equal(spline.controlPoints.length, 4);
});

test('entity decomposition preserves point polylines and native circles', () => {
    const open = extractEntityPaths({
        id: 'polyline', type: 'polyline', points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }],
    });
    assert.equal(open.length, 1);
    assert.equal(open[0].closed, false);
    assert.deepEqual(open[0].parts.map(part => part.type), ['line', 'line']);
    close(pathLength(open[0]), 7);

    const circle = extractEntityPaths({ id: 'circle', type: 'circle', cx: 2, cy: 3, r: 5 });
    assert.equal(circle[0].closed, true);
    assert.equal(circle[0].parts[0].type, 'circle');
    close(pathLength(circle[0]), 10 * Math.PI);
});

test('rectangle and polygon decomposition produce exact bounded outlines', () => {
    const rounded = extractEntityPaths({
        type: 'rectangle', x: 0, y: 0, width: 6, height: 4,
        cornerStyle: 'fillet', cornerValue: 1, rotation: 30,
    });
    assert.equal(rounded.length, 1);
    assert.equal(rounded[0].closed, true);
    assert.deepEqual(rounded[0].parts.map(part => part.type), [
        'line', 'arc', 'line', 'arc', 'line', 'arc', 'line', 'arc',
    ]);
    assert.ok(rounded[0].parts.filter(part => part.type === 'arc').every(part => part.r === 1));
    close(pathLength(rounded[0]), 2 * (6 + 4 - 4) + TAU, 1e-6);

    const polygon = extractEntityPaths({
        type: 'polygon', cx: 0, cy: 0, r: 2, sides: 6, mode: 'circumscribed', rotation: 10,
    });
    assert.equal(polygon[0].parts.length, 6);
    assert.equal(polygon[0].closed, true);
    assert.ok(polygon[0].parts.every(part => part.type === 'line'));
});

test('ordered mixed parts preserve arcs, orient reversed parts and split disconnected paths', () => {
    const paths = extractEntityPaths({
        type: 'polyline',
        parts: [
            { type: 'line', x1: 0, y1: 0, x2: 2, y2: 0 },
            { type: 'arc', cx: 2, cy: 1, r: 1, startAngle: -Math.PI / 2, endAngle: 0, counterClockwise: true },
            { type: 'line', x1: 5, y1: 1, x2: 3, y2: 1 },
            { type: 'circle', cx: 10, cy: 10, r: 1 },
        ],
    });
    assert.equal(paths.length, 2);
    assert.deepEqual(paths[0].parts.map(part => part.type), ['line', 'arc', 'line']);
    closePoint(getCurveEnd(paths[0].parts[1]), getCurveStart(paths[0].parts[2]));
    assert.equal(paths[1].parts[0].type, 'circle');
    assert.equal(paths[1].closed, true);
});

test('strict path normalization rejects gaps and pathological part counts', () => {
    assert.equal(normalizeCurvePath({
        type: 'path',
        parts: [
            { type: 'line', x1: 0, y1: 0, x2: 1, y2: 0 },
            { type: 'line', x1: 2, y1: 0, x2: 3, y2: 0 },
        ],
    }), null);
    const tooMany = Array.from({ length: 6 }, (_, index) => ({
        type: 'line', x1: index, y1: 0, x2: index + 1, y2: 0,
    }));
    assert.equal(normalizeCurvePath({ type: 'path', parts: tooMany }, { maxParts: 5 }), null);
});

test('block and hatch boundaries are supplied through bounded extraction hooks', () => {
    const registry = createBoundaryExtractorRegistry({
        block: entity => entity.definition.entities,
        hatch: entity => entity.loops,
    });
    const block = extractEntityPaths({
        type: 'block', definition: {
            entities: [{ type: 'line', x1: 0, y1: 0, x2: 2, y2: 0 }],
        },
    }, { boundaryExtractors: registry });
    assert.equal(block.length, 1);
    assert.equal(block[0].parts[0].type, 'line');

    const hatch = extractEntityPaths({
        type: 'hatch',
        loops: [[{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }]],
    }, { boundaryExtractors: registry });
    assert.equal(hatch.length, 1);
    assert.equal(hatch[0].closed, true);
    assert.equal(hatch[0].parts.length, 3);

    const recursive = {};
    recursive.type = 'block';
    recursive.child = recursive;
    assert.deepEqual(extractEntityPaths(recursive, {
        boundaryExtractors: createBoundaryExtractorRegistry({ block: entity => entity.child }),
    }), []);
});

test('start, end, point, tangent and reversal stay exact for native primitives', () => {
    const line = { type: 'line', x1: 1, y1: 2, x2: 5, y2: 2 };
    closePoint(getCurveStart(line), { x: 1, y: 2 });
    closePoint(getCurveEnd(line), { x: 5, y: 2 });
    closePoint(curvePointAt(line, 0.25), { x: 2, y: 2 });
    closePoint(curveTangentAt(line, 0.4), { x: 1, y: 0 });
    closePoint(getCurveStart(reverseCurve(line)), { x: 5, y: 2 });

    const arc = {
        type: 'arc', cx: 0, cy: 0, r: 2,
        startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
    };
    closePoint(curvePointAt(arc, 0.5), { x: Math.sqrt(2), y: Math.sqrt(2) });
    closePoint(curveTangentAt(arc, 0), { x: 0, y: 1 });
    const reversed = reverseCurve(arc);
    closePoint(getCurveStart(reversed), getCurveEnd(arc));
    closePoint(getCurveEnd(reversed), getCurveStart(arc));
});

test('length is exact for lines, circles and arcs and deterministic for ellipse and spline', () => {
    close(curveLength({ type: 'line', x1: 0, y1: 0, x2: 3, y2: 4 }), 5);
    close(curveLength({ type: 'circle', cx: 0, cy: 0, r: 3 }), 6 * Math.PI);
    close(curveLength({
        type: 'arc', cx: 0, cy: 0, r: 3,
        startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
    }), 1.5 * Math.PI);
    close(curveLength({ type: 'ellipse', cx: 0, cy: 0, rx: 3, ry: 3 }), 6 * Math.PI, 1e-7);
    close(curveLength({
        type: 'spline',
        controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
    }), 3, 1e-7);
});

test('closest parameters are exact for line/circle/arc and bounded for ellipse/spline', () => {
    const line = closestPointOnCurve({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }, { x: 3, y: 4 });
    close(line.t, 0.3);
    closePoint(line.point, { x: 3, y: 0 });

    const circle = closestPointOnCurve({ type: 'circle', cx: 0, cy: 0, r: 2 }, { x: 0, y: 9 });
    close(circle.t, 0.25);
    closePoint(circle.point, { x: 0, y: 2 });

    const arc = closestPointOnCurve({
        type: 'arc', cx: 0, cy: 0, r: 2,
        startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
    }, { x: -2, y: 0 });
    close(arc.t, 1);

    const ellipse = closestPointOnCurve({ type: 'ellipse', cx: 0, cy: 0, rx: 4, ry: 2 }, { x: 0, y: 5 });
    close(ellipse.t, 0.25, 1e-5);
    closePoint(ellipse.point, { x: 0, y: 2 }, 1e-5);

    const spline = closestPointOnCurve({
        type: 'spline',
        controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
    }, { x: 1.5, y: 4 });
    close(spline.t, 0.5, 1e-5);
});

test('splitting and subcurves retain native line, arc, ellipse and cubic representations', () => {
    const line = { id: 'line', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    const [lineBefore, lineAfter] = splitCurve(line, 0.3);
    closePoint(getCurveEnd(lineBefore), { x: 3, y: 0 });
    closePoint(getCurveStart(lineAfter), { x: 3, y: 0 });
    assert.equal(lineBefore.id, 'line');

    const circlePiece = curveSubcurve({ type: 'circle', cx: 0, cy: 0, r: 2 }, 0.25, 0.5);
    assert.equal(circlePiece.type, 'arc');
    close(curveLength(circlePiece), Math.PI);

    const ellipsePiece = curveSubcurve({ type: 'ellipse', cx: 0, cy: 0, rx: 4, ry: 2 }, 0, 0.5);
    assert.equal(ellipsePiece.type, 'ellipse');
    assert.equal(ellipsePiece.fullEllipse, false);

    const spline = {
        type: 'spline',
        controlPoints: [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 0 }],
    };
    const [splineBefore, splineAfter] = splitCurve(spline, 0.5);
    assert.equal(splineBefore.type, 'spline');
    assert.equal(splineAfter.type, 'spline');
    closePoint(getCurveEnd(splineBefore), getCurveStart(splineAfter));
    close(curveLength(splineBefore) + curveLength(splineAfter), curveLength(spline), 1e-6);
});

test('path APIs use accumulated length and support split, subpath, reverse and closed opening', () => {
    const path = normalizeCurvePath({
        type: 'path',
        parts: [
            { type: 'line', x1: 0, y1: 0, x2: 3, y2: 0 },
            { type: 'line', x1: 3, y1: 0, x2: 3, y2: 4 },
        ],
    });
    closePoint(pathPointAt(path, 3 / 7), { x: 3, y: 0 });
    closePoint(pathPointAt(path, 0.5), { x: 3, y: 0.5 });
    const closest = closestPointOnPath(path, { x: 2, y: 2 });
    assert.equal(closest.partIndex, 1);
    closePoint(closest.point, { x: 3, y: 2 });

    const [before, after] = splitPath(path, { partIndex: 1, t: 0.5 });
    close(pathLength(before), 5);
    close(pathLength(after), 2);
    const middle = pathSubpath(path, { partIndex: 0, t: 0.5 }, { partIndex: 1, t: 0.5 });
    close(pathLength(middle), 3.5);
    closePoint(pathPointAt(reversePath(path), 0), { x: 3, y: 4 });

    const closed = extractEntityPaths({
        type: 'polyline', closed: true,
        points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }],
    })[0];
    const opened = openClosedPathAt(closed, { partIndex: 1, t: 0.5 });
    assert.equal(opened.closed, false);
    close(pathLength(opened), 8);
    closePoint(getCurveStart(opened.parts[0]), getCurveEnd(opened.parts[opened.parts.length - 1]));
});

test('line intersections report exact crossings, endpoint touches and collinear overlap', () => {
    const crossing = intersectCurves(
        { type: 'line', x1: 0, y1: 0, x2: 4, y2: 4 },
        { type: 'line', x1: 0, y1: 4, x2: 4, y2: 0 },
    );
    assert.equal(crossing.points.length, 1);
    closePoint(crossing.points[0].point, { x: 2, y: 2 });
    close(crossing.points[0].leftT, 0.5);
    close(crossing.points[0].rightT, 0.5);

    const overlap = intersectCurves(
        { type: 'line', x1: 0, y1: 0, x2: 4, y2: 0 },
        { type: 'line', x1: 2, y1: 0, x2: 6, y2: 0 },
    );
    assert.equal(overlap.overlaps.length, 1);
    assert.deepEqual(overlap.overlaps[0].leftRange, [0.5, 1]);
    closePoint(overlap.overlaps[0].points[0], { x: 2, y: 0 });
    closePoint(overlap.overlaps[0].points[1], { x: 4, y: 0 });
});

test('line/circle/arc and circle/circle intersections are exact and tangent-aware', () => {
    const secant = intersectCurves(
        { type: 'line', x1: -2, y1: 0, x2: 2, y2: 0 },
        { type: 'circle', cx: 0, cy: 0, r: 1 },
    );
    assert.equal(secant.points.length, 2);
    assert.deepEqual(secant.points.map(item => Math.round(item.point.x)).sort(), [-1, 1]);

    const tangent = intersectCurves(
        { type: 'line', x1: -2, y1: 1, x2: 2, y2: 1 },
        { type: 'circle', cx: 0, cy: 0, r: 1 },
    );
    assert.equal(tangent.points.length, 1);
    assert.equal(tangent.points[0].tangent, true);

    const filteredArc = intersectCurves(
        { type: 'line', x1: -2, y1: 0, x2: 2, y2: 0 },
        { type: 'arc', cx: 0, cy: 0, r: 1, startAngle: 0, endAngle: Math.PI, counterClockwise: true },
    );
    assert.equal(filteredArc.points.length, 2);

    const circles = intersectCurves(
        { type: 'circle', cx: 0, cy: 0, r: 2 },
        { type: 'circle', cx: 2, cy: 0, r: 2 },
    );
    assert.equal(circles.points.length, 2);
    circles.points.forEach(item => close(item.point.x, 1));
});

test('coincident circular domains report overlap without chord conversion', () => {
    const overlap = intersectCurves(
        { type: 'arc', cx: 0, cy: 0, r: 2, startAngle: 0, endAngle: Math.PI, counterClockwise: true },
        { type: 'arc', cx: 0, cy: 0, r: 2, startAngle: Math.PI / 2, endAngle: Math.PI * 1.5, counterClockwise: true },
    );
    assert.equal(overlap.overlaps.length, 1);
    closePoint(overlap.overlaps[0].points[0], { x: 0, y: 2 });
    closePoint(overlap.overlaps[0].points[1], { x: -2, y: 0 });

    const circles = intersectCurves(
        { type: 'circle', cx: 0, cy: 0, r: 2 },
        { type: 'circle', cx: 0, cy: 0, r: 2 },
    );
    assert.equal(circles.overlaps.length, 1);
    assert.equal(circles.overlaps[0].closed, true);
});

test('line/ellipse uses an analytic solution and honors elliptical-arc domains', () => {
    const result = intersectCurves(
        { type: 'line', x1: -10, y1: 0, x2: 10, y2: 0 },
        { type: 'ellipse', cx: 0, cy: 0, rx: 4, ry: 2, rotation: 30 },
    );
    assert.equal(result.points.length, 2);
    result.points.forEach(item => close(item.point.y, 0));

    const upper = intersectCurves(
        { type: 'line', x1: -10, y1: 0, x2: 10, y2: 0 },
        {
            type: 'ellipse', cx: 0, cy: 0, rx: 4, ry: 2, rotation: 0,
            startAngle: 0, endAngle: Math.PI, counterClockwise: true,
        },
    );
    assert.equal(upper.points.length, 2);
});

test('ellipse/spline intersections are deterministic, bounded and refined numerically', () => {
    const spline = {
        type: 'spline',
        controlPoints: [{ x: -5, y: 0 }, { x: -2, y: 0 }, { x: 2, y: 0 }, { x: 5, y: 0 }],
    };
    const ellipse = { type: 'ellipse', cx: 0, cy: 0, rx: 3, ry: 2 };
    const first = intersectCurves(spline, ellipse);
    const second = intersectCurves(spline, ellipse);
    assert.equal(first.truncated, false);
    assert.equal(first.points.length, 2);
    assert.deepEqual(first, second);
    first.points.forEach(item => {
        close(Math.abs(item.point.x), 3, 1e-5);
        close(item.point.y, 0, 1e-5);
    });

    const truncated = intersectCurves(
        { type: 'ellipse', cx: 0, cy: 0, rx: 3, ry: 2 },
        { type: 'ellipse', cx: 1, cy: 0, rx: 3, ry: 2, rotation: 20 },
        { maxIntersectionChecks: 1 },
    );
    assert.equal(truncated.truncated, true);
});

test('path intersections expose part indices and deduplicate shared-vertex hits', () => {
    const left = normalizeCurvePath({
        type: 'path',
        parts: [
            { type: 'line', x1: 0, y1: 0, x2: 2, y2: 0 },
            { type: 'line', x1: 2, y1: 0, x2: 4, y2: 0 },
        ],
    });
    const right = normalizeCurvePath({
        type: 'path',
        parts: [{ type: 'line', x1: 2, y1: -2, x2: 2, y2: 2 }],
    });
    const result = intersectPaths(left, right);
    assert.equal(result.points.length, 1);
    closePoint(result.points[0].point, { x: 2, y: 0 });
    assert.ok([0, 1].includes(result.points[0].leftPartIndex));
    assert.equal(result.points[0].rightPartIndex, 0);
});


test('path length parameters invert nonuniform spline and ellipse speed', () => {
    const spline = { type: 'spline', controlPoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 12, y: 0 }] };
    const path = { type: 'path', parts: [spline] };
    closePoint(pathPointAt(path, 0.5), { x: 6, y: 0 }, 1e-7);
    close(closestPointOnPath(path, { x: 6, y: 1 }).pathT, 0.5, 1e-6);
    const ellipse = { type: 'ellipse', cx: 0, cy: 0, rx: 8, ry: 1, rotation: 0, fullEllipse: true };
    const length = curveLength(ellipse);
    const parameter = curveParameterAtLength(ellipse, length / 8);
    assert.ok(Math.abs(parameter - 0.125) > 0.01);
    close(curveLengthAtParameter(ellipse, parameter), length / 8, 1e-7);
});
