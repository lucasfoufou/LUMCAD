import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDrawingField, drawingFieldDependencyIds, remapDrawingField } from './drawingFieldDefinition.js';
import { createDrawingFieldEvaluator, refreshDrawingFields } from './drawingFields.js';
import { normalizeDrawingTextEntity } from './drawingText.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

function fixture() {
    const document = createLcadDocument({ name: 'Plan A' });
    document.content.metadata.projectName = 'Atelier';
    document.content.metadata.rate = 2.5;
    const layerId = document.content.activeLayerId;
    document.content.entities = [
        { id: 'line', type: 'line', layerId, x1: 0, y1: 0, x2: 3, y2: 4 },
        { id: 'circle', type: 'circle', layerId, cx: 10, cy: 10, r: 2 },
        { id: 'table', type: 'polyline', layerId, table: { cells: [['3', '=A1*4']] } },
    ];
    return document;
}

test('fields resolve document metadata, geometry, spreadsheet cells, dates and layout numbers', () => {
    const document = fixture();
    const evaluator = createDrawingFieldEvaluator(document, { now: new Date('2026-10-07T12:34:56Z'), layoutId: document.layouts[0].id });
    const value = field => evaluator.evaluate(field).value;
    assert.equal(value({ kind: 'metadata', key: 'projectName', prefix: 'Projet : ' }), 'Projet : Atelier');
    assert.equal(value({ kind: 'document', property: 'name' }), 'Plan A');
    assert.equal(value({ kind: 'object', entityId: 'line', property: 'length', precision: 2, suffix: ' m' }), '5.00 m');
    assert.equal(value({ kind: 'object', entityId: 'circle', property: 'area', precision: 3 }), '12.566');
    assert.equal(value({ kind: 'object', entityId: 'circle', property: 'diameter' }), '4');
    assert.equal(value({ kind: 'object', entityId: 'circle', property: 'x' }), '8');
    assert.equal(value({ kind: 'table', entityId: 'table', address: 'B1' }), '12');
    assert.equal(value({ kind: 'date', format: 'dmy' }), '07/10/2026');
    assert.equal(value({ kind: 'date', format: 'datetime' }), '2026-10-07T12:34:56.000Z');
    assert.equal(value({ kind: 'page', property: 'number' }), '1');
    assert.equal(value({ kind: 'page', property: 'count' }), '1');
    assert.equal(value({ kind: 'page', property: 'name' }), document.layouts[0].name);
});

test('field formulas use numeric sources rather than their formatted labels and report dependency errors', () => {
    const evaluator = createDrawingFieldEvaluator(fixture());
    const formula = { kind: 'formula', expression: 'length * rate', bindings: {
        length: { kind: 'object', entityId: 'line', property: 'length', suffix: ' m' },
        rate: { kind: 'metadata', key: 'rate' },
    }, precision: 2 };
    assert.equal(evaluator.evaluate(formula).value, '12.50');
    assert.equal(evaluator.evaluate({ ...formula, expression: 'globalThis.process.exit()' }).error, '#FORMULA!');
    assert.equal(evaluator.evaluate({ ...formula, bindings: { ...formula.bindings, rate: { kind: 'metadata', key: 'projectName' } } }).error, '#VALUE!');
    assert.equal(evaluator.evaluate({ kind: 'object', entityId: 'missing', property: 'length' }).error, '#REF!');
    assert.equal(evaluator.evaluate({ kind: 'metadata', key: 'missing' }).error, '#REF!');
    assert.equal(evaluator.evaluate({ kind: 'page', property: 'number' }).error, '#REF!');
    assert.equal(evaluator.evaluate({ kind: 'table', entityId: 'table', address: 'A5' }).error, '#REF!');
});

test('field references detect cycles and refreshing preserves definition, appearance and unchanged entities', () => {
    const document = fixture(); const layerId = document.content.activeLayerId;
    const fieldText = (id, field) => normalizeDrawingTextEntity({ id, layerId, x: 0, y: 0, width: 5, height: 1, text: 'cached', fontSize: 0.4, fontWeight: 700, field });
    document.content.entities.push(fieldText('a', { kind: 'field', entityId: 'b' }), fieldText('b', { kind: 'field', entityId: 'a' }),
        fieldText('length', { kind: 'object', entityId: 'line', property: 'length' }));
    const refreshed = refreshDrawingFields(document);
    assert.equal(refreshed.content.entities[3].text, '#CYCLE!');
    assert.equal(refreshed.content.entities[4].text, '#CYCLE!');
    assert.equal(refreshed.content.entities[5].text, '5');
    assert.equal(refreshed.content.entities[5].fontWeight, 700);
    assert.deepEqual(refreshed.content.entities[5].field, document.content.entities[5].field);
    assert.equal(refreshed.content.entities[0], document.content.entities[0]);
    assert.equal(document.content.entities[5].text, 'cached');
    assert.equal(refreshDrawingFields(refreshed), refreshed);
    const moved = { ...refreshed, content: { ...refreshed.content, entities: refreshed.content.entities.map(entity => entity.id === 'line' ? { ...entity, x2: 6, y2: 8 } : entity) } };
    assert.equal(refreshDrawingFields(moved, { selectedIds: ['length'] }).content.entities[5].text, '10');
});

