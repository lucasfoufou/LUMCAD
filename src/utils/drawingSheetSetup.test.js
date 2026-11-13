import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDefaultDrawingLayouts,
    createDrawingLayout,
    createDrawingViewport,
    getDrawingViewportScale,
    normalizeDrawingLayouts,
} from './drawingLayouts.js';
import {
    DRAWING_TITLE_BLOCK_SIZE_MM,
    applyDrawingSheetSetup,
    fitDrawingSheetScale,
    formatDrawingScaleLabel,
    getDrawingLayoutScaleDenominator,
    getDrawingSheetSetupRects,
    insertDrawingTitleBlock,
    isDrawingTitleBlockEntity,
    snapDrawingViewportScale,
    snapDrawingViewportToStandardScale,
} from './drawingSheetSetup.js';

const content = {
    activeLayerId: 'geometry',
    layers: [{ id: 'geometry', name: '0', visible: true, color: '#000000' }],
    entities: [{ id: 'l1', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 30, y2: 20 }],
};

test('raw viewport scales round up to the standard scale that still fits', () => {
    assert.equal(snapDrawingViewportScale(436.86), 500);
    assert.equal(snapDrawingViewportScale(100), 100);
    assert.equal(snapDrawingViewportScale(100.0000001), 100);
    assert.equal(snapDrawingViewportScale(0.7), 1);
    assert.equal(snapDrawingViewportScale(1.5), 2);
    assert.equal(snapDrawingViewportScale(7300), 10000);
});

test('snapping a viewport keeps its model centre and gives an exact scale', () => {
    const viewport = createDrawingViewport({ rect: { x: 10, y: 10, width: 200, height: 100 }, modelViewBox: { x: 0, y: 0, width: 87.372, height: 43.686 } });
    const snapped = snapDrawingViewportToStandardScale(viewport);
    assert.ok(Math.abs(getDrawingViewportScale(snapped) - 500) < 1e-9);
    assert.ok(Math.abs(snapped.modelViewBox.x + snapped.modelViewBox.width / 2 - 43.686) < 1e-9);
});

test('fit picks the largest standard scale that holds the extent', () => {
    // 30 m on 400 mm needs 1/75; 20 m on 232 mm needs 1/86.2 → 1/100.
    assert.equal(fitDrawingSheetScale({ width: 30, height: 20 }, { width: 400, height: 232 }), 100);
    assert.equal(fitDrawingSheetScale({ width: 3, height: 2 }, { width: 400, height: 232 }), 10);
});

test('scale labels follow plan conventions', () => {
    assert.equal(formatDrawingScaleLabel(100), '1:100');
    assert.equal(formatDrawingScaleLabel(0.5), '2:1');
    assert.equal(formatDrawingScaleLabel(436.857, 'fr'), '1:436,86');
});

test('new layouts default to A3 landscape while stored layouts keep their format', () => {
    const [layout] = createDefaultDrawingLayouts();
    assert.equal(layout.format, 'A3');
    assert.equal(layout.orientation, 'landscape');
    assert.equal(normalizeDrawingLayouts([{ name: 'Old', format: 'A0' }])[0].format, 'A0');
    assert.equal(normalizeDrawingLayouts([{ name: 'Legacy' }])[0].format, 'A0');
});

test('sheet setup puts the model on A3 at an exact locked 1:100 scale with a title block', () => {
    const layout = createDrawingLayout({ name: 'Plan', format: 'A0' });
    const result = applyDrawingSheetSetup(layout, content, {
        format: 'A3',
        orientation: 'landscape',
        scale: 100,
        titleBlock: true,
        titleBlockLabels: { title: 'Title', scale: 'Scale' },
        titleBlockValues: { title: 'House', date: '13/11/2026', designer: 'LF' },
    });
    const next = result.layout;
    assert.equal(next.id, layout.id);
    assert.equal(next.format, 'A3');
    assert.equal(next.viewports.length, 1);
    const [viewport] = next.viewports;
    assert.equal(viewport.locked, true);
    assert.ok(Math.abs(getDrawingViewportScale(viewport) - 100) < 1e-9);
    assert.ok(Math.abs(viewport.modelViewBox.x + viewport.modelViewBox.width / 2 - 15) < 1e-9);
    assert.ok(Math.abs(viewport.modelViewBox.y + viewport.modelViewBox.height / 2 - 10) < 1e-9);
    const rects = getDrawingSheetSetupRects(next, { titleBlock: true });
    assert.deepEqual({ x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height }, rects.viewport);
    assert.ok(viewport.y + viewport.height <= rects.titleBlock.y);
    assert.equal(rects.titleBlock.width, DRAWING_TITLE_BLOCK_SIZE_MM.width);
    assert.ok(rects.titleBlock.x + rects.titleBlock.width <= 410 + 1e-9);
    const texts = next.paperEntities.filter(entity => entity.type === 'text').map(entity => entity.text);
    assert.ok(texts.includes('1:100'));
    assert.ok(texts.includes('A3'));
    assert.ok(texts.includes('House'));
    assert.ok(texts.includes('13/11/2026'));
    assert.ok(next.paperEntities.every(isDrawingTitleBlockEntity));
    assert.ok(next.paperEntities.filter(entity => entity.type === 'text').every(entity => entity.fontSize >= 2.5 && entity.fontSize <= 5));
    assert.equal(getDrawingLayoutScaleDenominator(next), 100);
});

test('sheet setup keeps the main viewport id and replaces a previous title block', () => {
    const viewport = createDrawingViewport({ id: 'vp-main', rect: { x: 20, y: 20, width: 200, height: 100 }, modelViewBox: { x: 0, y: 0, width: 10, height: 5 } });
    const layout = createDrawingLayout({ format: 'A3', viewports: [viewport] });
    const first = applyDrawingSheetSetup(layout, content, { scale: 'fit', titleBlock: true }).layout;
    const second = applyDrawingSheetSetup(first, content, { scale: 200, titleBlock: true }).layout;
    assert.equal(second.viewports[0].id, 'vp-main');
    assert.equal(second.paperEntities.length, first.paperEntities.length);
    const withoutBlock = applyDrawingSheetSetup(second, content, { scale: 200, titleBlock: false }).layout;
    assert.equal(withoutBlock.paperEntities.length, 0);
});

test('fit chooses a standard scale for the whole extent', () => {
    const result = applyDrawingSheetSetup(createDrawingLayout({ format: 'A3' }), content, { scale: 'fit', titleBlock: true });
    assert.equal(result.scale, 100);
});

test('a title block stays inside a small portrait sheet', () => {
    const layout = insertDrawingTitleBlock(createDrawingLayout({ format: 'A4', orientation: 'portrait' }), { values: { title: 'X' } });
    const bounds = layout.paperEntities.filter(entity => entity.type === 'rectangle')[0];
    assert.ok(bounds.x >= 10 - 1e-9 && bounds.x + bounds.width <= 200 + 1e-9);
    assert.ok(bounds.y + bounds.height <= 287 + 1e-9);
});
