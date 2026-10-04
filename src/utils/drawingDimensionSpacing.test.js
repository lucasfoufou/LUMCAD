import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { getDimensionGeometry } from './drawingDimensions.js';
import { spaceDrawingDimensions, beginDimensionSpacing, spaceDimensionsAtPoint } from './drawingDimensionSpacing.js';

const linear = (id, offset, reverse = false) => ({ id, type: 'linearDimension', layerId: 'dimensions', p1: { x: reverse ? 5 : 0, y: 0 }, p2: { x: reverse ? 0 : 5, y: 0 }, offset: reverse ? -offset : offset });
const fixture = entities => ({ ...createDefaultDrawingContent(), entities });
const height = entity => getDimensionGeometry(entity).first.y;

test('spacing preserves its explicit base and source geometry on both sides, including reversed axes', () => {
    const content = fixture([linear('a', 1), linear('b', 4, true), linear('c', 8), linear('d', -4)]);
    content.entities[1].dimensionTextPosition = { x: 12, y: 8 };
    const before = structuredClone(content);
    const result = spaceDrawingDimensions(content, ['c', 'd', 'b', 'a'], '2 BASE a').content;
    assert.deepEqual(result.entities.map(height), [1, 3, 5, -1]);
    assert.equal(result.entities[0], content.entities[0]);
    assert.deepEqual(result.entities[1].dimensionTextPosition, { x: 12, y: 8 });
    for (let index = 0; index < content.entities.length; index += 1) {
        assert.equal(getDimensionGeometry(result.entities[index]).value, getDimensionGeometry(content.entities[index]).value);
        assert.deepEqual(result.entities[index].p1, content.entities[index].p1);
    }
    assert.deepEqual(content, before);
});

test('automatic spacing uses selected text heights and zero aligns to the first selected base', () => {
    const content = fixture([linear('a', 1), { ...linear('b', 5), textSize: 0.8 }, linear('c', 7)]);
    assert.deepEqual(spaceDrawingDimensions(content, ['a', 'b', 'c'], 'AUTO').content.entities.map(height), [1, 2.6, 4.2]);
    assert.deepEqual(spaceDrawingDimensions(content, ['b', 'a', 'c'], '0').content.entities.map(height), [5, 5, 5]);
});

test('angular spacing preserves measured angles and rejects collapsed inward radii atomically', () => {
    const angular = (id, radius) => ({ id, type: 'angularDimension', layerId: 'dimensions', vertex: { x: 2, y: 3 }, ray1Point: { x: 5, y: 3 }, ray2Point: { x: 2, y: 7 }, radius });
    const content = fixture([angular('a', 2), angular('b', 5), angular('c', 8)]);
    const result = spaceDrawingDimensions(content, ['a', 'b', 'c'], '1').content;
    assert.deepEqual(result.entities.map(entity => getDimensionGeometry(entity).radius), [2, 3, 4]);
    assert.ok(result.entities.every(entity => getDimensionGeometry(entity).value === getDimensionGeometry(content.entities[0]).value));
    assert.equal(spaceDrawingDimensions(content, ['c', 'b', 'a'], '5').error, 'spacingGeometry');
    content.entities[1].vertex = { x: 3, y: 3 };
    assert.equal(spaceDrawingDimensions(content, ['a', 'b'], '1').error, 'spacingGeometry');
});

test('spacing rejects invalid syntax, missing or locked targets and incompatible geometry', () => {
    const content = fixture([linear('a', 1), linear('b', 3)]);
    for (const input of ['-1', 'Infinity', '1 BASE', 'AUTO junk', 'NaN']) assert.equal(spaceDrawingDimensions(content, ['a', 'b'], input).error, 'spacingSyntax');
    assert.equal(spaceDrawingDimensions(content, ['a', 'missing'], '1').error, 'selection');
    assert.equal(spaceDrawingDimensions(content, ['a', 'b'], '1 BASE missing').error, 'selection');
    content.entities[1].locked = true;
    assert.equal(spaceDrawingDimensions(content, ['a', 'b'], '1').error, 'selection');
    delete content.entities[1].locked;
    content.entities[1].p2.y = 3;
    assert.equal(spaceDrawingDimensions(content, ['a', 'b'], '1').error, 'spacingGeometry');
});


test('interactive spacing previews perpendicular gaps without modifying the document', () => {
    const content = fixture([linear('a', 1), linear('b', 5), linear('c', 8)]);
    const before = structuredClone(content);
    const operation = beginDimensionSpacing(content, ['c', 'a', 'b'], 'POINT BASE a').operation;
    assert.equal(operation.baseId, 'a');
    assert.deepEqual(operation.basePoint, { x: 0, y: 1 });
    const preview = spaceDimensionsAtPoint(content, operation, { x: 200, y: 3 }).content;
    assert.deepEqual(preview.entities.map(height), [1, 3, 5]);
    assert.deepEqual(content, before);
    assert.deepEqual(spaceDimensionsAtPoint(content, operation, { x: 200, y: -1 }).content, preview);
    assert.equal(spaceDimensionsAtPoint(content, operation, { x: Infinity, y: 2 }).error, 'spacingGeometry');
    content.entities[1].locked = true;
    assert.equal(spaceDimensionsAtPoint(content, operation, { x: 1, y: 3 }).error, 'selection');
    assert.equal(beginDimensionSpacing(content, ['a', 'b']).error, 'selection');
});

test('interactive angular spacing measures distance to the base arc and validates syntax', () => {
    const angular = (id, radius) => ({ id, type: 'angularDimension', layerId: 'dimensions', vertex: { x: 2, y: 3 }, ray1Point: { x: 5, y: 3 }, ray2Point: { x: 2, y: 7 }, radius });
    const content = fixture([angular('a', 2), angular('b', 5), angular('c', 8)]);
    const operation = beginDimensionSpacing(content, ['a', 'b', 'c']).operation;
    assert.deepEqual(spaceDimensionsAtPoint(content, operation, { x: 2, y: 6 }).content.entities.map(entity => entity.radius), [2, 3, 4]);
    for (const input of ['POINT BASE', 'POINT other', 'AUTO', 'POINT BASE missing']) assert.ok(beginDimensionSpacing(content, ['a', 'b'], input).error);
});
