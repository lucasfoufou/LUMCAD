import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { parseDrawingDataInput, prepareDrawingDataReport, serializeDrawingDataReport, insertDrawingDataTable } from './drawingDataCommands.js';

test('extraction options accept explicit scopes, aggregation and export destinations; reject ambiguous syntax', () => {
    const options = parseDrawingDataInput('CSV SELECTED NESTED GROUP type,layer SUM length TO "/tmp/report a.csv"');
    assert.equal(options.path, '/tmp/report a.csv'); assert.equal(options.selected, true); assert.equal(options.nested, true);
    assert.deepEqual(options.sums, ['length']);
    assert.deepEqual(parseDrawingDataInput('2 -3', 'countTable').point, { x: 2, y: -3 });
    for (const text of ['TABLE', 'TABLE 1', 'TABLE x 2', 'LIST CSV', 'ALL SELECTED', 'GROUP type,type', 'LIST TO /tmp/a', 'SUM', 'wat']) assert.equal(parseDrawingDataInput(text), null, text);
});

test('reports export typed numbers, inert strings and unknown quantities; tables share native editing model', () => {
    const content = createDefaultDrawingContent();
    content.layers[0].name = '=1+1';
    content.entities = [{ id: 'a', type: 'line', layerId: content.layers[0].id, x1: 0, y1: 0, x2: 3, y2: 4 }];
    const before = structuredClone(content);
    const report = prepareDrawingDataReport(content, [], parseDrawingDataInput(''));
    const csv = serializeDrawingDataReport(report, 'CSV');
    assert.ok(csv.includes('"\'=1+1"')); assert.ok(csv.includes(',1,5,1,"",0'));
    assert.deepEqual(JSON.parse(serializeDrawingDataReport(report, 'JSON')), report);
    const result = insertDrawingDataTable(content, report, { x: 2, y: 3 });
    assert.ok(!result.error); assert.equal(result.selectedIds.length, 1);
    const table = result.content.entities.at(-1).table;
    assert.equal(table.cells[1][1].value, "'=1+1");
    assert.deepEqual(content, before);
    content.layers[0].locked = true;
    assert.equal(insertDrawingDataTable(content, report, { x: 0, y: 0 }).error, 'layer');
    assert.throws(() => prepareDrawingDataReport(content, [], parseDrawingDataInput('SELECTED')), /Empty/);
});
