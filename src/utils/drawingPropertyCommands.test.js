import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { matchDrawingProperties, makeDrawingLayerCurrent, copyDrawingSelectionToLayer } from './drawingPropertyCommands.js';

function fixture() {
    const content = createDefaultDrawingContent();
    return { ...content, layers: [...content.layers, { id: 'roof', name: 'Roof panels', visible: true, locked: false }], entities: [
        { id: 'source', type: 'line', layerId: 'roof', x1: 0, y1: 0, x2: 4, y2: 0, color: '#ff0000' },
        { id: 'target', type: 'line', layerId: content.activeLayerId, x1: 1, y1: 2, x2: 3, y2: 4, lineType: 'dashed', transparency: 50 },
        { id: 'locked', type: 'line', layerId: content.activeLayerId, locked: true, x1: 1, y1: 5, x2: 3, y2: 6 },
    ] };
}

test('MATCHPROP preserves target geometry and identity, copies overrides and restores ByLayer values', () => {
    const original = fixture();
    const result = matchDrawingProperties(original, ['target', 'locked', 'source'], 'source');
    assert.deepEqual(result.selectedIds, ['target']);
    assert.deepEqual(result.content.entities[1], { id: 'target', type: 'line', layerId: 'roof', x1: 1, y1: 2, x2: 3, y2: 4, color: '#ff0000' });
    assert.equal(result.content.entities[2], original.entities[2]);
    assert.equal(original.entities[1].transparency, 50);
    assert.equal(matchDrawingProperties(original, ['target'], 'absent').error, 'source');
});

test('LAYMCH changes only the layer and LAYMCUR respects unavailable layers', () => {
    const content = fixture();
    assert.deepEqual(matchDrawingProperties(content, ['target'], 'source', { layerOnly: true }).content.entities[1], { ...content.entities[1], layerId: 'roof' });
    assert.equal(makeDrawingLayerCurrent(content, 'source').content.activeLayerId, 'roof');
    const locked = { ...content, layers: content.layers.map(layer => ({ ...layer, locked: true })) };
    assert.equal(makeDrawingLayerCurrent(locked, 'source').error, 'layer');
    assert.equal(copyDrawingSelectionToLayer(locked, ['target'], 'roof').error, 'layer');
});

test('COPYTOLAYER creates independent IDs in place and remaps copied dimension dependencies', () => {
    const content = fixture();
    content.entities.push({ id: 'dim', type: 'linearDimension', layerId: content.activeLayerId, sourceId: 'target', offset: 1 });
    const result = copyDrawingSelectionToLayer(content, ['target', 'dim'], 'Roof panels');
    const copies = result.content.entities.slice(content.entities.length);
    assert.equal(copies.length, 2);
    assert.equal(copies[0].x1, content.entities[1].x1);
    assert.equal(copies[1].sourceId, copies[0].id);
    assert.ok(copies.every(entity => entity.layerId === 'roof' && !content.entities.some(source => source.id === entity.id)));
    assert.equal(result.content.entities[1], content.entities[1]);
});
