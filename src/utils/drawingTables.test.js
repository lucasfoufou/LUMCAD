import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDrawingTable, evaluateDrawingTable, parseDrawingTableCsv, drawingTableToCsv, tableCellAddress, parseTableCellAddress } from './drawingTables.js';
import { prepareDrawingTableExport, parseDrawingTableImport } from './drawingTableCommands.js';

test('CSV import options preserve quoted paths and reject ambiguous or unsupported inputs', () => {
    assert.deepEqual(parseDrawingTableImport('CSV'), { path: null, delimiter: ',' });
    assert.deepEqual(parseDrawingTableImport('csv FROM "/tmp/table values.csv" DELIMITER SEMICOLON'), { path: '/tmp/table values.csv', delimiter: ';' });
    for (const value of ['', '2 3', 'CSV FROM', 'CSV DELIMITER pipe', 'CSV FROM a.csv FROM b.csv', 'CSV unknown']) {
        assert.equal(parseDrawingTableImport(value), null);
    }
});

test('table CSV export validates selection/options and preserves source formulas on locked layers', () => {
    const content = { entities: [{ id: 't', layerId: 'locked', table: { cells: [['é;"\n', '=2+3']] } }], layers: [{ id: 'locked', locked: true }] };
    const snapshot = structuredClone(content);
    const evaluated = prepareDrawingTableExport(content, ['t'], 'DELIMITER SEMICOLON TO "/tmp/a b.csv"');
    assert.equal(evaluated.path, '/tmp/a b.csv');
    assert.deepEqual(parseDrawingTableCsv(evaluated.text, ';'), [['é;"\n', '5']]);
    const formulas = prepareDrawingTableExport(content, ['t'], 'FORMULAS DELIMITER TAB');
    assert.deepEqual(parseDrawingTableCsv(formulas.text, '\t'), [['é;"\n', '=2+3']]);
    assert.deepEqual(content, snapshot);
    assert.equal(prepareDrawingTableExport(content, []).error, 'exportSelection');
    for (const input of ['VALUES FORMULAS', 'TO', 'DELIMITER pipe', 'TO a.csv TO b.csv', 'garbage']) {
        assert.equal(prepareDrawingTableExport(content, ['t'], input).error, 'exportSyntax');
    }
    assert.deepEqual(parseDrawingTableCsv(prepareDrawingTableExport({ entities: [{ id: 't', table: { cells: [['']] } }] }, ['t']).text), [['']]);
});

test('table dimensions and merges reject overlaps and invalid sizes without changing cell data', () => {
    const cells = [['Title', ''], ['a', 'b']];
    const table = normalizeDrawingTable({ cells, merges: [{ row: 0, column: 0, rows: 1, columns: 2 }] });
    assert.equal(table.cells[0][0].value, 'Title');
    assert.deepEqual(cells, [['Title', ''], ['a', 'b']]);
    assert.equal(normalizeDrawingTable({ ...table, merges: [...table.merges, { row: 0, column: 1, rows: 2, columns: 1 }] }), null);
    assert.equal(normalizeDrawingTable({ ...table, rowHeights: [0, 1] }), null);
    assert.equal(tableCellAddress(2, 27), 'AB3');
    assert.deepEqual(parseTableCellAddress('$AB$3'), { row: 2, column: 27 });
});

test('table formulas evaluate references, ranges and arithmetic while preserving their source', () => {
    const table = { cells: [['2', '3', '=A1+B1*2'], ['4', '', '=SUM(A1:B2)'], ['label', '=AVERAGE(A1:A2)', '=COUNT(A1:B3)'], ['=1e12', '=MAX(A1:B2)', '=MIN(A1:B2)']] };
    const result = evaluateDrawingTable(table);
    assert.equal(result[0][2].number, 8);
    assert.equal(result[1][2].number, 9);
    assert.equal(result[2][1].number, 3);
    assert.equal(result[2][2].number, 4);
    assert.equal(result[3][0].number, 1e12);
    assert.equal(result[3][1].number, 4);
    assert.equal(result[3][2].number, 2);
    assert.equal(table.cells[0][2], '=A1+B1*2');
});

