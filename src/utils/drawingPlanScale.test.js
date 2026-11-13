import { describe, expect, it } from 'vitest';
import { changeDrawingPlanScale, countDrawingPlanScaleAnnotations, parseDrawingPlanScale } from './drawingPlanScale.js';
import { normalizeDimensionStyles } from './drawingDimensionStyles.js';

const dimension = { id: 'd', type: 'linearDimension', layerId: 'l', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, offset: 0.6, textSize: 0.35, arrowSize: 0.245, extensionGap: 0, extensionOverrun: 0 };
const annotative = { ...dimension, id: 'a', annotation: { baseScale: 100, scales: [{ scale: 100, offset: { x: 0, y: 0 } }] } };
const text = { id: 't', type: 'text', layerId: 'l', x: 0, y: 0, width: 4, height: 1, fontSize: 0.35, text: 'Note', textMode: 'singleLine' };
const content = { entities: [dimension, annotative, text], blocks: [], settings: {}, dimensionStyles: normalizeDimensionStyles([]), textStyles: [] };

describe('plan scale', () => {
    it('parses denominators written as 50, 1:50 or 1/50', () => {
        expect(parseDrawingPlanScale('50')).toBe(50);
        expect(parseDrawingPlanScale('1:50')).toBe(50);
        expect(parseDrawingPlanScale('1/12,5')).toBe(12.5);
        expect(parseDrawingPlanScale('abc')).toBeNull();
        expect(parseDrawingPlanScale('0')).toBeNull();
    });

    it('counts the non-annotative dimensions and texts it may resize', () => {
        expect(countDrawingPlanScaleAnnotations(content)).toEqual({ dimensions: 1, texts: 1 });
    });

    it('keeps the paper size of styles and leaves existing objects unless asked', () => {
        const next = changeDrawingPlanScale(content, 50);
        expect(next.settings.annotationScale).toBe(50);
        expect(next.annotationScales).toContain(50);
        expect(next.dimensionStyles[0].textSize).toBeCloseTo(0.175, 9);
        expect(next.dimensionStyles[0].arrowSize).toBeCloseTo(0.1225, 9);
        expect(next.entities[0]).toBe(dimension);
        expect(next.entities[2]).toBe(text);
    });

    it('rescales existing dimensions and texts in the same revision', () => {
        const next = changeDrawingPlanScale(content, 200, { rescaleExisting: true });
        expect(next.entities[0].textSize).toBeCloseTo(0.7, 9);
        expect(next.entities[0].arrowSize).toBeCloseTo(0.49, 9);
        expect(next.entities[0].offset).toBe(0.6);
        expect(next.entities[2].fontSize).toBeCloseTo(0.7, 9);
    });

    it('adds the new scale to annotative objects so they stay visible', () => {
        const next = changeDrawingPlanScale(content, 50, { rescaleExisting: true });
        expect(next.entities[1].annotation.scales.map(item => item.scale)).toEqual([100, 50]);
        expect(next.entities[1].textSize).toBe(0.35);
    });

    it('is a no-op on sizes when the scale does not change', () => {
        const next = changeDrawingPlanScale(content, 100, { rescaleExisting: true });
        expect(next.entities).toBe(content.entities);
    });
});
