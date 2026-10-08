import { getEntityBounds } from './drawingGeometry.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument } from './lcadDocument.js';
import { compareDrawingDocuments } from './drawingComparison.js';
import { drawingComparisonHighlights, drawingComparisonViewBox } from './drawingComparisonVisual.js';
const line = (id, x = 0) => ({ id, type: 'line', layerId: 'geometry', x1: x, y1: 0, x2: x + 2, y2: 2 });

test('preview highlights old/new geometry and shares a frame containing both moved positions', () => {
    const first = createLcadDocument(); first.content.entities = [line('moved'), line('same', 5)];
    const second = structuredClone(first); second.content.entities[0] = line('moved', 100);
    const report = compareDrawingDocuments(first, second);
    assert.deepEqual(drawingComparisonHighlights(first, report), ['moved']);
    assert.deepEqual(drawingComparisonHighlights(second, report), ['moved']);
    const box = drawingComparisonViewBox(first, second);
    assert.ok(box.x <= 0 && box.x + box.width >= 102);
    assert.ok(Math.abs(box.width / box.height - 1.6) < 1e-10);
});

test('nested resource changes highlight affected root instances without changing their geometry', () => {
    const first = createLcadDocument();
    first.content.blocks = [{ id: 'b', name: 'Block', entities: [line('child')] }];
    first.content.entities = [{ id: 'root', type: 'blockReference', blockId: 'b', layerId: 'references' }, { ...line('other'), layerId: 'references' }];
    const second = structuredClone(first); second.content.layers[0].color = '#ff0000';
    assert.deepEqual(drawingComparisonHighlights(first, compareDrawingDocuments(first, second)), ['root']);
    const snapshot = structuredClone(first);
    drawingComparisonViewBox(first, second);
    assert.deepEqual(first, snapshot);
});

test('comparison revision clouds enclose moved geometry using editable cloud definitions atomically', async () => {
    const { createDrawingComparisonClouds } = await import('./drawingComparisonClouds.js');
    const first = createLcadDocument(); first.content.entities = [line('moved')];
    const second = structuredClone(first); second.content.entities = [line('moved', 4)];
    const original = structuredClone(first);
    const report = compareDrawingDocuments(first, second);
    const result = createDrawingComparisonClouds(first.content, first, second, report);
    assert.equal(result.selectedIds.length, 1);
    const cloud = result.content.entities.at(-1);
    assert.equal(cloud.revisionSymbol.kind, 'cloud');
    assert.equal(getEntityBounds({ ...cloud.revisionSymbol.source, type: 'polyline' }).minX, -0.25);
    assert.equal(getEntityBounds({ ...cloud.revisionSymbol.source, type: 'polyline' }).maxX, 6.25);
    assert.deepEqual(first, original);
    assert.equal(createDrawingComparisonClouds(first.content, first, second, report, { arcLength: 0 }).error, 'comparisonCloudOptions');
    first.content.layers[0].locked = true;
    assert.equal(createDrawingComparisonClouds(first.content, first, second, report).error, 'layer');
});
