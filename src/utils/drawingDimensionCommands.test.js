import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import {
    DEFAULT_DRAWING_QDIM_BASELINE_SPACING,
    DRAWING_QDIM_GRIP_IDS,
    getDimensionGeometry,
    getDrawingEntityDependencyIds,
} from './drawingDimensions.js';
import {
    appendDimensionEntities,
    collectQdimStations,
    createAngularDimensionResult,
    createArcLengthDimensionResult,
    createBaselineDimensionResult,
    createCenterMarkResult,
    createContinuedDimensionResult,
    createDimensionIdAllocator,
    createJoggedRadiusDimensionResult,
    createOrdinateDimensionResult,
    createQdimResult,
    createQuickDimensionResult,
    getQdimSeriesPosition,
    rebuildQdimSeriesResult,
    rebuildQdimSeriesFromGripResult,
    resolveQdimSeriesId,
    resolveDimensionLayerId,
} from './drawingDimensionCommands.js';
import { getEntityGrips } from './drawingSelection.js';

function contentWithLinearSources() {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'first', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 0 },
        { id: 'second', type: 'line', layerId: 'geometry', x1: 2, y1: 0, x2: 5, y2: 0 },
        { id: 'existing', type: 'linearDimension', layerId: 'dimensions', sourceId: 'first', offset: 1 },
    ];
    return content;
}

test('stable id and layer allocators avoid collisions without mutating the document', () => {
    const content = contentWithLinearSources();
    content.entities.push({ id: 'dimension-1', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 1 });
    const before = structuredClone(content);
    const allocate = createDimensionIdAllocator(content);
    assert.equal(allocate('linearDimension', 0), 'dimension-2');
    assert.equal(allocate('linearDimension', 1), 'dimension-3');
    assert.deepEqual(content, before);
    assert.equal(resolveDimensionLayerId(content), 'dimensions');
    assert.equal(resolveDimensionLayerId(content, 'geometry'), 'geometry');

    const custom = createDimensionIdAllocator(content, {
        idFactory: ({ index }) => `custom-${index}`,
    });
    assert.equal(custom('linearDimension', 4), 'custom-4');
});

test('quick dimensions keep source associations and copy an existing measurement as free geometry', () => {
    const content = contentWithLinearSources();
    content.entities.push({ id: 'circle', type: 'circle', layerId: 'geometry', cx: 10, cy: 10, r: 2 });
    const result = createQuickDimensionResult(content, ['first', 'second', 'existing', 'circle'], {
        measurementMode: 'horizontal',
        offset: 1,
        spacing: 0.25,
        radialMode: 'diameter',
        dimensionFormat: { precision: 2 },
    });
    assert.equal(result.changed, true);
    assert.equal(result.command, 'quick');
    assert.equal(result.entities.length, 4);
    assert.deepEqual(result.entities.map(entity => entity.id), ['dimension-1', 'dimension-2', 'dimension-3', 'dimension-4']);
    assert.deepEqual(result.entities.slice(0, 2).map(entity => entity.sourceId), ['first', 'second']);
    assert.equal(result.entities[2].sourceId, undefined);
    assert.deepEqual(result.entities[2].p1, { x: 0, y: 0 });
    assert.deepEqual(result.entities[2].p2, { x: 2, y: 0 });
    assert.deepEqual(result.entities.slice(0, 3).map(entity => entity.offset), [1, 1.25, 1.5]);
    assert.equal(result.entities[3].sourceId, 'circle');
    assert.equal(result.entities[3].mode, 'diameter');
    assert.ok(result.entities.every(entity => entity.layerId === 'dimensions'));
    assert.equal(content.entities.length, 4);
    assert.equal(result.content.entities.length, 8);
});

