import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultDrawingContent } from './drawingDocument.js';
import {
    createArrayDraftEntities,
    createMirrorDraftEntities,
    createRectangularArray,
    editArrayOperation,
    explodeDrawingEntities,
    getArrayControlGeometry,
    joinDrawingEntities,
    mirrorDrawingEntities,
    xplodeDrawingEntities,
} from './drawingCompoundOperations.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference } from './drawingBlocks.js';
import { mirrorEntity, translateEntity } from './drawingGeometry.js';

test('mirror reflects geometry across the reference line and can copy or replace sources', () => {
    const axisFirst = { x: 0, y: 0 };
    const axisSecond = { x: 10, y: 0 };
    const line = { id: 'line', type: 'line', layerId: 'geometry', x1: 1, y1: 2, x2: 4, y2: 5 };
    assert.deepEqual(mirrorEntity(line, axisFirst, axisSecond), { ...line, y1: -2, y2: -5 });

    const content = createDefaultDrawingContent();
    content.entities = [line];
    const copied = mirrorDrawingEntities(content, ['line'], axisFirst, axisSecond);
    assert.equal(copied.content.entities.length, 2);
    assert.equal(copied.content.entities[1].y1, -2);
    assert.notEqual(copied.selectedIds[0], 'line');
    const replaced = mirrorDrawingEntities(content, ['line'], axisFirst, axisSecond, { replace: true });
    assert.equal(replaced.content.entities.length, 1);
    assert.equal(replaced.content.entities[0].y2, -5);
    assert.deepEqual(replaced.selectedIds, ['line']);
});

test('mirror applies the global text-glyph preference to copies and replacements', () => {
    const content = createDefaultDrawingContent();
    content.entities = [{
        id: 'text', type: 'text', layerId: 'geometry', x: 1, y: 1, width: 3, height: 1,
        rotation: 0, mirrored: false, text: 'LUMCAD',
    }];
    const copied = mirrorDrawingEntities(
        content, ['text'], { x: 0, y: 0 }, { x: 0, y: 5 }, { mirrorTextGlyphs: false },
    );
    assert.equal(copied.entities[0].mirrored, false);
    const replaced = mirrorDrawingEntities(
        content, ['text'], { x: 0, y: 0 }, { x: 0, y: 5 }, { replace: true, mirrorTextGlyphs: true },
    );
    assert.equal(replaced.content.entities[0].mirrored, true);
});

test('mirror draft follows a shifted or replaced reference axis before confirmation', () => {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'line', type: 'line', layerId: 'geometry', x1: 1, y1: 2, x2: 3, y2: 2 }];
    const operation = {
        type: 'mirror', stage: 'mirror-option-base', entityIds: ['line'],
        basePoint: { x: 0, y: 0 }, axisSecond: { x: 4, y: 0 },
    };
    const moved = createMirrorDraftEntities(content, operation, { x: 1, y: 3 });
    assert.deepEqual(
        { x1: moved[0].x1, y1: moved[0].y1, x2: moved[0].x2, y2: moved[0].y2 },
        { x1: 1, y1: 3, x2: 5, y2: 3 },
    );
    const replacedAxis = createMirrorDraftEntities(content, { ...operation, stage: 'mirror-option-axis' }, { x: 0, y: 5 });
    assert.deepEqual(
        { x1: replacedAxis[0].x1, y1: replacedAxis[0].y1, x2: replacedAxis[0].x2, y2: replacedAxis[0].y2 },
        { x1: 0, y1: 0, x2: 0, y2: 5 },
    );
});

test('join creates one connected polyline and explode restores individual line entities', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'a', type: 'line', layerId: 'geometry', transparency: 40, x1: 0, y1: 0, x2: 3, y2: 0 },
        { id: 'b', type: 'line', layerId: 'geometry', x1: 3, y1: 0, x2: 3, y2: 4 },
    ];
    const joined = joinDrawingEntities(content, ['a', 'b']);
    assert.equal(joined.changed, true);
    assert.equal(joined.entity.type, 'polyline');
    assert.equal(joined.entity.closed, false);
    assert.equal(joined.entity.transparency, 40);
    assert.deepEqual(joined.entity.parts.map(part => [part.x1, part.y1, part.x2, part.y2]), [
        [0, 0, 3, 0],
        [3, 0, 3, 4],
    ]);

    const exploded = explodeDrawingEntities(joined.content, joined.selectedIds);
    assert.equal(exploded.changed, true);
    assert.equal(exploded.entities.length, 2);
    assert.ok(exploded.entities.every(entity => entity.type === 'line'));
    assert.ok(exploded.entities.every(entity => entity.transparency === 40));

    const disconnected = createDefaultDrawingContent();
    disconnected.entities = [
        { id: 'a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 },
        { id: 'b', type: 'line', layerId: 'geometry', x1: 5, y1: 0, x2: 6, y2: 0 },
    ];
    assert.equal(joinDrawingEntities(disconnected, ['a', 'b']).changed, false);
});

