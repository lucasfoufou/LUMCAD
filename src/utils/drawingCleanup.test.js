import { reverseCurve, reversePath } from './drawingCurveKernel.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { cleanupDrawingEntities, parseDrawingCleanupInput } from './drawingCleanup.js';
const line = (id, x1, x2, extra = {}) => ({ id, type: 'line', layerId: 'geometry', x1, y1: 0, x2, y2: 0, ...extra });
const contentOf = entities => ({ ...createDefaultDrawingContent(), entities });

test('cleanup removes reversed duplicates and zero-length lines, then joins transitive overlaps in one proposal', () => {
    const content = contentOf([line('a', 0, 2), line('gap', 4, 6), line('bridge', 2, 4), line('duplicate', 2, 0), line('zero', 9, 9)]);
    const saved = structuredClone(content);
    const result = cleanupDrawingEntities(content, content.entities.map(entity => entity.id));
    assert.equal(result.changed, true); assert.equal(result.content.entities.length, 1);
    assert.deepEqual(result.content.entities[0], line('a', 0, 6));
    assert.equal(result.report.zeroLength, 1);
    assert.equal(result.report.duplicates + result.report.merged, 3);
    assert.deepEqual(content, saved);
    assert.equal(cleanupDrawingEntities(result.content, ['a']).changed, false);
});

test('cleanup preserves appearance, locks, associations and constraints rather than breaking identities', () => {
    const content = contentOf([line('source', 0, 2), line('copy', 0, 2), line('red', 0, 2, { color: '#ff0000' }), line('locked', 0, 2, { locked: true })]);
    content.geometricConstraints = [{ id: 'gc', type: 'horizontal', refs: [{ entityId: 'source' }] }];
    content.groups = [{ id: 'g', entityIds: ['copy'] }];
    const result = cleanupDrawingEntities(content, content.entities.map(entity => entity.id));
    assert.equal(result.changed, false); assert.equal(result.report.protected, 3);
    assert.equal(result.content, content);
});

test('cleanup respects finite gaps, tolerance, selected scope, dash continuity and atomic comparison limits', () => {
    const content = contentOf([line('a', 0, 2), line('b', 2.01, 4), line('c', 0, 2)]);
    assert.equal(cleanupDrawingEntities(content, ['a', 'b']).changed, false);
    assert.equal(cleanupDrawingEntities(content, ['a', 'b'], { tolerance: 0.02 }).content.entities.length, 2);
    assert.deepEqual(cleanupDrawingEntities(content, ['a', 'b', 'c'], { maxComparisons: 1 }), { error: 'limit' });
    const dashed = contentOf([line('a', 0, 2), line('b', 2, 4)]); dashed.layers[0].lineType = 'dashed';
    assert.equal(cleanupDrawingEntities(dashed, ['a', 'b']).changed, false);
});


test('geometric tolerance never treats distinct appearance or semantic numbers as interchangeable', () => {
    const content = contentOf([line('a', 0, 2, { lineWeight: 0.2 }), line('b', 0.001, 2.001, { lineWeight: 0.3 })]);
    assert.equal(cleanupDrawingEntities(content, ['a', 'b'], { tolerance: 0.2 }).changed, false);
    const polylines = contentOf(['a', 'b'].map((id, index) => ({ id, type: 'polyline', layerId: 'geometry',
        points: [{ x: 0, y: 0, width: 0.2 + index * 0.1 }, { x: 2, y: 0 }], closed: false })));
    assert.equal(cleanupDrawingEntities(polylines, ['a', 'b'], { tolerance: 0.2 }).changed, false);
});


test('OVERKILL options parse explicit scope and preview without silently accepting malformed input', () => {
    assert.deepEqual(parseDrawingCleanupInput('ALL PREVIEW TOLERANCE 0.01 MERGE OFF'), { all: true, preview: true, tolerance: 0.01, mergeLines: false });
    for (const input of ['ALL ALL', 'TOLERANCE', 'TOLERANCE -1', 'TOLERANCE Infinity', 'MERGE yes', 'unexpected']) assert.equal(parseDrawingCleanupInput(input), null);
});


test('cleanup recognizes reversed circular, elliptical and cubic primitives without confusing complementary arcs', () => {
    const curves = [
        { type: 'arc', cx: 0, cy: 0, r: 3, startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true },
        { type: 'ellipse', cx: 2, cy: 3, rx: 4, ry: 2, rotation: 25, startAngle: 0.2, endAngle: 2, counterClockwise: true },
        { type: 'spline', controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 3 }, { x: 2, y: -2 }, { x: 4, y: 0 }] },
        { type: 'circle', cx: 0, cy: 0, r: 2 },
    ];
    for (const curve of curves) {
        const first = { ...curve, id: 'first', layerId: 'geometry', color: '#123456' };
        const content = contentOf([first, { ...reverseCurve(first), id: 'reversed' }]);
        const result = cleanupDrawingEntities(content, ['first', 'reversed']);
        assert.equal(result.report.duplicates, 1, curve.type);
        assert.deepEqual(result.content.entities, [first]);
    }
    const minor = { id: 'minor', layerId: 'geometry', type: 'arc', cx: 0, cy: 0, r: 3, startAngle: 0, endAngle: 0.000001, counterClockwise: true };
    const major = { ...minor, id: 'major', endAngle: Math.PI * 2 - 0.000001 };
    assert.equal(cleanupDrawingEntities(contentOf([minor, major]), ['minor', 'major'], { tolerance: 0.001 }).changed, false);
});

test('closed point and native-curve paths match across start-index changes and reversal with bounded work', () => {
    const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
    const pointPath = { id: 'a', layerId: 'geometry', type: 'polyline', closed: true, points };
    const reordered = { ...pointPath, id: 'b', points: [points[2], points[1], points[0], points[3]] };
    assert.equal(cleanupDrawingEntities(contentOf([pointPath, reordered]), ['a', 'b']).report.duplicates, 1);
    const parts = points.map((point, index) => ({ type: 'line', x1: point.x, y1: point.y, x2: points[(index + 1) % 4].x, y2: points[(index + 1) % 4].y }));
    const native = { id: 'a', layerId: 'geometry', type: 'polyline', closed: true, parts };
    const reversed = reversePath(native);
    const other = { ...native, id: 'b', parts: [...reversed.parts.slice(2), ...reversed.parts.slice(0, 2)] };
    assert.equal(cleanupDrawingEntities(contentOf([native, other]), ['a', 'b']).report.duplicates, 1);
    assert.deepEqual(cleanupDrawingEntities(contentOf([native, other]), ['a', 'b'], { maxComparisons: 2 }), { error: 'limit' });
});
