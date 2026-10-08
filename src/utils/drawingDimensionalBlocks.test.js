import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent, transformSelectedEntities } from './drawingDocument.js';
import { rotateEntity, scaleEntity } from './drawingPrimitives.js';
import { explodeDrawingEntities } from './drawingCompoundOperations.js';
import { createAnonymousDrawingBlockReference } from './drawingBlocks.js';
import { createDrawingClipboardPayload, pasteDrawingClipboardPayload, validateDrawingClipboardPayload } from './drawingClipboard.js';
import { createDrawingBlockEditDraft, saveDrawingBlockEdit } from './drawingBlockEditing.js';
import { defineNamedDrawingBlock } from './drawingNamedBlocks.js';
import { remapDrawingBlockDefinition } from './drawingBlocks.js';
import { runDrawingDimensionalCommand } from './drawingDimensionalCommands.js';
import { evaluateDrawingDynamicBlock } from './drawingDynamicBlocks.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

function fixture() {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'edge', type: 'line', layerId: content.activeLayerId, x1: 10, y1: 20, x2: 14, y2: 20 }];
    content.parameters = [{ name: 'width', type: 'distance', expression: '4m' }];
    content.dimensionalConstraints = [{ id: 'driver', name: 'length', type: 'aligned', expression: 'width', refs: [{ entityId: 'edge' }] }];
    return content;
}

test('BLOCK and PASTEBLOCK preserve local driving graphs through BEDIT and archive round trips', () => {
    const source = fixture(); const saved = structuredClone(source);
    for (const make of [
        () => defineNamedDrawingBlock(source, ['edge'], { name: 'Driven', basePoint: { x: 10, y: 20 } }),
        () => pasteDrawingClipboardPayload(source, createDrawingClipboardPayload(source, ['edge']), { mode: 'block' }),
    ]) {
        const result = make(); assert.ok(!result.error, result.error);
        const root = normalizeDrawingContent(result.content); const block = root.blocks.at(-1);
        assert.equal(block.parameters[0].name, 'width');
        assert.equal(block.entities[0].x1, 0);
        const draft = createDrawingBlockEditDraft(root, block.id);
        const edited = runDrawingDimensionalCommand(draft.content, 'parameters', 'SET width distance 7m', []);
        assert.ok(!edited.error, edited.error);
        const committed = saveDrawingBlockEdit(root, block.id, edited.content);
        assert.ok(!committed.error, committed.error);
        assert.deepEqual(committed.content.parameters, root.parameters);
        assert.deepEqual(committed.content.entities.filter(item => item.type !== 'blockReference'), root.entities.filter(item => item.type !== 'blockReference'));
        for (const reference of root.entities.filter(item => item.type === 'blockReference')) {
            const updated = committed.content.entities.find(item => item.id === reference.id);
            assert.deepEqual(updated.transform, reference.transform);
            assert.ok(Math.abs(updated.definitionBounds.maxX - updated.definitionBounds.minX - 7) < 1e-7);
        }
        const local = committed.content.blocks.find(item => item.id === block.id);
        assert.ok(Math.abs(local.entities[0].x2 - local.entities[0].x1 - 7) < 1e-7);
        const document = { ...createLcadDocument(), content: committed.content };
        const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content;
        assert.deepEqual(loaded.blocks.find(item => item.id === block.id).dimensionalConstraints, local.dimensionalConstraints);
        assert.deepEqual(loaded.blocks.find(item => item.id === block.id).parameters, local.parameters);
        const remapped = remapDrawingBlockDefinition(local);
        assert.equal(remapped.dimensionalConstraints[0].refs[0].entityId, remapped.entities[0].id);
        assert.notEqual(remapped.dimensionalConstraints[0].id, local.dimensionalConstraints[0].id);
    }
    assert.deepEqual(source, saved);
});

test('moving a driver into a block preserves model formula dependencies and rejects boundary relations', () => {
    const content = fixture();
    content.parameters.push({ name: 'report', type: 'distance', expression: 'length * 2' });
    const result = defineNamedDrawingBlock(content, ['edge'], { name: 'Driven', basePoint: { x: 0, y: 0 } });
    assert.ok(!result.error, result.error);
    assert.deepEqual(result.content.dimensionalConstraints, []);
    assert.equal(result.content.parameters.find(item => item.name === 'length').expression, 'width');
    assert.doesNotThrow(() => normalizeDrawingContent(result.content));
    content.entities.push({ id: 'other', type: 'line', layerId: content.activeLayerId, x1: 10, y1: 22, x2: 14, y2: 22 });
    content.dimensionalConstraints.push({ id: 'between', name: 'gap', type: 'aligned', expression: '2m', refs: [
        { entityId: 'edge', point: 'start' }, { entityId: 'other', point: 'start' }] });
    assert.equal(defineNamedDrawingBlock(content, ['edge'], { name: 'Boundary', basePoint: { x: 0, y: 0 } }).error, 'dependent');
});

