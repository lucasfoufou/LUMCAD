import assert from 'node:assert/strict';
import test from 'node:test';
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

test('derives the default line offset from 6 mm at the plan scale', () => {
    assert.ok(Math.abs((defaultDimensionLineOffset(content())) - (0.6)) < 1e-9);
    assert.ok(Math.abs((defaultDimensionLineOffset(content(50))) - (0.3)) < 1e-9);
    assert.ok(Math.abs((defaultDimensionLineOffset(content(200))) - (1.2)) < 1e-9);
});

test('places every rectangle edge dimension outside the rectangle', () => {
    for (let edgeIndex = 0; edgeIndex < 4; edgeIndex++) {
        const placed = withDefaultDimensionPlacement(content(), edgeDimension(edgeIndex), sources);
        const center = lineCenter(placed);
        const outside = center.x < 0 || center.x > 10 || center.y < 0 || center.y > 4;
        assert.equal(outside, true, `edge ${edgeIndex}`);
    }
});

test('keeps a lone line on its conventional side and puts a contour line outside', () => {
    const line = { id: 'a', type: 'line', layerId: 'l', x1: 0, y1: 0, x2: 10, y2: 0 };
    const dimension = { id: 'd', type: 'linearDimension', sourceId: 'a', measurementMode: 'aligned', dimensionAngle: 0, offset: 0.6 };
    const lone = { entities: [line], settings: {} };
    assert.ok(Math.abs((withDefaultDimensionPlacement(lone, dimension, new Map([['a', line]])).offset) - (0.6)) < 1e-9);
    const side = { id: 'b', type: 'line', layerId: 'l', x1: 10, y1: 0, x2: 10, y2: 5 };
    const contour = { entities: [line, side], settings: {} };
    const placed = withDefaultDimensionPlacement(contour, dimension, new Map([['a', line], ['b', side]]));
    assert.ok((lineCenter(placed, new Map([['a', line]])).y) < (0));
});

test('moves the dimension line through the pointer and accepts typed distances on the pointer side', () => {
    const placed = placeDimensionAtPoint(edgeDimension(0), { x: 5, y: -3 }, sources);
    assert.ok(Math.abs((lineCenter(placed).y) - (-3)) < 1e-9);
    const typed = dimensionWithTypedOffset(edgeDimension(0), 2, sources, { x: 5, y: -10 });
    assert.ok(Math.abs((lineCenter(typed).y) - (-2)) < 1e-9);
    assert.equal(dimensionWithTypedOffset(edgeDimension(0), 0, sources), null);
});

test('prefers dimensioning a picked object unless the two-point mode is chosen', () => {
    assert.equal(resolveDimensionPickTarget(rectangle), rectangle);
    assert.equal(resolveDimensionPickTarget(rectangle, 'points'), null);
    assert.equal(resolveDimensionPickTarget({ type: 'text' }), null);
});

test('parses Enter, distances and mode words', () => {
    assert.deepEqual(parseDimensionToolInput(''), { kind: 'accept' });
    assert.deepEqual(parseDimensionToolInput('1,5'), { kind: 'offset', value: 1.5 });
    assert.deepEqual(parseDimensionToolInput('points'), { kind: 'pickMode', mode: 'points' });
    assert.deepEqual(parseDimensionToolInput('OBJET'), { kind: 'pickMode', mode: 'object' });
    assert.equal(parseDimensionToolInput('P'), null);
});

test('places command-created linear dimensions outside without touching other results', () => {
    const created = edgeDimension(0);
    const result = { changed: true, content: { ...content(), entities: [rectangle, created] }, entities: [created], selectedIds: ['d'] };
    const placed = withDefaultCommandPlacements(result);
    assert.ok((lineCenter(placed.entities[0]).y) < (0));
    assert.equal(placed.content.entities[1], placed.entities[0]);
    assert.deepEqual(withDefaultCommandPlacements({ changed: false }), { changed: false });
});
