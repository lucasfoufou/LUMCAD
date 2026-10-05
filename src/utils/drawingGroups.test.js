import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultDrawingContent, normalizeDrawingContent, applySelectionOperation, deleteSelectedEntities } from './drawingDocument.js';
import { expandDrawingGroupSelection, normalizeDrawingGroups, runDrawingGroupCommand } from './drawingGroups.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

function fixture() {
    const content = createDefaultDrawingContent();
    return { ...content, entities: ['a', 'b', 'c'].map((id, i) => ({ id, type: 'line', layerId: content.activeLayerId, x1: i, y1: 0, x2: i, y2: 2 })) };
}

test('group membership is non-destructive, editable and case-insensitively unique', () => {
    const source = fixture();
    const grouped = runDrawingGroupCommand(source, ['a', 'b'], 'group', '"Roof panels"').content;
    assert.equal(grouped.entities, source.entities);
    assert.deepEqual(source.groups, []);
    assert.equal(runDrawingGroupCommand(grouped, ['c'], 'group', '"ROOF PANELS"').error, 'duplicate');
    const added = runDrawingGroupCommand(grouped, ['c'], 'groupEdit', '"Roof panels" ADD').content;
    assert.deepEqual(added.groups[0].entityIds, ['a', 'b', 'c']);
    const removed = runDrawingGroupCommand(added, ['b'], 'groupEdit', '"Roof panels" REMOVE').content;
    assert.deepEqual(removed.groups[0].entityIds, ['a', 'c']);
    const renamed = runDrawingGroupCommand(removed, [], 'groupEdit', '"Roof panels" RENAME Roof').content;
    assert.equal(renamed.groups[0].id, grouped.groups[0].id);
    const ungrouped = runDrawingGroupCommand(renamed, [], 'ungroup', 'roof').content;
    assert.deepEqual(ungrouped.groups, []);
    assert.equal(ungrouped.entities, source.entities);
});

test('overlapping group selection expands transitively and Shift removes the same component', () => {
    let content = runDrawingGroupCommand(fixture(), ['a', 'b'], 'group', 'first').content;
    content = runDrawingGroupCommand(content, ['b', 'c'], 'group', 'second').content;
    assert.deepEqual(expandDrawingGroupSelection(content, ['a']), ['a', 'b', 'c']);
    assert.deepEqual(applySelectionOperation(['a', 'b', 'c'], expandDrawingGroupSelection(content, ['a']), 'remove'), []);
    content = runDrawingGroupCommand(content, [], 'groupEdit', 'second OFF').content;
    assert.deepEqual(expandDrawingGroupSelection(content, ['a']), ['a', 'b']);
    assert.deepEqual(expandDrawingGroupSelection(content, ['c']), ['c']);
    content = { ...content, layers: [...content.layers, { id: 'hidden', visible: false }], entities: content.entities.map(entity => entity.id === 'b' ? { ...entity, layerId: 'hidden' } : entity) };
    assert.deepEqual(expandDrawingGroupSelection(content, ['a']), ['a']);
});

test('normalization drops invalid, duplicate and stale membership; undo snapshots retain membership', () => {
    const original = runDrawingGroupCommand(fixture(), ['a', 'b'], 'group', 'first').content;
    const deleted = normalizeDrawingContent(deleteSelectedEntities(original, ['a']));
    assert.deepEqual(deleted.groups[0].entityIds, ['b']);
    assert.deepEqual(original.groups[0].entityIds, ['a', 'b']);
    assert.deepEqual(normalizeDrawingGroups([null, {}, ...original.groups, ...original.groups], original.entities), original.groups);
    assert.deepEqual(normalizeDrawingContent(deleteSelectedEntities(original, ['a', 'b'])).groups, []);
    assert.equal(runDrawingGroupCommand(original, [], 'group', 'new').error, 'selection');
    assert.equal(runDrawingGroupCommand(original, [], 'groupEdit', 'first WRONG').error, 'syntax');
});

test('named groups survive browser archive round trips with stable membership and selection flag', () => {
    let content = runDrawingGroupCommand(fixture(), ['a', 'b'], 'group', 'Roof').content;
    content = runDrawingGroupCommand(content, [], 'groupEdit', 'Roof OFF').content;
    const document = { ...createLcadDocument(), content };
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(loaded.content.groups, content.groups);
});