test('block catalogs reject malformed parameters and shared relationship IDs at archive and clipboard boundaries', () => {
    const source = fixture();
    const result = defineNamedDrawingBlock(source, ['edge'], { name: 'Driven', basePoint: { x: 0, y: 0 } });
    const invalid = structuredClone(result.content); invalid.blocks[0].parameters[0].expression = 'length';
    assert.throws(() => normalizeDrawingContent(invalid));
    const payload = createDrawingClipboardPayload(result.content, [result.reference.id]);
    payload.blocks[0].geometricConstraints = [{ id: payload.blocks[0].dimensionalConstraints[0].id, type: 'horizontal', refs: [{ entityId: 'edge' }] }];
    assert.throws(() => validateDrawingClipboardPayload(payload));
});

test('dynamic arrays carry independent dimensional graphs, while incompatible scaling rejects atomically', () => {
    const source = fixture(); const block = defineNamedDrawingBlock(source, ['edge'], { name: 'Driven', basePoint: { x: 10, y: 20 } }).definition;
    block.dynamic = { parameters: [{ name: 'Count', type: 'number', default: 1, min: 1, max: 4 }],
        actions: [{ id: 'repeat', type: 'array', parameter: 'Count', targets: ['edge'], offset: { x: 0, y: 5 } }] };
    const saved = structuredClone(block);
    const result = evaluateDrawingDynamicBlock(block, { Count: 3 });
    assert.ok(!result.error, result.error);
    assert.equal(result.entities.length, 3); assert.equal(result.dimensionalConstraints.length, 3);
    assert.equal(new Set(result.dimensionalConstraints.map(item => item.name)).size, 3);
    assert.deepEqual(block, saved);
    block.dynamic = { parameters: [{ name: 'Scale', type: 'number', default: 1, min: 1, max: 4 }],
        actions: [{ id: 'scale', type: 'scale', parameter: 'Scale', targets: ['edge'], origin: { x: 0, y: 0 } }] };
    const followed = evaluateDrawingDynamicBlock(block, { Scale: 2 });
    assert.equal(followed.entities[0].x2, 8);
    assert.ok(Math.abs(followed.entities[0].x1 - 4) < 1e-7);
    block.geometricConstraints = [{ id: 'pin', type: 'fix', refs: [{ entityId: 'edge', point: 'start' }], values: [0, 0] }];
    assert.equal(evaluateDrawingDynamicBlock(block, { Scale: 2 }).error, 'constraints');
});

test('EXPLODE transfers independent instance graphs while preserving model names and source definitions', () => {
    const source = fixture();
    const made = defineNamedDrawingBlock(source, ['edge'], { name: 'Driven', basePoint: { x: 10, y: 20 }, keepSources: true });
    const refs = [10, 30].map(x => createAnonymousDrawingBlockReference(made.definition, { insertionPoint: { x, y: 40 }, layerId: source.activeLayerId }));
    const root = normalizeDrawingContent({ ...made.content, entities: [...made.content.entities, ...refs] });
    const saved = structuredClone(root);
    const exploded = explodeDrawingEntities(root, refs.map(item => item.id));
    assert.ok(!exploded.error, exploded.error);
    assert.equal(exploded.content.dimensionalConstraints.length, 3);
    assert.equal(new Set(exploded.content.dimensionalConstraints.map(item => item.name)).size, 3);
    const driver = exploded.content.dimensionalConstraints[1];
    const changed = runDrawingDimensionalCommand(exploded.content, 'dimConstraint', `SET ${driver.name} 9m`);
    assert.ok(!changed.error, changed.error);
    const entity = changed.content.entities.find(item => item.id === driver.refs[0].entityId);
    assert.ok(Math.abs(entity.x2 - entity.x1 - 9) < 1e-7);
    assert.deepEqual(changed.content.entities[0], root.entities[0]);
    assert.deepEqual(changed.content.blocks, root.blocks);
    assert.deepEqual(root, saved);
});

test('rotation copies map projected axes and refuse transformations that violate prescribed dimensions', () => {
    const source = fixture();
    source.dimensionalConstraints[0] = { ...source.dimensionalConstraints[0], type: 'linear', axis: 'x', direction: 1 };
    const origin = { x: 0, y: 0 };
    const rotated = transformSelectedEntities(source, ['edge'], entity => rotateEntity(entity, 90, origin), { copy: true });
    assert.ok(!rotated.error, rotated.error);
    const driver = rotated.content.dimensionalConstraints[1];
    assert.equal(driver.axis, 'y'); assert.equal(driver.direction, 1);
    const invalid = transformSelectedEntities(source, ['edge'], entity => rotateEntity(entity, 30, origin), { copy: true });
    assert.equal(invalid.error, 'topology'); assert.equal(invalid.content, source);
    const scaled = transformSelectedEntities(source, ['edge'], entity => scaleEntity(entity, 2, origin), { copy: true });
    assert.equal(scaled.error, 'conflict'); assert.equal(scaled.content, source);
});
