import { editEntityGrip, getEntityGrips } from './drawingSelection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { beginPathArray, beginPathArrayEdit, choosePathArraySource, commitPathArray, createPathArrayDraft,
    editPathArrayPoint, normalizePathArray, refreshPathArrays } from './drawingPathArray.js';
import { rotateEntity, scaleEntity, translateEntity } from './drawingGeometry.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

function fixture(path = { id: 'path', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 10, y2: 0 }) {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'motif', type: 'line', layerId: 'geometry', x1: 20, y1: 20, x2: 21, y2: 20 }, path];
    const operation = choosePathArraySource(content, beginPathArray(content, ['motif'], { count: 3 }), path.id);
    return { content, operation, path };
}

test('path array previews and commits evenly spaced motifs without consuming the source path', () => {
    const { content, operation, path } = fixture();
    const before = structuredClone(content);
    const draft = createPathArrayDraft(content, operation)[0];
    assert.deepEqual(draft.parts.map(part => part.x1), [0, 5, 10]);
    assert.deepEqual(content, before);
    const result = commitPathArray(content, operation);
    assert.equal(result.changed, true);
    assert.equal(result.content.entities[0], path);
    assert.equal(result.entity.sourceId, 'path');
    assert.deepEqual(result.entity.parts, draft.parts);
    assert.equal(result.content.entities.length, 2);
});

test('fixed spacing, start offset and reversal have bounded and predictable station counts', () => {
    const { content, operation } = fixture();
    const measured = commitPathArray(content, { ...operation, mode: 'measure', spacing: 3, offset: 1 });
    assert.deepEqual(measured.entity.parts.map(part => part.x1), [1, 4, 7, 10]);
    assert.equal(measured.entity.array.count, 4);
    const reversed = commitPathArray(content, { ...operation, reverse: true });
    assert.deepEqual(reversed.entity.parts.map(part => part.x1), [10, 5, 0]);
    near(reversed.entity.parts[0].x2, 9);
    assert.equal(commitPathArray(content, { ...operation, mode: 'measure', spacing: 0.001 }).changed, false);
    assert.equal(commitPathArray(content, { ...operation, offset: 10 }).changed, false);
    assert.equal(commitPathArray(content, { ...operation, count: 101 }).changed, false);
});

test('closed paths omit the duplicated endpoint and respect tangent or fixed orientation', () => {
    const { content, operation } = fixture({ id: 'path', type: 'circle', layerId: 'geometry', cx: 0, cy: 0, r: 2 });
    const result = commitPathArray(content, { ...operation, count: 4 });
    near(result.entity.parts[0].x1, 2);
    near(result.entity.parts[1].y1, 2);
    near(result.entity.parts[3].y1, -2);
    near(result.entity.parts[0].x2, 2);
    near(result.entity.parts[0].y2, 1);
    const fixed = commitPathArray(content, { ...operation, count: 4, align: false });
    near(fixed.entity.parts[1].x2 - fixed.entity.parts[1].x1, 1);
    const measured = commitPathArray(content, { ...operation, mode: 'measure', spacing: Math.PI });
    assert.equal(measured.entity.parts.length, 4);
});

test('nonuniform spline parameterization still places items at equal physical distances', () => {
    const { content, operation } = fixture({ id: 'path', type: 'spline', layerId: 'geometry',
        controlPoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 12, y: 0 }] });
    const result = commitPathArray(content, { ...operation, count: 4 });
    assert.equal(result.changed, true);
    result.entity.parts.forEach((part, index) => near(part.x1, index * 4));
});

test('editing the path updates its array in the same content snapshot without changing its ID', () => {
    const { content, operation, path } = fixture();
    const result = commitPathArray(content, operation);
    const changedPath = { ...path, x2: 20 };
    const changed = { ...result.content, entities: result.content.entities.map(entity => entity.id === path.id ? changedPath : entity) };
    const refreshed = refreshPathArrays(changed, result.content);
    const array = refreshed.entities.find(entity => entity.id === result.entity.id);
    assert.deepEqual(array.parts.map(part => part.x1), [0, 10, 20]);
    assert.equal(array.sourceId, path.id);
    assert.deepEqual(result.entity.parts.map(part => part.x1), [0, 5, 10]);
    assert.equal(refreshPathArrays(refreshed, refreshed), refreshed);
});

