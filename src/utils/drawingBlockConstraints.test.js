import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { createAnonymousDrawingBlockReference } from './drawingBlocks.js';
import { explodeDrawingEntities, xplodeDrawingEntities } from './drawingCompoundOperations.js';
import { rotationAffineMatrix, translationAffineMatrix, multiplyAffineMatrices } from './drawingAffine.js';
import { drawingGeometricConstraintResiduals } from './drawingGeometricConstraints.js';
import { commitDrawingHistoryState, redoDrawingHistoryState } from './drawingHistory.js';

function fixture() {
    const content = createDefaultDrawingContent();
    const block = { id: 'corner', name: 'Corner', entities: [
        { id: 'a', type: 'line', layerId: content.activeLayerId, x1: 0, y1: 0, x2: 4, y2: 0 },
        { id: 'b', type: 'line', layerId: content.activeLayerId, x1: 4, y1: 0, x2: 4, y2: 3 }],
    geometricConstraints: [
        { id: 'joint', type: 'coincident', refs: [{ entityId: 'a', point: 'end' }, { entityId: 'b', point: 'start' }] },
        { id: 'pin', type: 'fix', refs: [{ entityId: 'a', point: 'start' }], values: [0, 0] },
        { id: 'horizontal', type: 'horizontal', refs: [{ entityId: 'a' }] }],
    };
    content.blocks = [block];
    content.entities = [createAnonymousDrawingBlockReference(block, { id: 'instance', insertionPoint: { x: 10, y: 20 } })];
    return content;
}
function satisfied(content) {
    const map = new Map(content.entities.map(entity => [entity.id, entity]));
    assert.ok(content.geometricConstraints.every(item => drawingGeometricConstraintResiduals(item, map).every(value => Math.abs(value) < 1e-7)));
    assert.deepEqual(normalizeDrawingContent(content).geometricConstraints, content.geometricConstraints);
}

test('EXPLODE and XPLODE transfer world-space constraints and quarter-turn axes in one history entry', () => {
    const content = fixture();
    content.entities[0].transform = multiplyAffineMatrices(translationAffineMatrix(10, 20), rotationAffineMatrix(90));
    const saved = structuredClone(content);
    for (const explode of [explodeDrawingEntities, xplodeDrawingEntities]) {
        const result = explode(content, ['instance']);
        assert.ok(result.changed, JSON.stringify(result));
        assert.equal(result.content.geometricConstraints.length, 3);
        assert.deepEqual(result.content.geometricConstraints[1].values, [10, 20]);
        assert.equal(result.content.geometricConstraints[2].type, 'vertical');
        satisfied(result.content);
        const state = commitDrawingHistoryState({ past: [], present: content, future: [] }, result.content);
        assert.equal(state.rejection, null);
        assert.deepEqual(state.past, [content]);
        assert.deepEqual(redoDrawingHistoryState({ past: [], present: content, future: [state.present] }).present, state.present);
        assert.deepEqual(content, saved);
    }
});

test('recursive explosion isolates reused nested local IDs and their fixation targets', () => {
    const content = fixture(); const corner = content.blocks[0];
    const outer = { id: 'outer', name: 'Outer', entities: [
        createAnonymousDrawingBlockReference(corner, { id: 'first' }),
        createAnonymousDrawingBlockReference(corner, { id: 'second', insertionPoint: { x: 10, y: 0 } }),
    ] };
    content.blocks.push(outer);
    content.entities = [createAnonymousDrawingBlockReference(outer, { id: 'instance' })];
    const result = explodeDrawingEntities(content, ['instance'], { recursiveBlocks: true });
    assert.equal(result.entities.length, 4);
    assert.equal(new Set(result.entities.map(entity => entity.id)).size, 4);
    assert.equal(result.content.geometricConstraints.length, 6);
    assert.equal(new Set(result.content.geometricConstraints.map(item => item.id)).size, 6);
    assert.deepEqual(result.content.geometricConstraints.filter(item => item.type === 'fix').map(item => item.values), [[0, 0], [10, 0]]);
    satisfied(result.content);
});

test('dynamic array explosion retains evaluated copies and independent complete catalogs', () => {
    const content = fixture();
    content.blocks[0].dynamic = { parameters: [{ name: 'Count', type: 'number', default: 1, min: 1, max: 20 }],
        actions: [{ id: 'repeat', type: 'array', targets: ['a', 'b'], parameter: 'Count', offset: { x: 10, y: 0 } }] };
    content.entities[0].dynamicValues = { Count: 3 };
    const result = explodeDrawingEntities(content, ['instance']);
    assert.equal(result.entities.length, 6);
    assert.equal(result.content.geometricConstraints.length, 9);
    satisfied(result.content);
});

test('an incompatible constrained instance rejects an entire explosion batch without mutation', () => {
    const content = fixture();
    content.entities.push({ ...content.entities[0], id: 'rotated', transform: rotationAffineMatrix(35) });
    const saved = structuredClone(content);
    const result = explodeDrawingEntities(content, ['instance', 'rotated']);
    assert.equal(result.error, 'topology'); assert.equal(result.changed, false);
    assert.equal(result.content, content); assert.deepEqual(content, saved);
});

test('explosion refuses catalog overflow and constrained primitive topology changes without partial output', () => {
    const content = fixture();
    const outside = { id: 'outside', type: 'line', layerId: content.activeLayerId, x1: 30, y1: 40, x2: 34, y2: 40 };
    content.entities.push(outside);
    content.geometricConstraints = Array.from({ length: 255 }, (_, index) => ({ id: `pin-${index}`, type: 'fix',
        refs: [{ entityId: 'outside', point: 'start' }], values: [30, 40] }));
    const result = explodeDrawingEntities(content, ['instance']);
    assert.equal(result.error, 'limit'); assert.equal(result.content, content); assert.equal(result.changed, false);
    const rectangle = { id: 'rectangle', type: 'rectangle', layerId: content.activeLayerId, x: 0, y: 0, width: 4, height: 3 };
    content.entities = [rectangle];
    content.geometricConstraints = [{ id: 'edge', type: 'horizontal', refs: [{ entityId: 'rectangle', part: 0 }] }];
    const refused = explodeDrawingEntities(content, ['rectangle']);
    assert.equal(refused.error, 'topology'); assert.equal(refused.content, content);
});