test('baseline and continued commands order and deduplicate selected source endpoints', () => {
    const content = contentWithLinearSources();
    const baseline = createBaselineDimensionResult(content, ['second', 'first'], {
        measurementMode: 'horizontal', offset: 2,
    });
    assert.equal(baseline.changed, true);
    assert.deepEqual(baseline.entities.map(entity => [entity.p1.x, entity.p2.x]), [[0, 2], [0, 5]]);
    assert.ok(baseline.entities.every(entity => entity.seriesMode === 'baseline'));

    const continued = createContinuedDimensionResult(content, ['second', 'first'], {
        measurementMode: 'horizontal', offset: 2,
    });
    assert.deepEqual(continued.entities.map(entity => [entity.p1.x, entity.p2.x]), [[0, 2], [2, 5]]);
    assert.ok(continued.entities.every(entity => entity.seriesMode === 'continuous'));

    const fromExisting = createContinuedDimensionResult(content, ['existing']);
    assert.equal(fromExisting.entities.length, 1);
    assert.deepEqual([fromExisting.entities[0].p1.x, fromExisting.entities[0].p2.x], [0, 2]);
});

test('QDIM continuous mode is deterministic across selection order, reversed lines and duplicate picks', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'right', type: 'line', layerId: 'geometry', x1: 5, y1: 0, x2: 2, y2: 0 },
        { id: 'left', type: 'line', layerId: 'geometry', x1: 2, y1: 0, x2: 0, y2: 0 },
        {
            id: 'dimension-1', type: 'linearDimension', layerId: 'dimensions',
            p1: { x: -1, y: 0 }, p2: { x: 0, y: 0 }, seriesId: 'qdim-series-1',
        },
    ];
    const before = structuredClone(content);
    const options = { mode: 'continuous', measurementMode: 'horizontal', offset: 1 };
    const forward = createQdimResult(content, ['right', 'left', 'right'], options);
    const reverse = createQdimResult(content, ['left', 'right'], options);

    assert.equal(forward.changed, true);
    assert.equal(forward.command, 'quick');
    assert.deepEqual(forward.entities.map(entity => [entity.p1.x, entity.p2.x]), [[0, 2], [2, 5]]);
    assert.deepEqual(reverse.entities.map(entity => [entity.p1.x, entity.p2.x]), [[0, 2], [2, 5]]);
    assert.deepEqual(forward.entities.map(entity => entity.id), ['dimension-2', 'dimension-3']);
    assert.equal(forward.qdim.seriesId, 'qdim-series-2');
    assert.equal(forward.qdim.stationCount, 3);
    assert.deepEqual(forward.qdim.axis, { x: 1, y: 0 });
    assert.ok(forward.entities.every((entity, index) => (
        entity.seriesMode === 'continuous'
        && entity.seriesIndex === index
        && entity.seriesId === 'qdim-series-2'
    )));
    assert.deepEqual(getDrawingEntityDependencyIds(forward.entities[0]), ['left']);
    assert.deepEqual(getDrawingEntityDependencyIds(forward.entities[1]), ['left', 'right']);
    assert.deepEqual(content, before);
    assert.equal(forward.content.entities.length, content.entities.length + 2);
    assert.deepEqual(forward.selectedIds, forward.entities.map(entity => entity.id));
});

test('QDIM aligned axis selection is independent of selection order for mixed orientations', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'vertical', type: 'line', layerId: 'geometry', x1: 2, y1: 0, x2: 2, y2: 2 },
        { id: 'horizontal', type: 'line', layerId: 'geometry', x1: 5, y1: 1, x2: -1, y2: 1 },
    ];
    const forward = collectQdimStations(content, ['vertical', 'horizontal']);
    const reverse = collectQdimStations(content, ['horizontal', 'vertical']);
    assert.deepEqual(forward.axis, { x: 1, y: 0 });
    assert.deepEqual(reverse.axis, forward.axis);
    assert.deepEqual(reverse.stations, forward.stations);
});

