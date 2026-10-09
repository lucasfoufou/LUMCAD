import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { snapDrawingPoint } from './drawingGeometry.js';
import { resolveDrawingSnap } from './drawingTracking.js';

function drawing(entities, blocks = []) {
    const content = normalizeDrawingContent({ ...createDefaultDrawingContent(), entities, blocks });
    return { ...content, settings: { ...content.settings, snaps: { endpoint: true, midpoint: true, center: true, intersection: true, nearest: false } } };
}

test('indexed snapping finds snap points outside the drawn extent of their entity', () => {
    const arc = { id: 'arc', type: 'arc', layerId: 'geometry', cx: 0, cy: 0, r: 10, startAngle: 0.1, endAngle: 0.4, counterClockwise: true };
    const snapped = snapDrawingPoint({ x: 0.01, y: -0.01 }, drawing([arc]), 0.1);
    assert.equal(snapped.type, 'center');
    assert.deepEqual([snapped.x, snapped.y], [0, 0]);
});

test('every block occurrence is snappable, beyond the former per-move expansion budget', () => {
    const block = { id: 'panel', name: 'PANEL', entities: [
        { id: 'a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 },
        { id: 'b', type: 'line', layerId: 'geometry', x1: 0, y1: 1, x2: 1, y2: 1 },
        { id: 'c', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 0, y2: 1 },
        { id: 'd', type: 'line', layerId: 'geometry', x1: 1, y1: 0, x2: 1, y2: 1 },
    ] };
    const references = Array.from({ length: 3000 }, (_, index) => ({
        id: `ref-${index}`, type: 'blockReference', blockId: 'panel', layerId: 'geometry',
        transform: { a: 1, b: 0, c: 0, d: 1, e: (index % 100) * 2, f: Math.floor(index / 100) * 2 },
    }));
    const snapped = snapDrawingPoint({ x: 198.98, y: 59.01 }, drawing(references, [block]), 0.1);
    assert.ok(['endpoint', 'intersection'].includes(snapped.type));
    assert.deepEqual([snapped.x, snapped.y], [199, 59]);
});

test('exclusions and edits are reflected by the cached index', () => {
    const line = { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0 };
    const content = drawing([line]);
    assert.equal(snapDrawingPoint({ x: 4.01, y: 0 }, content, 0.1).type, 'endpoint');
    assert.equal(snapDrawingPoint({ x: 4.01, y: 0 }, content, 0.1, { excludeIds: ['line'] }).type, null);
    const moved = { ...content, entities: [{ ...line, x2: 6 }] };
    assert.equal(snapDrawingPoint({ x: 4.01, y: 0 }, moved, 0.1).type, null);
    assert.equal(snapDrawingPoint({ x: 6.01, y: 0 }, moved, 0.1).type, 'endpoint');
});

test('orthogonal guides still meet construction lines far from their defining points', () => {
    const xline = { id: 'xline', type: 'xline', layerId: 'geometry', x1: 0, y1: 5, x2: 1, y2: 6 };
    const content = drawing([xline]);
    const tracked = resolveDrawingSnap({ x: -5.04, y: 0.01 }, {
        ...content, settings: { ...content.settings, snaps: { ...content.settings.snaps, nearest: true } },
    }, 0.25, { orthogonalOrigin: { x: 0, y: 0 }, temporaryOrtho: true });
    assert.equal(tracked.type, 'trackingIntersection');
    assert.ok(Math.hypot(tracked.x + 5, tracked.y) < 1e-9);
});
