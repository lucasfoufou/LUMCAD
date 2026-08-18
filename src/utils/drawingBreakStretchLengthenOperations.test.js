import assert from 'node:assert/strict';
import test from 'node:test';

import {
    breakDrawingEntity,
    breakDrawingEntityAtPoint,
    breakDrawingTarget,
    breakDrawingTargetAtPoint,
    createBreakPreviewEntities,
    createLengthenPreviewEntities,
    lengthenDrawingEntity,
    lengthenDrawingTarget,
} from './drawingBreakLengthenOperations.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { pathLength } from './drawingCurveKernel.js';
import {
    createStretchPreviewEntities,
    stretchDrawingEntities,
    stretchDrawingEntity,
} from './drawingStretchOperations.js';

const EPSILON = 1e-6;

function line(id, x1, y1, x2, y2, layerId = 'geometry') {
    return { id, type: 'line', layerId, x1, y1, x2, y2 };
}

function contentWith(entities) {
    return { ...createDefaultDrawingContent(), entities };
}

function near(actual, expected, tolerance = EPSILON) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);
}

const crossing = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY, mode: 'crossing' });

test('BREAK removes the exact interval and retains two native line fragments', () => {
    const result = breakDrawingEntity(line('source', 0, 0, 10, 0), { x: 3, y: 0 }, { x: 7, y: 0 });
    assert.equal(result.changed, true);
    assert.equal(result.operation, 'break');
    assert.deepEqual(result.fragments.map(({ layerId: _layerId, ...entity }) => entity), [
        { type: 'line', x1: 0, y1: 0, x2: 3, y2: 0 },
        { type: 'line', x1: 7, y1: 0, x2: 10, y2: 0 },
    ]);
    assert.deepEqual(result.removedCurves[0], {
        id: 'source', type: 'line', layerId: 'geometry', x1: 3, y1: 0, x2: 7, y2: 0,
    });
});

test('BREAK accepts points in either order on open paths', () => {
    const forward = breakDrawingEntity(line('source', 0, 0, 10, 0), { x: 3, y: 0 }, { x: 7, y: 0 });
    const reverse = breakDrawingEntity(line('source', 0, 0, 10, 0), { x: 7, y: 0 }, { x: 3, y: 0 });
    assert.deepEqual(reverse.fragments, forward.fragments);
});

test('BREAKATPOINT splits an open line without removing geometry', () => {
    const result = breakDrawingEntityAtPoint(line('source', 0, 0, 10, 0), { x: 4, y: 0 });
    assert.equal(result.operation, 'break-at-point');
    assert.equal(result.fragments.length, 2);
    near(result.fragments[0].x2, 4);
    near(result.fragments[1].x1, 4);
    assert.deepEqual(result.removedPaths, []);
});

test('BREAK on an arc preserves native arc pieces and direction', () => {
    const arc = {
        type: 'arc', cx: 0, cy: 0, r: 5,
        startAngle: 0, endAngle: Math.PI, counterClockwise: true,
    };
    const result = breakDrawingEntity(
        arc,
        { x: 5 / Math.sqrt(2), y: 5 / Math.sqrt(2) },
        { x: -5 / Math.sqrt(2), y: 5 / Math.sqrt(2) },
    );
    assert.equal(result.fragments.length, 2);
    assert.equal(result.fragments.every(entity => entity.type === 'arc' && entity.counterClockwise), true);
    assert.equal(result.removedCurves[0].type, 'arc');
});

test('BREAK on a circle removes the directed arc and keeps its exact complement', () => {
    const result = breakDrawingEntity(
        { type: 'circle', cx: 0, cy: 0, r: 5, counterClockwise: true },
        { x: 0, y: 5 },
        { x: 0, y: -5 },
    );
    assert.equal(result.fragments.length, 1);
    assert.equal(result.fragments[0].type, 'arc');
    near(result.fragments[0].startAngle, Math.PI * 1.5);
    near(result.fragments[0].endAngle, Math.PI / 2);
    assert.equal(result.removedCurves[0].type, 'arc');
});

test('BREAKATPOINT opens a circle as an exact mixed path without deleting geometry', () => {
    const result = breakDrawingEntityAtPoint({ type: 'circle', cx: 0, cy: 0, r: 5 }, { x: 5, y: 0 });
    assert.equal(result.fragments.length, 1);
    assert.equal(result.fragments[0].type, 'polyline');
    assert.equal(result.fragments[0].closed, false);
    assert.equal(result.fragments[0].parts.length, 2);
    near(pathLength(result.paths[0]), Math.PI * 10);
});

