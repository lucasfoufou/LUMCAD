import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultDrawingContent, canEditEntity, canSelectEntity, addEntity } from './drawingDocument.js';
import { drawingContentWithHiddenObjects, withoutDrawingObjectVisibility, updateDrawingObjectVisibility } from './drawingObjectVisibility.js';
import { drawingSnapEntities } from './drawingBlockSnapping.js';
import { getDrawingBounds } from './drawingGeometry.js';
import { expandDrawingGroupSelection } from './drawingGroups.js';

function fixture() {
    const content = createDefaultDrawingContent();
    return { ...content, entities: [
        { id: 'a', type: 'line', layerId: content.activeLayerId, x1: 0, y1: 0, x2: 2, y2: 2 },
        { id: 'b', type: 'line', layerId: content.activeLayerId, x1: 100, y1: 100, x2: 200, y2: 200 },
    ], groups: [{ id: 'group', name: 'Both', entityIds: ['a', 'b'], selectable: true }] };
}

test('temporary hide excludes selection, editing, snaps, grouped selection and zoom extents', () => {
    const source = fixture();
    const content = drawingContentWithHiddenObjects(source, ['b']);
    assert.equal(canSelectEntity(content, source.entities[1]), false);
    assert.equal(canEditEntity(content, source.entities[1]), false);
    assert.deepEqual(drawingSnapEntities(content).map(entity => entity.id), ['a']);
    assert.deepEqual(expandDrawingGroupSelection(content, ['a']), ['a']);
    assert.equal(getDrawingBounds(content).maxX, 2);
    assert.equal(getDrawingBounds(source).maxX, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(content)), source);
    assert.deepEqual(withoutDrawingObjectVisibility(content), source);
});

test('isolation accumulates hides and restoration retains layer state and entity data', () => {
    const content = fixture();
    const first = updateDrawingObjectVisibility(content, [], ['a'], 'isolate');
    assert.deepEqual(first, ['b']);
    assert.deepEqual(updateDrawingObjectVisibility(content, first, ['a'], 'hide'), ['b', 'a']);
    assert.deepEqual(updateDrawingObjectVisibility(content, first, [], 'show'), []);
    const hidden = drawingContentWithHiddenObjects(content, first);
    const edited = addEntity(hidden, { ...content.entities[0], id: 'c' });
    const persistent = withoutDrawingObjectVisibility(edited);
    assert.equal(persistent.entities.length, 3);
    assert.equal(canSelectEntity(persistent, content.entities[1]), true);
    assert.equal(persistent.layers, content.layers);
});