test('QDIM automatically dimensions X stations across parallel vertical lines', () => {
    const content = createDefaultDrawingContent();
    content.entities = [0, 2, 5].map((x, index) => ({
        id: `vertical-${index}`,
        type: 'line',
        layerId: 'geometry',
        x1: x,
        y1: index * 0.25,
        x2: x,
        y2: 10 + index * 0.25,
    }));
    const selectedIds = ['vertical-2', 'vertical-0', 'vertical-1'];
    const stations = collectQdimStations(content, selectedIds);
    assert.deepEqual(stations.axis, { x: 1, y: 0 });
    assert.equal(stations.measurementMode, 'horizontal');
    assert.deepEqual(stations.stations.map(station => station.point.x), [0, 2, 5]);

    const continuous = createQdimResult(content, selectedIds, { mode: 'continuous' });
    assert.deepEqual(continuous.entities.map(entity => [entity.p1.x, entity.p2.x]), [[0, 2], [2, 5]]);
    assert.deepEqual(continuous.entities.map(entity => entity.measurementMode), ['horizontal', 'horizontal']);
    assert.deepEqual(continuous.entities.map(entity => (
        getDimensionGeometry(entity, new Map(content.entities.map(source => [source.id, source]))).value
    )), [2, 3]);

    const baseline = createQdimResult(content, selectedIds, {
        mode: 'baseline', baselineEnd: 'last',
    });
    assert.deepEqual(baseline.entities.map(entity => [entity.p1.x, entity.p2.x]), [[5, 2], [5, 0]]);
    assert.deepEqual(baseline.entities.map(entity => (
        getDimensionGeometry(entity, new Map(content.entities.map(source => [source.id, source]))).value
    )), [3, 5]);
});

test('QDIM automatically dimensions Y stations across parallel horizontal lines', () => {
    const content = createDefaultDrawingContent();
    content.entities = [-1, 2, 6].map((y, index) => ({
        id: `horizontal-${index}`,
        type: 'line',
        layerId: 'geometry',
        x1: index * 0.25,
        y1: y,
        x2: 10 + index * 0.25,
        y2: y,
    }));
    const selectedIds = ['horizontal-1', 'horizontal-2', 'horizontal-0'];
    const stations = collectQdimStations(content, selectedIds);
    assert.deepEqual(stations.axis, { x: 0, y: 1 });
    assert.equal(stations.measurementMode, 'vertical');
    assert.deepEqual(stations.stations.map(station => station.point.y), [-1, 2, 6]);

    const continuous = createQdimResult(content, selectedIds, { mode: 'continuous' });
    assert.deepEqual(continuous.entities.map(entity => [entity.p1.y, entity.p2.y]), [[-1, 2], [2, 6]]);
    const baseline = createQdimResult(content, selectedIds, { mode: 'baseline' });
    assert.deepEqual(baseline.entities.map(entity => [entity.p1.y, entity.p2.y]), [[-1, 2], [-1, 6]]);
});

test('QDIM explicit measurement mode and series axis override automatic spread inference', () => {
    const content = createDefaultDrawingContent();
    content.entities = [0, 2, 5].map((x, index) => ({
        id: `vertical-${index}`,
        type: 'line',
        layerId: 'geometry',
        x1: x,
        y1: 0,
        x2: x,
        y2: 10,
    }));
    const selectedIds = content.entities.map(entity => entity.id);
    const explicitMode = collectQdimStations(content, selectedIds, { measurementMode: 'vertical' });
    assert.deepEqual(explicitMode.axis, { x: 0, y: 1 });
    assert.equal(explicitMode.measurementMode, 'vertical');
    assert.deepEqual(explicitMode.stations.map(station => station.point.y), [0, 10]);

    const explicitAxis = collectQdimStations(content, selectedIds, { seriesAxis: { x: 0, y: -3 } });
    assert.deepEqual(explicitAxis.axis, { x: 0, y: 1 });
    assert.equal(explicitAxis.measurementMode, 'vertical');
    assert.deepEqual(explicitAxis.stations.map(station => station.point.y), [0, 10]);
});

