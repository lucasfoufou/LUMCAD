import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDrawingDynamicBlock, normalizeDrawingDynamicBlock, remapDrawingDynamicBlock } from './drawingDynamicBlocks.js';
import { normalizeDrawingContent } from './drawingDocument.js';
import { remapDrawingBlockDefinition, createAnonymousDrawingBlockReference, getDrawingBlockReferenceBounds, materializeDrawingBlockReference } from './drawingBlocks.js';
import { drawingSnapEntities } from './drawingBlockSnapping.js';
import { editDrawingDynamicBlockInstances } from './drawingDynamicBlockOperations.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg, parseDrawingClipboardText, pasteDrawingClipboardPayload } from './drawingClipboard.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const line = { id: 'edge', type: 'line', layerId: '0', x1: 0, y1: 0, x2: 2, y2: 0 };
const make = (parameter, action) => ({ id: 'block', entities: [line], dynamic: { parameters: [parameter], actions: [{ id: 'action', targets: ['edge'], parameter: parameter.name, ...action }] } });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('dynamic moves reevaluate source geometry without drift or mutation', () => {
    const block = make({ name: 'Width', type: 'distance', default: 2 }, { type: 'move', direction: { x: 4, y: 0 } });
    const saved = structuredClone(block);
    assert.equal(evaluateDrawingDynamicBlock(block, { Width: 4 }).entities[0].x1, 2);
    assert.equal(evaluateDrawingDynamicBlock(block, { Width: 3 }).entities[0].x1, 1);
    assert.deepEqual(evaluateDrawingDynamicBlock(block).entities, [line]);
    assert.deepEqual(block, saved);
});

test('rotation, scale, flip and point parameters use shared affine geometry', () => {
    const rotated = evaluateDrawingDynamicBlock(make({ name: 'Angle', type: 'angle', default: 0 }, { type: 'rotate', origin: { x: 0, y: 0 } }), { Angle: 90 }).entities[0];
    near(rotated.x2, 0); near(rotated.y2, 2);
    const scaled = evaluateDrawingDynamicBlock(make({ name: 'Size', type: 'distance', min: 0.1, default: 2 }, { type: 'scale', origin: { x: 0, y: 0 } }), { Size: 6 }).entities[0];
    assert.equal(scaled.x2, 6);
    const flipped = evaluateDrawingDynamicBlock(make({ name: 'Flip', type: 'flip', default: false }, { type: 'flip', origin: { x: 0, y: 0 }, axisEnd: { x: 0, y: 1 } }), { Flip: true }).entities[0];
    near(flipped.x2, -2);
    const moved = evaluateDrawingDynamicBlock(make({ name: 'Point', type: 'point', default: { x: 0, y: 0 } }, { type: 'move' }), { Point: { x: 3, y: 4 } }).entities[0];
    assert.equal(moved.x1, 3); assert.equal(moved.y2, 4);
});

test('stretch actions move selected control points and retain the stationary endpoint', () => {
    const block = make({ name: 'Width', type: 'distance', default: 2 }, { type: 'stretch', direction: { x: 1, y: 0 }, window: { minX: 1, minY: -1, maxX: 3, maxY: 1 } });
    const result = evaluateDrawingDynamicBlock(block, { Width: 5 });
    assert.equal(result.entities[0].x1, 0); assert.equal(result.entities[0].x2, 5);
});

test('arrays retain stable copy IDs and visibility follows source membership', () => {
    const block = make({ name: 'Count', type: 'number', min: 1, max: 10, default: 1, step: 1 }, { type: 'array', offset: { x: 3, y: 0 } });
    block.dynamic.parameters.push({ name: 'Visible', type: 'choice', choices: ['On', 'Off'], default: 'On' });
    block.dynamic.visibility = { parameter: 'Visible', states: { On: ['edge'], Off: [] } };
    const result = evaluateDrawingDynamicBlock(block, { Count: 3 });
    assert.deepEqual(result.entities.map(entity => entity.x1), [0, 3, 6]);
    assert.equal(new Set(result.entities.map(entity => entity.id)).size, 3);
    assert.deepEqual(evaluateDrawingDynamicBlock(block, { Count: 3 }).entities, result.entities);
    assert.deepEqual(evaluateDrawingDynamicBlock(block, { Count: 3, Visible: 'Off' }).entities, []);
    const remapped = remapDrawingDynamicBlock(block.dynamic, new Map([['edge', 'copied']]));
    assert.deepEqual(remapped.actions[0].targets, ['copied']);
    assert.deepEqual(remapped.visibility.states.On, ['copied']);
});

