import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { defineDrawingAttribute, editDrawingAttribute, syncDrawingAttributes } from './drawingAttributeOperations.js';
import { defineNamedDrawingBlock, insertNamedDrawingBlock } from './drawingNamedBlocks.js';
import { drawingAttributeValues, resolveDrawingAttributeText, tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { materializeDrawingBlockReference, resolveDrawingBlockChild, getDrawingBlockReferenceBounds, refreshDrawingBlockBounds } from './drawingBlocks.js';
import { drawingSnapEntities } from './drawingBlockSnapping.js';
import { createDrawingClipboardPayload, pasteDrawingClipboardPayload, drawingClipboardPayloadToSvg } from './drawingClipboard.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingBlockEditDraft, saveDrawingBlockEdit } from './drawingBlockEditing.js';

function fixture() {
    let content = createDefaultDrawingContent();
    content = defineDrawingAttribute(content, 'CODE "A-01" 0 0 HEIGHT 0.5 PROMPT "Door number"').content;
    content = defineDrawingAttribute(content, 'TYPE "Door" 0 1 CONSTANT').content;
    content = defineDrawingAttribute(content, 'SECRET "Hidden" 0 2 INVISIBLE').content;
    const result = defineNamedDrawingBlock(content, content.entities.map(entity => entity.id), { name: 'Door', basePoint: { x: 0, y: 0 } });
    return insertNamedDrawingBlock(result.content, 'Door', { x: 10, y: 0 }).content;
}

test('definitions create independent insertion values, editable fields and fixed constants', () => {
    const content = fixture();
    const [first, second] = content.entities;
    assert.deepEqual(first.attributeValues, { CODE: 'A-01', TYPE: 'Door', SECRET: 'Hidden' });
    const edited = editDrawingAttribute(content, [first.id], 'code', 'A-02').content;
    assert.equal(edited.entities[0].attributeValues.CODE, 'A-02');
    assert.equal(edited.entities[1].attributeValues.CODE, 'A-01');
    assert.equal(content.entities[0].attributeValues.CODE, 'A-01');
    const materialized = materializeDrawingBlockReference(edited.entities[0], content.blocks);
    assert.equal(materialized[0].text, 'A-02');
    assert.equal(materialized[0].runs[0].text, 'A-02');
    assert.equal(materialized[0].attributeDefinition, undefined);
    assert.equal(editDrawingAttribute(content, [first.id], 'TYPE', 'Window').error, 'constant');
    assert.equal(editDrawingAttribute(content, [first.id, 'missing'], 'CODE', 'Value').error, 'selection');
    assert.equal(editDrawingAttribute(content, [first.id], 'UNKNOWN', 'Value').error, 'missing');
    assert.equal(editDrawingAttribute({ ...content, entities: [{ ...first, locked: true }, second] }, [first.id, second.id], 'CODE', 'A').error, 'selection');
});

test('attribute visibility affects nested rendering and snapping without erasing values', () => {
    const content = fixture();
    const block = content.blocks[0]; const reference = content.entities[0];
    const hidden = block.entities[2];
    assert.equal(resolveDrawingBlockChild(hidden, reference), null);
    assert.equal(resolveDrawingBlockChild(hidden, reference, 'all').text, 'Hidden');
    assert.equal(resolveDrawingBlockChild(block.entities[0], reference, 'off'), null);
    assert.equal(drawingSnapEntities(content).length, 4);
    assert.equal(drawingSnapEntities({ ...content, settings: { attributeDisplay: 'all' } }).length, 6);
    assert.equal(drawingSnapEntities({ ...content, settings: { attributeDisplay: 'off' } }).length, 0);
    const payload = createDrawingClipboardPayload({ content, assets: [] }, [reference.id]);
    const rendered = drawingClipboardPayloadToSvg(payload).split('</metadata>')[1];
    const visibleText = svg => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1].replace(/<[^>]+>/g, ''));
    assert.ok(visibleText(rendered).includes('A-01'));
    assert.ok(!visibleText(rendered).includes('Hidden'));
    const all = drawingClipboardPayloadToSvg({ ...payload, attributeDisplay: 'all' }).split('</metadata>')[1];
    const off = drawingClipboardPayloadToSvg({ ...payload, attributeDisplay: 'off' }).split('</metadata>')[1];
    assert.ok(visibleText(all).includes('Hidden'));
    assert.deepEqual(visibleText(off), []);
});

