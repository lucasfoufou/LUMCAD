import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDrawingOrderInput, reorderDrawingEntities, drawingAnnotationIds } from './drawingOrder.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const content = () => ({ ...createDefaultDrawingContent(), entities: ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({ id, type: 'line', layerId: 'geometry', x1: index, y1: 0, x2: index, y2: 1 })) });
const ids = content => content.entities.map(entity => entity.id).join('');

test('front/back and relative order preserve both selected and unselected ordering', () => {
    const original = content();
    assert.equal(ids(reorderDrawingEntities(original, ['d', 'b'], 'front')), 'acebd');
    assert.equal(ids(reorderDrawingEntities(original, ['d', 'b'], 'back')), 'bdace');
    assert.equal(ids(reorderDrawingEntities(original, ['a', 'e'], 'above', 'c')), 'bcaed');
    assert.equal(ids(reorderDrawingEntities(original, ['a', 'e'], 'below', 'c')), 'baecd');
    assert.equal(ids(original), 'abcde');
    assert.ok(reorderDrawingEntities(original, ['a'], 'front').entities.every(entity => original.entities.includes(entity)));
});

test('one-level moves keep groups stable and do not wrap at either end', () => {
    const original = content();
    assert.equal(ids(reorderDrawingEntities(original, ['a', 'b'], 'forward')), 'cabde');
    assert.equal(ids(reorderDrawingEntities(original, ['c', 'd'], 'backward')), 'acdbe');
    assert.equal(ids(reorderDrawingEntities(original, ['b', 'd'], 'forward')), 'acbed');
    assert.equal(reorderDrawingEntities(original, ['a'], 'backward'), original);
    assert.equal(reorderDrawingEntities(original, ['e'], 'forward'), original);
    assert.equal(reorderDrawingEntities(original, ['a'], 'above', 'a'), original);
    assert.equal(reorderDrawingEntities(original, ['a'], 'below', 'missing'), original);
});

test('locked/hidden entities are excluded from moving and invisible references reject', () => {
    const original = content();
    original.entities[1].locked = true;
    original.layers.push({ id: 'hidden', visible: false, locked: false });
    original.entities[2].layerId = 'hidden';
    assert.equal(reorderDrawingEntities(original, ['b', 'c'], 'front'), original);
    assert.equal(reorderDrawingEntities(original, ['a'], 'above', 'c'), original);
    assert.equal(ids(reorderDrawingEntities(original, ['a', 'b', 'c'], 'front')), 'bcdea');
});

test('annotation filters, aliases and archive order use the shared entity sequence', () => {
    const original = content();
    original.entities[0].type = 'text';
    original.entities[1].type = 'linearDimension';
    assert.deepEqual(drawingAnnotationIds(original), ['a', 'b']);
    assert.deepEqual(drawingAnnotationIds(original, 'text'), ['a']);
    assert.deepEqual(drawingAnnotationIds(original, 'dimensions'), ['b']);
    assert.equal(parseDrawingOrderInput('B'), 'back');
    assert.equal(parseDrawingOrderInput('above'), 'above');
    assert.equal(parseDrawingOrderInput('wrong'), null);
    assert.equal(parseDrawingOrderInput(''), 'front');
    const document = createLcadDocument({ name: 'Draw order' });
    document.content = reorderDrawingEntities(content(), ['b', 'd'], 'back');
    assert.equal(ids(readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content), 'bdace');
});
