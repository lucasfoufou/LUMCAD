import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveToolbarActiveOperation, resolveToolbarLayout, toolbarContentHeight } from './drawingToolbarLayout.js';

const groups = [2, 9, 4, 14];

test('tool rail measures the height of one and two columns', () => {
    assert.deepEqual(toolbarContentHeight(groups, 1), 29 * 34 + 3 * 9 + 12);
    assert.deepEqual(toolbarContentHeight(groups, 2), (1 + 5 + 2 + 7) * 34 + 3 * 9 + 12);
    assert.deepEqual(toolbarContentHeight([0, 3], 1), 3 * 34 + 12);
});

test('tool rail keeps one column when every tool fits', () => {
    assert.deepEqual(resolveToolbarLayout(groups, 2000), { columns: 1, overflow: false });
});

test('tool rail switches to two columns at the minimum window height', () => {
    // 680 px window: 44 px header and 30 px status bar.
    assert.deepEqual(resolveToolbarLayout(groups, 606), { columns: 2, overflow: false });
});

test('tool rail reports overflow when even two columns do not fit', () => {
    assert.deepEqual(resolveToolbarLayout(groups, 300), { columns: 2, overflow: true });
});

test('tool rail ignores an unknown height', () => {
    assert.deepEqual(resolveToolbarLayout(groups, 0), { columns: 1, overflow: false });
    assert.deepEqual(resolveToolbarLayout(groups, undefined), { columns: 1, overflow: false });
});

test('tool rail identifies the running operation', () => {
    assert.deepEqual(resolveToolbarActiveOperation(null), null);
    assert.deepEqual(resolveToolbarActiveOperation({ type: 'move' }), 'move');
    assert.deepEqual(resolveToolbarActiveOperation({ type: 'array', arrayKind: 'polar' }), 'arrayPolar');
    assert.deepEqual(resolveToolbarActiveOperation({ type: 'array', arrayKind: 'path' }), 'arrayPath');
    assert.deepEqual(resolveToolbarActiveOperation({ type: 'inquiry', mode: 'area' }), 'inquiry:area');
});