test('invalid actions and values return no partial instance geometry', () => {
    const block = make({ name: 'Size', type: 'distance', default: 2 }, { type: 'move', direction: { x: 1, y: 0 } });
    assert.deepEqual(evaluateDrawingDynamicBlock(block, { Size: -2 }), { error: 'values' });
    block.dynamic.actions[0].targets = ['missing'];
    assert.equal(normalizeDrawingDynamicBlock(block.dynamic, block.entities), null);
    assert.deepEqual(evaluateDrawingDynamicBlock(block), { error: 'definition' });
    block.dynamic.actions[0].parameter = 42;
    assert.equal(normalizeDrawingDynamicBlock(block.dynamic, block.entities), null);
});

test('lookup tables drive typed variants in dependency order', () => {
    const block = make({ name: 'Width', type: 'distance', default: 2 }, { type: 'move', direction: { x: 1, y: 0 } });
    block.dynamic.parameters.push({ name: 'Size', type: 'choice', choices: ['Small', 'Large'], default: 'Small' },
        { name: 'Product', type: 'choice', choices: ['A', 'B'], default: 'A' });
    block.dynamic.lookups = [
        { name: 'Sizes', parameter: 'Size', rows: [{ key: 'Small', values: { Width: 2 } }, { key: 'Large', values: { Width: 5 } }] },
        { name: 'Products', parameter: 'Product', rows: [{ key: 'A', values: { Size: 'Small' } }, { key: 'B', values: { Size: 'Large' } }] },
    ];
    const result = evaluateDrawingDynamicBlock(block, { Product: 'B' });
    assert.equal(result.values.Width, 5);
    assert.equal(result.entities[0].x1, 3);
    assert.equal(evaluateDrawingDynamicBlock(block).entities[0].x1, 0);
    assert.deepEqual(normalizeDrawingDynamicBlock(block.dynamic, block.entities).lookups.map(table => table.name), ['Products', 'Sizes']);
});

test('lookup graphs reject cycles, ambiguous outputs and incomplete variant rows', () => {
    const dynamic = { parameters: [
        { name: 'A', type: 'choice', choices: ['One'], default: 'One' },
        { name: 'B', type: 'choice', choices: ['One'], default: 'One' },
    ], actions: [], lookups: [
        { name: 'First', parameter: 'A', rows: [{ key: 'One', values: { B: 'One' } }] },
        { name: 'Second', parameter: 'B', rows: [{ key: 'One', values: { A: 'One' } }] },
    ] };
    assert.equal(normalizeDrawingDynamicBlock(dynamic, [line]), null);
    dynamic.lookups[1] = { ...dynamic.lookups[0], name: 'Duplicate' };
    assert.equal(normalizeDrawingDynamicBlock(dynamic, [line]), null);
    dynamic.lookups = [{ name: 'Missing', parameter: 'A', rows: [] }];
    assert.equal(normalizeDrawingDynamicBlock(dynamic, [line]), null);
});

test('array copies participate in subsequent actions and preserve local dependencies', () => {
    const block = make({ name: 'Count', type: 'number', min: 1, max: 10, default: 1 }, { type: 'array', offset: { x: 3, y: 0 } });
    block.entities.push({ ...line, id: 'dependent', sourceId: 'edge' });
    block.dynamic.actions[0].targets.push('dependent');
    block.dynamic.parameters.push({ name: 'Offset', type: 'distance', default: 0 });
    block.dynamic.actions.push({ id: 'shift', type: 'move', parameter: 'Offset', targets: ['edge', 'dependent'], direction: { x: 0, y: 1 } });
    const result = evaluateDrawingDynamicBlock(block, { Count: 2, Offset: 4 });
    assert.equal(result.entities.length, 4);
    assert.ok(result.entities.every(entity => entity.y1 === 4));
    assert.equal(result.entities[3].sourceId, result.entities[2].id);
});

test('array amplification and generated ID conflicts are rejected atomically', () => {
    const block = make({ name: 'Count', type: 'number', min: 1, max: 1024, default: 1 }, { type: 'array', offset: { x: 3, y: 0 } });
    block.entities = Array.from({ length: 11 }, (_, i) => ({ ...line, id: `edge${i}` }));
    block.dynamic.actions[0].targets = block.entities.map(entity => entity.id);
    assert.deepEqual(evaluateDrawingDynamicBlock(block, { Count: 1024 }), { error: 'limit' });
    block.entities = [line, { ...line, id: 'edge:dynamic:action:1' }];
    block.dynamic.actions[0].targets = ['edge'];
    assert.deepEqual(evaluateDrawingDynamicBlock(block, { Count: 2 }), { error: 'identity' });
});

