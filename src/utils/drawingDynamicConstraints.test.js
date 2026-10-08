import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDrawingDynamicBlock, drawingBlockInstanceEntities } from './drawingDynamicBlocks.js';
import { editDrawingDynamicBlockInstances } from './drawingDynamicBlockOperations.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { createAnonymousDrawingBlockReference, getDrawingBlockReferenceBounds, materializeDrawingBlockReference } from './drawingBlocks.js';
import { drawingGeometricConstraintResiduals } from './drawingGeometricConstraints.js';

function fixture() {
    return { id: 'corner', name: 'Corner', entities: [
        { id: 'a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0 },
        { id: 'b', type: 'line', layerId: 'geometry', x1: 4, y1: 0, x2: 4, y2: 3 }],
    geometricConstraints: [{ id: 'joint', type: 'coincident', refs: [{ entityId: 'a', point: 'end' }, { entityId: 'b', point: 'start' }] }],
    dynamic: { parameters: [{ name: 'Rise', type: 'distance', default: 0, min: 0, max: 10 }],
        actions: [{ id: 'move', type: 'move', parameter: 'Rise', targets: ['a'], direction: { x: 0, y: 1 } }] } };
}

test('dynamic actions drive coordinates while connected objects follow through the shared evaluator', () => {
    const definition = fixture(); const before = structuredClone(definition);
    const result = evaluateDrawingDynamicBlock(definition, { Rise: 2 });
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(result.entities[0].y2, 2);
    assert.ok(Math.abs(result.entities[1].y1 - 2) < 1e-7);
    const reference = createAnonymousDrawingBlockReference(definition, { insertionPoint: { x: 10, y: 20 } });
    reference.dynamicValues = { Rise: 2 };
    assert.deepEqual(drawingBlockInstanceEntities(definition, reference), result.entities);
    const materialized = materializeDrawingBlockReference(reference, [definition]);
    assert.ok(Math.abs(materialized[1].y1 - 22) < 1e-7);
    assert.ok(Math.abs(getDrawingBlockReferenceBounds(reference, [definition]).minY - 22) < 1e-7);
    assert.deepEqual(definition, before);
});

test('hidden members participate in solving and parameter conflicts reject all instance updates', () => {
    const definition = fixture();
    definition.geometricConstraints.push({ id: 'pin', type: 'fix', refs: [{ entityId: 'b', point: 'start' }], values: [4, 0] });
    definition.dynamic.parameters.push({ name: 'View', type: 'choice', default: 'Only A', choices: ['Only A', 'All'] });
    definition.dynamic.visibility = { parameter: 'View', states: { 'Only A': ['a'], All: ['a', 'b'] } };
    assert.deepEqual(evaluateDrawingDynamicBlock(definition, { Rise: 2 }), { error: 'constraints' });
    const content = createDefaultDrawingContent(); content.blocks = [definition];
    content.entities = [createAnonymousDrawingBlockReference(definition, { id: 'first' }), createAnonymousDrawingBlockReference(definition, { id: 'second' })];
    const saved = structuredClone(content);
    const result = editDrawingDynamicBlockInstances(content, ['first', 'second'], { Rise: 2 });
    assert.equal(result.error, 'constraints'); assert.equal(result.content, undefined);
    assert.deepEqual(content, saved);
});

test('dynamic arrays duplicate complete constraints with deterministic IDs and translated fixation snapshots', () => {
    const definition = fixture();
    definition.geometricConstraints.push({ id: 'pin', type: 'fix', refs: [{ entityId: 'a', point: 'start' }], values: [0, 0] });
    definition.dynamic = { parameters: [{ name: 'Count', type: 'number', default: 1, min: 1, max: 200 }],
        actions: [{ id: 'repeat', type: 'array', parameter: 'Count', targets: ['a', 'b'], offset: { x: 10, y: 0 } }] };
    const result = evaluateDrawingDynamicBlock(definition, { Count: 3 });
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(result.entities.length, 6); assert.equal(result.geometricConstraints.length, 6);
    const map = new Map(result.entities.map(entity => [entity.id, entity]));
    assert.ok(result.geometricConstraints.every(item => drawingGeometricConstraintResiduals(item, map).every(value => Math.abs(value) < 1e-7)));
    assert.deepEqual(result.geometricConstraints.at(-1).values, [20, 0]);
    assert.deepEqual(evaluateDrawingDynamicBlock(definition, { Count: 3 }), result);
    assert.deepEqual(evaluateDrawingDynamicBlock(definition, { Count: 200 }), { error: 'constraints' });
});

test('default parameter evaluation preserves constrained rectangle representation and archive geometry', () => {
    const content = createDefaultDrawingContent();
    const rectangle = { id: 'box', type: 'rectangle', layerId: 'geometry', x: 1, y: 2, width: 3, height: 4 };
    const definition = { ...fixture(), entities: [rectangle], geometricConstraints: [
        { id: 'horizontal', type: 'horizontal', refs: [{ entityId: 'box', part: 0 }] }],
    dynamic: { parameters: [{ name: 'Rise', type: 'distance', default: 0 }], actions: [
        { id: 'move', type: 'move', targets: ['box'], parameter: 'Rise', direction: { x: 0, y: 1 } }] } };
    assert.deepEqual(evaluateDrawingDynamicBlock(definition).entities, [rectangle]);
    const moved = evaluateDrawingDynamicBlock(definition, { Rise: 2 });
    assert.ok(!moved.error, JSON.stringify(moved));
    assert.deepEqual(moved.entities, [{ ...rectangle, y: 4 }]);
    content.blocks = [definition];
    assert.deepEqual(normalizeDrawingContent(content).blocks[0].geometricConstraints, definition.geometricConstraints);
});
