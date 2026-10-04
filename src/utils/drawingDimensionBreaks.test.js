import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDimensionBreaks, breakDimensionLine, breakDimensionArc, pickDimensionBreak } from './drawingDimensionBreaks.js';
import { maintainDrawingDimensions, beginDimensionBreak, advanceDimensionBreak } from './drawingDimensionMaintenance.js';
import { getDimensionGeometry, getDimensionBreakSourceCurves } from './drawingDimensions.js';
import { presentDrawingDimension } from './drawingDimensionPresentation.js';
import { createDefaultDrawingContent } from './drawingDocument.js';

const line = { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
test('manual gaps merge overlaps and preserve surviving line endpoints', () => {
    const gaps = [{ kind: 'line', index: 0, start: 0.2, end: 0.5 }, { kind: 'line', index: 0, start: 0.4, end: 0.7 }];
    assert.deepEqual(breakDimensionLine(line, 0, gaps).map(part => [part.start.x, part.end.x]), [[0, 2], [7, 10]]);
    assert.equal(normalizeDimensionBreaks([{ kind: 'line', index: 0, start: NaN, end: 1 }]).length, 0);
    assert.equal(breakDimensionLine(line, 0, [{ kind: 'line', index: 0, start: 0, end: 1 }]).length, 0);
});
test('arc gaps preserve signed sweep and nearest picking across the angle wrap', () => {
    for (const sign of [-1, 1]) {
        const arc = { center: { x: 0, y: 0 }, radius: 5, startAngle: sign * 3, endAngle: sign * 4, counterClockwise: sign > 0 };
        const point = angle => ({ x: 5 * Math.cos(angle), y: 5 * Math.sin(angle) });
        const gap = pickDimensionBreak({ arcs: [arc] }, point(sign * 3.2), point(sign * 3.8));
        assert.equal(gap.kind, 'arc');
        assert.ok(Math.abs(gap.start - 0.2) < 1e-9);
        const parts = breakDimensionArc(arc, 0, [gap]);
        assert.equal(parts.length, 2);
        assert.ok(Math.abs(parts[1].startAngle - sign * 3.8) < 1e-9);
    }
});
test('DIMBREAK preserves measurement and source data and REMOVE restores full presentation', () => {
    const entity = { id: 'dim', type: 'linearDimension', layerId: 'dimensions', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, offset: 2 };
    const content = { ...createDefaultDrawingContent(), entities: [entity] };
    const result = maintainDrawingDimensions(content, ['dim'], 'break', '2 2 4 2').content;
    const geometry = getDimensionGeometry(result.entities[0]);
    assert.deepEqual(geometry, getDimensionGeometry(entity));
    const rendered = presentDrawingDimension(geometry, result.entities[0]);
    assert.deepEqual(rendered.lines.filter(part => part.role === 'dimension').map(part => [part.start.x, part.end.x]), [[0, 2], [4, 10]]);
    assert.equal(entity.dimensionBreaks, undefined);
    const restored = maintainDrawingDimensions(result, ['dim'], 'break', 'REMOVE').content.entities[0];
    assert.equal(restored.dimensionBreaks, undefined);
    assert.equal(presentDrawingDimension(geometry, restored).lines.length, 3);
    assert.equal(maintainDrawingDimensions(content, ['dim'], 'break', '2 2 2 2').error, 'geometry');
});


test('interactive breaks wait for both points, match manual coordinates and revalidate locked targets', () => {
    const content = { ...createDefaultDrawingContent(), entities: [{ id: 'dim', type: 'linearDimension', layerId: 'dimensions', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, offset: 2 }] };
    const before = structuredClone(content);
    const start = beginDimensionBreak(content, ['dim']).operation;
    const pending = advanceDimensionBreak(content, start, { x: 2, y: 2 });
    assert.equal(pending.content, undefined);
    assert.equal(pending.operation.stage, 'second-point');
    const result = advanceDimensionBreak(content, pending.operation, { x: 4, y: 2 });
    assert.deepEqual(result, maintainDrawingDimensions(content, ['dim'], 'break', '2 2 4 2'));
    assert.deepEqual(content, before);
    assert.equal(advanceDimensionBreak(content, pending.operation, { x: 2, y: 2 }).error, 'geometry');
    content.entities[0].locked = true;
    assert.equal(advanceDimensionBreak(content, pending.operation, { x: 4, y: 2 }).error, 'selection');
});

test('automatic gaps follow obstacle movement and disappearance without changing manual gaps or measurements', () => {
    const dimension = { id: 'dim', type: 'linearDimension', layerId: 'dimensions', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, offset: 2 };
    const obstacle = { id: 'crossing', type: 'line', layerId: 'geometry', x1: 3, y1: 1, x2: 3, y2: 3 };
    const content = { ...createDefaultDrawingContent(), entities: [dimension, obstacle] };
    const automatic = maintainDrawingDimensions(content, ['dim'], 'break', 'AUTO 1 crossing').content.entities[0];
    const render = source => presentDrawingDimension(getDimensionGeometry(automatic, new Map(source.map(entity => [entity.id, entity]))), automatic);
    assert.deepEqual(render([obstacle]).lines.filter(line => line.role === 'dimension').map(line => [line.start.x, line.end.x]), [[0, 2.5], [3.5, 10]]);
    const moved = render([{ ...obstacle, x1: 7, x2: 7 }]).lines.filter(line => line.role === 'dimension');
    assert.ok(Math.abs(moved[0].end.x - 6.5) < 1e-9);
    assert.ok(Math.abs(moved[1].start.x - 7.5) < 1e-9);
    assert.equal(render([]).lines.filter(line => line.role === 'dimension').length, 1);
    assert.equal(render([obstacle]).value, 10);
    const removed = maintainDrawingDimensions({ ...content, entities: [automatic, obstacle] }, ['dim'], 'break', 'REMOVE').content.entities[0];
    assert.equal(removed.dimensionAutoBreak, undefined);
    assert.equal(maintainDrawingDimensions(content, ['dim'], 'break', 'AUTO 1 missing').error, 'breakSources');
});

test('dimension obstacles honor styled extensions and manual gaps while cyclic automatic references terminate', () => {
    const horizontal = { id: 'horizontal', type: 'linearDimension', layerId: 'dimensions', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, offset: 2 };
    const vertical = { id: 'vertical', type: 'linearDimension', layerId: 'dimensions', p1: { x: 4, y: 0 }, p2: { x: 4, y: 4 }, offset: 1 };
    const content = { ...createDefaultDrawingContent(), entities: [horizontal, vertical] };
    const first = maintainDrawingDimensions(content, ['horizontal'], 'break', 'AUTO 0.4 vertical').content;
    const cyclic = maintainDrawingDimensions(first, ['vertical'], 'break', 'AUTO 0.4 horizontal').content;
    const map = new Map(cyclic.entities.map(entity => [entity.id, entity]));
    for (const entity of cyclic.entities) {
        const geometry = presentDrawingDimension(getDimensionGeometry(entity, map), entity);
        assert.equal(geometry.lines.filter(line => line.role === 'dimension').length, 2);
        assert.equal(geometry.automaticBreakTruncated, false);
    }
    const brokenVertical = { ...cyclic.entities[1], dimensionBreaks: [{ kind: 'line', index: 2, start: 0.4, end: 0.6 }] };
    map.set('vertical', brokenVertical);
    const rendered = presentDrawingDimension(getDimensionGeometry(cyclic.entities[0], map), cyclic.entities[0]);
    assert.equal(rendered.lines.filter(line => line.role === 'dimension').length, 1);
    const extending = { ...vertical, p1: { x: 4, y: 2.1 }, p2: { x: 4, y: 4 }, extensionOverrun: 2 };
    const curves = getDimensionBreakSourceCurves(extending, new Map());
    assert.ok(curves.some(curve => curve.type === 'line' && curve.x2 === 1));
});