test('QDIM baseline mode exposes first/last choice and persistent editable baseline metadata', () => {
    const content = contentWithLinearSources();
    const first = createQdimResult(content, ['second', 'first'], {
        mode: 'baseline', baselineEnd: 'left', measurementMode: 'horizontal', seriesId: 'series-a',
    });
    assert.deepEqual(first.entities.map(entity => [entity.p1.x, entity.p2.x]), [[0, 2], [0, 5]]);
    assert.deepEqual(first.entities.map(entity => entity.offset), [
        0.6,
        0.6 + DEFAULT_DRAWING_QDIM_BASELINE_SPACING,
    ]);
    assert.equal(first.qdim.baselineEnd, 'first');
    assert.equal(first.qdim.baselineReference.sourceId, 'first');
    assert.ok(first.entities.every(entity => (
        entity.baselineEnd === 'first'
        && entity.baselineReference.sourceId === 'first'
        && entity.seriesId === 'series-a'
    )));

    const last = createQdimResult(content, ['first', 'second'], {
        mode: 'baseline', baselineEnd: 'right', measurementMode: 'horizontal', seriesId: 'series-b',
    });
    assert.deepEqual(last.entities.map(entity => [entity.p1.x, entity.p2.x]), [[5, 2], [5, 0]]);
    assert.equal(last.qdim.baselineEnd, 'last');
    assert.equal(last.qdim.baselineReference.sourceId, 'second');
    assert.ok(last.entities.every(entity => (
        entity.baselineEnd === 'last'
        && entity.baselineReference.sourceId === 'second'
    )));

    const normalized = normalizeDrawingContent(JSON.parse(JSON.stringify(last.content)));
    const restored = normalized.entities.filter(entity => entity.seriesId === 'series-b');
    assert.equal(restored.length, 2);
    assert.ok(restored.every(entity => entity.baselineEnd === 'last'));
    assert.deepEqual(restored[0].baselineReference, last.entities[0].baselineReference);
    assert.deepEqual(restored[0].sourcePointReferences, last.entities[0].sourcePointReferences);
});

test('existing QDIM series rebuild atomically across baseline ends and continuous mode', () => {
    const content = contentWithLinearSources();
    const created = createQdimResult(content, ['first', 'second'], {
        mode: 'baseline',
        baselineEnd: 'first',
        measurementMode: 'horizontal',
        offset: 1,
        spacing: 0.25,
        seriesId: 'editable-series',
        dimensionFormat: { precision: 2 },
    });
    const before = structuredClone(created.content);
    const reversed = rebuildQdimSeriesResult(created.content, 'editable-series', {
        baselineEnd: 'last',
    });
    assert.equal(reversed.changed, true);
    assert.equal(reversed.command, 'qdimEdit');
    assert.deepEqual(reversed.entities.map(entity => entity.id), created.entities.map(entity => entity.id));
    assert.deepEqual(reversed.entities.map(entity => [entity.p1.x, entity.p2.x]), [[5, 2], [5, 0]]);
    assert.deepEqual(reversed.entities.map(entity => entity.offset), [1, 1.25]);
    assert.ok(reversed.entities.every(entity => (
        entity.seriesId === 'editable-series'
        && entity.seriesMode === 'baseline'
        && entity.baselineEnd === 'last'
        && entity.baselineReference.sourceId === 'second'
        && entity.dimensionFormat.precision === 2
    )));
    assert.equal(reversed.qdim.baselineReference.sourceId, 'second');
    assert.deepEqual(created.content, before);

    const repositioned = rebuildQdimSeriesResult(reversed.content, 'editable-series', {
        offset: 2,
        spacing: 0.4,
    });
    assert.equal(repositioned.changed, true);
    assert.deepEqual(repositioned.entities.map(entity => entity.offset), [2, 2.4]);

    const continuous = rebuildQdimSeriesResult(repositioned.content, 'editable-series', {
        mode: 'continuous',
    });
    assert.equal(continuous.changed, true);
    assert.deepEqual(continuous.entities.map(entity => entity.id), created.entities.map(entity => entity.id));
    assert.deepEqual(continuous.entities.map(entity => [entity.p1.x, entity.p2.x]), [[0, 2], [2, 5]]);
    assert.ok(continuous.entities.every(entity => (
        entity.seriesMode === 'continuous'
        && entity.offset === 2
        && entity.baselineEnd === undefined
        && entity.baselineReference === undefined
    )));
    assert.deepEqual(continuous.selectedIds, continuous.entities.map(entity => entity.id));
    assert.equal(continuous.content.entities.length, created.content.entities.length);

    const unchanged = rebuildQdimSeriesResult(continuous.content, 'editable-series', {
        mode: 'continuous',
    });
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.reason, 'unchanged-qdim-series');
    assert.equal(unchanged.content, continuous.content);
    assert.equal(rebuildQdimSeriesResult(content, 'missing-series').reason, 'qdim-series-not-found');
});

