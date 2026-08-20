import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_DRAWING_PLOT_SETTINGS,
    applyDrawingPlotStyle,
    normalizeDrawingPlotSettings,
    resolveDrawingPlotArea,
    resolveDrawingPlotPaperRegion,
    resolveDrawingPlotTransform,
} from './drawingPlot.js';

test('plot settings expose complete stable defaults and clamp unsafe values', () => {
    assert.deepEqual(normalizeDrawingPlotSettings(), DEFAULT_DRAWING_PLOT_SETTINGS);
    assert.deepEqual(normalizeDrawingPlotSettings({
        area: {
            mode: 'window',
            window: { x: 12, y: 8, width: -4, height: -2 },
        },
        scale: {
            mode: 'fixed',
            denominator: 0,
            centered: false,
            offsetMm: { x: 7.5, y: -3 },
        },
        style: { colorMode: 'monochrome', plotLineweights: false },
        quality: { mode: 'raster', rasterDpi: 20, imageDpi: 5_000, jpegQuality: 4 },
    }), {
        area: {
            mode: 'window',
            window: { x: 8, y: 6, width: 4, height: 2 },
        },
        scale: {
            mode: 'fixed',
            denominator: 1,
            centered: false,
            offsetMm: { x: 7.5, y: -3 },
        },
        style: { colorMode: 'monochrome', plotLineweights: false },
        quality: { mode: 'raster', rasterDpi: 72, imageDpi: 1_200, jpegQuality: 1 },
    });
    assert.deepEqual(normalizeDrawingPlotSettings({
        area: { mode: 'unsupported', window: { width: 0, height: 0 } },
        scale: { mode: 'unsupported', denominator: Number.NaN, offsetMm: { x: Infinity } },
        style: { colorMode: 'unsupported' },
        quality: { mode: 'unsupported', rasterDpi: Number.NaN, jpegQuality: Number.NaN },
    }), DEFAULT_DRAWING_PLOT_SETTINGS);
});

test('plot areas resolve explicit layout regions, windows, and printable model extents', () => {
    const content = {
        layers: [
            { id: 'visible', visible: true },
            { id: 'hidden', visible: false },
        ],
        entities: [
            { id: 'line', type: 'line', layerId: 'visible', x1: 2, y1: 3, x2: 12, y2: 8 },
            { id: 'hidden-line', type: 'line', layerId: 'hidden', x1: -100, y1: -100, x2: 100, y2: 100 },
            {
                id: 'reference', type: 'image', layerId: 'visible', x: -20, y: -20,
                width: 50, height: 50, includeInPdf: false,
            },
        ],
    };
    assert.deepEqual(resolveDrawingPlotArea(content, { area: { mode: 'layout' } }, {
        layoutRegion: { x: 0, y: 0, width: 420, height: 297 },
    }), { x: 0, y: 0, width: 420, height: 297 });
    assert.deepEqual(resolveDrawingPlotArea(content, {
        area: { mode: 'window', window: { x: 8, y: 5, width: -6, height: 4 } },
    }), { x: 2, y: 5, width: 6, height: 4 });
    assert.deepEqual(resolveDrawingPlotArea(content, { area: { mode: 'extents' } }), {
        x: 2, y: 3, width: 10, height: 5,
    });
});

test('paper regions apply bounded margins in physical millimetres', () => {
    assert.deepEqual(resolveDrawingPlotPaperRegion({
        width: 420,
        height: 297,
        margins: { top: 10, right: 15, bottom: 20, left: 25 },
    }), { x: 25, y: 10, width: 380, height: 267 });

    const bounded = resolveDrawingPlotPaperRegion(
        { width: 100, height: 50 },
        { top: 100, right: 100, bottom: 100, left: 100 },
    );
    assert.ok(bounded.width > 0);
    assert.ok(bounded.height > 0);
    assert.ok(bounded.x >= 0 && bounded.y >= 0);
});

