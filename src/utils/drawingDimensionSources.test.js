import test from 'node:test';
import assert from 'node:assert/strict';
import { createDimensionSourceMap } from './drawingDimensionSources.js';
import { getDimensionGeometry } from './drawingDimensions.js';
import { presentDrawingDimension } from './drawingDimensionPresentation.js';
import { maintainDrawingDimensions } from './drawingDimensionMaintenance.js';
import { createDefaultDrawingContent } from './drawingDocument.js';

const matrix = (e = 0, f = 0) => ({ a: 1, b: 0, c: 0, d: 1, e, f });
function fixture() {
    const dimension = { id: 'dim', type: 'linearDimension', layerId: 'dimensions', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, offset: 2 };
    const reference = { id: 'ref', type: 'blockReference', blockId: 'outer', layerId: 'geometry', transform: matrix(2) };
    const blocks = [
        { id: 'inner', name: 'Inner', entities: [{ id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 0, y2: 4 }] },
        { id: 'outer', name: 'Outer', entities: [{ id: 'nested', type: 'blockReference', blockId: 'inner', layerId: 'geometry', transform: matrix(1) }] },
    ];
    return { ...createDefaultDrawingContent(), entities: [dimension, reference], blocks, layers: [{ id: 'geometry', visible: true }, { id: 'dimensions', visible: true }] };
}
const rendered = content => {
    const dimension = content.entities[0];
    return presentDrawingDimension(getDimensionGeometry(dimension, createDimensionSourceMap(content.entities, content.blocks, content)), dimension);
};

test('automatic gaps resolve nested block transforms and follow insertion changes without exploding', () => {
    const content = fixture(); const before = structuredClone(content);
    const result = maintainDrawingDimensions(content, ['dim'], 'break', 'AUTO 1 ref').content;
    const spans = rendered(result).lines.filter(line => line.role === 'dimension');
    assert.ok(Math.abs(spans[0].end.x - 2.5) < 1e-9);
    assert.ok(Math.abs(spans[1].start.x - 3.5) < 1e-9);
    const moved = { ...result, entities: [result.entities[0], { ...result.entities[1], transform: matrix(5) }] };
    assert.ok(Math.abs(rendered(moved).lines.filter(line => line.role === 'dimension')[0].end.x - 5.5) < 1e-9);
    assert.equal(result.entities.length, 2);
    assert.deepEqual(content, before);
});

test('hidden children and cyclic block references do not become obstacles', () => {
    const content = fixture();
    content.layers[0].visible = false;
    const map = createDimensionSourceMap(content.entities, content.blocks, content);
    assert.deepEqual(map.dimensionBlockCurves(content.entities[1]), []);
    content.layers[0].visible = true;
    content.blocks[0].entities = [{ id: 'cycle', type: 'blockReference', blockId: 'outer', transform: matrix() }];
    assert.deepEqual(createDimensionSourceMap(content.entities, content.blocks, content).dimensionBlockCurves(content.entities[1]), []);
});

test('local associative dimensions inside a block use transformed sibling sources', () => {
    const content = fixture();
    content.blocks[0].entities.push({ id: 'local-dim', type: 'linearDimension', layerId: 'dimensions', sourceId: 'line', offset: 1 });
    const curves = createDimensionSourceMap(content.entities, content.blocks, content).dimensionBlockCurves(content.entities[1]);
    assert.ok(curves.some(curve => curve.type === 'line' && curve.x1 === 2 && curve.x2 === 2 && curve.y1 === 0 && curve.y2 === 4));
});

test('wide empty nested block trees exhaust a shared traversal budget instead of expanding indefinitely', () => {
    const content = fixture();
    content.blocks = Array.from({ length: 7 }, (_, depth) => ({
        id: depth ? `level-${depth}` : 'outer', name: `Level ${depth}`,
        entities: depth === 6 ? [] : Array.from({ length: 10 }, (_, index) => ({ id: `child-${index}`, type: 'blockReference', layerId: 'geometry', blockId: `level-${depth + 1}`, transform: matrix() })),
    }));
    const map = createDimensionSourceMap(content.entities, content.blocks, content);
    assert.equal(map.dimensionBlockCurves(content.entities[1]).truncated, true);
    assert.equal(maintainDrawingDimensions(content, ['dim'], 'break', 'AUTO 1 ref').error, 'breakLimit');
    content.entities[0].dimensionAutoBreak = { gap: 1, sourceIds: ['ref'] };
    content.entities[0].dimensionBreaks = [{ kind: 'line', index: 2, start: 0.2, end: 0.4 }];
    const display = rendered(content);
    assert.equal(display.automaticBreakTruncated, true);
    assert.equal(display.lines.filter(line => line.role === 'dimension').length, 2);
    assert.equal(display.value, 10);
});