test('moving a path and array together preserves their link; moving only the array detaches it', () => {
    const { content, operation } = fixture();
    const result = commitPathArray(content, operation);
    const together = { ...result.content, entities: result.content.entities.map(entity => translateEntity(entity, 3, 2)) };
    const linked = refreshPathArrays(together, result.content).entities.find(entity => entity.id === result.entity.id);
    assert.equal(linked.sourceId, 'path');
    near(linked.parts[0].x1, 3);
    near(linked.parts[0].y1, 2);
    const alone = { ...result.content, entities: result.content.entities.map(entity => entity.id === result.entity.id ? translateEntity(entity, 3, 2) : entity) };
    const detached = refreshPathArrays(alone, result.content).entities.find(entity => entity.id === result.entity.id);
    assert.equal(detached.sourceId, undefined);
    near(detached.parts[0].x1, 3);
    assert.ok(beginPathArrayEdit({ ...alone, entities: [detached] }, [detached.id]));
});

test('path arrays retain their transformed geometry and parameters across archive reload and editing', () => {
    const { content, operation } = fixture();
    const result = commitPathArray(content, operation);
    let entity = rotateEntity(result.entity, 37, { x: 0, y: 0 });
    entity = scaleEntity(entity, { scaleX: 2, scaleY: 3, origin: { x: 0, y: 0 } });
    const transformed = refreshPathArrays({ ...result.content, entities: [result.content.entities[0], entity] }, result.content);
    const envelope = createLcadEnvelope({ ...createLcadDocument(), content: transformed });
    const loaded = readLcadArchive(createLcadArchive(envelope)).document.content;
    const editing = beginPathArrayEdit(loaded, [entity.id]);
    assert.ok(editing);
    const rebuilt = commitPathArray(loaded, editing);
    assert.deepEqual(rebuilt.entity.parts, entity.parts);
    assert.equal(rebuilt.entity.id, entity.id);
    assert.equal(commitPathArray(loaded, { ...editing, count: 5 }).entity.parts.length, 5);
});

test('path picking rejects the motif, disconnected geometry and recursive arrays', () => {
    const { content } = fixture();
    const operation = beginPathArray(content, ['motif']);
    assert.equal(choosePathArraySource(content, operation, 'motif'), null);
    assert.equal(choosePathArraySource(content, operation, 'missing'), null);
    content.entities.push({ id: 'disconnected', type: 'polyline', layerId: 'geometry', parts: [
        { type: 'line', x1: 0, y1: 0, x2: 1, y2: 0 }, { type: 'line', x1: 9, y1: 9, x2: 10, y2: 9 },
    ] });
    assert.equal(choosePathArraySource(content, operation, 'disconnected'), null);
    assert.equal(normalizePathArray({ kind: 'path' }), null);
});

test('offset and spacing grips edit the same path parameters as command input', () => {
    const { operation } = fixture();
    const offset = editPathArrayPoint(operation, 'offset', { x: 2, y: 1 });
    near(offset.offset, 2);
    const spacing = editPathArrayPoint(offset, 'spacing', { x: 5, y: 1 });
    near(spacing.spacing, 3);
    assert.equal(spacing.mode, 'measure');
    assert.equal(spacing.count, 3);
});


test('array selection grips move the complete array without breaking individual instances', () => {
    const { content, operation } = fixture();
    const result = commitPathArray(content, operation);
    const grips = getEntityGrips(result.entity);
    assert.equal(grips.length, 1);
    assert.equal(grips[0].id, 'array-origin');
    const moved = editEntityGrip(result.entity, grips[0].id, { x: 2, y: 3 });
    near(moved.parts[0].x1, 2);
    near(moved.parts[0].y1, 3);
    assert.equal(editEntityGrip(result.entity, 'part-0:start', { x: 2, y: 3 }), result.entity);
});