test('table formula cycles, missing references, text arithmetic and invalid syntax are explicit errors', () => {
    const result = evaluateDrawingTable({ cells: [['=B1', '=A1', '=A200', '=D2+1'], ['=SUM(A1:B1)', '=1/0', '=globalThis.secret', 'text']] });
    assert.equal(result[0][0].error, '#CYCLE!');
    assert.equal(result[0][1].error, '#CYCLE!');
    assert.equal(result[0][2].error, '#REF!');
    assert.equal(result[0][3].error, '#VALUE!');
    assert.equal(result[1][0].error, '#CYCLE!');
    assert.equal(result[1][1].error, '#FORMULA!');
    assert.equal(result[1][2].error, '#FORMULA!');
});

test('CSV round trips quoted delimiters, quotes, multiline values and empty trailing cells', () => {
    const cells = [['a,b', 'a"b', 'first\nsecond', ''], ['=2+3', 'é', '', '']];
    assert.deepEqual(parseDrawingTableCsv(drawingTableToCsv({ cells }, { formulas: true })), cells);
    assert.equal(parseDrawingTableCsv(drawingTableToCsv({ cells }))[1][0], '5');
    assert.deepEqual(parseDrawingTableCsv('a;b\r\nc;\r\n', ';'), [['a', 'b'], ['c', '']]);
    assert.equal(parseDrawingTableCsv('"unclosed'), null);
    assert.equal(parseDrawingTableCsv('"a"garbage,b'), null);
});

test('table edits are immutable and unmerging restores all original cell values', async () => {
    const { editDrawingTableDefinition } = await import('./drawingTables.js');
    const original = { cells: [['a', 'b'], ['c', 'd']] };
    const merged = editDrawingTableDefinition(original, { action: 'merge', first: 'A1', last: 'B1' });
    assert.equal(merged.merges.length, 1);
    const edited = editDrawingTableDefinition(merged, { action: 'cell', address: 'A1', value: '=2+3' });
    const split = editDrawingTableDefinition(edited, { action: 'unmerge', address: 'B1' });
    assert.equal(split.cells[0][1].value, 'b');
    assert.equal(evaluateDrawingTable(split)[0][0].number, 5);
    assert.deepEqual(original.cells, [['a', 'b'], ['c', 'd']]);
    assert.equal(editDrawingTableDefinition(split, { action: 'rowHeight', index: 0, value: -1 }), null);
});

test('cell formatting overrides only chosen properties and reset resumes table style inheritance', async () => {
    const { editDrawingTableDefinition } = await import('./drawingTables.js');
    const { parseDrawingTableEdit } = await import('./drawingTableCommands.js');
    const { rebuildDrawingTableEntity } = await import('./drawingTableGeometry.js');
    const source = { cells: [['Header'], ['Value']], style: { fontSize: 0.4, color: '#112233' } };
    const edit = parseDrawingTableEdit('FORMAT A2 COLOR #ff0000 ALIGN right BOLD ON');
    let table = editDrawingTableDefinition(source, edit);
    assert.deepEqual(table.cells[1][0].style, { color: '#ff0000', alignment: 'right', bold: true });
    table = editDrawingTableDefinition(table, { action: 'style', style: { ...table.style, fontSize: 0.6 } });
    const text = rebuildDrawingTableEntity({ id: 't', table }).parts.find(part => part.id === 't:cell:1:0');
    assert.equal(text.fontSize, 0.6);
    assert.equal(text.color, '#ff0000');
    assert.equal(text.horizontalAlign, 'right');
    assert.equal(text.fontWeight, 700);
    const reset = editDrawingTableDefinition(table, parseDrawingTableEdit('FORMAT A2 RESET'));
    assert.equal(reset.cells[1][0].style, undefined);
    assert.equal(reset.cells[1][0].value, 'Value');
    assert.equal(rebuildDrawingTableEntity({ id: 't', table: reset }).parts.find(part => part.id === 't:cell:1:0').color, '#112233');
    for (const invalid of ['FORMAT', 'FORMAT A1', 'FORMAT A1 FONT 0', 'FORMAT A1 ALIGN diagonal', 'FORMAT A1 COLOR red', 'FORMAT A1 BOLD maybe', 'FORMAT A1 BOLD ON BOLD OFF']) {
        assert.equal(parseDrawingTableEdit(invalid), null);
    }
    assert.equal(source.cells[1][0], 'Value');
});