test('block definitions persist validated actions and remap their entity targets on copy', () => {
    const block = make({ name: 'Width', type: 'distance', default: 2 }, { type: 'move', direction: { x: 1, y: 0 } });
    const document = createLcadDocument();
    document.content = normalizeDrawingContent({ ...document.content, blocks: [block] });
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(loaded.content.blocks[0].dynamic, document.content.blocks[0].dynamic);
    assert.equal(evaluateDrawingDynamicBlock(loaded.content.blocks[0], { Width: 4 }).entities[0].x1, 2);
    const copied = remapDrawingBlockDefinition(loaded.content.blocks[0]);
    assert.notEqual(copied.entities[0].id, 'edge');
    assert.deepEqual(copied.dynamic.actions[0].targets, [copied.entities[0].id]);
    assert.equal(evaluateDrawingDynamicBlock(copied, { Width: 4 }).entities[0].x1, 2);
    block.dynamic.actions[0].targets = ['missing'];
    const recovered = normalizeDrawingContent({ ...document.content, blocks: [block] }).blocks[0];
    assert.equal(recovered.dynamic, undefined);
    assert.equal(recovered.entities[0].x2, 2);
});

test('dynamic instance bounds, snaps, materialization and SVG agree and clipboard keeps overrides', () => {
    const block = make({ name: 'Width', type: 'distance', default: 2 }, { type: 'stretch', direction: { x: 1, y: 0 }, window: { minX: 1, minY: -1, maxX: 3, maxY: 1 } });
    const document = createLcadDocument();
    block.entities[0] = { ...line, layerId: document.content.activeLayerId };
    const reference = { ...createAnonymousDrawingBlockReference(block, { id: 'instance', layerId: document.content.activeLayerId, insertionPoint: { x: 10, y: 20 } }), dynamicValues: { Width: 5 } };
    document.content = normalizeDrawingContent({ ...document.content, blocks: [block], entities: [reference] });
    assert.deepEqual(getDrawingBlockReferenceBounds(reference, document.content.blocks), { minX: 10, minY: 20, maxX: 15, maxY: 20 });
    const materialized = materializeDrawingBlockReference(reference, document.content.blocks);
    assert.equal(materialized[0].x2, 15);
    const snapped = drawingSnapEntities(document.content);
    assert.equal(snapped[0].x2, 15);
    assert.equal(snapped[0].id, 'instance');
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(document, ['instance']));
    assert.match(svg, /x2="5"/);
    const pasted = pasteDrawingClipboardPayload({ content: createLcadDocument().content, assets: [] }, parseDrawingClipboardText(svg), { mode: 'original' });
    assert.deepEqual(pasted.content.entities[0].dynamicValues, { Width: 5 });
    assert.equal(materializeDrawingBlockReference(pasted.content.entities[0], pasted.content.blocks)[0].x2, 15);
});

test('an empty visibility state has neither stale bounds nor snap geometry', () => {
    const block = { id: 'visible', entities: [line], dynamic: { parameters: [{ name: 'State', type: 'choice', choices: ['On', 'Off'], default: 'On' }],
        actions: [], visibility: { parameter: 'State', states: { On: ['edge'], Off: [] } } } };
    const reference = { ...createAnonymousDrawingBlockReference(block), dynamicValues: { State: 'Off' } };
    assert.ok(reference.definitionBounds);
    assert.equal(getDrawingBlockReferenceBounds(reference, [block]), null);
    assert.deepEqual(materializeDrawingBlockReference(reference, [block]), []);
});

test('instance edits and reset preserve identities, source geometry and reject locked batches', () => {
    const block = make({ name: 'Width', type: 'distance', default: 2 }, { type: 'stretch', direction: { x: 1, y: 0 }, window: { minX: 1, minY: -1, maxX: 3, maxY: 1 } });
    const document = createLcadDocument();
    const reference = createAnonymousDrawingBlockReference(block, { id: 'ref', layerId: document.content.activeLayerId });
    const content = normalizeDrawingContent({ ...document.content, blocks: [block], entities: [reference, { ...reference, id: 'locked', locked: true }] });
    const edited = editDrawingDynamicBlockInstances(content, ['ref'], { width: 5 });
    assert.equal(edited.changed, true);
    assert.equal(edited.content.entities[0].id, 'ref');
    assert.deepEqual(edited.content.entities[0].transform, reference.transform);
    assert.equal(edited.content.entities[0].definitionBounds.maxX, 5);
    assert.deepEqual(edited.content.blocks[0].entities, content.blocks[0].entities);
    assert.equal(content.entities[0].dynamicValues, undefined);
    assert.equal(editDrawingDynamicBlockInstances(content, ['ref', 'locked'], { Width: 5 }).error, 'selection');
    assert.equal(editDrawingDynamicBlockInstances(content, ['ref'], { Width: -1 }).error, 'values');
    const reset = editDrawingDynamicBlockInstances(edited.content, ['ref'], {}, { reset: true });
    assert.equal(reset.content.entities[0].dynamicValues, undefined);
    assert.equal(reset.content.entities[0].definitionBounds.maxX, 2);
    assert.equal(editDrawingDynamicBlockInstances(reset.content, ['ref'], {}, { reset: true }).changed, false);
});
