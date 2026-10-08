import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingSheetSet, parseDrawingSheetSet, normalizeDrawingSheetSet, editDrawingSheetSet, prepareDrawingSheetSetPublication } from './drawingSheetSets.js';

function fixture() {
    const set = createDrawingSheetSet('Permit drawings');
    return editDrawingSheetSet(set, [
        { type: 'source', source: { id: 'a', path: 'plans/ground.lcad', documentId: 'drawing-a' } },
        { type: 'source', source: { id: 'b', path: '../details.lcad', documentId: 'drawing-b' } },
        { type: 'sheet', sheet: { id: 'one', sourceId: 'a', layoutId: 'ground', number: 'A-01', title: 'Ground floor' } },
        { type: 'sheet', sheet: { id: 'two', sourceId: 'b', layoutId: 'details', number: 'A-02', title: 'Details' } },
    ]);
}

test('portable sheet sets retain independent source/layout identities and explicit publication order', () => {
    const set = fixture();
    const reordered = editDrawingSheetSet(set, [{ type: 'order', ids: ['two', 'one'] }]);
    assert.deepEqual(parseDrawingSheetSet(JSON.stringify(reordered)), reordered);
    const documents = new Map([['a', { id: 'drawing-a', layouts: [{ id: 'ground' }] }], ['b', { id: 'drawing-b', layouts: [{ id: 'details' }] }]]);
    const plan = prepareDrawingSheetSetPublication(reordered, documents);
    assert.deepEqual(plan.map(page => [page.index, page.number, page.documentId, page.layoutId]), [[1, 'A-02', 'drawing-b', 'details'], [2, 'A-01', 'drawing-a', 'ground']]);
    assert.deepEqual(set.sheets.map(sheet => sheet.id), ['one', 'two']);
});

test('batch numbering and metadata changes are atomic and do not mutate supplied sheets or changes', () => {
    const set = fixture();
    const changes = [{ type: 'sheet', sheet: { ...set.sheets[0], number: 'A-02' } },
        { type: 'sheet', sheet: { ...set.sheets[1], number: 'A-01' } },
        { type: 'properties', ids: null, properties: { Project: 'School', Revision: 'B' } },
        { type: 'properties', ids: ['one', 'two'], properties: { Checked: 'Yes' } },
        { type: 'properties', ids: ['one'], properties: { Revision: 'C' } }];
    const before = structuredClone([set, changes]);
    const result = editDrawingSheetSet(set, changes);
    assert.deepEqual([set, changes], before);
    assert.deepEqual(result.sheets.map(sheet => sheet.number), ['A-02', 'A-01']);
    const documents = new Map([['a', { id: 'drawing-a', layouts: [{ id: 'ground' }] }], ['b', { id: 'drawing-b', layouts: [{ id: 'details' }] }]]);
    const plan = prepareDrawingSheetSetPublication(result, documents);
    assert.deepEqual(plan[0].properties, { Project: 'School', Revision: 'C', Checked: 'Yes' });
    assert.equal(plan[1].properties.Revision, 'B');
});

test('ambiguous numbering, broken references, invalid permutations and remote sources refuse', () => {
    const set = fixture(); const before = structuredClone(set);
    assert.throws(() => editDrawingSheetSet(set, [{ type: 'sheet', sheet: { ...set.sheets[0], number: 'a-02' } }]), /sheetSetDuplicate/);
    assert.throws(() => editDrawingSheetSet(set, [{ type: 'removeSource', id: 'a' }]), /sheetSetSource/);
    assert.throws(() => editDrawingSheetSet(set, [{ type: 'order', ids: ['one', 'one'] }]), /sheetSetOrder/);
    assert.throws(() => editDrawingSheetSet(set, [{ type: 'source', source: { ...set.sources[0], path: 'https://example.org/drawing.lcad' } }]), /sheetSetPath/);
    assert.throws(() => normalizeDrawingSheetSet({ ...set, version: 2 }), /sheetSetInvalid/);
    assert.deepEqual(set, before);
});

test('missing or replaced drawings and missing/ambiguous layouts prevent partial publication', () => {
    const set = fixture();
    const documents = new Map([['a', { id: 'drawing-a', layouts: [{ id: 'ground' }] }]]);
    assert.throws(() => prepareDrawingSheetSetPublication(set, documents), /sheetSetSourceChanged/);
    documents.set('b', { id: 'another-drawing', layouts: [{ id: 'details' }] });
    assert.throws(() => prepareDrawingSheetSetPublication(set, documents), /sheetSetSourceChanged/);
    documents.set('b', { id: 'drawing-b', layouts: [] });
    assert.throws(() => prepareDrawingSheetSetPublication(set, documents), /sheetSetLayoutMissing/);
    documents.get('b').layouts = [{ id: 'details' }, { id: 'details' }];
    assert.throws(() => prepareDrawingSheetSetPublication(set, documents), /sheetSetLayoutMissing/);
    assert.throws(() => parseDrawingSheetSet(' '.repeat(4 * 1024 * 1024 + 1)), /sheetSetLimit/);
    const properties = Object.fromEntries(Array.from({ length: 128 }, (_, index) => [`Field ${index}`, 'x'.repeat(4096)]));
    const oversized = { ...set, sheets: Array.from({ length: 9 }, (_, index) => ({ ...set.sheets[0], id: `sheet-${index}`, number: String(index), properties })) };
    assert.throws(() => normalizeDrawingSheetSet(oversized), /sheetSetLimit/);
});
