import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDrawingBoundary, createDrawingBoundaries } from './drawingBoundaryDetection.js';
import { getCurveStart, getCurveEnd } from './drawingCurveKernel.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { normalizeDrawingContent, createDefaultDrawingContent } from './drawingDocument.js';
import { translateEntity } from './drawingPrimitives.js';

const rectangle = { id: 'outer', type: 'rectangle', x: 0, y: 0, width: 10, height: 8 };
const line = (id, x1, y1, x2, y2) => ({ id, type: 'line', x1, y1, x2, y2 });
const circle = (id, cx, cy, r) => ({ id, type: 'circle', cx, cy, r });

function assertClosed(result) {
    assert.ok(result);
    for (const boundary of result.boundaries) {
        boundary.parts.forEach((part, index, parts) => {
            const end = getCurveEnd(part);
            const next = getCurveStart(parts[(index + 1) % parts.length]);
            assert.ok(Math.hypot(end.x - next.x, end.y - next.y) < 1e-7);
        });
    }
}

test('a pick chooses the intersected face and ignores dangling branches', () => {
    const sources = [rectangle, line('divider', 5, -1, 5, 9), line('branch', 0, 4, 2, 4)];
    const left = detectDrawingBoundary(sources, { x: 1, y: 1 });
    assertClosed(left);
    assert.deepEqual(new Set(left.sourceIds), new Set(['outer', 'divider']));
    assert.ok(left.boundaries[0].parts.every(part => getCurveStart(part).x <= 5));
    const right = detectDrawingBoundary(sources, { x: 7, y: 2 });
    assertClosed(right);
    assert.ok(right.boundaries[0].parts.every(part => getCurveStart(part).x >= 5));
    assert.equal(detectDrawingBoundary(sources, { x: 12, y: 2 }), null);
    assert.equal(detectDrawingBoundary(sources, { x: 5, y: 2 }), null);
});

test('nested islands exclude only immediate disconnected interiors', () => {
    const sources = [rectangle, circle('island', 4, 4, 2), circle('inner', 4, 4, 0.5)];
    const outer = detectDrawingBoundary(sources, { x: 1, y: 1 });
    assertClosed(outer);
    assert.equal(outer.boundaries.length, 2);
    assert.deepEqual(outer.sourceIds, ['outer', 'island']);
    const inner = detectDrawingBoundary(sources, { x: 4, y: 4 });
    assertClosed(inner);
    assert.deepEqual(inner.sourceIds, ['inner']);
});

test('intersecting circles retain native circular arcs in the picked lens', () => {
    const result = detectDrawingBoundary([circle('a', 0, 0, 2), circle('b', 2, 0, 2)], { x: 1, y: 0 });
    assertClosed(result);
    assert.equal(result.boundaries.length, 1);
    assert.ok(result.boundaries[0].parts.every(part => part.type === 'arc'));
    assert.deepEqual(new Set(result.sourceIds), new Set(['a', 'b']));
});

test('open gaps, overlapping duplicate edges and excessive input fail without a partial contour', () => {
    assert.equal(detectDrawingBoundary([line('a', 0, 0, 1, 0), line('b', 1, 0, 1, 1)], { x: 0.5, y: 0.5 }), null);
    assert.equal(detectDrawingBoundary([rectangle, rectangle], { x: 1, y: 1 }), null);
    assert.equal(detectDrawingBoundary(Array.from({ length: 257 }, (_, i) => line(`${i}`, i, 0, i, 1)), { x: 1, y: 1 }), null);
});

test('boundary creation preserves source objects and exact island paths through transforms and archives', () => {
    const sources = [rectangle, circle('hole', 4, 4, 1)];
    const original = structuredClone(sources);
    let id = 0;
    const boundaries = createDrawingBoundaries(sources, { x: 1, y: 1 }, 'geometry', () => `boundary-${++id}`);
    assert.equal(boundaries.length, 2);
    assert.deepEqual(sources, original);
    assert.deepEqual(boundaries.map(entity => entity.id), ['boundary-1', 'boundary-2']);
    assert.ok(boundaries.every(entity => entity.closed && entity.type === 'polyline' && !entity.sourceIds));
    assert.ok(boundaries[1].parts.every(part => part.type === 'arc'));
    const moved = boundaries.map(entity => translateEntity(entity, 10, -2));
    assertClosed({ boundaries: moved });
    assert.ok(Math.abs(getCurveStart(moved[0].parts[0]).x - getCurveStart(boundaries[0].parts[0]).x - 10) < 1e-9);
    const document = createLcadDocument({ name: 'Boundaries' });
    document.content = normalizeDrawingContent({ ...createDefaultDrawingContent(), entities: moved });
    assert.deepEqual(readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content, document.content);
    assert.equal(createDrawingBoundaries(sources, { x: 20, y: 20 }, 'geometry', () => { throw new Error('No IDs for failed picks'); }), null);
});
