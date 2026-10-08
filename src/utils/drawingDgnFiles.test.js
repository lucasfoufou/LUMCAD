import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDrawingDgnInput, readDrawingDgnFile } from './drawingDgnFiles.js';
import { parseDrawingCommand } from './drawingCommands.js';

test('DGNIMPORT parses quoted paths, explicit units and placement in any option order', () => {
    assert.deepEqual(parseDrawingDgnInput(''), { path: null, unit: null, x: 0, y: 0, scale: 1, cellMode: 'blocks' });
    assert.deepEqual(parseDrawingDgnInput('"/tmp/test drawing.dgn" SCALE 2 UNIT US-FT AT -3 4'),
        { path: '/tmp/test drawing.dgn', unit: 'us-ft', x: -3, y: 4, scale: 2, cellMode: 'blocks' });
    assert.equal(parseDrawingDgnInput('UNIT mm').unit, 'mm');
    assert.equal(parseDrawingDgnInput('CELLS EXPLODE UNIT m').cellMode, 'explode');
    assert.equal(parseDrawingCommand('DGNIMPORT UNIT m').command, 'dgnImport');
});

test('DGNIMPORT rejects missing/repeated options and invalid numbers before opening a file', () => {
    for (const input of ['CELLS', 'CELLS unknown', 'CELLS BLOCKS CELLS EXPLODE', 'UNIT', 'UNIT unknown', 'UNIT m UNIT mm', 'AT 1', 'AT 1 2 AT 3 4', 'AT "" 1',
        'SCALE 0', 'SCALE -1', 'SCALE Infinity', 'SCALE NaN', 'SCALE 2 SCALE 3', 'AT 1e10 0',
        'file.dgn extra', 'file.dgn UNIT m extra', '"unclosed']) {
        assert.throws(() => parseDrawingDgnInput(input), /dgnSyntax/, input);
    }
});

test('DGN browser imports refuse explicit filesystem paths', async () => {
    await assert.rejects(readDrawingDgnFile('/tmp/test.dgn', 'DGN'), /dgnDesktop/);
});
