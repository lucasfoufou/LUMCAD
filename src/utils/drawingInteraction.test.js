import test from 'node:test';
import assert from 'node:assert/strict';

import {
    entityIdFromDrawingEvent,
    getDrawingEntityRenderMode,
    getInteractiveOperationPointMode,
    getTrimExtendPointMode,
    pickDrawingEntity,
} from './drawingInteraction.js';
import { createDefaultDrawingContent } from './drawingDocument.js';

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

function pickFixture(entities) {
    const content = createDefaultDrawingContent();
    return { ...content, entities: entities.map(entity => ({ layerId: content.activeLayerId, ...entity })) };
}

test('index picking returns the topmost entity whose stroke is within the pointer tolerance', () => {
    const content = pickFixture([
        { id: 'below', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'above', type: 'line', x1: 5, y1: -5, x2: 5, y2: 5 },
        { id: 'ring', type: 'circle', cx: 20, cy: 0, r: 2 },
        { id: 'axis', type: 'xline', x1: 0, y1: 50, x2: 1, y2: 50 },
    ]);
    assert.equal(pickDrawingEntity(content, { x: 5, y: 0.05 }, 0.1), 'above');
    assert.equal(pickDrawingEntity(content, { x: 2, y: 0.05 }, 0.1), 'below');
    assert.equal(pickDrawingEntity(content, { x: 2, y: 0.5 }, 0.1), null);
    // Circles are picked on their outline only, as their stroke hit shape was.
    assert.equal(pickDrawingEntity(content, { x: 22.05, y: 0 }, 0.1), 'ring');
    assert.equal(pickDrawingEntity(content, { x: 20, y: 0 }, 0.1), null);
    // Construction lines have no finite bounds and stay pickable anywhere.
    assert.equal(pickDrawingEntity(content, { x: 9000, y: 50 }, 0.1), 'axis');
});

test('index picking fills hatch and text areas and respects hidden objects and layers', () => {
    const content = pickFixture([
        { id: 'hatch', type: 'hatch', pattern: { name: 'ansi31' },
            boundaries: [{ type: 'polyline', closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }] },
        { id: 'label', type: 'text', x: 20, y: 0, width: 4, height: 1, fontSize: 0.5, text: 'Roof', textMode: 'singleLine' },
    ]);
    assert.equal(pickDrawingEntity(content, { x: 5, y: 5 }, 0.1), 'hatch');
    assert.equal(pickDrawingEntity(content, { x: 22, y: 0.5 }, 0.1), 'label');
    assert.equal(pickDrawingEntity(content, { x: 5, y: 5 }, 0.1, { hiddenIds: ['hatch'] }), null);
    assert.equal(pickDrawingEntity(content, { x: 5, y: 5 }, 0.1, { hiddenIds: ['hatch'], hitOnlyIds: ['hatch'] }), 'hatch');
    const hiddenLayer = { ...content, layers: content.layers.map(layer => ({ ...layer, visible: false })) };
    assert.equal(pickDrawingEntity(hiddenLayer, { x: 5, y: 5 }, 0.1), null);
});
