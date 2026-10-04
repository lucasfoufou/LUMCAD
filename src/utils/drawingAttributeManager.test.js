import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { defineDrawingAttribute, editDrawingAttribute } from './drawingAttributeOperations.js';
import { defineNamedDrawingBlock, insertNamedDrawingBlock } from './drawingNamedBlocks.js';
import { manageDrawingAttributes, parseDrawingAttributeManagerInput } from './drawingAttributeManager.js';

function fixture() {
    let content = createDefaultDrawingContent();
    content = defineDrawingAttribute(content, 'CODE "A" 0 0').content;
    content = defineDrawingAttribute(content, 'TYPE "Door" 0 1').content;
    content = defineNamedDrawingBlock(content, content.entities.map(entity => entity.id), { name: 'Door', basePoint: { x: 0, y: 0 } }).content;
    content = insertNamedDrawingBlock(content, 'Door', { x: 10, y: 0 }).content;
    return editDrawingAttribute(content, [content.entities[0].id], 'CODE', 'Custom').content;
}

test('renaming migrates independent values in locked and nested references without mutating the input', () => {
    const content = fixture();
    content.entities[0].locked = true;
    content.blocks.push({ id: 'wrapper', name: 'Wrapper', entities: [{ ...content.entities[1], id: 'nested', attributeValues: { CODE: 'Nested', TYPE: 'Door' } }] });
    const before = structuredClone(content);
    const result = manageDrawingAttributes(content, 'Door', 'CODE', 'TAG', 'NUMBER').content;
    assert.deepEqual(result.entities.map(entity => entity.attributeValues.NUMBER), ['Custom', 'A']);
    assert.equal(result.blocks.find(block => block.id === 'wrapper').entities[0].attributeValues.NUMBER, 'Nested');
    assert.ok(result.entities.every(entity => !Object.hasOwn(entity.attributeValues, 'CODE')));
    assert.deepEqual(result.entities.map(entity => entity.id), content.entities.map(entity => entity.id));
    assert.deepEqual(content, before);
});

test('default changes preserve old variable values, constants refresh and deleted fields disappear', () => {
    let content = fixture();
    content = manageDrawingAttributes(content, 'Door', 'CODE', 'DEFAULT', 'New').content;
    assert.deepEqual(content.entities.map(entity => entity.attributeValues.CODE), ['Custom', 'A']);
    assert.equal(insertNamedDrawingBlock(content, 'Door', { x: 20, y: 0 }).reference.attributeValues.CODE, 'New');
    content = manageDrawingAttributes(content, 'Door', 'CODE', 'CONSTANT', 'ON').content;
    assert.deepEqual(content.entities.map(entity => entity.attributeValues.CODE), ['New', 'New']);
    content = manageDrawingAttributes(content, 'Door', 'CODE', 'DELETE').content;
    assert.ok(content.entities.every(entity => !Object.hasOwn(entity.attributeValues, 'CODE')));
});

test('reordering skips geometry, respects boundaries and keeps entity identities', () => {
    const content = fixture();
    const block = content.blocks[0];
    block.entities.splice(1, 0, { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 1 });
    const ids = block.entities.map(entity => entity.id);
    assert.equal(manageDrawingAttributes(content, 'Door', 'CODE', 'UP').changed, false);
    const result = manageDrawingAttributes(content, 'Door', 'CODE', 'DOWN').content;
    assert.deepEqual(result.blocks[0].entities.map(entity => entity.id), [ids[2], ids[1], ids[0]]);
});

test('duplicate tags and deletion of a dimension source are rejected atomically', () => {
    const content = fixture();
    assert.equal(manageDrawingAttributes(content, 'Door', 'CODE', 'TAG', 'TYPE').error, 'duplicate');
    content.blocks[0].entities.push({ id: 'dim', type: 'dimension', sourceId: content.blocks[0].entities[0].id });
    const before = structuredClone(content);
    assert.equal(manageDrawingAttributes(content, 'Door', 'CODE', 'DELETE').error, 'managerDependency');
    assert.deepEqual(content, before);
});

test('manager input accepts quoted names and empty values while rejecting malformed arity', () => {
    assert.deepEqual(parseDrawingAttributeManagerInput('"Door panel" CODE PROMPT ""'), { blockName: 'Door panel', tag: 'CODE', operation: 'PROMPT', value: '' });
    assert.deepEqual(parseDrawingAttributeManagerInput(''), { blockName: '', open: true });
    for (const input of ['Door CODE UP extra', 'Door CODE TAG', '"unfinished']) assert.equal(parseDrawingAttributeManagerInput(input), null);
});
