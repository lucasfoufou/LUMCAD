import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createAnonymousDrawingBlock,
    createAnonymousDrawingBlockReference,
    getDrawingBlockReferenceBounds,
    getDrawingBlockReferenceInsertionPoint,
    materializeDrawingBlockReference,
    mirrorAffineMatrix,
    moveDrawingBlockReferenceInsertion,
    rotationAffineMatrix,
    scaleAffineMatrix,
    transformAffinePoint,
    transformDrawingBlockReference,
} from './drawingBlocks.js';
import { createDefaultDrawingContent, normalizeDrawingContent, removeEmptyLayer } from './drawingDocument.js';
import { mirrorEntity, rotateEntity, scaleEntity, translateEntity } from './drawingPrimitives.js';
import { editEntityGrip, entityMatchesSelectionWindow, getEntityGrips } from './drawingSelection.js';

test('anonymous blocks retain local source geometry behind one affine reference', () => {
    const definition = createAnonymousDrawingBlock([
        { id: 'line', type: 'line', layerId: 'geometry', x1: 10, y1: 20, x2: 14, y2: 20 },
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 12, cy: 22, r: 1 },
    ], { basePoint: { x: 10, y: 20 }, id: 'block-a', name: '*UA' });
    assert.deepEqual(definition.entities[0], {
        id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0,
    });
    assert.deepEqual(definition.bounds, { minX: 0, minY: 0, maxX: 4, maxY: 3 });

    const reference = createAnonymousDrawingBlockReference(definition, {
        id: 'reference', layerId: 'geometry', insertionPoint: { x: 10, y: 20 },
    });
    assert.deepEqual(getDrawingBlockReferenceInsertionPoint(reference), { x: 10, y: 20 });
    assert.deepEqual(getDrawingBlockReferenceBounds(reference), { minX: 10, minY: 20, maxX: 14, maxY: 23 });
    const materialized = materializeDrawingBlockReference(reference, [definition]);
    assert.deepEqual(materialized[0], {
        id: 'line', type: 'line', layerId: 'geometry', x1: 10, y1: 20, x2: 14, y2: 20,
    });
});

test('block references compose translate, rotate, scale, mirror and grip transforms', () => {
    const definition = createAnonymousDrawingBlock([
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 0 },
    ], { id: 'block-a' });
    const reference = createAnonymousDrawingBlockReference(definition, {
        id: 'reference', insertionPoint: { x: 1, y: 1 }, layerId: 'geometry',
    });

    const translated = translateEntity(reference, 2, 3);
    assert.deepEqual(getDrawingBlockReferenceInsertionPoint(translated), { x: 3, y: 4 });
    const rotated = rotateEntity(reference, 90, { x: 0, y: 0 });
    closePoint(getDrawingBlockReferenceInsertionPoint(rotated), { x: -1, y: 1 });
    const scaled = scaleEntity(reference, { origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 3 });
    closePoint(getDrawingBlockReferenceInsertionPoint(scaled), { x: 2, y: 3 });
    const mirrored = mirrorEntity(reference, { x: 0, y: -1 }, { x: 0, y: 1 });
    closePoint(getDrawingBlockReferenceInsertionPoint(mirrored), { x: -1, y: 1 });

    assert.deepEqual(getEntityGrips(reference), [{ id: 'insertion', x: 1, y: 1 }]);
    const gripMoved = editEntityGrip(reference, 'insertion', { x: 8, y: 9 });
    assert.deepEqual(getDrawingBlockReferenceInsertionPoint(gripMoved), { x: 8, y: 9 });
    assert.deepEqual(getDrawingBlockReferenceInsertionPoint(moveDrawingBlockReferenceInsertion(reference, { x: 5, y: 6 })), { x: 5, y: 6 });
});

test('block reference bounds participate in crossing and containment selection', () => {
    const definition = createAnonymousDrawingBlock([
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 2 },
    ], { id: 'block-a' });
    const reference = createAnonymousDrawingBlockReference(definition, {
        id: 'reference', insertionPoint: { x: 10, y: 20 }, layerId: 'geometry',
    });
    assert.equal(entityMatchesSelectionWindow(reference, {
        minX: 9, minY: 19, maxX: 15, maxY: 23, mode: 'window',
    }), true);
    assert.equal(entityMatchesSelectionWindow(reference, {
        minX: 13, minY: 21, maxX: 20, maxY: 30, mode: 'crossing',
    }), true);
    assert.equal(entityMatchesSelectionWindow(reference, {
        minX: -5, minY: -5, maxX: 0, maxY: 0, mode: 'crossing',
    }), false);
});

test('document normalization persists valid blocks and rejects dangling references', () => {
    const content = createDefaultDrawingContent();
    const definition = createAnonymousDrawingBlock([
        { id: 'line', type: 'line', layerId: 'custom', x1: 0, y1: 0, x2: 2, y2: 0 },
    ], { id: 'block-a' });
    const reference = createAnonymousDrawingBlockReference(definition, {
        id: 'reference', insertionPoint: { x: 2, y: 3 }, layerId: 'geometry',
    });
    content.layers.push({
        id: 'custom', name: 'BLOCK', color: '#123456', lineWeight: 1,
        lineType: 'continuous', transparency: 0, visible: true, locked: false,
    });
    content.blocks = [definition];
    content.entities = [reference, { ...reference, id: 'dangling', blockId: 'missing' }];
    const normalized = normalizeDrawingContent(JSON.parse(JSON.stringify(content)));
    assert.equal(normalized.blocks.length, 1);
    assert.equal(normalized.entities.length, 1);
    assert.equal(normalized.entities[0].blockId, definition.id);
    assert.equal(removeEmptyLayer(normalized, 'custom'), normalized);
});

test('affine helpers preserve explicit matrix composition around origins', () => {
    const rotated = transformAffinePoint({ x: 2, y: 1 }, rotationAffineMatrix(90, { x: 1, y: 1 }));
    closePoint(rotated, { x: 1, y: 2 });
    const scaled = transformAffinePoint({ x: 2, y: 2 }, scaleAffineMatrix(2, 3, { x: 1, y: 1 }));
    closePoint(scaled, { x: 3, y: 4 });
    const mirrored = transformAffinePoint({ x: 2, y: 1 }, mirrorAffineMatrix({ x: 0, y: 0 }, { x: 0, y: 2 }));
    closePoint(mirrored, { x: -2, y: 1 });
    const transformed = transformDrawingBlockReference({
        id: 'reference', type: 'blockReference', layerId: 'geometry', blockId: 'block',
        transform: { a: 1, b: 0, c: 0, d: 1, e: 1, f: 1 },
    }, rotationAffineMatrix(90));
    closePoint(getDrawingBlockReferenceInsertionPoint(transformed), { x: -1, y: 1 });
});

function closePoint(actual, expected, tolerance = 1e-9) {
    assert.ok(Math.abs(actual.x - expected.x) <= tolerance, `${actual.x} != ${expected.x}`);
    assert.ok(Math.abs(actual.y - expected.y) <= tolerance, `${actual.y} != ${expected.y}`);
}
