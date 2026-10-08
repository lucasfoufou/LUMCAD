import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDrawingWmfInput } from './drawingWmfFiles.js';

test('WMFIN parses quoted paths, metre placement and scale without ambiguous repeated options', () => {
    assert.deepEqual(parseDrawingWmfInput(''), { path: null, x: 0, y: 0, scale: 1 });
    assert.deepEqual(parseDrawingWmfInput('"/tmp/test plan.wmf" SCALE 2 AT -3 4'), { path: '/tmp/test plan.wmf', x: -3, y: 4, scale: 2 });
    for (const input of ['AT 1', 'AT a 1', 'SCALE 0', 'SCALE Infinity', 'SCALE 2 SCALE 3', 'AT 1 2 AT 3 4', 'file.wmf extra']) {
        assert.throws(() => parseDrawingWmfInput(input), /wmfSyntax/);
    }
});


test('WMF export accepts one optional quoted destination and rejects import options', async () => {
    const { parseDrawingWmfExportInput } = await import('./drawingWmfFiles.js');
    assert.deepEqual(parseDrawingWmfExportInput(''), { path: null });
    assert.deepEqual(parseDrawingWmfExportInput('"/tmp/my drawing.wmf"'), { path: '/tmp/my drawing.wmf' });
    assert.throws(() => parseDrawingWmfExportInput('/tmp/a.wmf SCALE 2'), /wmfExportSyntax/);
    assert.throws(() => parseDrawingWmfExportInput('"unclosed'), /wmfExportSyntax/);
});
