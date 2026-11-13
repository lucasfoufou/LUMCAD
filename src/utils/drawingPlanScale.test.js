import assert from 'node:assert/strict';
import test from 'node:test';
import { changeDrawingPlanScale, countDrawingPlanScaleAnnotations, parseDrawingPlanScale } from './drawingPlanScale.js';
import { normalizeDimensionStyles } from './drawingDimensionStyles.js';

const dimension = { id: 'd', type: 'linearDimension', layerId: 'l', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, offset: 0.6, textSize: 0.35, arrowSize: 0.245, extensionGap: 0, extensionOverrun: 0 };
const annotative = { ...dimension, id: 'a', annotation: { baseScale: 100, scales: [{ scale: 100, offset: { x: 0, y: 0 } }] } };
const text = { id: 't', type: 'text', layerId: 'l', x: 0, y: 0, width: 4, height: 1, fontSize: 0.35, text: 'Note', textMode: 'singleLine' };
const content = { entities: [dimension, annotative, text], blocks: [], settings: {}, dimensionStyles: normalizeDimensionStyles([]), textStyles: [] };

test('parses denominators written as 50, 1:50 or 1/50', () => {
    assert.equal(parseDrawingPlanScale('50'), 50);
    assert.equal(parseDrawingPlanScale('1:50'), 50);
    assert.equal(parseDrawingPlanScale('1/12,5'), 12.5);
    assert.equal(parseDrawingPlanScale('abc'), null);
    assert.equal(parseDrawingPlanScale('0'), null);
});

test('counts the non-annotative dimensions and texts it may resize', () => {
    assert.deepEqual(countDrawingPlanScaleAnnotations(content), { dimensions: 1, texts: 1 });
});

test('keeps the paper size of styles and leaves existing objects unless asked', () => {
    const next = changeDrawingPlanScale(content, 50);
    assert.equal(next.settings.annotationScale, 50);
    assert.ok(next.annotationScales.includes(50));
    assert.ok(Math.abs((next.dimensionStyles[0].textSize) - (0.175)) < 1e-9);
    assert.ok(Math.abs((next.dimensionStyles[0].arrowSize) - (0.1225)) < 1e-9);
    assert.equal(next.entities[0], dimension);
    assert.equal(next.entities[2], text);
});

test('rescales existing dimensions and texts in the same revision', () => {
    const next = changeDrawingPlanScale(content, 200, { rescaleExisting: true });
    assert.ok(Math.abs((next.entities[0].textSize) - (0.7)) < 1e-9);
    assert.ok(Math.abs((next.entities[0].arrowSize) - (0.49)) < 1e-9);
    assert.equal(next.entities[0].offset, 0.6);
    assert.ok(Math.abs((next.entities[2].fontSize) - (0.7)) < 1e-9);
});

test('adds the new scale to annotative objects so they stay visible', () => {
    const next = changeDrawingPlanScale(content, 50, { rescaleExisting: true });
    assert.deepEqual(next.entities[1].annotation.scales.map(item => item.scale), [100, 50]);
    assert.equal(next.entities[1].textSize, 0.35);
});

test('is a no-op on sizes when the scale does not change', () => {
    const next = changeDrawingPlanScale(content, 100, { rescaleExisting: true });
    assert.equal(next.entities, content.entities);
});
