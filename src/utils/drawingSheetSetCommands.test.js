import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingSheetSet, editDrawingSheetSet } from './drawingSheetSets.js';
import { editDrawingSheetSetCommand } from './drawingSheetSetCommands.js';

function fixture() {
    return editDrawingSheetSet(createDrawingSheetSet('Permit'), [
        { type: 'source', source: { id: 'source', path: '/plans/permit.lcad', documentId: 'drawing' } },
        ...['first', 'second'].map((id, index) => ({ type: 'sheet', sheet: {
            id, sourceId: 'source', layoutId: id, number: `A-${index + 1}`, title: id,
        } })),
    ]);
}

test('sheet commands address current report positions after reordering without changing identities', () => {
    const original = fixture(); const before = structuredClone(original);
    let result = editDrawingSheetSetCommand(original, ['ORDER', '2', '1']);
    result = editDrawingSheetSetCommand(result, ['NUMBER', '1', 'B-07']);
    result = editDrawingSheetSetCommand(result, ['TITLE', '1', 'Roof details']);
    assert.deepEqual(result.sheets.map(sheet => [sheet.id, sheet.number, sheet.title]), [
        ['second', 'B-07', 'Roof details'], ['first', 'A-1', 'first'],
    ]);
    result = editDrawingSheetSetCommand(result, ['REMOVE', '2']);
    assert.deepEqual(result.sheets.map(sheet => sheet.id), ['second']);
    assert.deepEqual(result.sources, original.sources);
    assert.deepEqual(original, before);
});

test('sheet metadata commands distinguish project, all sheets and one sheet', () => {
    let set = fixture();
    set = editDrawingSheetSetCommand(set, ['PROPERTY', 'project', 'Client', 'School']);
    set = editDrawingSheetSetCommand(set, ['PROPERTY', 'all', 'Revision', 'A']);
    set = editDrawingSheetSetCommand(set, ['PROPERTY', '2', 'Revision', 'B']);
    assert.deepEqual(set.properties, { Client: 'School' });
    assert.deepEqual(set.sheets.map(sheet => sheet.properties), [{ Revision: 'A' }, { Revision: 'B' }]);
    const special = editDrawingSheetSetCommand(set, ['PROPERTY', 'PROJECT', '__proto__', 'Literal metadata']);
    assert.equal(Object.getPrototypeOf(special.properties), Object.prototype);
    assert.equal(special.properties.__proto__, 'Literal metadata');
});

test('invalid sheet commands and number collisions leave the original project untouched', () => {
    const set = fixture(); const before = structuredClone(set);
    for (const tokens of [
        ['REMOVE', '0'], ['REMOVE', '3'], ['TITLE', '01', 'Title'], ['NUMBER', '1', 'a-2'],
        ['ORDER', '1'], ['ORDER', '2', '2'], ['PROPERTY', '3', 'Client', 'School'],
        ['PROPERTY', 'ALL', 'Client'], ['TITLE', '1', ''], ['REMOVE', '1', '2'], ['UNKNOWN'],
    ]) {
        assert.throws(() => editDrawingSheetSetCommand(set, tokens), /sheetSet/);
        assert.deepEqual(set, before);
    }
});
