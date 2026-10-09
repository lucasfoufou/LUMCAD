import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDrawingCadInput } from './drawingCadFiles.js';

test('CAD import options accept SKIP once and refuse it on export', () => {
    assert.deepEqual(parseDrawingCadInput('"/tmp/site plan.dxf" UNIT us-ft SKIP AT 1 2'),
        { path: '/tmp/site plan.dxf', x: 1, y: 2, scale: 1, unit: 'us-ft', skip: true });
    assert.equal(parseDrawingCadInput('SKIP').skip, true);
    assert.equal(parseDrawingCadInput('').skip, false);
    for (const input of ['SKIP SKIP', 'UNIT parsec']) assert.throws(() => parseDrawingCadInput(input), /cadSyntax/);
    assert.throws(() => parseDrawingCadInput('"/tmp/out.dxf" SKIP', true), /cadSyntax/);
});
