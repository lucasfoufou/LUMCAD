import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument } from './lcadDocument.js';
import { commitDrawingHistoryState, undoDrawingHistoryState, redoDrawingHistoryState, updateDrawingHistoryMetadata } from './drawingHistory.js';
const initial = document => ({ past: [], present: document, future: [], coalesceKey: null });

test('whole-document import restores name, assets and layouts together with exact undo/redo', () => {
    const before = createLcadDocument({ name: 'Before' }); before.assets = [{ id: 'image', data: 'old' }];
    const after = structuredClone(before); after.name = 'After'; after.assets[0].data = 'new'; after.layouts[0].name = 'New layout';
    let state = commitDrawingHistoryState(initial(before), after, { applyCreationStyles: false, preserveConstraintSnapshot: true });
    assert.deepEqual(undoDrawingHistoryState(state).present, before);
    assert.deepEqual(redoDrawingHistoryState(undoDrawingHistoryState(state)).present, after);
    const partial = commitDrawingHistoryState(state, { content: after.content, layouts: after.layouts });
    assert.equal(partial.present.name, 'After'); assert.deepEqual(partial.present.assets, after.assets);
});

test('ordinary cache additions do not destroy older imported asset versions or create undo steps', () => {
    const before = createLcadDocument(); before.assets = [{ id: 'image', data: 'old' }];
    const after = { ...before, assets: [{ id: 'image', data: 'new' }] };
    const committed = commitDrawingHistoryState(initial(before), after);
    const state = updateDrawingHistoryMetadata(committed, 'assets', assets => [...assets, { id: 'extra', data: 'extra' }]);
    assert.equal(state.past.length, 1);
    assert.deepEqual(state.present.assets.map(a => a.data), ['new', 'extra']);
    assert.deepEqual(undoDrawingHistoryState(state).present.assets.map(a => a.data), ['old', 'extra']);
    assert.deepEqual(committed.present.assets, [{ id: 'image', data: 'new' }]);
    const renamed = updateDrawingHistoryMetadata(state, 'name', 'User rename');
    assert.equal(undoDrawingHistoryState(renamed).present.name, 'User rename');
    const future = updateDrawingHistoryMetadata(undoDrawingHistoryState(state), 'assets', assets => [...assets, { id: 'third', data: 'third' }]);
    assert.deepEqual(redoDrawingHistoryState(future).present.assets.map(a => a.data), ['new', 'extra', 'third']);
});
