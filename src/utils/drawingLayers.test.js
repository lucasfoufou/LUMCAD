import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent, canSelectEntity, canEditEntity } from './drawingDocument.js';
import { saveDrawingLayerState, restoreDrawingLayerState, mergeDrawingLayers, filterDrawingLayers } from './drawingLayers.js';
import { createFittedDrawingViewport, createDrawingLayoutFromTemplate } from './drawingLayouts.js';
import { applyDrawingPlotStyle } from './drawingPlot.js';
import { getDrawingBounds } from './drawingGeometry.js';

function fixture() {
    const content = createDefaultDrawingContent();
    content.layers.push({ ...content.layers[0], id: 'roof', name: 'Roof', newViewportFrozen: true, plot: false });
    content.entities = [{ id: 'line', type: 'line', layerId: 'roof', x1: 0, y1: 0, x2: 5, y2: 3 }];
    return content;
}

test('layer states restore existing stable identities and retain newly added layers', () => {
    const content = fixture();
    const saved = saveDrawingLayerState(content, 'Before').content;
    const changed = { ...saved, activeLayerId: 'roof', layers: [...saved.layers.map(layer => ({ ...layer, visible: false, frozen: true, color: '#ff0000' })), { id: 'later', name: 'Later', visible: true }] };
    const restored = restoreDrawingLayerState(changed, saved.layerStates[0]).content;
    assert.equal(restored.layers[0].visible, true);
    assert.equal(restored.layers[0].frozen, false);
    assert.equal(restored.layers[0].color, content.layers[0].color);
    assert.equal(restored.layers.at(-1).id, 'later');
    assert.equal(restored.activeLayerId, 'geometry');
    assert.deepEqual(normalizeDrawingContent(saved).layerStates, saved.layerStates);
});

test('merge remaps nested layers and layout references in one result and rejects protected or locked sources', () => {
    const content = fixture();
    content.blocks = [{ id: 'b', name: 'Block', entities: [{ ...content.entities[0], id: 'child' }] }];
    content.activeLayerId = 'roof';
    const layouts = [{ id: 'sheet', viewports: [{ hiddenLayerIds: ['roof'], layerOverrides: [{ layerId: 'roof', color: '#ff0000' }] }], paperEntities: [] }];
    const merged = mergeDrawingLayers(content, ['roof'], 'geometry', layouts);
    assert.equal(merged.content.entities[0].id, 'line');
    assert.equal(merged.content.entities[0].layerId, 'geometry');
    assert.equal(merged.content.blocks[0].entities[0].layerId, 'geometry');
    assert.deepEqual(merged.layouts[0].viewports[0].hiddenLayerIds, ['geometry']);
    assert.equal(merged.content.activeLayerId, 'geometry');
    assert.equal(mergeDrawingLayers(content, ['geometry'], 'roof').error, 'invalid');
    assert.equal(mergeDrawingLayers({ ...content, layers: content.layers.map(layer => ({ ...layer, locked: true })) }, ['roof'], 'geometry').error, 'invalid');
    assert.equal(content.entities[0].layerId, 'roof');
});

test('freeze affects model interaction, no-plot affects output, and new viewport freeze initializes only new windows', () => {
    const content = fixture();
    assert.equal(canSelectEntity(content, content.entities[0]), true);
    assert.ok(getDrawingBounds(content));
    assert.deepEqual(getDrawingBounds(content, { printableOnly: true }), getDrawingBounds(createDefaultDrawingContent()));
    assert.equal(applyDrawingPlotStyle(content, {}).layers.at(-1).visible, false);
    assert.equal(applyDrawingPlotStyle(content, null).layers.at(-1).visible, true);
    const viewport = createFittedDrawingViewport(content, { x: 0, y: 0, width: 100, height: 100 });
    assert.deepEqual(viewport.hiddenLayerIds, ['roof']);
    const layout = createDrawingLayoutFromTemplate({ template: 'single', layers: content.layers });
    assert.deepEqual(layout.viewports[0].hiddenLayerIds, ['roof']);
    const frozen = { ...content, layers: content.layers.map(layer => ({ ...layer, frozen: true })) };
    assert.equal(canSelectEntity(frozen, content.entities[0]), false);
    assert.equal(canEditEntity(frozen, content.entities[0]), false);
    assert.deepEqual(getDrawingBounds(frozen), getDrawingBounds(createDefaultDrawingContent()));
    assert.deepEqual(filterDrawingLayers(content.layers, 'roof noplot').map(layer => layer.id), ['roof']);
});

test('layer states and flags survive the portable archive without changing model geometry', async () => {
    const { createLcadDocument, createLcadEnvelope } = await import('./lcadDocument.js');
    const { createLcadArchive, readLcadArchive } = await import('./lcadArchive.js');
    const content = fixture();
    const saved = saveDrawingLayerState(content, 'Roof').content;
    const document = { ...createLcadDocument(), content: saved };
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content;
    assert.deepEqual(loaded.layerStates, saved.layerStates);
    assert.equal(loaded.layers.at(-1).newViewportFrozen, true);
    assert.equal(loaded.layers.at(-1).plot, false);
});
