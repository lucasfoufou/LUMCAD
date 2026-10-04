import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_DRAWING_QDIM_BASELINE_SPACING,
    DRAWING_DIMENSION_TYPES,
    DRAWING_QDIM_BASELINE_ENDS,
    DRAWING_QDIM_MODES,
    buildBaselineDimensions,
    buildChainDimensions,
    buildContinuedDimensions,
    buildQdimDimensions,
    buildQuickDimensions,
    convertDrawingLength,
    drawingEntityDependsOn,
    formatDrawingAngle,
    formatDrawingDimensionLabel,
    formatDrawingDimensionMeasurement,
    formatDrawingLength,
    getAngularDimensionGeometry,
    getArcLengthDimensionGeometry,
    getCenterMarkGeometry,
    getDimensionGeometry,
    getDrawingEntityDependencyIds,
    getLinearDimensionGeometry,
    getOrdinateDimensionGeometry,
    getRadialDimensionGeometry,
    isDrawingDimensionEntity,
    normalizeDrawingDimension,
    normalizeDrawingQdimBaselineEnd,
    normalizeDrawingQdimMode,
    normalizeDrawingDimensionFormat,
    remapDrawingEntityDependencies,
    reverseDrawingQdimBaselineEnd,
} from './drawingDimensions.js';
import { getEntityBounds } from './drawingGeometry.js';
import { normalizeDrawingContent } from './drawingDocument.js';

