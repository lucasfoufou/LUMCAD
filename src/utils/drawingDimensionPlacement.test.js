import { describe, expect, it } from 'vitest';
import { getDimensionGeometry } from './drawingDimensions.js';
import {
    defaultDimensionLineOffset,
    dimensionWithTypedOffset,
    parseDimensionToolInput,
    placeDimensionAtPoint,
    resolveDimensionPickTarget,
    withDefaultCommandPlacements,
    withDefaultDimensionPlacement,
} from './drawingDimensionPlacement.js';

const rectangle = { id: 'r', type: 'rectangle', layerId: 'l', x: 0, y: 0, width: 10, height: 4 };
const content = annotationScale => ({ entities: [rectangle], settings: annotationScale ? { annotationScale } : {} });
const sources = new Map([[rectangle.id, rectangle]]);
const edgeDimension = edgeIndex => ({ id: 'd', type: 'linearDimension', sourceId: 'r', edgeIndex, measurementMode: 'aligned', dimensionAngle: 0, offset: 0.6 });
const lineCenter = (dimension, map = sources) => {
    const [first, second] = getDimensionGeometry(dimension, map).points;
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
};

describe('dimension placement', () => {
    it('derives the default line offset from 6 mm at the plan scale', () => {
        expect(defaultDimensionLineOffset(content())).toBeCloseTo(0.6, 9);
        expect(defaultDimensionLineOffset(content(50))).toBeCloseTo(0.3, 9);
        expect(defaultDimensionLineOffset(content(200))).toBeCloseTo(1.2, 9);
    });

    it('places every rectangle edge dimension outside the rectangle', () => {
        for (let edgeIndex = 0; edgeIndex < 4; edgeIndex++) {
            const placed = withDefaultDimensionPlacement(content(), edgeDimension(edgeIndex), sources);
            const center = lineCenter(placed);
            const outside = center.x < 0 || center.x > 10 || center.y < 0 || center.y > 4;
            expect(outside, `edge ${edgeIndex}`).toBe(true);
        }
    });

    it('keeps a lone line on its conventional side and puts a contour line outside', () => {
        const line = { id: 'a', type: 'line', layerId: 'l', x1: 0, y1: 0, x2: 10, y2: 0 };
        const dimension = { id: 'd', type: 'linearDimension', sourceId: 'a', measurementMode: 'aligned', dimensionAngle: 0, offset: 0.6 };
        const lone = { entities: [line], settings: {} };
        expect(withDefaultDimensionPlacement(lone, dimension, new Map([['a', line]])).offset).toBeCloseTo(0.6, 9);
        const side = { id: 'b', type: 'line', layerId: 'l', x1: 10, y1: 0, x2: 10, y2: 5 };
        const contour = { entities: [line, side], settings: {} };
        const placed = withDefaultDimensionPlacement(contour, dimension, new Map([['a', line], ['b', side]]));
        expect(lineCenter(placed, new Map([['a', line]])).y).toBeLessThan(0);
    });

    it('moves the dimension line through the pointer and accepts typed distances on the pointer side', () => {
        const placed = placeDimensionAtPoint(edgeDimension(0), { x: 5, y: -3 }, sources);
        expect(lineCenter(placed).y).toBeCloseTo(-3, 9);
        const typed = dimensionWithTypedOffset(edgeDimension(0), 2, sources, { x: 5, y: -10 });
        expect(lineCenter(typed).y).toBeCloseTo(-2, 9);
        expect(dimensionWithTypedOffset(edgeDimension(0), 0, sources)).toBeNull();
    });

    it('prefers dimensioning a picked object unless the two-point mode is chosen', () => {
        expect(resolveDimensionPickTarget(rectangle)).toBe(rectangle);
        expect(resolveDimensionPickTarget(rectangle, 'points')).toBeNull();
        expect(resolveDimensionPickTarget({ type: 'text' })).toBeNull();
    });

    it('parses Enter, distances and mode words', () => {
        expect(parseDimensionToolInput('')).toEqual({ kind: 'accept' });
        expect(parseDimensionToolInput('1,5')).toEqual({ kind: 'offset', value: 1.5 });
        expect(parseDimensionToolInput('points')).toEqual({ kind: 'pickMode', mode: 'points' });
        expect(parseDimensionToolInput('OBJET')).toEqual({ kind: 'pickMode', mode: 'object' });
        expect(parseDimensionToolInput('P')).toBeNull();
    });

    it('places command-created linear dimensions outside without touching other results', () => {
        const created = edgeDimension(0);
        const result = { changed: true, content: { ...content(), entities: [rectangle, created] }, entities: [created], selectedIds: ['d'] };
        const placed = withDefaultCommandPlacements(result);
        expect(lineCenter(placed.entities[0]).y).toBeLessThan(0);
        expect(placed.content.entities[1]).toBe(placed.entities[0]);
        expect(withDefaultCommandPlacements({ changed: false })).toEqual({ changed: false });
    });
});
