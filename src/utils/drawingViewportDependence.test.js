import test from 'node:test';
import assert from 'node:assert/strict';

import { drawingEntityRenderBounds, drawingEntityViewportChanged, drawingEntityViewportKey, drawingEntityUsesDefaultDimensionSize } from './drawingViewportDependence.js';

const near = { x: 0, y: 0, width: 20, height: 10 };
const panned = { x: 2, y: 1, width: 20, height: 10 };
const far = { x: 500, y: 500, width: 20, height: 10 };

test('ordinary geometry never depends on the viewport', () => {
    for (const entity of [
        { id: 'line', type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 },
        { id: 'text', type: 'text', x: 0, y: 0, text: 'A' },
        { id: 'path', type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    ]) {
        assert.equal(drawingEntityViewportKey(entity, near), '');
        assert.equal(drawingEntityViewportChanged(entity, near, far, new Map()), false);
    }
});

test('construction lines follow every viewport change', () => {
    const xline = { id: 'x', type: 'xline', x1: 0, y1: 0, x2: 1, y2: 0 };
    assert.equal(drawingEntityViewportChanged(xline, near, panned, new Map()), true);
    assert.equal(drawingEntityViewportChanged(xline, near, near, new Map()), false);
});

test('circles change only when culling or oversized tessellation changes', () => {
    const circle = { id: 'c', type: 'circle', cx: 5, cy: 5, r: 1 };
    assert.equal(drawingEntityViewportChanged(circle, near, panned, new Map()), false);
    assert.equal(drawingEntityViewportChanged(circle, near, far, new Map()), true);
    const huge = { id: 'h', type: 'circle', cx: 0, cy: 1e5, r: 1e5 };
    assert.equal(drawingEntityViewportChanged(huge, near, panned, new Map()), true);
});

test('block references inherit the viewport dependence of their definitions', () => {
    const blockMap = new Map([
        ['plain', { id: 'plain', entities: [{ id: 'l', type: 'line', x1: 0, y1: 0, x2: 1, y2: 0 }] }],
        ['bolt', { id: 'bolt', entities: [{ id: 'c', type: 'circle', cx: 0, cy: 0, r: 0.2 }] }],
        ['nested', { id: 'nested', entities: [{ id: 'r', type: 'blockReference', blockId: 'bolt', transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }] }],
    ]);
    const reference = blockId => ({ id: blockId, type: 'blockReference', blockId, transform: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 } });
    assert.equal(drawingEntityViewportKey(reference('plain'), near, blockMap), '');
    assert.equal(drawingEntityViewportChanged(reference('bolt'), near, panned, blockMap), false);
    assert.equal(drawingEntityViewportChanged(reference('bolt'), near, far, blockMap), true);
    assert.equal(drawingEntityViewportChanged(reference('nested'), near, far, blockMap), true);
});

test('render bounds are conservative and unknown extents always render', () => {
    assert.deepEqual(drawingEntityRenderBounds({ id: 'l', type: 'line', x1: 0, y1: 0, x2: 4, y2: 2 }), { minX: 0, minY: 0, maxX: 4, maxY: 2 });
    const text = drawingEntityRenderBounds({ id: 't', type: 'text', x: 0, y: 0, width: 1, height: 0.5, text: 'Label', fontSize: 0.2 });
    assert.ok(text.maxX >= 1 + 5 * 0.2 - 1e-9);
    assert.equal(drawingEntityRenderBounds({ id: 'x', type: 'xline', x1: 0, y1: 0, x2: 1, y2: 0 }), null);
    assert.equal(drawingEntityRenderBounds({ id: 'd', type: 'linearDimension', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, offset: 1 }), null);
    assert.equal(drawingEntityRenderBounds({ id: 'u', type: 'unknown' }), null);
});

test('nested block cache follows replacement catalogs and automatic dimension sizing', () => {
    const parent = { id: 'parent', entities: [{ type: 'blockReference', blockId: 'child' }] };
    const plain = { id: 'child', entities: [{ type: 'line' }] };
    const original = new Map([['parent', parent], ['child', plain]]);
    const reference = { type: 'blockReference', blockId: 'parent' };
    assert.equal(drawingEntityViewportKey(reference, near, original), '');
    assert.equal(drawingEntityUsesDefaultDimensionSize(reference, original), false);
    const changed = new Map([['parent', parent], ['child', { id: 'child', entities: [{ type: 'xline', x1: 0, y1: 0, x2: 1, y2: 1 }, { type: 'linearDimension' }] }]]);
    assert.equal(drawingEntityViewportChanged(reference, near, far, changed), true);
    assert.equal(drawingEntityUsesDefaultDimensionSize(reference, changed), true);
    assert.equal(drawingEntityUsesDefaultDimensionSize({ type: 'linearDimension', textSize: 0.3 }, changed), false);
    assert.equal(drawingEntityUsesDefaultDimensionSize({ type: 'linearDimension', textSize: 0 }, changed), true);
    const cyclic = new Map([['parent', { id: 'parent', entities: [reference] }]]);
    assert.equal(drawingEntityUsesDefaultDimensionSize(reference, cyclic), true);
});
