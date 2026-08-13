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
} from './drawingCompoundOperations.js';
import { getEntityBounds, mirrorEntity, translateEntity } from './drawingGeometry.js';

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
        { id: 'a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 3, y2: 0 },
        { id: 'b', type: 'line', layerId: 'geometry', x1: 3, y1: 0, x2: 3, y2: 4 },
    ];
    const joined = joinDrawingEntities(content, ['a', 'b']);
    assert.equal(joined.changed, true);
    assert.equal(joined.entity.type, 'polyline');
    assert.equal(joined.entity.closed, false);
    assert.deepEqual(joined.entity.points, [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]);

    const exploded = explodeDrawingEntities(joined.content, joined.selectedIds);
    assert.equal(exploded.changed, true);
    assert.equal(exploded.entities.length, 2);
    assert.ok(exploded.entities.every(entity => entity.type === 'line'));

    const disconnected = createDefaultDrawingContent();
    disconnected.entities = [
        { id: 'a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 },
        { id: 'b', type: 'line', layerId: 'geometry', x1: 5, y1: 0, x2: 6, y2: 0 },
    ];
    assert.equal(joinDrawingEntities(disconnected, ['a', 'b']).changed, false);
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

test('join represents a connected branched network as one multi-path polyline', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'left', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: -3, y2: -2 },
        { id: 'right', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0 },
        { id: 'top', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 3, y2: -2 },
    ];
    const joined = joinDrawingEntities(content, ['left', 'right', 'top']);
    assert.equal(joined.changed, true);
    assert.equal(joined.entity.type, 'polyline');
    assert.equal(joined.entity.parts.length, 3);
    assert.equal(getEntityBounds(joined.entity).maxX, 4);
    const exploded = explodeDrawingEntities(joined.content, joined.selectedIds);
    assert.equal(exploded.entities.length, 3);
});

test('join accepts a connected network whose branches meet inside other segments', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'vertical', type: 'line', layerId: 'geometry', x1: 1, y1: -4, x2: 1, y2: 4 },
        { id: 'upper', type: 'line', layerId: 'geometry', x1: -2, y1: 0, x2: 4, y2: -3 },
        { id: 'middle', type: 'line', layerId: 'geometry', x1: -2, y1: 0, x2: 5, y2: 0 },
        { id: 'lower', type: 'line', layerId: 'geometry', x1: -2, y1: 0, x2: 4, y2: 3 },
    ];
    const joined = joinDrawingEntities(content, content.entities.map(entity => entity.id));
    assert.equal(joined.changed, true);
    assert.equal(joined.entity.type, 'polyline');
    assert.equal(joined.entity.parts.length, 4);
    assert.equal(joined.content.entities.length, 1);
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
