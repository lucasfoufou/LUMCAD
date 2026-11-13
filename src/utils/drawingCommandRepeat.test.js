import assert from 'node:assert/strict';
import test from 'node:test';

import { drawingRepeatableCommandName, resolveDrawingRepeatSubmission } from './drawingCommandRepeat.js';

test('drawing and modify commands are repeatable by their command-line name', () => {
    assert.equal(drawingRepeatableCommandName('line'), 'LINE');
    assert.equal(drawingRepeatableCommandName('copy'), 'COPY');
    assert.equal(drawingRepeatableCommandName('rectangle'), 'RECTANGLE');
});

test('file, dialog and history commands are never repeated', () => {
    for (const command of ['open', 'saveAs', 'new', 'undo', 'redo', 'select', 'pan', 'plot']) {
        assert.equal(drawingRepeatableCommandName(command), null);
    }
    assert.equal(drawingRepeatableCommandName('notACommand'), null);
    assert.equal(drawingRepeatableCommandName(null), null);
});

test('only an empty submission on an idle canvas repeats the last command', () => {
    assert.equal(resolveDrawingRepeatSubmission('', { idle: true, lastCommand: 'LINE' }), 'LINE');
    assert.equal(resolveDrawingRepeatSubmission('  ', { idle: true, lastCommand: 'LINE' }), 'LINE');
    assert.equal(resolveDrawingRepeatSubmission('', { idle: false, lastCommand: 'LINE' }), '');
    assert.equal(resolveDrawingRepeatSubmission('', { idle: true, lastCommand: null }), '');
    assert.equal(resolveDrawingRepeatSubmission('CIRCLE', { idle: true, lastCommand: 'LINE' }), 'CIRCLE');
});
