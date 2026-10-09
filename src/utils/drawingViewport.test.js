import test from 'node:test';
import assert from 'node:assert/strict';

import { drawingViewBoxScreenTransform, drawingVisibleViewBox, zoomDrawingViewBox } from './drawingViewport.js';

const canvas = { width: 800, height: 400 };

function screenPoint(point, viewBox) {
    const scale = Math.min(canvas.width / viewBox.width, canvas.height / viewBox.height);
    return {
        x: (canvas.width - viewBox.width * scale) / 2 + (point.x - viewBox.x) * scale,
        y: (canvas.height - viewBox.height * scale) / 2 + (point.y - viewBox.y) * scale,
    };
}

function assertMapsLike(rendered, current) {
    const transform = drawingViewBoxScreenTransform(rendered, current, canvas);
    for (const point of [{ x: 0, y: 0 }, { x: 12.5, y: -3 }, { x: 40, y: 22 }]) {
        const before = screenPoint(point, rendered);
        const expected = screenPoint(point, current);
        assert.ok(Math.abs(transform.x + before.x * transform.scale - expected.x) < 1e-9);
        assert.ok(Math.abs(transform.y + before.y * transform.scale - expected.y) < 1e-9);
    }
}

test('screen transform reproduces a pan of the logical view', () => {
    assertMapsLike({ x: 0, y: 0, width: 40, height: 20 }, { x: 3, y: -2, width: 40, height: 20 });
});

test('screen transform reproduces zooms, including letterboxed aspect ratios', () => {
    const rendered = { x: 0, y: 0, width: 40, height: 20 };
    assertMapsLike(rendered, zoomDrawingViewBox(rendered, 0.5, { x: 10, y: 5 }, canvas));
    assertMapsLike({ x: 0, y: 0, width: 10, height: 20 }, { x: 2, y: 1, width: 5, height: 10 });
});

test('identical views need no transform', () => {
    const viewBox = { x: 0, y: 0, width: 40, height: 20 };
    assert.equal(drawingViewBoxScreenTransform(viewBox, viewBox, canvas), null);
    assert.equal(drawingViewBoxScreenTransform(viewBox, { ...viewBox, x: 1 }, { width: 0, height: 0 }), null);
});

test('visible area includes the letterboxed margins of a fitted view', () => {
    assert.deepEqual(drawingVisibleViewBox({ x: 0, y: 0, width: 10, height: 10 }, canvas), { x: -5, y: 0, width: 20, height: 10 });
    assert.deepEqual(drawingVisibleViewBox({ x: 0, y: 0, width: 40, height: 10 }, canvas), { x: 0, y: -5, width: 40, height: 20 });
});