test('QDIM baseline spacing follows the signed dimension side and clears stale pinned lines', () => {
    const content = contentWithLinearSources();
    const created = createQdimResult(content, ['first', 'second'], {
        mode: 'baseline',
        measurementMode: 'horizontal',
        offset: -5,
        spacing: 1,
        seriesId: 'raised-series',
    });
    assert.deepEqual(created.entities.map(entity => entity.offset), [-5, -6]);
    const sources = new Map(content.entities.map(entity => [entity.id, entity]));
    assert.deepEqual(created.entities.map(entity => getDimensionGeometry(entity, sources).label.point.y), [-5, -6]);

    const pinnedContent = {
        ...created.content,
        entities: created.content.entities.map(entity => entity.seriesId === 'raised-series'
            ? { ...entity, linePoint: { x: 0, y: 3 } }
            : entity),
    };
    assert.deepEqual(
        pinnedContent.entities.filter(entity => entity.seriesId === 'raised-series')
            .map(entity => getDimensionGeometry(entity, new Map(pinnedContent.entities.map(item => [item.id, item]))).label.point.y),
        [3, 3],
    );
    assert.deepEqual(getQdimSeriesPosition(pinnedContent, 'raised-series'), {
        seriesId: 'raised-series',
        mode: 'baseline',
        offset: 3,
        spacing: 1,
        offsets: [3, 3],
    });

    const rebuilt = rebuildQdimSeriesResult(pinnedContent, 'raised-series', { offset: -3, spacing: 0.5 });
    assert.equal(rebuilt.changed, true);
    assert.deepEqual(rebuilt.entities.map(entity => entity.offset), [-3, -3.5]);
    assert.ok(rebuilt.entities.every(entity => entity.linePoint === undefined));
    const rebuiltSources = new Map(rebuilt.content.entities.map(entity => [entity.id, entity]));
    assert.deepEqual(rebuilt.entities.map(entity => (
        getDimensionGeometry(entity, rebuiltSources).label.point.y
    )), [-3, -3.5]);
});

test('QDIM exposes array-like distance grips that rebuild the whole series', () => {
    const content = contentWithLinearSources();
    const created = createQdimResult(content, ['first', 'second'], {
        mode: 'baseline',
        measurementMode: 'horizontal',
        offset: 1,
        spacing: 0.25,
        seriesId: 'grip-series',
    });
    const sources = new Map(created.content.entities.map(entity => [entity.id, entity]));
    assert.deepEqual(getEntityGrips(created.entities[0], sources).map(grip => grip.id), [
        DRAWING_QDIM_GRIP_IDS.offset,
    ]);
    assert.deepEqual(getEntityGrips(created.entities[1], sources).map(grip => grip.id), [
        DRAWING_QDIM_GRIP_IDS.spacing,
    ]);

    const movedSeries = rebuildQdimSeriesFromGripResult(
        created.content,
        created.entities[0].id,
        DRAWING_QDIM_GRIP_IDS.offset,
        { x: 1, y: 2 },
    );
    assert.equal(movedSeries.changed, true);
    assert.deepEqual(movedSeries.entities.map(entity => entity.offset), [2, 2.25]);
    assert.deepEqual(movedSeries.entities.map(entity => entity.id), created.entities.map(entity => entity.id));

    const spacedSeries = rebuildQdimSeriesFromGripResult(
        movedSeries.content,
        movedSeries.entities[1].id,
        DRAWING_QDIM_GRIP_IDS.spacing,
        { x: 2.5, y: 3.5 },
    );
    assert.equal(spacedSeries.changed, true);
    assert.deepEqual(spacedSeries.entities.map(entity => entity.offset), [2, 3.5]);
    assert.equal(spacedSeries.command, 'qdimGrip');
});