test('join coalesces a collinear chain into one native line without mutating unrelated entities', () => {
    const content = createDefaultDrawingContent();
    const unrelated = { id: 'keep', type: 'circle', layerId: 'geometry', cx: 20, cy: 20, r: 2 };
    content.entities = [
        { id: 'middle', type: 'line', layerId: 'geometry', x1: 4, y1: 2, x2: 2, y2: 1 },
        { id: 'start', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 1 },
        { id: 'end', type: 'line', layerId: 'geometry', x1: 6, y1: 3, x2: 4, y2: 2 },
        { id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'middle' },
        unrelated,
    ];

    const result = joinDrawingEntities(content, ['end', 'start', 'middle']);
    assert.equal(result.changed, true);
    assert.equal(result.entity.type, 'line');
    assert.notEqual(result.entity.id, 'start');
    assert.deepEqual(
        [result.entity.x1, result.entity.y1, result.entity.x2, result.entity.y2],
        [0, 0, 6, 3],
    );
    assert.equal(result.content.entities.includes(unrelated), true);
    assert.equal(result.content.entities.some(entity => entity.id === 'dimension'), false);
    assert.deepEqual(content.entities.map(entity => entity.id), ['middle', 'start', 'end', 'dimension', 'keep']);
});

test('join only coalesces adjacent lines when direction and appearance remain lossless', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'a', type: 'line', layerId: 'geometry', color: '#ff0000', x1: 0, y1: 0, x2: 2, y2: 0 },
        { id: 'b', type: 'line', layerId: 'geometry', color: '#ff0000', x1: 2, y1: 0, x2: 4, y2: 0 },
        { id: 'c', type: 'line', layerId: 'geometry', color: '#0000ff', x1: 4, y1: 0, x2: 6, y2: 0 },
    ];
    const styled = joinDrawingEntities(content, ['a', 'b', 'c']);
    assert.equal(styled.entity.type, 'polyline');
    assert.equal(styled.entity.parts.length, 2);
    assert.deepEqual(styled.entity.parts.map(part => part.color), ['#ff0000', '#0000ff']);

    const backtracking = createDefaultDrawingContent();
    backtracking.entities = [
        { id: 'out', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0 },
        { id: 'back', type: 'line', layerId: 'geometry', x1: 4, y1: 0, x2: 2, y2: 0 },
    ];
    const folded = joinDrawingEntities(backtracking, ['out', 'back']);
    assert.equal(folded.entity.type, 'polyline');
    assert.equal(folded.entity.parts.length, 2);
});

test('join applies its tolerance as a spatial collinearity bound', () => {
    const within = createDefaultDrawingContent();
    within.entities = [
        { id: 'a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 },
        { id: 'b', type: 'line', layerId: 'geometry', x1: 1, y1: 0, x2: 2, y2: 0.05 },
    ];
    assert.equal(joinDrawingEntities(within, ['a', 'b'], 0.1).entity.type, 'line');

    const outside = createDefaultDrawingContent();
    outside.entities = [
        { id: 'a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 },
        { id: 'b', type: 'line', layerId: 'geometry', x1: 1, y1: 0, x2: 2, y2: 0.11 },
    ];
    const result = joinDrawingEntities(outside, ['a', 'b'], 0.1);
    assert.equal(result.entity.type, 'polyline');
    assert.equal(result.entity.parts.length, 2);
});

test('explode leaves true arcs untouched instead of replacing them with sampled chords', () => {
    const content = createDefaultDrawingContent();
    content.entities = [{
        id: 'arc', type: 'arc', layerId: 'geometry', cx: 0, cy: 0, r: 5,
        startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
    }];
    const result = explodeDrawingEntities(content, ['arc']);
    assert.equal(result.changed, false);
    assert.equal(result.content, content);
    assert.deepEqual(result.selectedIds, ['arc']);
});

test('join rejects a connected branched network', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'left', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: -3, y2: -2 },
        { id: 'right', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0 },
        { id: 'top', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 3, y2: -2 },
    ];
    const joined = joinDrawingEntities(content, ['left', 'right', 'top']);
    assert.equal(joined.changed, false);
    assert.equal(joined.reason, 'branched');
});