test('synchronization preserves values, adds defaults, removes stale tags and refreshes constants', () => {
    let content = fixture();
    content = editDrawingAttribute(content, [content.entities[0].id], 'CODE', 'Custom').content;
    const draft = createDrawingBlockEditDraft(content, 'Door');
    draft.content.entities = draft.content.entities.filter(entity => entity.attributeDefinition.tag !== 'SECRET')
        .map(entity => ({ ...entity, text: entity.attributeDefinition.constant ? 'New type' : 'New default' }));
    draft.content = defineDrawingAttribute(draft.content, 'NEW "New field" 0 3').content;
    const saved = saveDrawingBlockEdit(content, draft.blockId, draft.content).content;
    const synced = syncDrawingAttributes(saved, [], 'Door').content;
    assert.deepEqual(synced.entities[0].attributeValues, { CODE: 'Custom', TYPE: 'New type', NEW: 'New field' });
    assert.equal(synced.entities[1].attributeValues.CODE, 'A-01');
    const inserted = insertNamedDrawingBlock(synced, 'Door', { x: 20, y: 0 });
    assert.equal(inserted.reference.attributeValues.CODE, 'New default');
    assert.equal(drawingAttributeValues(synced.blocks[0], synced.entities[0]).TYPE, 'New type');
});

test('definitions and instance values survive archive and remapped cross-document copies', () => {
    const document = createLcadDocument(); document.content = fixture();
    document.content = editDrawingAttribute(document.content, [document.content.entities[0].id], 'CODE', 'Copied value').content;
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content.entities[0].attributeValues, document.content.entities[0].attributeValues);
    const payload = createDrawingClipboardPayload(restored, [restored.content.entities[0].id]);
    const pasted = pasteDrawingClipboardPayload({ content: fixture(), assets: [] }, payload, { mode: 'original' });
    const block = pasted.content.blocks.find(block => block.id === pasted.entities[0].blockId);
    assert.equal(resolveDrawingAttributeText(block.entities[0], pasted.entities[0]).text, 'Copied value');
});

test('bounded metadata, quoting and duplicate tags are validated before commits', () => {
    const content = createDefaultDrawingContent();
    assert.deepEqual(tokenizeDrawingAttributeInput('CODE "A \\"quote\\""'), ['CODE', 'A "quote"']);
    assert.equal(tokenizeDrawingAttributeInput('CODE "unfinished'), null);
    for (const input of ['1TAG "A" 0 0', 'A "B" NaN 0', 'A "B" 0 0 HEIGHT 0', 'A "B" 0 0 UNKNOWN']) assert.ok(defineDrawingAttribute(content, input).error);
    const first = defineDrawingAttribute(content, 'CODE "A" 0 0');
    assert.equal(defineDrawingAttribute(first.content, 'code "B" 1 1').error, 'duplicate');
    const duplicate = { ...first.entity, id: 'duplicate' };
    assert.equal(defineNamedDrawingBlock({ ...first.content, entities: [first.entity, duplicate] }, [first.entity.id, duplicate.id], { name: 'Bad', basePoint: { x: 0, y: 0 } }).error, 'attributeTags');
    const normalized = normalizeDrawingContent({ ...content, entities: [{ ...first.entity, attributeDefinition: { tag: 'bad tag' } }] });
    assert.equal(normalized.entities[0].attributeDefinition, undefined);
});

test('insertion values are stored with geometry in one immutable edit and constants retain their defaults', () => {
    const content = fixture();
    const result = insertNamedDrawingBlock(content, 'Door', { x: 20, y: 5 }, { attributeValues: { CODE: 'Next door', TYPE: 'Wrong', UNKNOWN: 'Ignored' } });
    assert.deepEqual(result.reference.attributeValues, { CODE: 'Next door', TYPE: 'Door', SECRET: 'Hidden' });
    assert.equal(result.content.entities.length, content.entities.length + 1);
    assert.equal(content.entities[0].attributeValues.CODE, 'A-01');
});

test('long insertion values expand independent cached and nested bounds without shifting text geometry', () => {
    let content = fixture();
    const first = content.entities[0];
    const longValue = 'Wide value '.repeat(20);
    const originalBounds = getDrawingBlockReferenceBounds(first, content.blocks);
    content = editDrawingAttribute(content, [first.id], 'CODE', longValue).content;
    const enlarged = content.entities[0];
    const bounds = getDrawingBlockReferenceBounds(enlarged, content.blocks);
    assert.ok(bounds.maxX > originalBounds.maxX + 20);
    assert.ok(enlarged.definitionBounds.maxX > content.entities[1].definitionBounds.maxX + 20);
    assert.deepEqual(enlarged.transform, first.transform);
    const resolved = resolveDrawingBlockChild(content.blocks[0].entities[0], enlarged);
    assert.equal(resolved.width, content.blocks[0].entities[0].width);
    assert.equal(resolved.x, content.blocks[0].entities[0].x);
    content.blocks.push({ id: 'wrapper', name: 'Wrapper', entities: [{ ...enlarged, id: 'nested' }] });
    content.entities.push({ id: 'outer', type: 'blockReference', blockId: 'wrapper', layerId: 'geometry', transform: { a: 0, b: 1, c: -1, d: 0, e: 10, f: 20 } });
    content = refreshDrawingBlockBounds(content);
    const outer = content.entities.at(-1);
    assert.ok(outer.definitionBounds.maxX > originalBounds.maxX + 20);
    assert.ok(getDrawingBlockReferenceBounds(outer, content.blocks).maxY > 40);
});
