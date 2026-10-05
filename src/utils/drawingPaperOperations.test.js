import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { createDrawingLayout, createDrawingViewport } from './drawingLayouts.js';
import { commitDrawingPaperEntity, resolveDrawingPaperSnap } from './drawingPaperOperations.js';

function fixture() {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'model-line', type: 'line', layerId: 'geometry', x1: 2, y1: 2, x2: 4, y2: 4 }];
    const layout = createDrawingLayout({ format: 'A4', viewports: [createDrawingViewport({ rect: { x: 10, y: 20, width: 100, height: 100 }, modelViewBox: { x: 0, y: 0, width: 10, height: 10 } })] });
    return { content, layout };
}

test('paper point creation uses native millimetre geometry, preserves model and rejects locked layers', () => {
    const { content, layout } = fixture();
    const created = commitDrawingPaperEntity(content, layout, 'line', { x: 10, y: 10 }, { x: 50, y: 40 });
    assert.equal(created.entity.x2, 50);
    assert.equal(created.layout.paperEntities.length, 1);
    assert.equal(layout.paperEntities.length, 0);
    assert.equal(content.entities[0].x2, 4);
    const text = commitDrawingPaperEntity(content, created.layout, 'text', { x: 5, y: 5 }, { x: 40, y: 20 }, { text: 'Paper note', fontSize: 3 });
    assert.equal(text.entity.text, 'Paper note');
    assert.equal(text.entity.fontSize, 3);
    const locked = { ...content, layers: content.layers.map(layer => ({ ...layer, locked: true })) };
    assert.equal(commitDrawingPaperEntity(locked, layout, 'line', { x: 0, y: 0 }, { x: 2, y: 3 }), null);
});

test('paper snaps include visible viewport geometry and obey hidden viewport layers', () => {
    const { content, layout } = fixture();
    const snap = resolveDrawingPaperSnap({ x: 30.2, y: 40.1 }, content, layout, 1);
    assert.equal(snap.type, 'endpoint');
    assert.ok(Math.hypot(snap.x - 30, snap.y - 40) < 1e-8);
    const hidden = { ...layout, viewports: layout.viewports.map(viewport => ({ ...viewport, hiddenLayerIds: ['geometry'] })) };
    assert.notEqual(resolveDrawingPaperSnap({ x: 30.2, y: 40.1 }, content, hidden, 1).type, 'endpoint');
    const paper = commitDrawingPaperEntity(content, layout, 'line', { x: 5, y: 5 }, { x: 8, y: 5 }).layout;
    const ownSnap = resolveDrawingPaperSnap({ x: 5.1, y: 5 }, content, paper, 0.5);
    assert.equal(ownSnap.type, 'endpoint');
    assert.equal(ownSnap.x, 5);
});

test('viewport snapping follows view rotation and excludes geometry outside clipping polygons', () => {
    const { content, layout } = fixture();
    const rotated = { ...layout, viewports: layout.viewports.map(viewport => ({ ...viewport, viewRotation: 90 })) };
    const snapped = resolveDrawingPaperSnap({ x: 90.1, y: 40.1 }, content, rotated, 0.5);
    assert.equal(snapped.type, 'endpoint');
    assert.ok(Math.hypot(snapped.x - 90, snapped.y - 40) < 1e-8);
    const clipped = { ...layout, viewports: layout.viewports.map(viewport => ({ ...viewport, clipBoundary: { type: 'polygon', points: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }] } })) };
    assert.notEqual(resolveDrawingPaperSnap({ x: 30.1, y: 40.1 }, content, clipped, 0.5).type, 'endpoint');
});