test('join rejects intersections that are not an ordered endpoint path', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'vertical', type: 'line', layerId: 'geometry', x1: 1, y1: -4, x2: 1, y2: 4 },
        { id: 'upper', type: 'line', layerId: 'geometry', x1: -2, y1: 0, x2: 4, y2: -3 },
        { id: 'middle', type: 'line', layerId: 'geometry', x1: -2, y1: 0, x2: 5, y2: 0 },
        { id: 'lower', type: 'line', layerId: 'geometry', x1: -2, y1: 0, x2: 4, y2: 3 },
    ];
    const joined = joinDrawingEntities(content, content.entities.map(entity => entity.id));
    assert.equal(joined.changed, false);
    assert.ok(['branched', 'disconnected'].includes(joined.reason));
});

test('join orders mixed exact line, circular arc, elliptical arc and spline paths', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 },
        { id: 'spline', type: 'spline', layerId: 'geometry', controlPoints: [
            { x: 4, y: 1 }, { x: 4.5, y: 2 }, { x: 5.5, y: 0 }, { x: 6, y: 1 },
        ] },
        {
            id: 'ellipse', type: 'ellipse', layerId: 'geometry', cx: 3, cy: 1, rx: 1, ry: 0.5,
            startAngle: Math.PI, endAngle: 0, counterClockwise: true,
        },
        {
            id: 'arc', type: 'arc', layerId: 'geometry', cx: 1, cy: 1, r: 1,
            startAngle: -Math.PI / 2, endAngle: 0, counterClockwise: true,
        },
    ];
    const joined = joinDrawingEntities(content, ['line', 'spline', 'ellipse', 'arc']);
    assert.equal(joined.changed, true);
    assert.deepEqual(joined.entity.parts.map(part => part.type), ['line', 'arc', 'ellipse', 'spline']);
    assert.deepEqual(joined.entity.parts[3].controlPoints, content.entities[1].controlPoints);

    const exploded = explodeDrawingEntities(joined.content, joined.selectedIds);
    assert.deepEqual(exploded.entities.map(entity => entity.type), ['line', 'arc', 'ellipse', 'spline']);
    assert.deepEqual(exploded.entities[3].controlPoints, content.entities[1].controlPoints);
});

test('join creates a truly closed exact mixed path', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        {
            id: 'upper', type: 'arc', layerId: 'geometry', cx: 0, cy: 0, r: 2,
            startAngle: 0, endAngle: Math.PI, counterClockwise: true,
        },
        {
            id: 'lower', type: 'arc', layerId: 'geometry', cx: 0, cy: 0, r: 2,
            startAngle: Math.PI, endAngle: 0, counterClockwise: true,
        },
    ];
    const joined = joinDrawingEntities(content, ['upper', 'lower']);
    assert.equal(joined.changed, true);
    assert.equal(joined.entity.closed, true);
    assert.deepEqual(joined.entity.parts.map(part => part.type), ['arc', 'arc']);
});