const closeTo = (actual, expected, epsilon = 1e-9) => {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not within ${epsilon} of ${expected}`);
};

const pointCloseTo = (actual, expected, epsilon = 1e-9) => {
    closeTo(actual.x, expected.x, epsilon);
    closeTo(actual.y, expected.y, epsilon);
};

test('dimension type registry and predicate cover every persisted annotation family', () => {
    assert.deepEqual(DRAWING_DIMENSION_TYPES, [
        'linearDimension',
        'radialDimension',
        'angularDimension',
        'arcLengthDimension',
        'ordinateDimension',
        'centerMark',
        'centerLine',
    ]);
    DRAWING_DIMENSION_TYPES.forEach(type => assert.equal(isDrawingDimensionEntity({ type }), true));
    assert.equal(isDrawingDimensionEntity('line'), false);
    assert.equal(isDrawingDimensionEntity(null), false);
});

test('legacy aligned and radial geometry remains source-associative and shape-compatible', () => {
    const line = { id: 'line', type: 'line', x1: 0, y1: 0, x2: 3, y2: 4 };
    const linear = getDimensionGeometry({ type: 'linearDimension', sourceId: 'line', offset: 0.5 }, line);
    assert.equal(linear.kind, 'linear');
    assert.equal(linear.value, 5);
    pointCloseTo(linear.first, { x: -0.4, y: 0.3 });
    pointCloseTo(linear.second, { x: 2.6, y: 4.3 });
    pointCloseTo(linear.sourceFirst, { x: 0, y: 0 });
    pointCloseTo(linear.sourceSecond, { x: 3, y: 4 });
    assert.equal(linear.lines.length, 3);
    assert.equal(linear.ticks.length, 2);

    const circle = { id: 'circle', type: 'circle', cx: 2, cy: 3, r: 4 };
    const radial = getDimensionGeometry({
        type: 'radialDimension', sourceId: 'circle', angle: 0, leaderScale: 1.5,
    }, circle);
    assert.equal(radial.kind, 'radial');
    assert.equal(radial.mode, 'radius');
    assert.equal(radial.value, 4);
    assert.deepEqual(radial.center, { x: 2, y: 3 });
    assert.deepEqual(radial.edge, { x: 6, y: 3 });
    assert.deepEqual(radial.text, { x: 8, y: 3 });
});

test('linear dimensions measure horizontal, vertical and rotated axes independently of the source', () => {
    const source = { id: 'line', type: 'line', x1: 1, y1: 2, x2: 5, y2: 5 };
    const horizontal = getLinearDimensionGeometry({
        type: 'linearDimension', sourceId: 'line', measurementMode: 'horizontal', offset: 2,
    }, source);
    assert.equal(horizontal.value, 4);
    pointCloseTo(horizontal.first, { x: 1, y: 4 });
    pointCloseTo(horizontal.second, { x: 5, y: 4 });

    const vertical = getLinearDimensionGeometry({
        type: 'linearDimension', sourceId: 'line', measurementMode: 'vertical', offset: 2,
    }, source);
    assert.equal(vertical.value, 3);
    pointCloseTo(vertical.first, { x: -1, y: 2 });
    pointCloseTo(vertical.second, { x: -1, y: 5 });

    const rotated = getLinearDimensionGeometry({
        type: 'linearDimension',
        sourceId: 'line',
        measurementMode: 'rotated',
        dimensionAngle: Math.PI / 4,
        linePoint: { x: 0, y: 10 },
    }, new Map([['line', source]]));
    closeTo(rotated.value, 7 / Math.sqrt(2));
    closeTo(rotated.first.y - rotated.first.x, 10);
    closeTo(rotated.second.y - rotated.second.x, 10);
});

test('linear geometry resolves rectangle edges and rejects perpendicular or degenerate measurements', () => {
    const rectangle = { id: 'rect', type: 'rectangle', x: 2, y: 3, width: 6, height: 4 };
    const geometry = getLinearDimensionGeometry({
        type: 'linearDimension', sourceId: 'rect', edgeIndex: 1, offset: 1,
    }, new Map([['rect', rectangle]]));
    assert.equal(geometry.value, 4);
    assert.deepEqual(geometry.sourceFirst, { x: 8, y: 3 });
    assert.deepEqual(geometry.sourceSecond, { x: 8, y: 7 });
    assert.equal(getLinearDimensionGeometry({
        type: 'linearDimension',
        p1: { x: 0, y: 0 },
        p2: { x: 0, y: 4 },
        measurementMode: 'horizontal',
    }), null);
    assert.equal(getLinearDimensionGeometry({
        type: 'linearDimension', p1: { x: 1, y: 1 }, p2: { x: 1, y: 1 },
    }), null);
});

test('angular dimensions support explicit rays, reflex sweeps and two associative line sources', () => {
    const explicit = getAngularDimensionGeometry({
        type: 'angularDimension',
        vertex: { x: 0, y: 0 },
        ray1Point: { x: 2, y: 0 },
        ray2Point: { x: 0, y: 2 },
        radius: 3,
    });
    closeTo(explicit.value, Math.PI / 2);
    assert.equal(explicit.arcs.length, 1);
    assert.equal(explicit.lines.length, 2);
    pointCloseTo(explicit.first, { x: 3, y: 0 });
    pointCloseTo(explicit.second, { x: 0, y: 3 });

    const reflex = getAngularDimensionGeometry({
        type: 'angularDimension',
        vertex: { x: 0, y: 0 },
        ray1Point: { x: 2, y: 0 },
        ray2Point: { x: 0, y: 2 },
        radius: 3,
        reflex: true,
    });
    closeTo(reflex.value, Math.PI * 1.5);
    assert.equal(reflex.counterClockwise, false);

    const sources = new Map([
        ['horizontal', { id: 'horizontal', type: 'line', x1: -2, y1: 1, x2: 4, y2: 1 }],
        ['vertical', { id: 'vertical', type: 'line', x1: 1, y1: -3, x2: 1, y2: 5 }],
    ]);
    const associated = getAngularDimensionGeometry({
        type: 'angularDimension',
        sourceIds: ['horizontal', 'vertical'],
        sourcePickPoints: [{ x: 4, y: 1 }, { x: 1, y: 5 }],
        radius: 2,
    }, sources);
    assert.deepEqual(associated.vertex, { x: 1, y: 1 });
    closeTo(associated.value, Math.PI / 2);
    assert.equal(getAngularDimensionGeometry({
        type: 'angularDimension', sourceIds: ['a', 'b'],
    }, new Map([
        ['a', { type: 'line', x1: 0, y1: 0, x2: 1, y2: 0 }],
        ['b', { type: 'line', x1: 0, y1: 1, x2: 1, y2: 1 }],
    ])), null);
});

test('angular dimensions can measure a native arc source', () => {
    const arc = {
        id: 'arc', type: 'arc', cx: 4, cy: 5, r: 2,
        startAngle: 0, endAngle: Math.PI / 3, counterClockwise: true,
    };
    const geometry = getAngularDimensionGeometry({
        type: 'angularDimension', sourceId: 'arc', radius: 3,
    }, arc);
    assert.deepEqual(geometry.vertex, { x: 4, y: 5 });
    closeTo(geometry.value, Math.PI / 3);
    pointCloseTo(geometry.first, { x: 7, y: 5 });
});

test('arc-length dimensions preserve clockwise direction while reporting positive length', () => {
    const ccw = {
        id: 'arc', type: 'arc', cx: 1, cy: 2, r: 4,
        startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
    };
    const geometry = getArcLengthDimensionGeometry({
        type: 'arcLengthDimension', sourceId: 'arc', offset: 1,
    }, ccw);
    closeTo(geometry.value, Math.PI * 2);
    assert.equal(geometry.radius, 5);
    assert.equal(geometry.counterClockwise, true);
    assert.equal(geometry.arcs.length, 1);

    const clockwise = getArcLengthDimensionGeometry({
        type: 'arcLengthDimension', sourceId: 'arc', offset: 1,
    }, { ...ccw, startAngle: Math.PI / 2, endAngle: 0, counterClockwise: false });
    closeTo(clockwise.value, Math.PI * 2);
    assert.equal(clockwise.counterClockwise, false);
    assert.equal(getArcLengthDimensionGeometry({
        type: 'arcLengthDimension', sourceId: 'circle',
    }, { id: 'circle', type: 'circle', cx: 0, cy: 0, r: 2 }), null);
});

test('jogged radius uses the true radius value and emits explicit jog primitives', () => {
    const source = { id: 'circle', type: 'circle', cx: 10, cy: 10, r: 5 };
    const geometry = getRadialDimensionGeometry({
        type: 'radialDimension',
        sourceId: 'circle',
        mode: 'joggedRadius',
        angle: 0,
        leaderScale: 1.4,
        jogCenter: { x: 6, y: 10 },
        jogPoint: { x: 11, y: 10 },
        jogSize: 0.5,
    }, source);
    assert.equal(geometry.value, 5);
    assert.deepEqual(geometry.center, { x: 10, y: 10 });
    assert.deepEqual(geometry.jogCenter, { x: 6, y: 10 });
    assert.equal(geometry.jogs.length, 1);
    assert.equal(geometry.jogs[0].points.length, 4);
    assert.ok(geometry.lines.some(line => line.role === 'jog'));

    const diameter = getRadialDimensionGeometry({
        type: 'radialDimension', sourceId: 'circle', mode: 'diameter', angle: Math.PI,
    }, source);
    assert.equal(diameter.value, 10);
    assert.equal(diameter.mode, 'diameter');
});

test('ordinate dimensions retain signed coordinates on both axes', () => {
    const x = getOrdinateDimensionGeometry({
        type: 'ordinateDimension',
        axis: 'x',
        origin: { x: 10, y: 10 },
        featurePoint: { x: 7, y: 14 },
        leaderPoint: { x: 9, y: 16 },
    });
    assert.equal(x.value, -3);
    assert.deepEqual(x.elbow, { x: 9, y: 14 });
    assert.deepEqual(x.text, { x: 9, y: 16 });

    const source = { id: 'circle', type: 'circle', cx: 3, cy: 8, r: 2 };
    const y = getOrdinateDimensionGeometry({
        type: 'ordinateDimension', sourceId: 'circle', axis: 'y', origin: { x: 1, y: 2 },
    }, source);
    assert.equal(y.value, 6);
    assert.deepEqual(y.feature, { x: 3, y: 8 });
});

test('centre marks expose a complete cross and participate in generic bounds', () => {
    const circle = { id: 'circle', type: 'circle', cx: 4, cy: 5, r: 3 };
    const mark = { type: 'centerMark', sourceId: 'circle', size: 0.5, extension: 0.25 };
    const geometry = getCenterMarkGeometry(mark, circle);
    assert.equal(geometry.kind, 'centerMark');
    assert.equal(geometry.value, null);
    assert.equal(geometry.lines.length, 2);
    assert.deepEqual(geometry.center, { x: 4, y: 5 });
    assert.deepEqual(getEntityBounds(mark, new Map([['circle', circle]])), {
        minX: 3.25, minY: 4.25, maxX: 4.75, maxY: 5.75,
    });
});

test('dimension normalization is additive, bounded and legacy-compatible', () => {
    const legacy = normalizeDrawingDimension({
        id: 'dimension',
        type: 'linearDimension',
        sourceId: ' source ',
        offset: '2.5',
        p1: { x: '1', y: 2 },
        p2: { x: 5, y: 2 },
        edgeIndex: -5,
        custom: 'preserved',
    });
    assert.equal(legacy.id, 'dimension');
    assert.equal(legacy.custom, 'preserved');
    assert.equal(legacy.sourceId, 'source');
    assert.equal(legacy.measurementMode, 'aligned');
    assert.equal(legacy.offset, 2.5);
    assert.equal(legacy.edgeIndex, 0);
    assert.deepEqual(legacy.p1, { x: 1, y: 2 });
    assert.equal('dimensionFormat' in legacy, false);

    const radial = normalizeDrawingDimension({
        type: 'radialDimension', mode: 'unknown', angle: 'bad', leaderScale: 0,
    });
    assert.equal(radial.mode, 'radius');
    closeTo(radial.angle, -Math.PI / 4);
    assert.equal(radial.leaderScale, 1.05);

    const angular = normalizeDrawingDimension({
        type: 'angularDimension', sourceIds: [' a ', 'a', '', null, 'b'], radius: -1,
        sourcePickPoints: [{ x: 1, y: 2 }, { x: Infinity, y: 0 }, { x: 3, y: 4 }],
    });
    assert.deepEqual(angular.sourceIds, ['a', 'b']);
    assert.equal(angular.radius, 1e-9);
    assert.deepEqual(angular.sourcePickPoints, [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    assert.equal(normalizeDrawingDimension({ type: 'line' }).type, 'line');
});

test('document normalization applies the dimension model without changing the archive version', () => {
    const normalized = normalizeDrawingContent({
        version: 1,
        entities: [{
            id: 'ordinate', type: 'ordinateDimension', layerId: 'dimensions',
            axis: 'invalid', origin: { x: '1', y: '2' }, featurePoint: { x: 5, y: 6 },
        }],
    });
    assert.equal(normalized.version, 1);
    const ordinate = normalized.entities.find(entity => entity.id === 'ordinate');
    assert.equal(ordinate.axis, 'x');
    assert.deepEqual(ordinate.origin, { x: 1, y: 2 });
});

test('dependency helpers support one or several associative sources and safe remapping', () => {
    const dimension = {
        type: 'angularDimension', sourceId: 'primary', sourceIds: ['a', 'primary', 'b', '', 'a'],
    };
    assert.deepEqual(getDrawingEntityDependencyIds(dimension), ['primary', 'a', 'b']);
    assert.equal(drawingEntityDependsOn(dimension, 'b'), true);
    assert.equal(drawingEntityDependsOn(dimension, 'missing'), false);
    assert.deepEqual(remapDrawingEntityDependencies(dimension, new Map([
        ['primary', 'copy-primary'], ['a', 'copy-a'], ['b', 'copy-a'],
    ])), {
        type: 'angularDimension',
        sourceId: 'copy-primary',
        sourceIds: ['copy-a', 'copy-primary'],
    });
    assert.deepEqual(remapDrawingEntityDependencies({ type: 'line' }, null), { type: 'line' });
});

test('dimension format normalization bounds precision and preserves tolerance, alternate and inspection settings', () => {
    assert.deepEqual(normalizeDrawingDimensionFormat({
        precision: 99,
        prefix: '≈',
        suffix: ' REF',
        tolerance: { mode: 'deviation', upper: -1, lower: 0.002, precision: 3 },
        alternateUnits: { enabled: true, unit: 'in', precision: -2 },
        inspection: { enabled: true, label: 12, rate: 'A' },
    }), {
        precision: 8,
        prefix: '≈',
        suffix: ' REF',
        tolerance: { mode: 'deviation', upper: 0, lower: 0.002, precision: 3 },
        alternateUnits: { enabled: true, unit: 'in', precision: 0 },
        inspection: { enabled: true, label: '12', rate: 'A' },
    });
});

test('legacy, localized and angular formatting remains deterministic', () => {
    assert.equal(formatDrawingLength(1.25), '1.25 m');
    assert.equal(formatDrawingLength(1.25, 3, 'fr-FR'), '1,25 m');
    assert.equal(formatDrawingLength(undefined), '0 m');
    assert.equal(formatDrawingAngle(Math.PI / 6), '30°');
    assert.equal(formatDrawingAngle(Math.PI / 8, 1, 'fr'), '22,5°');
    assert.equal(formatDrawingDimensionMeasurement(4, {
        alternateUnits: { enabled: true, unit: 'mm', precision: 0 },
    }).alternate, '[4000 mm]');
    closeTo(convertDrawingLength(1, 'mm'), 1_000);
    closeTo(convertDrawingLength(0.3048, 'ft'), 1);
});

test('measurement formatting composes tolerances, alternate units and inspection metadata', () => {
    const formatted = formatDrawingDimensionMeasurement({ value: 1.2345, unitKind: 'length' }, {
        dimensionFormat: {
            precision: 2,
            prefix: 'L=',
            suffix: ' NOM',
            tolerance: { mode: 'deviation', upper: 0.01, lower: 0.02, precision: 2 },
            alternateUnits: { enabled: true, unit: 'mm', precision: 0 },
            inspection: { enabled: true, label: 'A', rate: '100%' },
        },
    }, 'en');
    assert.equal(formatted.primary, 'L=1.23 m NOM');
    assert.equal(formatted.tolerance, '+0.01 m / −0.02 m');
    assert.equal(formatted.alternate, '[1235 mm]');
    assert.deepEqual(formatted.inspection, { enabled: true, label: 'A', rate: '100%' });
    assert.deepEqual(formatted.lines, ['L=1.23 m NOM', '+0.01 m / −0.02 m', '[1235 mm]']);

    const symmetric = formatDrawingDimensionMeasurement({ value: 2, unitKind: 'length' }, {
        dimensionFormat: { tolerance: { mode: 'symmetric', upper: 0.005, precision: 3 } },
    }, 'fr');
    assert.equal(symmetric.tolerance, '±0,005 m');

    const limits = formatDrawingDimensionMeasurement({ value: Math.PI / 2, unitKind: 'angle' }, {
        dimensionFormat: { precision: 1, tolerance: { mode: 'limits', upper: Math.PI / 180, lower: 0, precision: 1 } },
    });
    assert.equal(limits.primary, '90°');
    assert.equal(limits.tolerance, '91° / 90°');
    assert.equal(limits.alternate, '');
});

test('dimension label formatting keeps family symbols and inspection metadata in render order', () => {
    const label = formatDrawingDimensionLabel({
        kind: 'radial', mode: 'diameter', value: 0.5, unitKind: 'length',
    }, {
        dimensionFormat: {
            precision: 2,
            tolerance: { mode: 'symmetric', upper: 0.01, precision: 2 },
            alternateUnits: { enabled: true, unit: 'mm', precision: 0 },
            inspection: { enabled: true, label: 'B', rate: '50%' },
        },
    });
    assert.deepEqual(label.lines, ['B', 'Ø 0.5 m', '±0.01 m', '[500 mm]', '50%']);
    assert.equal(label.plainText, 'B\nØ 0.5 m\n±0.01 m\n[500 mm]\n50%');
    assert.deepEqual(formatDrawingDimensionLabel({ kind: 'centerMark', value: null }), {
        lines: [], plainText: '', inspection: null,
    });
});

test('quick, baseline, continued and chain builders produce deterministic free dimensions', () => {
    const points = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 0 },
        { x: 5, y: 0 },
    ];
    const baseline = buildBaselineDimensions(points, { offset: 1 });
    assert.equal(baseline.length, 2);
    assert.deepEqual(baseline.map(dimension => [dimension.p1.x, dimension.p2.x]), [[0, 2], [0, 5]]);
    assert.ok(baseline.every(dimension => dimension.seriesMode === 'baseline' && dimension.offset === 1));

    const chain = buildChainDimensions(points);
    assert.deepEqual(chain.map(dimension => [dimension.p1.x, dimension.p2.x]), [[0, 2], [2, 5]]);
    assert.ok(chain.every(dimension => dimension.seriesMode === 'chain'));
    assert.ok(buildContinuedDimensions(points).every(dimension => dimension.seriesMode === 'continued'));
    assert.ok(buildQuickDimensions(points).every(dimension => dimension.seriesMode === 'quick'));
    assert.deepEqual(buildChainDimensions([{ x: 0, y: 0 }]), []);
});

test('QDIM modes and baseline-end aliases normalize to a small reversible workflow contract', () => {
    assert.deepEqual(DRAWING_QDIM_MODES, ['continuous', 'baseline']);
    assert.deepEqual(DRAWING_QDIM_BASELINE_ENDS, ['first', 'last']);
    assert.equal(normalizeDrawingQdimMode('BASELINE'), 'baseline');
    assert.equal(normalizeDrawingQdimMode('continued'), 'continuous');
    assert.equal(normalizeDrawingQdimBaselineEnd('left'), 'first');
    assert.equal(normalizeDrawingQdimBaselineEnd('right'), 'last');
    assert.equal(reverseDrawingQdimBaselineEnd('first'), 'last');
    assert.equal(reverseDrawingQdimBaselineEnd('right'), 'first');
});

test('QDIM builders create adjacent continuous and reversible cumulative baseline pairs', () => {
    const points = [{ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 5, y: 1 }];
    const references = points.map((point, index) => ({
        sourceId: `line-${index + 1}`,
        sourceType: 'line',
        endpointIndex: index ? 1 : 0,
        point,
    }));
    const continuous = buildQdimDimensions(points, {
        mode: 'continuous',
        measurementMode: 'horizontal',
        pointReferences: references,
        seriesId: 'qdim-series-7',
        seriesAxis: { x: 3, y: 0 },
        spacing: 9,
    });
    assert.deepEqual(continuous.map(entity => [entity.p1.x, entity.p2.x]), [[0, 2], [2, 5]]);
    assert.ok(continuous.every((entity, index) => (
        entity.seriesMode === 'continuous'
        && entity.seriesIndex === index
        && entity.seriesId === 'qdim-series-7'
        && entity.baselineReference === undefined
    )));
    assert.deepEqual(continuous[1].sourceIds, ['line-2', 'line-3']);
    assert.deepEqual(continuous[0].seriesAxis, { x: 1, y: 0 });
    assert.deepEqual(continuous.map(entity => entity.offset), [0.6, 0.6]);

    const firstBaseline = buildQdimDimensions(points, {
        mode: 'baseline', baselineEnd: 'left', pointReferences: references,
    });
    assert.deepEqual(firstBaseline.map(entity => [entity.p1.x, entity.p2.x]), [[0, 2], [0, 5]]);
    assert.deepEqual(firstBaseline.map(entity => entity.offset), [
        0.6,
        0.6 + DEFAULT_DRAWING_QDIM_BASELINE_SPACING,
    ]);
    assert.ok(firstBaseline.every(entity => entity.baselineEnd === 'first'));
    assert.deepEqual(firstBaseline[1].baselineReference, references[0]);

    const lastBaseline = buildQdimDimensions(points, {
        mode: 'baseline', baselineEnd: 'right', pointReferences: references,
    });
    assert.deepEqual(lastBaseline.map(entity => [entity.p1.x, entity.p2.x]), [[5, 2], [5, 0]]);
    assert.ok(lastBaseline.every(entity => entity.baselineEnd === 'last'));
    assert.deepEqual(lastBaseline[0].baselineReference, references[2]);
});

test('QDIM endpoint references remain associative, normalized and dependency-remappable', () => {
    const sources = new Map([
        ['left', { id: 'left', type: 'line', x1: 0, y1: 0, x2: 2, y2: 0 }],
        ['right', { id: 'right', type: 'line', x1: 2, y1: 0, x2: 5, y2: 0 }],
    ]);
    const [dimension] = buildQdimDimensions([{ x: 0, y: 0 }, { x: 5, y: 0 }], {
        mode: 'baseline',
        pointReferences: [
            { sourceId: 'left', sourceType: 'line', endpointIndex: 0, point: { x: 0, y: 0 } },
            { sourceId: 'right', sourceType: 'line', endpointIndex: 1, point: { x: 5, y: 0 } },
        ],
        measurementMode: 'horizontal',
    });
    assert.equal(getDimensionGeometry(dimension, sources).value, 5);
    sources.get('right').x2 = 8;
    assert.equal(getDimensionGeometry(dimension, sources).value, 8);
    assert.deepEqual(getDrawingEntityDependencyIds(dimension), ['left', 'right']);

    const remapped = remapDrawingEntityDependencies(dimension, new Map([
        ['left', 'left-copy'], ['right', 'right-copy'],
    ]));
    assert.deepEqual(remapped.sourceIds, ['left-copy', 'right-copy']);
    assert.deepEqual(
        remapped.sourcePointReferences.map(reference => reference.sourceId),
        ['left-copy', 'right-copy'],
    );
    assert.equal(remapped.baselineReference.sourceId, 'left-copy');
    const normalized = normalizeDrawingDimension({
        ...dimension,
        seriesId: ' series ',
        baselineEnd: 'right',
        seriesAxis: { x: 10, y: 0 },
    });
    assert.equal(normalized.seriesId, 'series');
    assert.equal(normalized.baselineEnd, 'last');
    assert.deepEqual(normalized.seriesAxis, { x: 1, y: 0 });
});

test('QDIM snapshots without source associations keep transformed free endpoints authoritative', () => {
    const [dimension] = buildQdimDimensions([{ x: 0, y: 0 }, { x: 4, y: 0 }], {
        mode: 'continuous',
        measurementMode: 'horizontal',
    });
    const transformed = {
        ...dimension,
        p1: { x: 10, y: 3 },
        p2: { x: 16, y: 3 },
    };
    const geometry = getDimensionGeometry(transformed);
    assert.deepEqual(geometry.sourceFirst, transformed.p1);
    assert.deepEqual(geometry.sourceSecond, transformed.p2);
    assert.equal(geometry.value, 6);
});

test('all new geometry families expose finite common render primitives', () => {
    const sourceMap = new Map([
        ['circle', { id: 'circle', type: 'circle', cx: 0, cy: 0, r: 3 }],
        ['arc', {
            id: 'arc', type: 'arc', cx: 0, cy: 0, r: 3,
            startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
        }],
    ]);
    const dimensions = [
        { type: 'linearDimension', p1: { x: 0, y: 0 }, p2: { x: 2, y: 1 } },
        { type: 'radialDimension', sourceId: 'circle' },
        {
            type: 'angularDimension', vertex: { x: 0, y: 0 },
            ray1Point: { x: 1, y: 0 }, ray2Point: { x: 0, y: 1 },
        },
        { type: 'arcLengthDimension', sourceId: 'arc' },
        { type: 'ordinateDimension', featurePoint: { x: 3, y: 4 } },
        { type: 'centerMark', sourceId: 'circle' },
    ];
    dimensions.forEach(dimension => {
        const geometry = getDimensionGeometry(dimension, sourceMap);
        assert.ok(geometry);
        assert.ok(Array.isArray(geometry.lines));
        assert.ok(Array.isArray(geometry.arcs));
        assert.ok(Array.isArray(geometry.ticks));
        assert.ok(Array.isArray(geometry.jogs));
        assert.ok(geometry.points.length > 0);
        geometry.points.forEach(point => {
            assert.equal(Number.isFinite(point.x), true);
            assert.equal(Number.isFinite(point.y), true);
        });
    });
});

test('manual dimension labels interpolate live measurements and retain inspection context', () => {
    const dimension = { type: 'linearDimension', p1: { x: 0, y: 0 }, p2: { x: 5, y: 0 }, dimensionTextOverride: 'Opening: <>', dimensionFormat: { inspection: { enabled: true, label: 'Control', rate: '100%' } } };
    const formatted = formatDrawingDimensionLabel(getDimensionGeometry(dimension), dimension);
    assert.deepEqual(formatted.lines, ['Control', 'Opening: 5 m', '100%']);
    const changed = { ...dimension, p2: { x: 8, y: 0 } };
    assert.equal(formatDrawingDimensionLabel(getDimensionGeometry(changed), changed).lines[1], 'Opening: 8 m');
});
