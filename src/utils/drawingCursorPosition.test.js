import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDrawingCursorPosition } from './drawingCursorPosition.js';

test('cursor position uses the display units and the language separators', () => {
    assert.equal(formatDrawingCursorPosition({ x: 12.3456, y: -3.2 }, {}, 'fr'), '12,346 m ; -3,2 m');
    assert.equal(formatDrawingCursorPosition({ x: 12.3456, y: -3.2 }, {}, 'en'), '12.346 m, -3.2 m');
    assert.equal(formatDrawingCursorPosition({ x: 1.5, y: 0 }, { units: { display: 'mm', precision: 0 } }, 'en'), '1,500 mm, 0 mm');
});

test('cursor position is read in the UCS', () => {
    const settings = { ucs: { x: 10, y: 5, rotation: 0 } };
    assert.equal(formatDrawingCursorPosition({ x: 12, y: 5 }, settings, 'en'), '2 m, 0 m');
    assert.equal(formatDrawingCursorPosition({ x: Number.NaN, y: 0 }, settings, 'en'), '');
});