test('QDIM station collection supports line, rectangle and polygon edges with projection deduplication', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 3, x2: 2, y2: 3 },
        { id: 'rectangle', type: 'rectangle', layerId: 'geometry', x: 2, y: 0, width: 3, height: 2 },
        { id: 'polygon', type: 'polygon', layerId: 'geometry', cx: 8, cy: 1, r: 2, sides: 4, rotation: 45 },
    ];
    const series = collectQdimStations(content, ['polygon', 'rectangle', 'line', 'rectangle'], {
        measurementMode: 'horizontal',
        edgeIndex: { rectangle: 0, polygon: 0 },
    });
    assert.equal(series.measurementMode, 'horizontal');
    assert.deepEqual(series.axis, { x: 1, y: 0 });
    assert.ok(series.stations.length >= 4);
    assert.deepEqual(
        series.stations.map(station => station.point.x),
        [...series.stations.map(station => station.point.x)].sort((left, right) => left - right),
    );
    assert.equal(new Set(series.stations.map(station => station.point.x)).size, series.stations.length);
    assert.ok(series.stations.some(station => station.reference.sourceType === 'line'));
    assert.ok(series.stations.some(station => station.reference.sourceType === 'rectangle'));
    assert.ok(series.stations.some(station => station.reference.sourceType === 'polygon'));
});

test('QDIM endpoint associations update geometry and quick dispatch can opt into either explicit mode', () => {
    const content = contentWithLinearSources();
    const continuous = createQuickDimensionResult(content, ['first', 'second'], {
        qdimMode: 'continuous', measurementMode: 'horizontal',
    });
    assert.equal(continuous.qdim.mode, 'continuous');
    assert.deepEqual(continuous.entities.map(entity => [entity.p1.x, entity.p2.x]), [[0, 2], [2, 5]]);
    const baseline = createQuickDimensionResult(content, ['first', 'second'], {
        qdimMode: 'baseline', baselineEnd: 'last', measurementMode: 'horizontal',
    });
    assert.equal(baseline.qdim.mode, 'baseline');
    assert.deepEqual(baseline.entities.map(entity => [entity.p1.x, entity.p2.x]), [[5, 2], [5, 0]]);

    const sourceMap = new Map(content.entities.map(entity => [entity.id, entity]));
    assert.equal(getDimensionGeometry(continuous.entities[1], sourceMap).value, 3);
    sourceMap.get('second').x2 = 9;
    assert.equal(getDimensionGeometry(continuous.entities[1], sourceMap).value, 7);
    assert.equal(resolveQdimSeriesId(continuous.content), 'qdim-series-2');
});

test('angular creator supports two lines, an arc, and explicit rays in one-step results', () => {
    const content = contentWithLinearSources();
    content.entities.push(
        { id: 'vertical', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 0, y2: 4 },
        {
            id: 'arc', type: 'arc', layerId: 'geometry', cx: 10, cy: 10, r: 2,
            startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
        },
    );
    const lines = createAngularDimensionResult(content, ['first', 'vertical'], { radius: 3 });
    assert.equal(lines.changed, true);
    assert.deepEqual(lines.entities[0].sourceIds, ['first', 'vertical']);
    assert.equal(lines.entities[0].radius, 3);

    const arc = createAngularDimensionResult(content, ['arc']);
    assert.equal(arc.entities[0].sourceId, 'arc');

    const explicit = createAngularDimensionResult(content, [], {
        vertex: { x: 0, y: 0 },
        ray1Point: { x: 1, y: 0 },
        ray2Point: { x: 0, y: 1 },
    });
    assert.equal(explicit.changed, true);
    assert.equal(explicit.entities[0].sourceId, undefined);
    assert.equal(createAngularDimensionResult(content, ['first']).reason, 'invalid-angular-sources');
});