test('explode preserves rounded rectangle arcs and supports blocks, hatches, text and dimensions', () => {
    const content = createDefaultDrawingContent();
    const inner = createAnonymousDrawingBlock([
        { id: 'inner-line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 },
    ], { id: 'inner' });
    const innerReference = createAnonymousDrawingBlockReference(inner, {
        id: 'inner-reference', insertionPoint: { x: 2, y: 0 }, layerId: 'geometry',
    });
    const outer = createAnonymousDrawingBlock([innerReference], { id: 'outer' });
    const outerReference = createAnonymousDrawingBlockReference(outer, {
        id: 'outer-reference', insertionPoint: { x: 10, y: 0 }, layerId: 'geometry',
    });
    content.blocks = [inner, outer];
    content.entities = [
        {
            id: 'rounded', type: 'rectangle', layerId: 'geometry', x: 0, y: 0, width: 6, height: 4,
            rotation: 0, cornerStyle: 'fillet', cornerValue: 0.5,
        },
        {
            id: 'hatch', type: 'hatch', layerId: 'geometry', boundaries: [[
                { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 },
            ]],
        },
        { id: 'text', type: 'text', layerId: 'geometry', text: 'AB', x: 0, y: 0, width: 2, height: 1, fontSize: 0.5 },
        {
            id: 'dimension', type: 'linearDimension', layerId: 'dimensions',
            p1: { x: 0, y: 0 }, p2: { x: 3, y: 0 }, offset: 1,
            dimensionFormat: {
                tolerance: { mode: 'symmetric', upper: 0.01, precision: 2 },
                alternateUnits: { enabled: true, unit: 'mm', precision: 0 },
                inspection: { enabled: true, label: 'A', rate: '100%' },
            },
        },
        outerReference,
    ];

    const rounded = explodeDrawingEntities(content, ['rounded']);
    assert.equal(rounded.entities.length, 8);
    assert.deepEqual(rounded.entities.map(entity => entity.type), ['line', 'arc', 'line', 'arc', 'line', 'arc', 'line', 'arc']);
    assert.ok(rounded.entities.filter(entity => entity.type === 'arc').every(entity => entity.r === 0.5));
    assert.equal(explodeDrawingEntities(content, ['hatch']).entities.length, 3);
    assert.deepEqual(explodeDrawingEntities(content, ['text']).entities.map(entity => entity.text), ['A', 'B']);
    assert.deepEqual(explodeDrawingEntities(content, ['dimension']).entities.map(entity => entity.type), [
        'line', 'line', 'line', 'line', 'line', 'text',
    ]);
    assert.equal(
        explodeDrawingEntities(content, ['dimension']).entities.find(entity => entity.type === 'text').text,
        'A\n3 m\n±0.01 m\n[3000 mm]\n100%',
    );

    const oneLevel = explodeDrawingEntities(content, ['outer-reference']);
    assert.equal(oneLevel.entities[0].type, 'blockReference');
    const recursive = explodeDrawingEntities(content, ['outer-reference'], { recursiveBlocks: true });
    assert.equal(recursive.entities[0].type, 'line');
    assert.deepEqual(
        { x1: recursive.entities[0].x1, y1: recursive.entities[0].y1, x2: recursive.entities[0].x2, y2: recursive.entities[0].y2 },
        { x1: 12, y1: 0, x2: 13, y2: 0 },
    );
});

test('exploding one QDIM member detaches the complete series as independent native dimensions', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'source-a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 0, y2: 3 },
        { id: 'source-b', type: 'line', layerId: 'geometry', x1: 2, y1: 0, x2: 2, y2: 3 },
        {
            id: 'qdim-a', type: 'linearDimension', layerId: 'dimensions',
            p1: { x: 0, y: 0 }, p2: { x: 2, y: 0 }, offset: 1,
            sourceIds: ['source-a', 'source-b'],
            sourcePointReferences: [
                { sourceId: 'source-a', endpointIndex: 0 },
                { sourceId: 'source-b', endpointIndex: 0 },
            ],
            seriesId: 'qdim-series-1', seriesMode: 'baseline', seriesIndex: 0,
            seriesAxis: { x: 1, y: 0 }, baselineEnd: 'first',
            baselineReference: { sourceId: 'source-a', endpointIndex: 0 },
        },
        {
            id: 'qdim-b', type: 'linearDimension', layerId: 'dimensions',
            p1: { x: 0, y: 0 }, p2: { x: 4, y: 0 }, offset: 2,
            sourceIds: ['source-a', 'source-b'],
            sourcePointReferences: [
                { sourceId: 'source-a', endpointIndex: 0 },
                { sourceId: 'source-b', endpointIndex: 0 },
            ],
            seriesId: 'qdim-series-1', seriesMode: 'baseline', seriesIndex: 1,
            seriesAxis: { x: 1, y: 0 }, baselineEnd: 'first',
            baselineReference: { sourceId: 'source-a', endpointIndex: 0 },
        },
    ];

    const exploded = explodeDrawingEntities(content, ['qdim-b']);
    assert.equal(exploded.changed, true);
    assert.equal(exploded.explodedCount, 2);
    assert.deepEqual(exploded.entities.map(entity => entity.type), ['linearDimension', 'linearDimension']);
    assert.deepEqual(exploded.entities.map(entity => entity.offset), [1, 2]);
    assert.ok(exploded.entities.every(entity => (
        !Object.hasOwn(entity, 'seriesId')
        && !Object.hasOwn(entity, 'seriesMode')
        && !Object.hasOwn(entity, 'seriesIndex')
        && !Object.hasOwn(entity, 'seriesAxis')
        && !Object.hasOwn(entity, 'baselineEnd')
        && !Object.hasOwn(entity, 'baselineReference')
    )));
    assert.ok(exploded.entities.every(entity => entity.sourceIds.join(',') === 'source-a,source-b'));
    assert.ok(exploded.entities.every(entity => !['qdim-a', 'qdim-b'].includes(entity.id)));
    assert.ok(exploded.content.entities.some(entity => entity.id === 'source-a'));
    assert.ok(exploded.content.entities.some(entity => entity.id === 'source-b'));
});