test('paper fields use their own layout and survive archive loading with cached display text', () => {
    const document = fixture();
    const paper = normalizeDrawingTextEntity({ id: 'page-number', x: 10, y: 10, width: 30, height: 10, text: 'cached', field: { kind: 'page', property: 'number', prefix: 'Page ' } });
    document.layouts[0].paperEntities = [paper];
    const updated = refreshDrawingFields(document);
    assert.equal(updated.layouts[0].paperEntities[0].text, 'Page 1');
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(updated))).document;
    assert.deepEqual(loaded.layouts[0].paperEntities[0].field, paper.field);
    assert.equal(loaded.layouts[0].paperEntities[0].text, 'Page 1');
});

test('field definitions bound nesting and keys, and remap nested source references without mutation', () => {
    assert.equal(normalizeDrawingField({ kind: 'metadata', key: '__proto__' }), null);
    assert.equal(normalizeDrawingField({ kind: 'object', entityId: 'x', property: '__proto__' }), null);
    assert.equal(normalizeDrawingField({ kind: 'formula', expression: '1', bindings: Object.fromEntries([['__proto__', { kind: 'date', format: 'iso' }]]) }), null);
    let field = { kind: 'object', entityId: 'a', property: 'length' };
    for (let i = 0; i < 10; i++) field = { kind: 'formula', expression: 'x', bindings: { x: field } };
    assert.equal(normalizeDrawingField(field), null);
    const source = { kind: 'formula', expression: 'x+y', bindings: { x: { kind: 'object', entityId: 'a', property: 'length' }, y: { kind: 'table', entityId: 'b', address: 'B1' } } };
    assert.deepEqual(drawingFieldDependencyIds(source), ['a', 'b']);
    assert.deepEqual(drawingFieldDependencyIds(remapDrawingField(source, new Map([['a', 'new-a'], ['b', 'new-b']]))), ['new-a', 'new-b']);
    assert.deepEqual(drawingFieldDependencyIds(source), ['a', 'b']);
    const invalid = normalizeDrawingTextEntity({ text: 'cached', field: { kind: 'unknown' } });
    assert.equal(invalid.field, undefined); assert.equal(invalid.text, 'cached');
});

test('FIELD commands create, edit, detach and update atomically with quoted formula bindings', async () => {
    const { parseDrawingFieldInput, createDrawingFieldText, editDrawingField, updateDrawingFields } = await import('./drawingFieldCommands.js');
    const document = fixture();
    const request = parseDrawingFieldInput('FORMULA "length * rate" BIND length "OBJECT line length" BIND rate "META rate" PREFIX "Prix : " PRECISION 2');
    assert.ok(request?.field);
    const created = createDrawingFieldText(document, request.field, { x: 5, y: 6 });
    const id = created.selectedIds[0];
    assert.equal(created.document.content.entities.at(-1).text, 'Prix : 12.50');
    assert.equal(document.content.entities.length, 3);
    const changed = { ...created.document, content: { ...created.document.content, metadata: { ...document.content.metadata, rate: 4 } } };
    const updated = updateDrawingFields(changed, { selectedIds: [id] });
    assert.equal(updated.document.content.entities.at(-1).text, 'Prix : 20.00');
    const detached = editDrawingField(updated.document, [id], { action: 'remove' });
    assert.equal(detached.document.content.entities.at(-1).field, undefined);
    assert.equal(detached.document.content.entities.at(-1).text, 'Prix : 20.00');
    const locked = { ...changed, content: { ...changed.content, entities: changed.content.entities.map(entity => entity.id === id ? { ...entity, locked: true } : entity) } };
    assert.equal(updateDrawingFields(locked).error, 'locked');
    assert.equal(editDrawingField(document, ['line'], request).error, 'selection');
    for (const input of ['META', 'OBJECT line', 'FORMULA "2" BIND', 'DATE bad', 'PAGE bad', 'META rate PRECISION 9', 'META rate PRECISION 2 PRECISION 3']) {
        assert.equal(parseDrawingFieldInput(input), null);
    }
});

test('copying a field includes and remaps its dependencies without making deletion cascade to field text', async () => {
    const { createDrawingFieldText } = await import('./drawingFieldCommands.js');
    const { createDrawingClipboardPayload, pasteDrawingClipboardPayload } = await import('./drawingClipboard.js');
    const { getDrawingEntityDependencyIds } = await import('./drawingDimensions.js');
    const document = createDrawingFieldText(fixture(), { kind: 'object', entityId: 'line', property: 'length' }, { x: 0, y: 5 }).document;
    const field = document.content.entities.at(-1);
    const payload = createDrawingClipboardPayload(document, [field.id]);
    assert.equal(payload.entities.length, 2);
    const pasted = pasteDrawingClipboardPayload(createLcadDocument(), payload, { mode: 'original' });
    const pastedField = pasted.entities.find(entity => entity.field);
    const pastedLine = pasted.entities.find(entity => entity.type === 'line');
    assert.notEqual(pastedLine.id, 'line');
    assert.equal(pastedField.field.entityId, pastedLine.id);
    assert.equal(createDrawingFieldEvaluator({ content: pasted.content, layouts: [] }).evaluateEntity(pastedField.id).value, '5');
    assert.deepEqual(getDrawingEntityDependencyIds(field), []);
    const withoutSource = { ...document, content: { ...document.content, entities: document.content.entities.filter(entity => entity.id !== 'line') } };
    assert.equal(refreshDrawingFields(withoutSource).content.entities.at(-1).text, '#REF!');
});
