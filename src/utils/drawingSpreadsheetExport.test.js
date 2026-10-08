import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from 'xlsx';
import { createDrawingSpreadsheet } from './drawingSpreadsheetExport.js';
import { parseDrawingDataInput, manageDrawingDataDefinition } from './drawingDataCommands.js';

test('XLS contains real BIFF8 numeric/text cells with Unicode, literal formulas and blank unknown values', async () => {
    const bytes = await createDrawingSpreadsheet([['Type', 'Length (m)', 'Area (m²)'], ['Étage 中文', -1.25, null], ['=1+1', 0, 4]]);
    assert.deepEqual([...bytes.slice(0, 8)], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const book = read(bytes, { type: 'array' }); const sheet = book.Sheets.Quantities;
    assert.equal(sheet.A2.v, 'Étage 中文'); assert.equal(sheet.A3.v, '=1+1'); assert.equal(sheet.A3.t, 's'); assert.equal(sheet.A3.f, undefined);
    assert.equal(sheet.B2.v, -1.25); assert.equal(sheet.B2.t, 'n'); assert.equal(sheet.B3.v, 0);
    assert.ok(!sheet.C2 || sheet.C2.t === 'z');
    assert.equal(parseDrawingDataInput('XLS TO "/tmp/a.xls"').action, 'XLS');
    const content = manageDrawingDataDefinition({ entities: [] }, [], 'SAVE all').content;
    assert.equal(manageDrawingDataDefinition(content, [], 'RUN all XLS').options.action, 'XLS');
});

test('spreadsheet writer rejects truncation, ragged rows, nonfinite and oversized cells', async () => {
    for (const rows of [[], [[1], [1, 2]], [[Infinity]], [[{}]], [['x'.repeat(32768)]], [Array(257).fill(1)]]) {
        await assert.rejects(createDrawingSpreadsheet(rows), /Limit/);
    }
});
