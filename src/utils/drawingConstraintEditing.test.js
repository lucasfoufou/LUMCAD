import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { prepareDrawingConstraintEdit } from './drawingConstraintEditing.js';
import { commitDrawingHistoryState, undoDrawingHistoryState, redoDrawingHistoryState } from './drawingHistory.js';
import { createDrawingBlockEditDraft, saveDrawingBlockEdit } from './drawingBlockEditing.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function fixture() {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'a', type: 'line', layerId: content.activeLayerId, x1: 0, y1: 0, x2: 4, y2: 0 },
        { id: 'b', type: 'line', layerId: content.activeLayerId, x1: 4, y1: 0, x2: 5, y2: 2 }];
    content.geometricConstraints = [
        { id: 'horizontal', type: 'horizontal', refs: [{ entityId: 'a' }] },
        { id: 'join', type: 'coincident', refs: [{ entityId: 'a', point: 'end' }, { entityId: 'b', point: 'start' }] },
    ];
    return content;
}
const edit = (content, id, patch) => ({ ...content, entities: content.entities.map(entity => entity.id === id ? { ...entity, ...patch } : entity) });

test('a moved grip remains exact while the related endpoint and neighboring object follow', () => {
    const before = fixture();
    const result = prepareDrawingConstraintEdit(before, edit(before, 'a', { y2: 2 }));
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(result.content.entities[0].y2, 2);
    near(result.content.entities[0].y1, 2); near(result.content.entities[1].y1, 2);
    assert.equal(before.entities[0].y1, 0);
});

test('a fixed relation rejects a driven edit without changing undo, redo or coalescing', () => {
    const before = fixture();
    before.geometricConstraints.push({ id: 'fix', type: 'fix', refs: [{ entityId: 'a', point: 'end' }], values: [4, 0] });
    const state = { past: [{ ...before, metadata: { previous: true } }], present: before, future: [before], coalesceKey: 'drag' };
    const rejected = commitDrawingHistoryState(state, edit(before, 'a', { y2: 1 }), { coalesceKey: 'drag' });
    assert.equal(rejected.present, before); assert.equal(rejected.past, state.past); assert.equal(rejected.future, state.future);
    assert.equal(rejected.coalesceKey, 'drag'); assert.equal(rejected.rejection.kind, 'constraint');
});

test('constraint propagation shares a single coalesced history entry', () => {
    const before = fixture();
    const state = { past: [], present: { content: before, layouts: [], pageSetups: [] }, future: [], coalesceKey: null };
    const first = commitDrawingHistoryState(state, { ...state.present, content: edit(before, 'a', { y2: 1 }) }, { coalesceKey: 'drag' });
    const second = commitDrawingHistoryState(first, { ...first.present, content: edit(first.present.content, 'a', { y2: 2 }) }, { coalesceKey: 'drag' });
    assert.equal(second.past.length, 1); assert.equal(second.past[0], state.present);
    assert.equal(second.present.content.entities[0].y2, 2); near(second.present.content.entities[1].y1, 2);
    assert.equal(second.future.length, 0);
    const undone = undoDrawingHistoryState(second);
    assert.equal(undone.present, state.present);
    const redone = redoDrawingHistoryState(undone);
    assert.equal(redone.present, second.present);
    assert.equal(redone.future.length, 0);
});

test('deletion removes related constraints in the same edit; same-ID topology loss is refused', () => {
    const before = fixture();
    const removed = prepareDrawingConstraintEdit(before, { ...before, entities: before.entities.filter(entity => entity.id !== 'b') });
    assert.deepEqual(removed.content.geometricConstraints.map(constraint => constraint.id), ['horizontal']);
    const incompatible = { ...before, entities: before.entities.map(entity => entity.id === 'a'
        ? { id: 'a', type: 'circle', layerId: entity.layerId, cx: 0, cy: 0, r: 2 } : entity) };
    assert.equal(prepareDrawingConstraintEdit(before, incompatible).error, 'definition');
    assert.equal(prepareDrawingConstraintEdit(before, { ...before, geometricConstraints: {} }).error, 'definition');
});

test('unrelated geometry, appearance and layout edits do not solve untouched archive components', () => {
    const before = edit(fixture(), 'a', { y1: 1 });
    before.entities.push({ id: 'other', type: 'point', layerId: before.activeLayerId, x: 20, y: 30 });
    const next = edit(before, 'other', { x: 25 });
    assert.equal(prepareDrawingConstraintEdit(before, next).content, next);
    const appearance = edit(before, 'a', { color: '#123456' });
    assert.equal(prepareDrawingConstraintEdit(before, appearance).content, appearance);
    const state = { past: [], present: { content: before, layouts: [], pageSetups: [] }, future: [], coalesceKey: null };
    const changed = commitDrawingHistoryState(state, { ...state.present, layouts: [{ id: 'new' }] });
    assert.equal(changed.present.content, before);
});

test('adding a relation solves its component without treating all existing coordinates as drivers', () => {
    const before = fixture(); before.geometricConstraints = []; before.entities[0].y2 = 1;
    const next = { ...before, geometricConstraints: [{ id: 'horizontal', type: 'horizontal', refs: [{ entityId: 'a' }] }] };
    const result = prepareDrawingConstraintEdit(before, next);
    assert.ok(!result.error); near(result.content.entities[0].y1, result.content.entities[0].y2);
});

test('explicit whole-document replacement preserves a validated snapshot without constraint solving', () => {
    const before = fixture();
    const imported = edit(before, 'a', { y2: 1 });
    const state = { past: [], present: { content: before, layouts: [], pageSetups: [] }, future: [], coalesceKey: null };
    const next = commitDrawingHistoryState(state, { ...state.present, content: imported }, { preserveConstraintSnapshot: true });
    assert.deepEqual(next.present.content.entities, imported.entities);
    assert.equal(next.past[0], state.present);
});

test('BEDIT isolates model constraints and preserves them on saving an unrelated block', () => {
    const content = fixture();
    content.blocks = [{ id: 'symbol', name: 'Symbol', entities: [{ ...content.entities[0], id: 'local' }] }];
    const draft = createDrawingBlockEditDraft(content, 'symbol');
    assert.deepEqual(draft.content.geometricConstraints, []);
    const saved = saveDrawingBlockEdit(content, 'symbol', draft.content);
    assert.ok(!saved.error); assert.deepEqual(saved.content.geometricConstraints, content.geometricConstraints);
});
