import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { defineNamedDrawingBlock, insertNamedDrawingBlock } from './drawingNamedBlocks.js';
import { createDrawingBlockEditDraft, saveDrawingBlockEdit } from './drawingBlockEditing.js';
import { createDrawingId } from './drawingDocument.js';

function fixture() {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 2 }];
    const result = defineNamedDrawingBlock(content, ['line'], { name: 'Door', basePoint: { x: 0, y: 0 } });
    return insertNamedDrawingBlock(result.content, 'Door', { x: 10, y: 20 }).content;
}

test('block edit draft is isolated and saving updates every instance without changing their IDs/transforms', () => {
    const root = fixture();
    const before = JSON.stringify(root);
    const draft = createDrawingBlockEditDraft(root, 'Door');
    assert.equal(draft.content.entities.length, 1);
    draft.content.entities[0].x2 = 12;
    assert.equal(JSON.stringify(root), before);
    const result = saveDrawingBlockEdit(root, draft.blockId, draft.content);
    assert.equal(result.changed, true);
    assert.equal(result.content.blocks[0].id, draft.blockId);
    assert.equal(result.content.blocks[0].entities[0].id, 'line');
    for (let i = 0; i < root.entities.length; i++) {
        assert.equal(result.content.entities[i].id, root.entities[i].id);
        assert.deepEqual(result.content.entities[i].transform, root.entities[i].transform);
        assert.equal(result.content.entities[i].definitionBounds.maxX, 12);
    }
    assert.equal(JSON.stringify(root), before);
});

test('unchanged edit saves no model history step; empty definitions can be saved', () => {
    const root = fixture();
    const draft = createDrawingBlockEditDraft(root, 'Door');
    assert.equal(saveDrawingBlockEdit(root, draft.blockId, draft.content).changed, false);
    const cleared = { ...draft.content, entities: [] };
    const result = saveDrawingBlockEdit(root, draft.blockId, cleared);
    assert.equal(result.content.blocks[0].entities.length, 0);
    assert.equal(result.content.entities[0].definitionBounds, undefined);
});

test('save refuses direct/indirect cycles and missing local dependency sources atomically', () => {
    const root = fixture();
    const draft = createDrawingBlockEditDraft(root, 'Door');
    const recursive = insertNamedDrawingBlock(draft.content, 'Door', { x: 0, y: 0 }).content;
    assert.equal(saveDrawingBlockEdit(root, draft.blockId, recursive).error, 'cycle');
    const otherId = createDrawingId('block');
    const indirect = { ...draft.content, blocks: [...draft.content.blocks, { id: otherId, name: 'Other', entities: [{ ...root.entities[0], id: 'nested' }] }],
        entities: [{ ...root.entities[0], blockId: otherId }] };
    assert.equal(saveDrawingBlockEdit(root, draft.blockId, indirect).error, 'cycle');
    const missing = { ...draft.content, entities: [{ id: 'dimension', type: 'dimension', sourceId: 'missing' }] };
    assert.equal(saveDrawingBlockEdit(root, draft.blockId, missing).error, 'dependency');
    assert.equal(root.blocks[0].entities[0].x2, 4);
});

test('save retains model-only layers, adopts new local resources and preserves model geometry', () => {
    const root = fixture();
    const untouched = { id: 'outside', type: 'circle', layerId: 'outside-layer', cx: 7, cy: 8, r: 2 };
    root.entities.push(untouched);
    root.layers.push({ ...root.layers[0], id: 'outside-layer', name: 'Outside' });
    const draft = createDrawingBlockEditDraft(root, 'Door');
    draft.content.layers = draft.content.layers.filter(layer => layer.id !== 'outside-layer');
    draft.content.layers.push({ ...root.layers[0], id: 'new-layer', name: 'New' });
    draft.content.entities[0].layerId = 'new-layer';
    const result = saveDrawingBlockEdit(root, draft.blockId, draft.content);
    assert.ok(result.content.layers.some(layer => layer.id === 'outside-layer'));
    assert.ok(result.content.layers.some(layer => layer.id === 'new-layer'));
    assert.deepEqual(result.content.entities.find(entity => entity.id === 'outside'), untouched);
    assert.equal(result.content.blocks[0].entities[0].layerId, 'new-layer');
});
