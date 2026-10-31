import test from 'node:test';
import assert from 'node:assert/strict';

import { drawingLineworkBlockChildren, drawingLineworkDependsOnViewport, drawingLineworkPath } from './drawingLineworkBatch.js';
import { getArcPath } from './drawingCurves.js';

const view = { x: -100, y: -100, width: 200, height: 200 };

test('plain linework draws the same geometry as its own element', () => {
    assert.equal(drawingLineworkPath({ type: 'line', x1: 0, y1: 1, x2: 3, y2: 4 }), 'M 0 1 L 3 4');
    const arc = { type: 'arc', cx: 0, cy: 0, r: 2, startAngle: 0, endAngle: Math.PI / 2 };
    assert.equal(drawingLineworkPath(arc), getArcPath(arc));
    assert.equal(drawingLineworkPath({ type: 'circle', cx: 1, cy: 2, r: 3 }, view), 'M 4 2 A 3 3 0 1 1 -2 2 A 3 3 0 1 1 4 2 Z');
    assert.equal(drawingLineworkPath({ type: 'rectangle', x: 0, y: 0, width: 2, height: 1 }), 'M 0 0 L 2 0 L 2 1 L 0 1 Z');
    // Open polylines stay open, closed ones close, as with polyline/polygon elements.
    const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    assert.equal(drawingLineworkPath({ type: 'polyline', points }), 'M 0 0 L 1 0 L 1 1');
    assert.equal(drawingLineworkPath({ type: 'polyline', closed: true, points }), 'M 0 0 L 1 0 L 1 1 Z');
    // Polyline parts are drawn one by one.
    const parts = [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 0 }, { type: 'arc', cx: 1, cy: 1, r: 1, startAngle: -Math.PI / 2, endAngle: 0 }];
    assert.equal(drawingLineworkPath({ type: 'polyline', parts }), `M 0 0 L 1 0 ${getArcPath(parts[1])}`);
});

test('entities needing their own element are not batched', () => {
    const cases = [
        { type: 'text', x: 0, y: 0, width: 1, height: 1 },
        { type: 'hatch', boundaries: [] },
        { type: 'spline', controlPoints: [] },
        { type: 'rectangle', x: 0, y: 0, width: 2, height: 1, rotation: 30 },
        { type: 'polyline', lineWidth: 0.2, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
        { type: 'polyline', parts: [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 0, color: '#ff0000' }] },
        { type: 'polyline', parts: [{ type: 'text', text: 'A' }] },
        { type: 'xline', x: 0, y: 0, angle: 0 },
    ];
    for (const entity of cases) assert.equal(drawingLineworkPath(entity, view), null, entity.type);
    assert.equal(drawingLineworkDependsOnViewport({ type: 'circle' }), true);
    assert.equal(drawingLineworkDependsOnViewport({ type: 'line' }), false);
});

test('block children are drawn in drawing coordinates, or the reference keeps its own rendering', () => {
    const block = { id: 'panel', entities: [
        { id: 'frame', type: 'rectangle', layerId: 'geometry', x: 0, y: 0, width: 1, height: 2 },
        { id: 'cell', type: 'line', layerId: 'geometry', x1: 0, y1: 1, x2: 1, y2: 1 },
    ] };
    const reference = { id: 'r', type: 'blockReference', blockId: 'panel', layerId: 'pv', transform: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 } };
    const children = drawingLineworkBlockChildren(reference, block);
    assert.deepEqual(children.map(child => child.d), ['M 10 20 L 11 20 L 11 22 L 10 22 Z', 'M 10 21 L 11 21']);
    // Children on layer 0 take the reference layer, as when the block is drawn.
    assert.deepEqual(children.map(child => child.entity.layerId), ['pv', 'pv']);
    assert.deepEqual(drawingLineworkBlockChildren(reference, block, { layerVisible: layerId => layerId !== 'pv' }), []);
    const rotated = { ...reference, transform: { a: Math.SQRT1_2, b: Math.SQRT1_2, c: -Math.SQRT1_2, d: Math.SQRT1_2, e: 0, f: 0 } };
    // A rotated reference turns the frame into its rotated outline.
    const [frame] = drawingLineworkBlockChildren(rotated, block);
    const corners = frame.d.match(/-?\d+(\.\d+)?(e-?\d+)?/g).map(Number);
    const expected = [0, 0, Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, 3 * Math.SQRT1_2, -2 * Math.SQRT1_2, 2 * Math.SQRT1_2];
    expected.forEach((value, index) => assert.ok(Math.abs(corners[index] - value) < 1e-12));
    const labelled = { ...block, entities: [...block.entities, { id: 'label', type: 'text', layerId: 'geometry', x: 0, y: 0, width: 1, height: 1, text: 'A' }] };
    assert.equal(drawingLineworkBlockChildren(reference, labelled), null);
    assert.equal(drawingLineworkBlockChildren({ ...reference, externalReference: { loaded: false } }, block), null);
});

test('cubic spans batch as independent Bezier subpaths without changing joins or per-part appearance', () => {
    const spline = { type: 'spline', controlPoints: [{ x: 0, y: 1 }, { x: 2, y: 3 }, { x: 4, y: 5 }, { x: 6, y: 7 }] };
    assert.equal(drawingLineworkPath(spline), 'M 0 1 C 2 3 4 5 6 7');
    const compound = { type: 'polyline', parts: [spline, { type: 'line', x1: 6, y1: 7, x2: 8, y2: 9 }] };
    assert.equal(drawingLineworkPath(compound), 'M 0 1 C 2 3 4 5 6 7 M 6 7 L 8 9');
    assert.equal(drawingLineworkPath({ ...compound, parts: [{ ...spline, transparency: 30 }] }), null);
});
