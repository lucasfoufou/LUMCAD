import test from 'node:test';
import assert from 'node:assert/strict';
import {
    describeDrawingBlockTransform,
    describeDrawingLine,
    resizeDrawingLine,
    summarizeDrawingSelectionTypes,
    updateDrawingBlockTransform,
} from './drawingEntityProperties.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test('line length and angle are read in the UCS', () => {
    const line = { type: 'line', x1: 1, y1: 1, x2: 4, y2: 5 };
    const world = describeDrawingLine(line);
    close(world.length, 5);
    close(world.angle, Math.atan2(4, 3) * 180 / Math.PI);
    const rotated = describeDrawingLine({ x1: 0, y1: 0, x2: 0, y2: 2 }, { x: 0, y: 0, rotation: 90 });
    close(rotated.length, 2);
    close(rotated.angle, 0);
    assert.equal(describeDrawingLine({ x1: 0 }), null);
});

test('line length and angle edits keep the first point', () => {
    const line = { x1: 1, y1: 1, x2: 4, y2: 5 };
    const longer = resizeDrawingLine(line, { length: 10 });
    close(longer.x2, 7); close(longer.y2, 9);
    const turned = resizeDrawingLine(line, { angle: 90 });
    close(turned.x2, 1); close(turned.y2, 6);
    assert.equal(resizeDrawingLine(line, { length: 0 }), null);
    assert.equal(resizeDrawingLine(line, { angle: Number.NaN }), null);
});

test('block reference rotation and scale', () => {
    const transform = { a: 0, b: 2, c: -2, d: 0, e: 5, f: 6 };
    const described = describeDrawingBlockTransform(transform);
    close(described.rotation, 90); close(described.scale, 2);
    assert.equal(described.editable, true);
    const next = updateDrawingBlockTransform(transform, { rotation: 0, scale: 3 });
    close(next.a, 3); close(next.b, 0); close(next.c, 0); close(next.d, 3);
    assert.equal(next.e, 5); assert.equal(next.f, 6);
});

test('mirrored or stretched block references are not editable', () => {
    assert.equal(describeDrawingBlockTransform({ a: -1, b: 0, c: 0, d: 1 }).editable, false);
    assert.equal(describeDrawingBlockTransform({ a: 2, b: 0, c: 0, d: 1 }).editable, false);
    assert.equal(updateDrawingBlockTransform({ a: 2, b: 0, c: 0, d: 1 }, { rotation: 10 }), null);
    assert.equal(updateDrawingBlockTransform({ a: 1, b: 0, c: 0, d: 1 }, { scale: 0 }), null);
});

test('block reference rotation follows the UCS', () => {
    const ucs = { x: 0, y: 0, rotation: 30 };
    const next = updateDrawingBlockTransform({ a: 1, b: 0, c: 0, d: 1 }, { rotation: 0 }, ucs);
    close(describeDrawingBlockTransform(next, ucs).rotation, 0);
    close(describeDrawingBlockTransform(next).rotation, 30);
});

test('selection breakdown by type', () => {
    assert.deepEqual(summarizeDrawingSelectionTypes([{ type: 'line' }, { type: 'circle' }, { type: 'line' }]),
        [{ type: 'line', count: 2 }, { type: 'circle', count: 1 }]);
    assert.deepEqual(summarizeDrawingSelectionTypes([]), []);
});
