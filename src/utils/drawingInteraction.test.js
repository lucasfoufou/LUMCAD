import test from 'node:test';
import assert from 'node:assert/strict';

import {
    entityIdFromDrawingEvent,
    getDrawingEntityRenderMode,
    getInteractiveOperationPointMode,
    getTrimExtendPointMode,
} from './drawingInteraction.js';

test('retained transparent hit geometry still resolves its source entity ID', () => {
    const group = { dataset: { entityId: 'second-line' } };
    const event = { target: { closest: selector => selector === '[data-entity-id]' ? group : null } };
    assert.equal(entityIdFromDrawingEvent(event), 'second-line');
    assert.equal(getDrawingEntityRenderMode('second-line', [], []), 'visible', 'before pointer movement');
    assert.equal(getDrawingEntityRenderMode(
        'second-line', ['first-line', 'second-line'], ['first-line', 'second-line'],
    ), 'hit-only', 'after a corner preview hides the source visuals');
    assert.equal(getDrawingEntityRenderMode('other', ['other'], []), 'hidden');
});

test('only effective TRIM target picks preserve raw pointer and remote coordinates', () => {
    assert.equal(getTrimExtendPointMode('trim', { targetId: 'line' }), 'raw');
    assert.equal(getTrimExtendPointMode('extend', { shift: true, targetId: 'line' }), 'raw');
    assert.equal(getTrimExtendPointMode('extend', { targetId: 'line' }), 'snap');
    assert.equal(getTrimExtendPointMode('trim', { shift: true, targetId: 'line' }), 'snap');
    assert.equal(getTrimExtendPointMode('trim', { fence: true }), 'snap');
    assert.equal(getTrimExtendPointMode('trim'), 'snap');
    assert.equal(getInteractiveOperationPointMode('fillet', { targetId: 'line' }), 'raw');
    assert.equal(getInteractiveOperationPointMode('chamfer', { targetId: 'line' }), 'raw');
    assert.equal(getInteractiveOperationPointMode('blend', { targetId: 'line' }), 'raw');
    assert.equal(getInteractiveOperationPointMode('extend', { targetId: 'line' }), 'snap');
});