test('fit transforms center and offset source geometry inside the paper region', () => {
    const transform = resolveDrawingPlotTransform(
        { x: 10, y: 20, width: 20, height: 10 },
        { x: 5, y: 10, width: 200, height: 160 },
        { mode: 'fit', centered: true, offsetMm: { x: 3, y: -2 } },
    );
    assert.equal(transform.scaleFactor, 10);
    assert.equal(transform.denominator, 100);
    assert.deepEqual(transform.outputRegion, { x: 8, y: 38, width: 200, height: 100 });
    assert.deepEqual(transform.matrix, {
        a: 10, b: 0, c: 0, d: 10, e: -92, f: -162,
    });
});

test('fixed transforms use exact 1/X model scales and support paper-space sources', () => {
    const model = resolveDrawingPlotTransform(
        { x: -1, y: -0.5, width: 2, height: 1 },
        { x: 10, y: 20, width: 100, height: 50 },
        { mode: 'fixed', denominator: 100, centered: true },
    );
    assert.equal(model.scaleFactor, 10);
    assert.equal(model.denominator, 100);
    assert.deepEqual(model.outputRegion, { x: 50, y: 40, width: 20, height: 10 });
    assert.equal(model.translateX, 60);
    assert.equal(model.translateY, 45);

    const paper = resolveDrawingPlotTransform(
        { x: 0, y: 0, width: 100, height: 50 },
        { x: 5, y: 6, width: 200, height: 100 },
        { mode: 'fixed', denominator: 2, centered: false, offsetMm: { x: 4, y: 3 } },
        { sourceUnit: 'mm' },
    );
    assert.equal(paper.scaleFactor, 0.5);
    assert.deepEqual(paper.outputRegion, { x: 9, y: 9, width: 50, height: 25 });
});

test('plot styles transform every vector appearance without mutating drawing content', () => {
    const content = {
        layers: [{ id: 'geometry', color: '#ff0000', lineWeight: 5 }],
        entities: [
            { id: 'line', type: 'line', layerId: 'geometry', color: '#00ff00', lineWidth: 3 },
            {
                id: 'text', type: 'text', layerId: 'geometry', color: '#0000ff',
                runs: [{ text: 'A', marks: { color: '#ffffff', bold: true } }],
            },
            {
                id: 'mixed', type: 'polyline', layerId: 'geometry',
                parts: [
                    { type: 'line', x1: 0, y1: 0, x2: 1, y2: 0, color: '#ff0000', lineWeight: 5 },
                    { type: 'line', x1: 1, y1: 0, x2: 2, y2: 0, color: '#0000ff', lineWeight: 10 },
                ],
            },
        ],
        blocks: [{
            id: 'block',
            entities: [{ id: 'child', type: 'line', layerId: 'geometry', color: '#336699', lineWeight: 10 }],
        }],
    };
    const grayscale = applyDrawingPlotStyle(content, {
        colorMode: 'grayscale',
        plotLineweights: false,
    });
    assert.notEqual(grayscale, content);
    assert.equal(content.layers[0].color, '#ff0000');
    assert.deepEqual(grayscale.layers[0], { id: 'geometry', color: '#363636', lineWeight: 1 });
    assert.equal(grayscale.entities[0].color, '#b6b6b6');
    assert.equal(grayscale.entities[0].lineWeight, 1);
    assert.equal(grayscale.entities[0].lineWidth, undefined);
    assert.equal(grayscale.entities[1].color, '#121212');
    assert.equal(grayscale.entities[1].runs[0].marks.color, '#ffffff');
    assert.equal(grayscale.entities[2].lineWeight, undefined);
    assert.deepEqual(grayscale.entities[2].parts.map(part => [part.color, part.lineWeight]), [
        ['#363636', 1],
        ['#121212', 1],
    ]);
    assert.equal(grayscale.blocks[0].entities[0].color, '#5f5f5f');
    assert.equal(grayscale.blocks[0].entities[0].lineWeight, 1);

    const monochrome = applyDrawingPlotStyle(content, { colorMode: 'monochrome' });
    assert.equal(monochrome.layers[0].color, '#000000');
    assert.equal(monochrome.entities[1].runs[0].marks.color, '#000000');
    assert.equal(applyDrawingPlotStyle(content, { colorMode: 'asDisplayed', plotLineweights: true }), content);
});
