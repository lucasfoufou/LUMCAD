import assert from 'node:assert/strict';
import test from 'node:test';

import { drawingZoomWindowBounds, parseDrawingZoomInput } from './drawingZoomCommand.js';

test('ZOOM accepts AutoCAD keywords in English and French, and factors', () => {
    assert.deepEqual(parseDrawingZoomInput(''), { action: 'prompt' });
    for (const keyword of ['E', 'extents', 'A', 'ALL', 'étendu', 'TOUT']) assert.deepEqual(parseDrawingZoomInput(keyword), { action: 'extents' });
    for (const keyword of ['W', 'window', 'F', 'Fenêtre']) assert.deepEqual(parseDrawingZoomInput(keyword), { action: 'window' });
    assert.deepEqual(parseDrawingZoomInput('2'), { action: 'factor', factor: 2 });
    assert.deepEqual(parseDrawingZoomInput('0,5'), { action: 'factor', factor: 0.5 });
    assert.deepEqual(parseDrawingZoomInput('2x'), { action: 'factor', factor: 2 });
    for (const invalid of ['0', '-2', 'Q', '2;3', '10000']) assert.equal(parseDrawingZoomInput(invalid), null);
});

test('zoom windows normalize corners and reject a single point', () => {
    assert.deepEqual(drawingZoomWindowBounds({ x: 4, y: 1 }, { x: 0, y: 3 }), { minX: 0, minY: 1, maxX: 4, maxY: 3 });
    assert.equal(drawingZoomWindowBounds({ x: 1, y: 1 }, { x: 1, y: 1 }), null);
    assert.equal(drawingZoomWindowBounds(null, { x: 1, y: 1 }), null);
});