test('BREAK and BREAKATPOINT support open and closed mixed polylines', () => {
    const open = {
        type: 'polyline',
        parts: [
            { type: 'line', x1: 0, y1: 0, x2: 5, y2: 0 },
            { type: 'arc', cx: 5, cy: 5, r: 5, startAngle: -Math.PI / 2, endAngle: 0, counterClockwise: true },
        ],
        closed: false,
    };
    const split = breakDrawingEntityAtPoint(open, { x: 5, y: 0 });
    assert.equal(split.fragments.length, 2);
    assert.equal(split.fragments[1].type, 'arc');

    const closed = {
        type: 'polyline',
        points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }],
        closed: true,
    };
    const opened = breakDrawingEntityAtPoint(closed, { x: 2, y: 0 });
    assert.equal(opened.changed, true);
    assert.equal(opened.fragments[0].closed, false);
});

test('document break replaces the source, removes dependents and assigns new ids', () => {
    const source = line('source', 0, 0, 10, 0);
    const content = contentWith([
        source,
        { id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'source', offset: 0.5 },
    ]);
    const result = breakDrawingTarget(content, source, { x: 3, y: 0 }, { x: 7, y: 0 });
    assert.equal(result.changed, true);
    assert.equal(result.replacements.length, 2);
    assert.equal(result.replacements.some(entity => entity.id === 'source'), false);
    assert.equal(result.content.entities.some(entity => entity.sourceId === 'source'), false);

    const atPoint = breakDrawingTargetAtPoint(content, 'source', { x: 5, y: 0 });
    assert.equal(atPoint.replacements.length, 2);
});

test('break preview uses native result geometry', () => {
    const arc = {
        id: 'arc', type: 'arc', layerId: 'geometry', cx: 0, cy: 0, r: 5,
        startAngle: 0, endAngle: Math.PI, counterClockwise: true,
    };
    const previews = createBreakPreviewEntities(contentWith([arc]), {
        targetId: 'arc', firstPoint: { x: 5, y: 0 }, secondPoint: { x: -5, y: 0 },
    });
    assert.equal(previews.every(entity => entity.type === 'arc'), true);
    assert.equal(previews.every(entity => entity.previewMode === 'break'), true);
});

test('break rejects endpoints, non-finite picks and pathological point counts', () => {
    const source = line('source', 0, 0, 10, 0);
    assert.equal(breakDrawingEntityAtPoint(source, { x: 0, y: 0 }).reason, 'endpoint');
    assert.equal(breakDrawingEntity(source, { x: Infinity, y: 0 }, { x: 5, y: 0 }).changed, false);
    const oversized = {
        type: 'polyline',
        points: Array.from({ length: 4_097 }, (_, index) => ({ x: index, y: 0 })),
        closed: false,
    };
    assert.equal(breakDrawingEntityAtPoint(oversized, { x: 5, y: 0 }).changed, false);
});

test('LENGTHEN delta extends and shortens the picked line endpoint', () => {
    const source = line('source', 0, 0, 10, 0);
    const extended = lengthenDrawingEntity(source, { x: 10, y: 0 }, { mode: 'delta', value: 2 });
    near(extended.entity.x2, 12);
    near(extended.targetLength, 12);
    const shortened = lengthenDrawingEntity(source, { x: 0, y: 0 }, { mode: 'delta', value: -3 });
    near(shortened.entity.x1, 3);
    near(shortened.targetLength, 7);
});

test('LENGTHEN percent and total operate on the whole open path length', () => {
    const path = {
        type: 'polyline',
        points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }],
        closed: false,
    };
    const percent = lengthenDrawingEntity(path, { x: 3, y: 4 }, { mode: 'percent', value: 50 });
    near(pathLength(percent.path), 3.5);
    const total = lengthenDrawingEntity(path, { x: 3, y: 4 }, { mode: 'total', value: 10 });
    near(pathLength(total.path), 10);
    near(total.entity.points.at(-1).y, 7);
});

test('LENGTHEN dynamic projects line endpoints on their native support', () => {
    const result = lengthenDrawingEntity(line('source', 0, 0, 5, 0), { x: 5, y: 0 }, {
        mode: 'dynamic', dynamicPoint: { x: 8, y: 3 },
    });
    assert.equal(result.changed, true);
    near(result.entity.x2, 8);
    near(result.entity.y2, 0);
});

test('LENGTHEN dynamic changes arc angular extent without chord conversion', () => {
    const arc = {
        type: 'arc', cx: 0, cy: 0, r: 5,
        startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
    };
    const result = lengthenDrawingEntity(arc, { x: 0, y: 5 }, {
        mode: 'dynamic', dynamicPoint: { x: -5, y: 0 },
    });
    assert.equal(result.entity.type, 'arc');
    near(result.entity.endAngle, Math.PI);
});

