import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { parseDrawingDataInput, prepareDrawingDataReport, insertDrawingDataTable } from './drawingDataCommands.js';
import { refreshDrawingQuantityTables } from './drawingQuantityTables.js';
import { commitDrawingHistoryState, undoDrawingHistoryState, redoDrawingHistoryState } from './drawingHistory.js';
import { editDrawingTableDefinition, normalizeDrawingTable } from './drawingTables.js';
import { remapDrawingBlockEntity } from './drawingBlocks.js';

const line = id => ({ id, type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 3, y2: 4 });
function fixture(selectedIds = null) {
    const document = createLcadDocument();
    document.content.entities = [line('a'), line('b')];
    const options = parseDrawingDataInput('10 20 LINKED GROUP type SUM length', 'countTable');
    const report = prepareDrawingDataReport(document.content, [], options);
    const definition = { id: 'q', name: 'Lengths', groupBy: options.groupBy, sums: options.sums, nested: false, selectedIds };
    const result = insertDrawingDataTable(document.content, report, options.point, { quantityDefinition: definition });
    document.content = refreshDrawingQuantityTables(result.content);
    return document;
}
const table = content => content.entities.find(entity => entity.table);
const values = content => table(content).table.cells.map(row => row.map(cell => cell.value));

test('linked quantities update in the source undo step and retain exact archive query and cells', () => {
    const document = fixture();
    const initial = { past: [], present: document, future: [], coalesceKey: null };
    const next = { ...document, content: { ...document.content, entities: [...document.content.entities, line('c')] } };
    const changed = commitDrawingHistoryState(initial, next);
    assert.deepEqual(values(changed.present.content)[1], ['line', '3', '15', '3']);
    assert.equal(changed.past.length, 1);
    assert.deepEqual(undoDrawingHistoryState(changed).present, document);
    assert.deepEqual(redoDrawingHistoryState(undoDrawingHistoryState(changed)).present, changed.present);
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(changed.present))).document;
    assert.deepEqual(table(restored.content).table, table(changed.present.content).table);
    assert.equal(table(changed.present.content).id, table(document.content).id);
    assert.deepEqual(table(changed.present.content).table.transform, table(document.content).table.transform);
});

test('fixed scopes ignore additions, remove deleted roots, and report an empty result without self-counting', () => {
    const document = fixture(['a']); const source = structuredClone(document.content);
    assert.deepEqual(values(source)[1], ['line', '1', '5', '1']);
    const refreshed = refreshDrawingQuantityTables({ ...source, entities: source.entities.filter(entity => entity.id !== 'a') });
    assert.equal(table(refreshed).table.quantityLink.status, 'empty');
    assert.equal(values(refreshed).length, 1);
    assert.deepEqual(source, document.content);
    assert.equal(refreshDrawingQuantityTables(document.content), document.content);
});

test('query failures retain marked values and recover; excessive table output cannot appear current', () => {
    const document = fixture(); const originalValues = values(document.content);
    const missing = { id: 'broken', type: 'blockReference', layerId: 'geometry', blockId: 'absent' };
    const failed = refreshDrawingQuantityTables({ ...document.content, entities: [...document.content.entities, missing] });
    assert.equal(table(failed).table.quantityLink.status, 'dependency');
    assert.deepEqual(values(failed), originalValues);
    const recovered = refreshDrawingQuantityTables({ ...failed, entities: failed.entities.filter(entity => entity.id !== 'broken') });
    assert.equal(table(recovered).table.quantityLink.status, 'current');
    const entity = structuredClone(table(document.content));
    entity.table.quantityLink.definition.groupBy = ['id'];
    const limited = refreshDrawingQuantityTables({ ...document.content, entities: [entity, ...Array.from({ length: 256 }, (_, i) => line(`l${i}`))] });
    assert.equal(table(limited).table.quantityLink.status, 'limit');
    assert.deepEqual(values(limited), originalValues);
});

test('linked values are read-only until detach; formatting survives updates and clipboard scopes remap safely', () => {
    const document = fixture(['a']); const entity = table(document.content);
    assert.equal(editDrawingTableDefinition(entity.table, { action: 'cell', address: 'B2', value: '999' }), null);
    const styled = editDrawingTableDefinition(entity.table, { action: 'cellStyle', address: 'B2', style: { bold: true } });
    const refreshed = refreshDrawingQuantityTables({ ...document.content, entities: document.content.entities.map(item => item === entity ? { ...entity, table: styled } : item) });
    assert.equal(table(refreshed).table.cells[1][1].style.bold, true);
    const detached = editDrawingTableDefinition(styled, { action: 'detachQuantity' });
    assert.equal(detached.quantityLink, undefined);
    assert.ok(editDrawingTableDefinition(detached, { action: 'cell', address: 'B2', value: '999' }));
    assert.deepEqual(remapDrawingBlockEntity(entity, { entityIdMap: new Map([['a', 'copy-a']]) }).table.quantityLink.definition.selectedIds, ['copy-a']);
    assert.equal(remapDrawingBlockEntity(entity).table.quantityLink, undefined);
    assert.equal(normalizeDrawingTable({ ...entity.table, quantityLink: { ...entity.table.quantityLink, headers: [] } }), null);
});

test('linked queries exclude nested tables and keep formula-like names inert', () => {
    const document = fixture();
    const entity = structuredClone(table(document.content));
    entity.table.quantityLink.definition.nested = true;
    const block = { id: 'assembly', name: '=1+1', entities: [line('child'), entity] };
    const reference = { id: 'insert', type: 'blockReference', layerId: 'geometry', blockId: block.id,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } };
    const content = { ...document.content, blocks: [block], entities: [entity, reference] };
    entity.table.quantityLink.definition.groupBy = ['block'];
    const refreshed = refreshDrawingQuantityTables(content);
    assert.equal(values(refreshed)[1][0], "'=1+1");
    assert.equal(values(refreshed).length, 3);
    assert.equal(table(refreshed).table.quantityLink.status, 'current');
});
