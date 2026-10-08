import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDrawingDwfAttachInput } from './drawingDwfCommands.js';

test('DWFATTACH accepts picker defaults and quoted paths with unordered placement options', () => {
    assert.deepEqual(parseDrawingDwfAttachInput(''), { path: null, pageNumber: 1, x: 0, y: 0, scale: 1 });
    assert.deepEqual(parseDrawingDwfAttachInput('"/tmp/two pages.dwfx" scale 2 AT -3 4 PAGE 2'),
        { path: '/tmp/two pages.dwfx', pageNumber: 2, x: -3, y: 4, scale: 2 });
    assert.deepEqual(parseDrawingDwfAttachInput('PAGE 3'), { path: null, pageNumber: 3, x: 0, y: 0, scale: 1 });
});

test('DWFATTACH rejects ambiguous, incomplete and out-of-bounds options before reading a source', () => {
    for (const input of ['"unterminated', '""', 'AT "" 2', 'AT 1', 'PAGE', 'PAGE 0', 'PAGE 1.5',
        'PAGE 10001', 'PAGE 2 PAGE 3', 'AT 1 2 AT 3 4', 'SCALE 2 SCALE 3', 'SCALE 0', 'SCALE -1',
        'SCALE Infinity', 'SCALE NaN', 'SCALE 1000000001', 'AT 1000000001 0', 'AT 0 -1000000001',
        'file.dwfx UNKNOWN 2', 'file.dwfx other.dwfx', 'PAGE 2 file.dwfx']) {
        assert.throws(() => parseDrawingDwfAttachInput(input), /dwfxSyntax/, input);
    }
});
