import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { snapDrawingPoint } from './drawingGeometry.js';
import { drawingSnapEntities } from './drawingBlockSnapping.js';
import { transformDrawingEntityAffine, materializeDrawingBlockReference } from './drawingBlocks.js';
import { curvePointAt } from './drawingCurveKernel.js';

function content() {
    const content = createDefaultDrawingContent();
    content.settings.snaps = { endpoint: true, midpoint: true, nearest: true, intersection: true, grid: false };
    content.blocks = [{ id: 'inner', name: 'Inner', entities: [
        { id: 'edge', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0 },
    ] }, { id: 'outer', name: 'Outer', entities: [
        { id: 'nested', type: 'blockReference', layerId: 'geometry', blockId: 'inner', transform: { a: 2, b: 0, c: 0, d: 2, e: 1, f: 0 } },
    ] }];
    content.entities = [{ id: 'instance', type: 'blockReference', layerId: 'geometry', blockId: 'outer', transform: { a: 0, b: 1, c: -1, d: 0, e: 10, f: 20 } }];
    return content;
}

test('nested block endpoint, midpoint and nearest snaps use world coordinates and root identity', () => {
    const drawing = content();
    for (const [point, expected, type] of [
        [{ x: 10.01, y: 21.01 }, { x: 10, y: 21 }, 'endpoint'],
        [{ x: 10.01, y: 25 }, { x: 10, y: 25 }, 'midpoint'],
        [{ x: 10.01, y: 23 }, { x: 10, y: 23 }, 'nearest'],
    ]) {
        drawing.settings.snaps.nearest = type === 'nearest';
        const result = snapDrawingPoint(point, drawing, 0.1);
        assert.equal(result.type, type); assert.equal(result.entityId, 'instance');
        assert.ok(Math.hypot(result.x - expected.x, result.y - expected.y) < 1e-9);
    }
    assert.equal(snapDrawingPoint({ x: 10, y: 21 }, drawing, 0.1, { excludeIds: ['instance'] }).type, null);
    drawing.layers[0].visible = false;
    assert.equal(snapDrawingPoint({ x: 10, y: 21 }, drawing, 0.1).type, null);
});

test('block children intersect ordinary geometry and other children with instance identities', () => {
    const drawing = content();
    drawing.entities.push({ id: 'crossing', type: 'line', layerId: 'geometry', x1: 8, y1: 23, x2: 12, y2: 23 });
    drawing.settings.snaps.nearest = false;
    const snap = snapDrawingPoint({ x: 10.01, y: 23.01 }, drawing, 0.1);
    assert.equal(snap.type, 'intersection');
    assert.deepEqual(new Set(snap.entityIds), new Set(['instance', 'crossing']));
});

test('cyclic and highly repeated block graphs have bounded snapping expansion', () => {
    const drawing = content();
    drawing.blocks[0].entities.push({ ...drawing.entities[0], id: 'cycle' });
    assert.equal(drawingSnapEntities(drawing).length, 1);
    drawing.blocks[1].entities = Array.from({ length: 100 }, (_, index) => ({ ...drawing.blocks[1].entities[0], id: String(index) }));
    assert.ok(drawingSnapEntities(drawing, new Set(), 10).length <= 10);
});

test('nonuniform block materialization keeps circles and arcs as exact native ellipses', () => {
    const matrix = { a: 2, b: 0.3, c: 0.4, d: 1, e: 10, f: -2 };
    for (const entity of [
        { id: 'circle', type: 'circle', cx: 1, cy: 2, r: 3 },
        { id: 'arc', type: 'arc', cx: 1, cy: 2, r: 3, startAngle: 0.2, endAngle: 2.3, counterClockwise: false },
    ]) {
        const transformed = transformDrawingEntityAffine(entity, matrix);
        assert.equal(transformed.type, 'ellipse');
        if (entity.type === 'arc') for (const parameter of [0, 0.2, 0.5, 1]) {
            const point = curvePointAt(entity, parameter);
            const actual = curvePointAt(transformed, parameter);
            assert.ok(Math.hypot(actual.x - (matrix.a * point.x + matrix.c * point.y + matrix.e), actual.y - (matrix.b * point.x + matrix.d * point.y + matrix.f)) < 1e-8);
        }
        const materialized = materializeDrawingBlockReference({ blockId: 'shape', transform: matrix }, [{ id: 'shape', entities: [entity] }]);
        assert.deepEqual(materialized[0], transformed);
    }
});

test('similarity transforms retain mirrored image frames and scale inherited/rich text sizes', () => {
    const matrix = { a: -2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const image = { id: 'image', type: 'image', x: 1, y: 2, width: 4, height: 2, rotation: 30 };
    const transformed = transformDrawingEntityAffine(image, matrix);
    assert.equal(transformed.mirrored, true);
    assert.equal(transformed.width, 8); assert.equal(transformed.height, 4);
    assert.ok(Math.abs(transformed.rotation - 150) < 1e-9);
    const text = { ...image, type: 'text', textStyleId: 'large', runs: [{ text: 'A', marks: { fontSize: 0.8 } }, { text: 'B', marks: {} }] };
    const result = materializeDrawingBlockReference({ blockId: 'label', transform: matrix }, [{ id: 'label', entities: [text] }], {
        textStyles: [{ id: 'large', name: 'Large', fontSize: 0.6 }],
    })[0];
    assert.equal(result.fontSize, 1.2);
    assert.equal(result.runs[0].marks.fontSize, 1.6);
    assert.deepEqual(result.runs[1].marks, {});
});
