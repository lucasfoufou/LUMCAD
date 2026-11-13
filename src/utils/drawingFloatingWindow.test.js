import test from 'node:test';
import assert from 'node:assert/strict';
import { clampFloatingWindowPosition, moveFloatingWindowByKey } from './drawingFloatingWindow.js';

const viewport = { width: 1000, height: 680 };
const size = { width: 360, height: 500 };

test('floating window keeps a position that fits', () => {
    assert.deepEqual(clampFloatingWindowPosition({ left: 200, top: 100 }, size, viewport, 44), { left: 200, top: 100 });
});

test('floating window header stays reachable', () => {
    assert.deepEqual(clampFloatingWindowPosition({ left: 2000, top: 2000 }, size, viewport, 44), { left: 872, top: 632 });
    assert.deepEqual(clampFloatingWindowPosition({ left: -2000, top: -50 }, size, viewport, 44), { left: -232, top: 44 });
});

test('floating window without a position keeps its default placement', () => {
    assert.equal(clampFloatingWindowPosition(null, size, viewport), null);
});

test('floating window moves with the arrow keys', () => {
    assert.deepEqual(moveFloatingWindowByKey({ left: 10, top: 10 }, 'ArrowRight'), { left: 20, top: 10 });
    assert.deepEqual(moveFloatingWindowByKey({ left: 10, top: 60 }, 'ArrowUp', true), { left: 10, top: 10 });
    assert.equal(moveFloatingWindowByKey({ left: 10, top: 10 }, 'Enter'), null);
});
