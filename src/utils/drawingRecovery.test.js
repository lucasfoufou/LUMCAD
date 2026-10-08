import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument } from './lcadDocument.js';
import { salvageDrawingDocument } from './drawingRecovery.js';
const line = (id, extra = {}) => ({ id, type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0, ...extra });

test('salvage retains useful geometry, isolates raw defects and repairs missing layer ownership', () => {
    const document = createLcadDocument();
    document.content.entities = [line('keep', { layerId: 'lost' }), line('bad', { x2: NaN }), line('keep'),
        { id: 'image', type: 'image', assetId: 'lost-image', layerId: 'geometry', x: 1, y: 2, width: 3, height: 4 }];
    const original = structuredClone(document);
    const result = salvageDrawingDocument(document);
    assert.equal(result.report.valid, true);
    assert.deepEqual(result.document.content.entities, [document.content.entities[0]]);
    assert.equal(result.report.quarantine.length, 3);
    assert.ok(Number.isNaN(result.report.quarantine.find(item => item.value.id === 'bad').value.x2));
    assert.ok(result.document.content.layers.some(layer => layer.id === 'lost'));
    assert.deepEqual(document, original);
    assert.equal(salvageDrawingDocument(result.document).changed, false);
});

test('salvage removes broken dependent objects in later passes and retains valid geometric relationships', () => {
    const document = createLcadDocument();
    document.content.entities = [line('good'), line('bad', { x2: Infinity }), line('dependent', { sourceId: 'bad' })];
    document.content.geometricConstraints = [
        { id: 'valid', type: 'horizontal', refs: [{ entityId: 'good' }] },
        { id: 'broken', type: 'horizontal', refs: [{ entityId: 'bad' }] },
    ];
    const result = salvageDrawingDocument(document);
    assert.equal(result.report.valid, true);
    assert.deepEqual(result.document.content.entities.map(entity => entity.id), ['good']);
    assert.deepEqual(result.document.content.geometricConstraints, [document.content.geometricConstraints[0]]);
    assert.equal(result.report.quarantine.filter(item => item.kind === 'entity').length, 2);
    assert.ok(result.report.quarantine.some(item => item.kind === 'geometricConstraint'));
    assert.deepEqual(salvageDrawingDocument(document, { maxPasses: 1 }), { error: 'limit' });
});

test('salvage handles block-local and paper objects and leaves unresolved catalogs explicitly invalid', () => {
    const document = createLcadDocument();
    document.content.blocks = [{ id: 'block', entities: [line('good'), line('bad', { x1: NaN })] }];
    document.layouts[0].paperEntities = [line('paper'), line('paper-bad', { y2: NaN })];
    document.content.parameters = [{ name: 'cycle', expression: 'cycle', type: 'number' }];
    const result = salvageDrawingDocument(document);
    assert.deepEqual(result.document.content.blocks[0].entities.map(entity => entity.id), ['good']);
    assert.deepEqual(result.document.layouts[0].paperEntities.map(entity => entity.id), ['paper']);
    assert.equal(result.report.valid, false);
    assert.ok(result.report.issues.some(issue => issue.code === 'invalidDimensionalConstraints'));
});

test('salvage quarantines corrupt insertion transforms without relocating surviving references', () => {
    const document = createLcadDocument();
    document.content.blocks = [{ id: 'cache', entities: [line('definition')] }];
    const reference = { type: 'blockReference', blockId: 'cache', layerId: 'geometry' };
    document.content.entities = [
        { ...reference, id: 'bad', transform: { a: 1, b: 0, c: 0, d: 1, e: null, f: 0 } },
        { ...reference, id: 'good', transform: { a: -2, b: 0, c: 0, d: 2, e: 13, f: 7 } },
    ];
    const original = structuredClone(document);
    const result = salvageDrawingDocument(document);
    assert.equal(result.report.valid, true);
    assert.deepEqual(result.document.content.entities, [original.content.entities[1]]);
    assert.deepEqual(result.report.quarantine[0].value, original.content.entities[0]);
    assert.deepEqual(result.document.content.blocks, original.content.blocks);
    assert.deepEqual(document, original);
});
