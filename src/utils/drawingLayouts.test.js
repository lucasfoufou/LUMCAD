import assert from 'node:assert/strict';
import test from 'node:test';

import {
    changeDrawingLayoutFormat,
    changeDrawingLayoutOrientation,
    createDrawingLayout,
    createDrawingViewport,
    getDrawingLayoutDimensionTextSize,
    getDrawingPaperSize,
    getDrawingViewportScale,
    modelViewBoxFromViewport,
    normalizeDrawingLayouts,
    resizeDrawingViewport,
    scaleDrawingViewport,
    setDrawingViewportScale,
    updateDrawingViewport,
} from './drawingLayouts.js';

test('paper formats expose landscape A-series dimensions', () => {
    assert.deepEqual(getDrawingPaperSize('A4'), { width: 297, height: 210 });
    assert.deepEqual(getDrawingPaperSize('A0'), { width: 1189, height: 841 });
    assert.deepEqual(getDrawingPaperSize('A4', 'portrait'), { width: 210, height: 297 });
});

test('layout dimension text keeps the same visual proportion from A4 to A0', () => {
    const a4 = getDrawingPaperSize('A4');
    const a0 = getDrawingPaperSize('A0');
    const a4Size = getDrawingLayoutDimensionTextSize(a4);
    const a0Size = getDrawingLayoutDimensionTextSize(a0);
    assert.equal(a4Size, 3);
    assert.ok(Math.abs(a4Size / Math.min(a4.width, a4.height) - a0Size / Math.min(a0.width, a0.height)) < 1e-12);
    assert.ok(a0Size > 12 && a0Size < 12.02);
});

test('drawing layouts normalize to one editable A0 layout', () => {
    const [layout] = normalizeDrawingLayouts(null);
    assert.equal(layout.format, 'A0');
    assert.equal(layout.orientation, 'landscape');
    assert.equal(layout.name, 'Layout 1');
    assert.deepEqual(layout.viewports, []);
});

test('changing orientation keeps viewport placement proportional', () => {
    const layout = createDrawingLayout({
        format: 'A4',
        viewports: [createDrawingViewport({
            rect: { x: 29.7, y: 21, width: 148.5, height: 105 },
            modelViewBox: { x: 0, y: 0, width: 20, height: 10 },
        })],
    });
    const portrait = changeDrawingLayoutOrientation(layout, 'portrait');
    assert.equal(portrait.orientation, 'portrait');
    assert.ok(Math.abs(portrait.viewports[0].x - 21) < 1e-9);
    assert.ok(Math.abs(portrait.viewports[0].y - 29.7) < 1e-9);
    assert.ok(Math.abs(portrait.viewports[0].width - 105) < 1e-9);
    assert.ok(Math.abs(portrait.viewports[0].height - 148.5) < 1e-9);
});

test('changing paper format keeps viewport placement proportional', () => {
    const layout = createDrawingLayout({
        format: 'A4',
        viewports: [createDrawingViewport({
            rect: { x: 29.7, y: 21, width: 148.5, height: 105 },
            modelViewBox: { x: 0, y: 0, width: 20, height: 10 },
        })],
    });
    const resized = changeDrawingLayoutFormat(layout, 'A3');
    assert.equal(resized.viewports[0].x, 42);
    assert.ok(Math.abs(resized.viewports[0].y - 29.7) < 1e-9);
    assert.equal(resized.viewports[0].width, 210);
    assert.equal(resized.viewports[0].height, 148.5);
});

test('viewport edits stay on the paper and preserve the viewport aspect ratio', () => {
    const layout = createDrawingLayout({
        format: 'A4',
        viewports: [createDrawingViewport({
            rect: { x: 20, y: 20, width: 100, height: 50 },
            modelViewBox: { x: 0, y: 0, width: 20, height: 10 },
        })],
    });
    const updated = updateDrawingViewport(layout, layout.viewports[0].id, {
        x: 290,
        y: 205,
        width: 80,
        height: 80,
    });
    const viewport = updated.viewports[0];
    assert.ok(viewport.x + viewport.width <= 297);
    assert.ok(viewport.y + viewport.height <= 210);
    assert.equal(viewport.modelViewBox.width / viewport.modelViewBox.height, viewport.width / viewport.height);
});

test('resizing a viewport changes its field of view without changing its scale', () => {
    const layout = createDrawingLayout({
        format: 'A4',
        viewports: [createDrawingViewport({
            rect: { x: 20, y: 20, width: 100, height: 50 },
            modelViewBox: { x: 0, y: 0, width: 20, height: 10 },
        })],
    });
    const before = layout.viewports[0];
    const resized = resizeDrawingViewport(layout, before.id, { width: 150, height: 75 }).viewports[0];
    assert.equal(getDrawingViewportScale(resized), getDrawingViewportScale(before));
    assert.equal(resized.modelViewBox.width, 30);
    assert.equal(resized.modelViewBox.height, 15);
    assert.equal(resized.modelViewBox.x + resized.modelViewBox.width / 2, 10);
    assert.equal(resized.modelViewBox.y + resized.modelViewBox.height / 2, 5);
});

test('the scale tool resizes a viewport around a paper base point without changing zoom', () => {
    const layout = createDrawingLayout({
        format: 'A4',
        viewports: [createDrawingViewport({
            rect: { x: 20, y: 20, width: 100, height: 50 },
            modelViewBox: { x: 0, y: 0, width: 20, height: 10 },
        })],
    });
    const before = layout.viewports[0];
    const scaled = scaleDrawingViewport(layout, before.id, 1.5, { x: 20, y: 20 }).viewports[0];
    assert.equal(scaled.x, 20);
    assert.equal(scaled.y, 20);
    assert.equal(scaled.width, 150);
    assert.equal(scaled.height, 75);
    assert.equal(getDrawingViewportScale(scaled), getDrawingViewportScale(before));
});

test('a model canvas viewport can seed a layout viewport at its target aspect', () => {
    const viewBox = modelViewBoxFromViewport({ x: 10, y: 5, width: 30, height: 20 }, 2);
    assert.equal(viewBox.x + viewBox.width / 2, 10);
    assert.equal(viewBox.y + viewBox.height / 2, 5);
    assert.equal(viewBox.width / viewBox.height, 2);
});

test('viewport scales use exact 1/X paper-to-model ratios', () => {
    const viewport = createDrawingViewport({
        rect: { x: 10, y: 10, width: 200, height: 100 },
        modelViewBox: { x: -10, y: -5, width: 20, height: 10 },
        hiddenLayerIds: ['references', 'references', '', null],
    });
    assert.equal(getDrawingViewportScale(viewport), 100);
    assert.deepEqual(viewport.hiddenLayerIds, ['references']);
    const scaled = setDrawingViewportScale(viewport, 50);
    assert.equal(getDrawingViewportScale(scaled), 50);
    assert.equal(scaled.modelViewBox.width, 10);
    assert.equal(scaled.modelViewBox.height, 5);
    assert.equal(scaled.modelViewBox.x + scaled.modelViewBox.width / 2, 0);
    assert.equal(scaled.modelViewBox.y + scaled.modelViewBox.height / 2, 0);
});
