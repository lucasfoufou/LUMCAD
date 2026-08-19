import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createDefaultDrawingContent,
    deleteSelectedEntities,
    getTransformSelectionEntities,
    pasteDrawingEntities,
} from './drawingDocument.js';
import {
    createDrawingClipboardPayload,
    drawingClipboardPayloadToSvg,
    validateDrawingClipboardPayload,
} from './drawingClipboard.js';
import {
    materializeDrawingBlockReference,
    remapDrawingBlockEntity,
    rotationAffineMatrix,
} from './drawingBlocks.js';
import { explodeDrawingEntities, joinDrawingEntities, mirrorDrawingEntities } from './drawingCompoundOperations.js';
import { buildDrawingDimensionEntity } from './drawingEntityFactory.js';
import { mirrorEntity, rotateEntity, scaleEntity, translateEntity } from './drawingPrimitives.js';
import { editEntityGrip, entityMatchesSelectionWindow, getEntityGrips } from './drawingSelection.js';

const closeTo = (actual, expected, epsilon = 1e-9) => {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not within ${epsilon} of ${expected}`);
};

const pointCloseTo = (actual, expected, epsilon = 1e-9) => {
    closeTo(actual.x, expected.x, epsilon);
    closeTo(actual.y, expected.y, epsilon);
};

function multiSourceContent() {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'horizontal', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0 },
        { id: 'vertical', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 0, y2: 3 },
        {
            id: 'angle',
            type: 'angularDimension',
            layerId: 'dimensions',
            sourceIds: ['horizontal', 'vertical'],
            radius: 1,
        },
    ];
    return content;
}

test('document selection, deletion, paste and join preserve multi-source dependency semantics', () => {
    const content = multiSourceContent();
    assert.deepEqual(
        getTransformSelectionEntities(content, ['horizontal']).map(entity => entity.id),
        ['horizontal', 'angle'],
    );

    const deleted = deleteSelectedEntities(content, ['horizontal']);
    assert.deepEqual(deleted.entities.map(entity => entity.id), ['vertical']);

    const pasted = pasteDrawingEntities(createDefaultDrawingContent(), content.entities, { x: 2, y: 3 });
    const copiedAngle = pasted.entities.find(entity => entity.type === 'angularDimension');
    const copiedSources = pasted.entities.filter(entity => entity.type === 'line').map(entity => entity.id);
    assert.deepEqual(copiedAngle.sourceIds, copiedSources);
    assert.ok(copiedAngle.sourceIds.every(id => !['horizontal', 'vertical'].includes(id)));

    const joined = joinDrawingEntities(content, ['horizontal', 'vertical']);
    assert.equal(joined.changed, true);
    assert.equal(joined.content.entities.some(entity => entity.id === 'angle'), false);
});

test('clipboard closure, validation, paste and SVG export include every angular source', () => {
    const content = multiSourceContent();
    const payload = createDrawingClipboardPayload(content, ['angle']);
    assert.deepEqual(payload.entities.map(entity => entity.id), ['horizontal', 'vertical', 'angle']);
    assert.deepEqual(payload.selectionIds, ['angle']);

    const missing = structuredClone(payload);
    missing.entities = missing.entities.filter(entity => entity.id !== 'vertical');
    assert.throws(
        () => validateDrawingClipboardPayload(missing),
        error => error.drawingClipboardCode === 'missing-source',
    );

    const svg = drawingClipboardPayloadToSvg(payload);
    assert.match(svg, /90°/);
    assert.match(svg, /<path d="M /);
});

test('block remapping and affine materialization retain all dimension fields and associations', () => {
    const remapped = remapDrawingBlockEntity({
        id: 'angle',
        type: 'angularDimension',
        layerId: 'dimensions',
        sourceIds: ['first', 'second'],
        radius: 2,
    }, {
        entityIdMap: new Map([
            ['angle', 'copy-angle'], ['first', 'copy-first'], ['second', 'copy-second'],
        ]),
    });
    assert.equal(remapped.id, 'copy-angle');
    assert.deepEqual(remapped.sourceIds, ['copy-first', 'copy-second']);

    const block = {
        id: 'block',
        entities: [{
            id: 'free-angle',
            type: 'angularDimension',
            layerId: 'dimensions',
            vertex: { x: 0, y: 0 },
            ray1Point: { x: 2, y: 0 },
            ray2Point: { x: 0, y: 2 },
            sourcePickPoints: [{ x: 1, y: 0 }, { x: 0, y: 1 }],
            radius: 1,
        }],
    };
    const materialized = materializeDrawingBlockReference({
        type: 'blockReference', blockId: 'block', transform: rotationAffineMatrix(90),
    }, [block])[0];
    pointCloseTo(materialized.vertex, { x: 0, y: 0 });
    pointCloseTo(materialized.ray1Point, { x: 0, y: 2 });
    pointCloseTo(materialized.ray2Point, { x: -2, y: 0 });
    pointCloseTo(materialized.sourcePickPoints[0], { x: 0, y: 1 });
    closeTo(materialized.radius, 1);
});

test('translate, rotate, scale and mirror transform every free dimension control field', () => {
    const angular = {
        type: 'angularDimension',
        vertex: { x: 1, y: 1 },
        ray1Point: { x: 3, y: 1 },
        ray2Point: { x: 1, y: 3 },
        sourcePickPoints: [{ x: 2, y: 1 }, { x: 1, y: 2 }],
        radius: 2,
        counterClockwise: true,
    };
    const translated = translateEntity(angular, 4, -2);
    assert.deepEqual(translated.vertex, { x: 5, y: -1 });
    assert.deepEqual(translated.sourcePickPoints[1], { x: 5, y: 0 });

    const rotated = rotateEntity(angular, 90, { x: 0, y: 0 });
    pointCloseTo(rotated.vertex, { x: -1, y: 1 });
    pointCloseTo(rotated.ray1Point, { x: -1, y: 3 });

    const scaled = scaleEntity(angular, { origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 2 });
    assert.deepEqual(scaled.vertex, { x: 2, y: 2 });
    assert.equal(scaled.radius, 4);

    const mirrored = mirrorEntity(angular, { x: 0, y: -5 }, { x: 0, y: 5 });
    assert.deepEqual(mirrored.vertex, { x: -1, y: 1 });
    assert.equal(mirrored.counterClockwise, false);

    const jogged = translateEntity({
        type: 'radialDimension',
        mode: 'joggedRadius',
        jogCenter: { x: 1, y: 2 },
        jogPoint: { x: 3, y: 4 },
    }, 2, 3);
    assert.deepEqual(jogged.jogCenter, { x: 3, y: 5 });
    assert.deepEqual(jogged.jogPoint, { x: 5, y: 7 });

    const ordinate = translateEntity({
        type: 'ordinateDimension',
        origin: { x: 0, y: 0 },
        featurePoint: { x: 2, y: 3 },
        leaderPoint: { x: 4, y: 5 },
    }, -1, 2);
    assert.deepEqual(ordinate.origin, { x: -1, y: 2 });
    assert.deepEqual(ordinate.featurePoint, { x: 1, y: 5 });
    assert.deepEqual(ordinate.leaderPoint, { x: 3, y: 7 });

    const mark = scaleEntity({ type: 'centerMark', size: 0.5, extension: 0.25 }, {
        origin: { x: 0, y: 0 }, scaleX: 4, scaleY: 4,
    });
    assert.equal(mark.size, 2);
    assert.equal(mark.extension, 1);
});

test('new dimension grips edit placement without breaking source associations', () => {
    const sources = new Map([
        ['first', { id: 'first', type: 'line', x1: 0, y1: 0, x2: 4, y2: 0 }],
        ['second', { id: 'second', type: 'line', x1: 0, y1: 0, x2: 0, y2: 4 }],
        ['arc', {
            id: 'arc', type: 'arc', cx: 10, cy: 10, r: 3,
            startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
        }],
        ['circle', { id: 'circle', type: 'circle', cx: 20, cy: 20, r: 4 }],
    ]);
    const angular = {
        type: 'angularDimension', sourceIds: ['first', 'second'], radius: 2,
    };
    assert.deepEqual(getEntityGrips(angular, sources).map(grip => grip.id), ['dimension-position']);
    const resizedAngle = editEntityGrip(angular, 'dimension-position', { x: 3, y: 4 }, sources);
    assert.equal(resizedAngle.radius, 5);
    assert.deepEqual(resizedAngle.sourceIds, angular.sourceIds);

    const arcLength = { type: 'arcLengthDimension', sourceId: 'arc', offset: 1 };
    const movedArcLength = editEntityGrip(arcLength, 'dimension-position', { x: 15, y: 10 }, sources);
    assert.equal(movedArcLength.offset, 2);

    const ordinate = {
        type: 'ordinateDimension', axis: 'x', origin: { x: 0, y: 0 }, featurePoint: { x: 2, y: 3 },
    };
    assert.deepEqual(getEntityGrips(ordinate, sources).map(grip => grip.id), [
        'ordinate-origin', 'ordinate-feature', 'dimension-position',
    ]);
    assert.deepEqual(
        editEntityGrip(ordinate, 'dimension-position', { x: 7, y: 8 }, sources).leaderPoint,
        { x: 7, y: 8 },
    );

    const centerMark = { type: 'centerMark', sourceId: 'circle', size: 0.5, extension: 0.25 };
    assert.deepEqual(getEntityGrips(centerMark, sources).map(grip => grip.id), ['center-mark-size']);
    assert.equal(editEntityGrip(centerMark, 'center-mark-size', { x: 21.25, y: 20 }, sources).size, 1);
});

test('dimension factory creates normalized descriptors for every family and tool alias', () => {
    const cases = [
        ['horizontalDimension', 'linearDimension', { measurementMode: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 2, y: 0 } }],
        ['rotatedDimension', 'linearDimension', { dimensionAngle: Math.PI / 4, p1: { x: 0, y: 0 }, p2: { x: 2, y: 2 } }],
        ['diameterDimension', 'radialDimension', { sourceId: 'circle' }],
        ['joggedRadiusDimension', 'radialDimension', { sourceId: 'circle' }],
        ['angularDimension', 'angularDimension', { sourceIds: ['first', 'second'] }],
        ['arcLengthDimension', 'arcLengthDimension', { sourceId: 'arc' }],
        ['ordinateDimension', 'ordinateDimension', { featurePoint: { x: 1, y: 2 } }],
        ['centerMark', 'centerMark', { sourceId: 'circle' }],
    ];
    cases.forEach(([tool, type, options], index) => {
        const entity = buildDrawingDimensionEntity(tool, 'dimensions', options, `dimension-${index}`);
        assert.equal(entity.id, `dimension-${index}`);
        assert.equal(entity.type, type);
        assert.equal(entity.layerId, 'dimensions');
    });
    assert.equal(buildDrawingDimensionEntity('diameterDimension', 'dimensions', { sourceId: 'circle' }).mode, 'diameter');
    assert.equal(buildDrawingDimensionEntity('joggedRadiusDimension', 'dimensions', { sourceId: 'circle' }).mode, 'joggedRadius');
    assert.equal(buildDrawingDimensionEntity('unknown', 'dimensions'), null);
});

test('selection and explode consume common lines and native arcs for every annotation family', () => {
    const content = multiSourceContent();
    content.entities.push(
        {
            id: 'arc', type: 'arc', layerId: 'geometry', cx: 10, cy: 10, r: 3,
            startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
        },
        { id: 'arc-length', type: 'arcLengthDimension', layerId: 'dimensions', sourceId: 'arc', offset: 1 },
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 20, cy: 20, r: 4 },
        { id: 'center', type: 'centerMark', layerId: 'dimensions', sourceId: 'circle', size: 0.5 },
    );
    const map = new Map(content.entities.map(entity => [entity.id, entity]));
    assert.equal(entityMatchesSelectionWindow(content.entities[2], {
        minX: -0.25, minY: -0.25, maxX: 1.5, maxY: 1.5, mode: 'crossing',
    }, map), true);

    const angularParts = explodeDrawingEntities(content, ['angle']).entities;
    assert.ok(angularParts.some(entity => entity.type === 'arc'));
    assert.ok(angularParts.some(entity => entity.type === 'text' && entity.text.includes('90°')));
    const arcLengthParts = explodeDrawingEntities(content, ['arc-length']).entities;
    assert.ok(arcLengthParts.some(entity => entity.type === 'arc'));
    const centerParts = explodeDrawingEntities(content, ['center']).entities;
    assert.deepEqual(centerParts.map(entity => entity.type), ['line', 'line']);

    const mirrored = mirrorDrawingEntities(content, ['horizontal', 'vertical'], { x: 0, y: -2 }, { x: 0, y: 2 });
    const copiedAngle = mirrored.entities.find(entity => entity.type === 'angularDimension');
    const copiedLines = mirrored.entities.filter(entity => entity.type === 'line').map(entity => entity.id);
    assert.deepEqual(copiedAngle.sourceIds, copiedLines);
});