test('table materialization omits merged internal rules and computes displayed formula text', async () => {
    const { rebuildDrawingTableEntity } = await import('./drawingTableGeometry.js');
    const entity = rebuildDrawingTableEntity({ id: 'table', layerId: 'geometry', table: { cells: [['title', 'hidden'], ['2', '=A2*3']],
        merges: [{ row: 0, column: 0, rows: 1, columns: 2 }] } });
    assert.equal(entity.parts.filter(part => part.type === 'text').length, 3);
    assert.equal(entity.parts.find(part => part.id === 'table:cell:1:1').text, '6');
    assert.equal(entity.parts.some(part => part.id === 'table:grid:v:1:0'), false);
    assert.equal(entity.parts.some(part => part.id === 'table:grid:v:1:1'), true);
});

test('table transforms and edits retain cell sources and stable generated identities', async () => {
    const { rebuildDrawingTableEntity } = await import('./drawingTableGeometry.js');
    const { translateEntity, rotateEntity } = await import('./drawingPrimitives.js');
    const { normalizeDrawingContent } = await import('./drawingDocument.js');
    const { editDrawingTableDefinition } = await import('./drawingTables.js');
    let entity = rebuildDrawingTableEntity({ id: 'table', layerId: 'geometry', table: { cells: [['2', '=A1+3']] } });
    const ids = entity.parts.map(part => part.id);
    entity = rotateEntity(translateEntity(entity, 10, 20), 90, { x: 0, y: 0 });
    entity = rebuildDrawingTableEntity({ ...entity, table: editDrawingTableDefinition(entity.table, { action: 'cell', address: 'A1', value: '4' }) });
    const normalized = normalizeDrawingContent({ entities: [entity] }).entities[0];
    assert.deepEqual(normalized.parts.map(part => part.id), ids);
    assert.equal(normalized.table.cells[0][1].value, '=A1+3');
    assert.equal(normalized.parts[1].text, '7');
    assert.ok(Math.abs(normalized.table.transform.e + 20) < 1e-8);
    assert.ok(Math.abs(normalized.table.transform.f - 10) < 1e-8);
});

test('table command creation and editing use atomic document changes and preserve formulas', async () => {
    const { createDrawingTable, editDrawingTable, parseDrawingTableCreation, parseDrawingTableEdit } = await import('./drawingTableCommands.js');
    const { createDefaultDrawingContent } = await import('./drawingDocument.js');
    const source = createDefaultDrawingContent();
    const created = createDrawingTable(source, parseDrawingTableCreation('2 2 0.8 3'), { x: 10, y: 20 });
    assert.equal(source.entities.length, 0);
    assert.equal(created.content.entities[0].table.transform.e, 10);
    const edited = editDrawingTable(created.content, created.selectedIds, parseDrawingTableEdit('CELL B2 "=2+3"'));
    assert.equal(edited.content.entities[0].parts.find(part => part.id.endsWith(':cell:1:1')).text, '5');
    assert.equal(created.content.entities[0].table.cells[1][1].value, '');
    assert.equal(editDrawingTable(edited.content, edited.selectedIds, parseDrawingTableEdit('MERGE A1 Z99')).error, 'invalid');
    assert.equal(parseDrawingTableCreation('500 500'), null);
});

test('named table styles persist and only explicit application changes existing tables', async () => {
    const { createDrawingTable, parseDrawingTableCreation, runDrawingTableStyle } = await import('./drawingTableCommands.js');
    const { createDefaultDrawingContent, normalizeDrawingContent } = await import('./drawingDocument.js');
    const created = createDrawingTable(createDefaultDrawingContent(), parseDrawingTableCreation('2 2'), { x: 0, y: 0 });
    const saved = runDrawingTableStyle(created.content, 'SET "Schedule" FONT 0.4 COLOR #123456 HEADERS 2 ALIGN right');
    assert.equal(saved.content.entities[0].table.style.fontSize, 0.25);
    const applied = runDrawingTableStyle(saved.content, 'APPLY "Schedule"', created.selectedIds);
    assert.equal(applied.content.entities[0].table.style.fontSize, 0.4);
    assert.equal(applied.content.entities[0].parts[0].horizontalAlign, 'right');
    assert.equal(applied.content.entities[0].parts[0].fontWeight, 700);
    assert.deepEqual(normalizeDrawingContent(applied.content).tableStyles, applied.content.tableStyles);
    assert.equal(runDrawingTableStyle(applied.content, 'DELETE Standard').error, 'styleMissing');
    assert.equal(runDrawingTableStyle(applied.content, 'SET bad FONT -1').error, 'styleSyntax');
});
