import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultDrawingContent, copySelectedEntities, normalizeDrawingContent } from './drawingDocument.js';
import { createDrawingLeader, updateDrawingLeader, editDrawingLeaderGrip, drawingLeaderGrips } from './drawingLeaders.js';
import { transformDrawingEntityAffine, materializeDrawingBlockReference } from './drawingBlocks.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

function fixture() {
    return createDrawingLeader(createDefaultDrawingContent(), [[{ x: 0, y: 0 }, { x: 3, y: 2 }]], { x: 5, y: 2 }, { text: 'Roof note' });
}

test('leaders reuse native block, text, line and hatch geometry with independently editable copies', () => {
    const result = fixture();
    assert.ok(result.content);
    const entity = result.content.entities[0];
    const parts = materializeDrawingBlockReference(entity, result.content.blocks);
    assert.ok(parts.some(part => part.type === 'text' && part.text === 'Roof note'));
    assert.ok(parts.some(part => part.type === 'hatch'));
    const copy = copySelectedEntities(result.content, [entity.id]);
    const updated = updateDrawingLeader(copy.content, copy.selectedIds[0], { text: 'Independent' });
    assert.equal(updated.content.entities[0].blockId, entity.blockId);
    assert.notEqual(updated.content.entities[1].blockId, entity.blockId);
    assert.equal(updated.content.blocks.find(block => block.id === entity.blockId).entities.at(-1).text, 'Roof note');
    assert.equal(updated.content.blocks.find(block => block.id === updated.content.entities[1].blockId).entities.at(-1).text, 'Independent');
});

test('moving leader content retains arrow positions; branch grips follow general affine transforms', () => {
    const result = fixture();
    const entity = result.content.entities[0];
    const shifted = editDrawingLeaderGrip(result.content, entity.id, 'leader-content', { x: 10, y: 4 });
    const grips = drawingLeaderGrips(shifted.content.entities[0]);
    assert.deepEqual(grips.find(grip => grip.id === 'leader-0-0'), { id: 'leader-0-0', x: 0, y: 0 });
    assert.deepEqual(grips[0], { id: 'leader-content', x: 10, y: 4 });
    const transformed = transformDrawingEntityAffine(entity, { a: 2, b: 0.5, c: 1, d: 3, e: 10, f: -5 });
    const content = { ...result.content, entities: [transformed] };
    const edited = editDrawingLeaderGrip(content, entity.id, 'leader-0-0', { x: 4, y: 7 });
    const arrow = drawingLeaderGrips(edited.content.entities[0]).find(grip => grip.id === 'leader-0-0');
    assert.ok(Math.hypot(arrow.x - 4, arrow.y - 7) < 1e-9);
});

test('leader metadata and geometry survive normalization and archive persistence', () => {
    const result = fixture();
    const document = { ...createLcadDocument(), content: result.content };
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content;
    assert.deepEqual(loaded.entities[0].leader, result.content.entities[0].leader);
    assert.equal(loaded.blocks[0].entities.at(-1).text, 'Roof note');
    const malformed = normalizeDrawingContent({ ...loaded, entities: [{ ...loaded.entities[0], leader: { version: 1, branches: [] } }] });
    assert.equal(malformed.entities[0].leader, undefined);
    assert.equal(createDrawingLeader(createDefaultDrawingContent(), [null], { x: 0, y: 0 }).error, 'invalid');
});

test('leader alignment and collection preserve arrows and collect contents atomically', async () => {
    const { alignDrawingLeaders, collectDrawingLeaders } = await import('./drawingLeaders.js');
    const first = fixture();
    const second = createDrawingLeader(first.content, [[{ x: 8, y: 0 }, { x: 9, y: 3 }]], { x: 12, y: 3 }, { text: 'Second' });
    const ids = second.content.entities.map(entity => entity.id);
    const aligned = alignDrawingLeaders(second.content, ids, 'X', 2);
    assert.deepEqual(drawingLeaderGrips(aligned.content.entities[1])[0], { id: 'leader-content', x: 5, y: 4 });
    assert.deepEqual(drawingLeaderGrips(aligned.content.entities[1])[1], { id: 'leader-0-0', x: 8, y: 0 });
    const collected = collectDrawingLeaders(aligned.content, ids);
    assert.equal(collected.content.entities.length, 1);
    assert.equal(collected.content.entities[0].id, ids[0]);
    assert.equal(collected.content.entities[0].leader.branches.length, 2);
    const parts = materializeDrawingBlockReference(collected.content.entities[0], collected.content.blocks, { recursive: true });
    assert.deepEqual(parts.filter(part => part.type === 'text').map(part => part.text), ['Roof note', 'Second']);
    const locked = { ...second.content, layers: second.content.layers.map(layer => ({ ...layer, locked: true })) };
    assert.equal(collectDrawingLeaders(locked, ids).error, 'selection');
    assert.equal(alignDrawingLeaders(second.content, ids, 'Z').error, 'selection');
});

test('leader clipboard remaps nested annotation definitions and named style presets normalize', async () => {
    const { createDrawingClipboardPayload, pasteDrawingClipboardPayload } = await import('./drawingClipboard.js');
    const { collectDrawingLeaders } = await import('./drawingLeaders.js');
    const first = fixture();
    const second = createDrawingLeader(first.content, [[{ x: 1, y: 5 }, { x: 3, y: 6 }]], { x: 5, y: 6 }, { text: 'Nested' });
    const collected = collectDrawingLeaders(second.content, second.content.entities.map(entity => entity.id));
    const payload = createDrawingClipboardPayload({ content: collected.content, assets: [] }, collected.selectedIds);
    const target = { ...createDefaultDrawingContent(), blocks: collected.content.blocks.map(block => ({ ...block, name: `${block.name}-conflict` })) };
    const pasted = pasteDrawingClipboardPayload({ content: target, assets: [] }, payload, { mode: 'original' });
    assert.ok(pasted.entities[0].leader);
    assert.notEqual(pasted.entities[0].blockId, collected.content.entities[0].blockId);
    const parts = materializeDrawingBlockReference(pasted.entities[0], pasted.content.blocks, { recursive: true });
    assert.deepEqual(parts.filter(part => part.type === 'text').map(part => part.text), ['Roof note', 'Nested']);
    const normalized = normalizeDrawingContent({ ...collected.content, leaderStyles: [{ name: 'Standard', textSize: 0.5 }, { name: 'standard' }, { name: '' }] });
    assert.equal(normalized.leaderStyles.length, 1);
    assert.equal(normalized.leaderStyles[0].textSize, 0.5);
});