test('arc length and jogged-radius creators create one entity per compatible source', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        {
            id: 'arc-a', type: 'arc', layerId: 'geometry', cx: 0, cy: 0, r: 2,
            startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
        },
        {
            id: 'arc-b', type: 'arc', layerId: 'geometry', cx: 5, cy: 0, r: 3,
            startAngle: 0, endAngle: Math.PI, counterClockwise: true,
        },
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 10, cy: 0, r: 4 },
    ];
    const lengths = createArcLengthDimensionResult(content, ['arc-a', 'arc-b'], {
        offset: (source, index) => index + source.r,
    });
    assert.deepEqual(lengths.entities.map(entity => entity.sourceId), ['arc-a', 'arc-b']);
    assert.deepEqual(lengths.entities.map(entity => entity.offset), [2, 4]);

    const jogged = createJoggedRadiusDimensionResult(content, ['arc-a', 'circle'], {
        placementPoint: new Map([
            ['arc-a', { x: 0, y: 2 }],
            ['circle', { x: 14, y: 0 }],
        ]),
        jogCenter: source => ({ x: source.cx - 1, y: source.cy }),
        jogSize: 0.5,
    });
    assert.deepEqual(jogged.entities.map(entity => entity.sourceId), ['arc-a', 'circle']);
    assert.ok(jogged.entities.every(entity => entity.mode === 'joggedRadius' && entity.jogSize === 0.5));
    assert.equal(jogged.entities[0].angle, Math.PI / 2);
    assert.equal(jogged.entities[1].angle, 0);
});

test('ordinate and centre-mark creators preserve signed origins and batch compatible sources', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'line', type: 'line', layerId: 'geometry', x1: -2, y1: 3, x2: 4, y2: 3 },
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 5, cy: 6, r: 2 },
        {
            id: 'arc', type: 'arc', layerId: 'geometry', cx: 10, cy: 11, r: 3,
            startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
        },
    ];
    const ordinate = createOrdinateDimensionResult(content, ['line'], {
        axis: 'x', origin: { x: 1, y: 2 }, leaderPoint: { x: 0, y: 5 },
    });
    assert.equal(ordinate.entities[0].sourceId, 'line');
    assert.deepEqual(ordinate.entities[0].origin, { x: 1, y: 2 });
    assert.equal(ordinate.entities[0].featurePoint, undefined);
    assert.deepEqual(
        getDimensionGeometry(ordinate.entities[0], new Map(content.entities.map(entity => [entity.id, entity]))).feature,
        { x: -2, y: 3 },
    );

    const explicit = createOrdinateDimensionResult(content, [], {
        axis: 'y', featurePoint: { x: 7, y: -4 }, origin: { x: 0, y: 10 },
    });
    assert.equal(explicit.changed, true);
    assert.equal(explicit.entities[0].sourceId, undefined);

    const marks = createCenterMarkResult(content, ['circle', 'arc', 'line'], { size: 0.4, extension: 0.1 });
    assert.deepEqual(marks.entities.map(entity => entity.sourceId), ['circle', 'arc']);
    assert.ok(marks.entities.every(entity => entity.size === 0.4 && entity.extension === 0.1));
});

test('append and unsupported selections fail closed with history-friendly result shapes', () => {
    const content = createDefaultDrawingContent();
    const invalid = appendDimensionEntities(content, [{ type: 'arcLengthDimension', sourceId: 'missing' }], {
        command: 'arcLength',
    });
    assert.deepEqual(invalid, {
        changed: false,
        command: 'arcLength',
        content,
        entities: [],
        selectedIds: [],
        reason: 'invalid-dimension-geometry',
    });
    const quick = createQuickDimensionResult(content, [], {});
    assert.equal(quick.changed, false);
    assert.equal(quick.reason, 'no-dimension-sources');
    assert.equal(quick.content, content);
    assert.deepEqual(quick.entities, []);
});