test('LENGTHEN preserves native arc curvature for every numeric mode', () => {
    const arc = {
        type: 'arc', cx: 0, cy: 0, r: 5,
        startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
    };
    const result = lengthenDrawingEntity(arc, { x: 0, y: 5 }, { mode: 'delta', value: Math.PI * 2.5 });
    assert.equal(result.entity.type, 'arc');
    near(result.entity.endAngle, Math.PI);
    near(result.targetLength, Math.PI * 5);
});

test('LENGTHEN supports elliptical arcs and cubic spline shortening/extension', () => {
    const ellipse = {
        type: 'ellipse', cx: 0, cy: 0, rx: 6, ry: 3, rotation: 0,
        startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true, fullEllipse: false,
    };
    const current = pathLength({ type: 'path', parts: [ellipse], closed: false });
    const ellipseResult = lengthenDrawingEntity(ellipse, { x: 0, y: 3 }, { mode: 'total', value: current + 1 });
    assert.equal(ellipseResult.changed, true);
    assert.equal(ellipseResult.entity.type, 'ellipse');
    near(pathLength(ellipseResult.path), current + 1, 2e-5);

    const spline = {
        type: 'spline',
        controlPoints: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 2 }, { x: 5, y: 2 }],
    };
    const splineLength = pathLength({ type: 'path', parts: [spline], closed: false });
    const shortened = lengthenDrawingEntity(spline, { x: 5, y: 2 }, { mode: 'total', value: splineLength / 2 });
    assert.equal(shortened.entity.type, 'spline');
    const extended = lengthenDrawingEntity(spline, { x: 5, y: 2 }, { mode: 'delta', value: 2 });
    assert.equal(extended.entity.type, 'polyline');
    assert.equal(extended.entity.parts.at(-1).type, 'line');
    near(pathLength(extended.path), splineLength + 2, 2e-5);
});

test('closed objects and invalid values fail closed for LENGTHEN', () => {
    assert.equal(lengthenDrawingEntity({ type: 'circle', cx: 0, cy: 0, r: 5 }, { x: 5, y: 0 }, {
        mode: 'delta', value: 1,
    }).reason, 'closed-path');
    assert.equal(lengthenDrawingEntity(line('line', 0, 0, 1, 0), { x: 1, y: 0 }, {
        mode: 'percent', value: 0,
    }).changed, false);
    assert.equal(lengthenDrawingEntity(line('line', 0, 0, 1, 0), { x: Infinity, y: 0 }, {
        mode: 'delta', value: 1,
    }).changed, false);
});

test('document lengthen preserves id and compatible dimension associations', () => {
    const source = line('source', 0, 0, 5, 0);
    const content = contentWith([
        source,
        { id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'source', offset: 0.5 },
    ]);
    const result = lengthenDrawingTarget(content, source, { x: 5, y: 0 }, { mode: 'total', value: 8 });
    assert.equal(result.entity.id, 'source');
    assert.equal(result.content.entities.some(entity => entity.id === 'dimension' && entity.sourceId === 'source'), true);
    near(result.entity.x2, 8);
});

test('lengthen preview contains the full native result', () => {
    const source = line('source', 0, 0, 5, 0);
    const previews = createLengthenPreviewEntities(contentWith([source]), {
        targetId: 'source', point: { x: 5, y: 0 }, mode: 'delta', value: 2,
    });
    assert.equal(previews.length, 1);
    assert.equal(previews[0].type, 'line');
    assert.equal(previews[0].previewMode, 'lengthen');
    near(previews[0].x2, 7);
});

test('STRETCH moves only line endpoints inside the crossing window', () => {
    const source = line('source', 0, 0, 4, 0);
    const result = stretchDrawingEntity(source, crossing(3.5, -1, 4.5, 1), { x: 2, y: 1 });
    assert.equal(result.changed, true);
    assert.equal(result.rigid, false);
    assert.deepEqual(result.entity, line('source', 0, 0, 6, 1));
});

test('STRETCH moves wholly enclosed geometry rigidly and rejects containment windows', () => {
    const source = line('source', 0, 0, 2, 0);
    const rigid = stretchDrawingEntity(source, crossing(-1, -1, 3, 1), { x: 5, y: 2 });
    assert.equal(rigid.rigid, true);
    assert.deepEqual(rigid.entity, line('source', 5, 2, 7, 2));
    assert.equal(stretchDrawingEntity(source, { ...crossing(-1, -1, 3, 1), mode: 'window' }, { x: 1, y: 0 }).changed, false);
});

