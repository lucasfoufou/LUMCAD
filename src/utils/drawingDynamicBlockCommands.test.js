import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { defineNamedDrawingBlock } from './drawingNamedBlocks.js';
import { createDrawingBlockEditDraft, saveDrawingBlockEdit } from './drawingBlockEditing.js';
import { runDrawingDynamicBlockCommand } from './drawingDynamicBlockCommands.js';
import { evaluateDrawingDynamicBlock } from './drawingDynamicBlocks.js';

function fixture() {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'edge', type: 'line', layerId: content.activeLayerId, x1: 0, y1: 0, x2: 2, y2: 0 }];
    return defineNamedDrawingBlock(content, ['edge'], { name: 'Dynamic', basePoint: { x: 0, y: 0 } }).content;
}

test('BEDIT parameter/action authoring saves one reusable definition and edits its instances', () => {
    const root = fixture(); const draft = createDrawingBlockEditDraft(root, 'Dynamic');
    const parameter = runDrawingDynamicBlockCommand(draft.content, 'blockParameter', 'SET Width distance 2 MIN 1 MAX 10 STEP 0.5', [], { editing: true });
    assert.ok(parameter.content);
    const action = runDrawingDynamicBlockCommand(parameter.content, 'blockAction', 'SET stretch STRETCH Width 1 0 1 -1 3 1', ['edge'], { editing: true });
    assert.ok(action.content);
    assert.equal(root.blocks[0].dynamic, undefined);
    const saved = saveDrawingBlockEdit(root, draft.blockId, action.content);
    assert.ok(saved.content.blocks[0].dynamic);
    const ids = [saved.content.entities[0].id];
    const edited = runDrawingDynamicBlockCommand(saved.content, 'blockParameter', 'SET Width 5', ids);
    assert.equal(edited.content.entities[0].definitionBounds.maxX, 5);
    const reset = runDrawingDynamicBlockCommand(edited.content, 'resetBlock', '', ids);
    assert.equal(reset.content.entities[0].definitionBounds.maxX, 2);
    assert.equal(reset.content.entities[0].dynamicValues, undefined);
    const reopened = createDrawingBlockEditDraft(saved.content, 'Dynamic');
    assert.deepEqual(reopened.content.blockDynamicDraft, saved.content.blocks[0].dynamic);
    assert.equal(saveDrawingBlockEdit(saved.content, reopened.blockId, reopened.content).changed, false);
});

test('invalid authoring and referenced parameter deletion leave the draft unchanged', () => {
    const draft = createDrawingBlockEditDraft(fixture(), 'Dynamic').content;
    const run = (content, command, input, ids = []) => runDrawingDynamicBlockCommand(content, command, input, ids, { editing: true });
    let content = run(draft, 'blockParameter', 'SET Width distance 2').content;
    content = run(content, 'blockAction', 'SET move MOVE Width 1 0', ['edge']).content;
    const saved = JSON.stringify(content);
    for (const input of ['SET bad unknown 3', 'SET Width distance -2', 'DELETE Width']) assert.ok(run(content, 'blockParameter', input).error);
    assert.ok(run(content, 'blockAction', 'SET missing MOVE Width 1 0', ['absent']).error);
    assert.ok(run(content, 'blockAction', 'SET move MOVE Width 0 0', ['edge']).error);
    assert.equal(JSON.stringify(content), saved);
    content = run(content, 'blockAction', 'DELETE move').content;
    content = run(content, 'blockParameter', 'DELETE Width').content;
    assert.deepEqual(content.blockDynamicDraft, { parameters: [], actions: [] });
});

test('typed point, flip and choice parameter commands retain their values', () => {
    let content = createDrawingBlockEditDraft(fixture(), 'Dynamic').content;
    for (const input of ['SET Position point 1 2', 'SET Reverse flip OFF', 'SET Variant choice "Wide door" "Wide door" Narrow']) {
        content = runDrawingDynamicBlockCommand(content, 'blockParameter', input, [], { editing: true }).content;
        assert.ok(content, input);
    }
    assert.deepEqual(content.blockDynamicDraft.parameters.map(item => item.default), [{ x: 1, y: 2 }, false, 'Wide door']);
    assert.ok(runDrawingDynamicBlockCommand(content, 'blockAction', 'SET shift MOVE Position', ['edge'], { editing: true }).content);
});

test('lookup authoring fills other variants with defaults and BTABLE applies a selected row', () => {
    const root = fixture(); const draft = createDrawingBlockEditDraft(root, 'Dynamic');
    let content = draft.content;
    const run = (command, input, ids = []) => {
        const result = runDrawingDynamicBlockCommand(content, command, input, ids, { editing: true });
        assert.ok(result.content, JSON.stringify(result)); content = result.content;
    };
    run('blockParameter', 'SET Width distance 2 MIN 1 MAX 10');
    run('blockParameter', 'SET Variant choice Small Small Large');
    run('blockAction', 'SET move MOVE Width 1 0', ['edge']);
    run('blockLookupTable', 'SET Sizes Variant Large Width 5');
    assert.deepEqual(content.blockDynamicDraft.lookups[0].rows, [{ key: 'Small', values: { Width: 2 } }, { key: 'Large', values: { Width: 5 } }]);
    const saved = saveDrawingBlockEdit(root, draft.blockId, content).content;
    const ids = [saved.entities[0].id];
    const result = runDrawingDynamicBlockCommand(saved, 'blockTable', 'APPLY Sizes Large', ids);
    assert.equal(result.content.entities[0].dynamicValues.Width, 5);
    assert.equal(result.content.entities[0].definitionBounds.maxX, 5);
    assert.equal(runDrawingDynamicBlockCommand(saved, 'blockParameter', 'SET Width 7', ids).error, 'driven');
    run('blockTable', 'DELETE Sizes');
    assert.equal(content.blockDynamicDraft.lookups, undefined);
});

test('visibility authoring supports empty states and leaves other choices visible', () => {
    const draft = createDrawingBlockEditDraft(fixture(), 'Dynamic');
    let content = runDrawingDynamicBlockCommand(draft.content, 'blockParameter', 'SET State choice On On Off', [], { editing: true }).content;
    content = runDrawingDynamicBlockCommand(content, 'blockVisibility', 'SET State Off', [], { editing: true }).content;
    const definition = { entities: content.entities, dynamic: content.blockDynamicDraft };
    assert.equal(evaluateDrawingDynamicBlock(definition).entities.length, 1);
    assert.equal(evaluateDrawingDynamicBlock(definition, { State: 'Off' }).entities.length, 0);
    const cleared = runDrawingDynamicBlockCommand(content, 'blockVisibility', 'DELETE', [], { editing: true });
    assert.equal(cleared.content.blockDynamicDraft.visibility, undefined);
    assert.equal(runDrawingDynamicBlockCommand(content, 'blockVisibility', 'SET State Missing', [], { editing: true }).error, 'values');
});