test('XPLODE can inherit parent appearance or retain each exact part appearance', () => {
    const content = createDefaultDrawingContent();
    content.entities = [{
        id: 'mixed', type: 'polyline', layerId: 'geometry', color: '#ff0000', transparency: 10,
        parts: [
            { type: 'line', layerId: 'references', color: '#0000ff', transparency: 20, x1: 0, y1: 0, x2: 1, y2: 0 },
            { type: 'line', layerId: 'dimensions', color: '#00ff00', transparency: 30, x1: 1, y1: 0, x2: 2, y2: 0 },
        ],
    }];
    const inherited = xplodeDrawingEntities(content, ['mixed'], { appearanceMode: 'parent' });
    assert.ok(inherited.entities.every(entity => entity.layerId === 'geometry'));
    assert.ok(inherited.entities.every(entity => entity.color === '#ff0000' && entity.transparency === 10));

    const retained = xplodeDrawingEntities(content, ['mixed'], { appearanceMode: 'parts' });
    assert.deepEqual(retained.entities.map(entity => entity.layerId), ['references', 'dimensions']);
    assert.deepEqual(retained.entities.map(entity => entity.color), ['#0000ff', '#00ff00']);
    assert.deepEqual(retained.entities.map(entity => entity.transparency), [20, 30]);
});

test('rectangular array replaces its sources with one transformable multi-path polyline', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 },
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 0.5, cy: 0.5, r: 0.2 },
    ];
    const array = createRectangularArray(
        content, ['line', 'circle'],
        { x: 0, y: 0 }, { x: -2, y: 0 }, { x: 0, y: 3 }, 3, 2,
    );
    assert.equal(array.changed, true);
    assert.equal(array.content.entities.length, 1);
    assert.equal(array.entity.type, 'polyline');
    assert.equal(array.entity.parts.length, 12);
    assert.deepEqual(array.entity.array, {
        columns: 3, rows: 2, horizontal: { x: -2, y: 0 }, vertical: { x: 0, y: 3 },
    });
    const moved = translateEntity(array.entity, 1, -1);
    assert.equal(moved.parts[0].x1, 1);
    assert.equal(moved.parts[1].cy, -0.5);
    const exploded = explodeDrawingEntities(array.content, array.selectedIds);
    assert.equal(exploded.entities.length, 12);
    assert.ok(exploded.entities.some(entity => entity.type === 'circle'));
});

test('rectangular array stays a draft while all five controls remain editable', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 },
    ];
    const operation = {
        type: 'array', stage: 'array-edit', entityIds: ['line'],
        sourceBasePoint: { x: 0, y: 0 }, basePoint: { x: 0, y: 0 },
        horizontalPoint: { x: 2, y: 0 }, verticalPoint: { x: 0, y: 3 },
        columns: 3, rows: 2,
    };
    const controls = getArrayControlGeometry(operation);
    assert.deepEqual(controls.xQuantity, { x: 4, y: 0 });
    assert.deepEqual(controls.yQuantity, { x: 0, y: 3 });

    const moved = editArrayOperation(operation, 'base', { x: 1, y: -1 });
    assert.deepEqual(moved.horizontalPoint, { x: 3, y: -1 });
    assert.deepEqual(moved.verticalPoint, { x: 1, y: 2 });
    const resized = editArrayOperation(moved, 'columns', { x: 9.2, y: -1 });
    assert.equal(resized.columns, 5);
    const respaced = editArrayOperation(resized, 'y-spacing', { x: 8, y: 4 });
    assert.deepEqual(respaced.verticalPoint, { x: 1, y: 4 });

    const drafts = createArrayDraftEntities(content, respaced, null);
    const preview = drafts.find(entity => entity.id === 'array-preview');
    assert.equal(content.entities.length, 1);
    assert.equal(preview.parts.length, 10);
    assert.equal(preview.parts[0].x1, 1);

    const created = createRectangularArray(
        content, ['line'], respaced.basePoint, respaced.horizontalPoint, respaced.verticalPoint,
        respaced.columns, respaced.rows, { sourceBasePoint: respaced.sourceBasePoint },
    );
    assert.equal(created.entity.parts[0].x1, 1);
    assert.equal(created.entity.parts.length, 10);
});