test('STRETCH edits point-polyline vertices and converts partial rectangles to paths', () => {
    const polyline = {
        type: 'polyline', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }], closed: false,
    };
    const polylineResult = stretchDrawingEntity(polyline, crossing(1.5, -1, 2.5, 1), { x: 0, y: 3 });
    assert.deepEqual(polylineResult.entity.points, [{ x: 0, y: 0 }, { x: 2, y: 3 }, { x: 4, y: 0 }]);

    const rectangle = { type: 'rectangle', x: 0, y: 0, width: 4, height: 2 };
    const rectangleResult = stretchDrawingEntity(rectangle, crossing(3.5, -1, 4.5, 3), { x: 2, y: 0 });
    assert.equal(rectangleResult.entity.type, 'polyline');
    assert.equal(rectangleResult.entity.closed, true);
    assert.equal(rectangleResult.entity.points.some(point => point.x === 6), true);
});

test('STRETCH preserves native fillet arcs while moving a rounded-rectangle side', () => {
    const rectangle = {
        type: 'rectangle', x: 0, y: 0, width: 6, height: 4,
        cornerStyle: 'fillet', cornerValue: 0.5,
    };
    const result = stretchDrawingEntity(rectangle, crossing(5.4, -1, 6.6, 5), { x: 2, y: 0 });
    assert.equal(result.changed, true);
    assert.equal(result.entity.type, 'polyline');
    assert.equal(result.entity.parts.filter(part => part.type === 'arc').length, 4);
    assert.equal(result.entity.parts.some(part => part.type === 'line' && part.x1 > 7), true);
});

test('STRETCH reconstructs arcs and moves cubic control points natively', () => {
    const arc = {
        type: 'arc', cx: 0, cy: 0, r: 5,
        startAngle: 0, endAngle: Math.PI, counterClockwise: true,
    };
    const arcResult = stretchDrawingEntity(arc, crossing(4.5, -0.5, 5.5, 0.5), { x: 1, y: 1 });
    assert.equal(arcResult.changed, true);
    assert.equal(arcResult.entity.type, 'arc');
    near(arcResult.entity.x1 ?? 0, 0);

    const spline = {
        type: 'spline',
        controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }],
    };
    const splineResult = stretchDrawingEntity(spline, crossing(0.5, -1, 1.5, 1), { x: 0, y: 2 });
    assert.deepEqual(splineResult.entity.controlPoints[1], { x: 1, y: 2 });
    assert.deepEqual(splineResult.entity.controlPoints[0], { x: 0, y: 0 });
});

test('STRETCH handles block insertion points and canonical hatch boundaries', () => {
    const block = {
        id: 'reference', type: 'blockReference', blockId: 'block', layerId: 'geometry',
        transform: { a: 1, b: 0, c: 0, d: 1, e: 2, f: 2 },
    };
    const blockResult = stretchDrawingEntity(block, crossing(1, 1, 3, 3), { x: 4, y: 0 });
    near(blockResult.entity.transform.e, 6);

    const hatch = {
        type: 'hatch',
        boundaries: [{
            type: 'polyline', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], closed: true,
        }],
        pattern: { name: 'solid' },
    };
    const hatchResult = stretchDrawingEntity(hatch, crossing(3.5, -1, 4.5, 5), { x: 2, y: 0 });
    assert.equal(hatchResult.changed, true);
    assert.equal(hatchResult.entity.boundaries[0].parts.some(part => part.x1 === 6 || part.x2 === 6), true);
});

test('batch STRETCH derives delta from two points, preserves ids, and keeps compatible dimensions', () => {
    const source = line('source', 0, 0, 4, 0);
    const untouched = line('untouched', 0, 5, 4, 5);
    const content = contentWith([
        source,
        untouched,
        { id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'source', offset: 0.5 },
    ]);
    const result = stretchDrawingEntities(content, {
        targetIds: ['source'],
        window: crossing(3.5, -1, 4.5, 1),
        basePoint: { x: 0, y: 0 },
        secondPoint: { x: 2, y: 1 },
    });
    assert.equal(result.changedCount, 1);
    assert.equal(result.entities[0].id, 'source');
    assert.equal(result.content.entities.some(entity => entity.id === 'untouched'), true);
    assert.equal(result.content.entities.some(entity => entity.sourceId === 'source'), true);
    near(result.entities[0].x2, 6);
    near(result.entities[0].y2, 1);
});

test('stretch previews and safety validation fail closed deterministically', () => {
    const source = line('source', 0, 0, 4, 0);
    const content = contentWith([source]);
    const previews = createStretchPreviewEntities(content, {
        targetIds: ['source'], window: crossing(3.5, -1, 4.5, 1), basePoint: { x: 0, y: 0 },
    }, { x: 2, y: 0 });
    assert.equal(previews.length, 1);
    assert.equal(previews[0].previewMode, 'stretch');
    assert.equal(stretchDrawingEntity(source, crossing(0, 0, 0, 1), { x: 1, y: 0 }).changed, false);
    assert.equal(stretchDrawingEntity(source, crossing(-1, -1, 5, 1), { x: Infinity, y: 0 }).changed, false);
});
