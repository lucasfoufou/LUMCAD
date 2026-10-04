import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { beginPolarArray, beginPolarArrayEdit, commitPolarArray, createPolarArrayDraft, editPolarArrayPoint, normalizePolarArray } from './drawingPolarArray.js';
import { mirrorEntity, rotateEntity, scaleEntity, translateEntity } from './drawingGeometry.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

function fixture() {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'line', type: 'line', layerId: 'geometry', x1: 2, y1: 0, x2: 3, y2: 0 }];
    const operation = { ...beginPolarArray(content, ['line']), center: { x: 0, y: 0 }, count: 4, stage: 'array-edit' };
    return { content, operation };
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('full polar arrays omit the duplicate endpoint and preview without mutating the drawing', () => {
    const { content, operation } = fixture();
    const before = structuredClone(content);
    const draft = createPolarArrayDraft(content, operation)[0];
    assert.equal(draft.id, 'array-preview');
    assert.equal(draft.parts.length, 4);
    near(draft.parts[1].x1, 0);
    near(draft.parts[1].y1, 2);
    near(draft.parts[3].y1, -2);
    assert.deepEqual(content, before);
    const result = commitPolarArray(content, operation);
    assert.equal(result.changed, true);
    assert.equal(result.content.entities.length, 1);
    assert.deepEqual(result.entity.parts, draft.parts);
});

test('partial and negative sweeps include endpoints and support fixed motif orientation', () => {
    const { content, operation } = fixture();
    const partial = commitPolarArray(content, { ...operation, count: 3, angle: -180 });
    near(partial.entity.parts[1].y1, -2);
    near(partial.entity.parts[2].x1, -2);
    const fixed = commitPolarArray(content, { ...operation, rotateItems: false });
    near(fixed.entity.parts[1].x2 - fixed.entity.parts[1].x1, 1);
    near(fixed.entity.parts[1].y2 - fixed.entity.parts[1].y1, 0);
    assert.equal(commitPolarArray(content, { ...operation, count: 1 }).entity.parts.length, 1);
});

test('polar definitions reject invalid counts, angles, matrices and oversized geometry', () => {
    const { content, operation } = fixture();
    for (const changes of [{ count: 0 }, { count: 101 }, { count: 2.5 }, { angle: 0 }, { angle: 361 },
        { angle: Infinity }, { center: { x: NaN, y: 0 } }, { transform: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 } },
        { count: 100, seedParts: Array(1001).fill(operation.seedParts[0]) }]) {
        assert.equal(commitPolarArray(content, { ...operation, ...changes }).changed, false);
    }
    content.entities[0].locked = true;
    assert.equal(beginPolarArray(content, ['line']), null);
});

test('polar arrays retain their identity and regenerate exactly after geometric transforms', () => {
    const { content, operation } = fixture();
    const created = commitPolarArray(content, operation);
    let entity = created.entity;
    for (const transform of [
        value => translateEntity(value, 8, -4),
        value => rotateEntity(value, 37, { x: 1, y: 1 }),
        value => scaleEntity(value, { scaleX: 2, scaleY: 3, origin: { x: 0, y: 0 } }),
        value => mirrorEntity(value, { x: 0, y: 0 }, { x: 2, y: 3 }),
    ]) {
        entity = transform(entity);
        const transformed = { ...created.content, entities: [entity] };
        const editing = beginPolarArrayEdit(transformed, [entity.id]);
        const rebuilt = commitPolarArray(transformed, editing);
        assert.equal(rebuilt.entity.id, entity.id);
        assert.deepEqual(rebuilt.entity.parts, entity.parts);
        const resized = commitPolarArray(transformed, { ...editing, count: 7 });
        assert.equal(resized.entity.parts.length, 7);
    }
});

test('nonuniform polar circle transforms preserve exact ellipses and remain editable', () => {
    const { content } = fixture();
    content.entities = [{ id: 'circle', type: 'circle', layerId: 'geometry', cx: 3, cy: 0, r: 1 }];
    const operation = { ...beginPolarArray(content, ['circle']), center: { x: 0, y: 0 }, count: 4, stage: 'array-edit' };
    const result = commitPolarArray(content, operation);
    const scaled = scaleEntity(result.entity, { scaleX: 2, scaleY: 3, origin: { x: 0, y: 0 } });
    assert.ok(scaled.parts.every(part => part.type === 'ellipse'));
    assert.ok(scaled.parts.every(part => part.fullEllipse));
    const edited = beginPolarArrayEdit({ ...content, entities: [scaled] }, [scaled.id]);
    assert.ok(edited);
    assert.deepEqual(commitPolarArray({ ...content, entities: [scaled] }, edited).entity.parts, scaled.parts);
});

test('polar arrays reload with usable controls and the same editable motif', () => {
    const { content, operation } = fixture();
    const created = commitPolarArray(content, operation);
    const document = { ...createLcadDocument(), content: created.content };
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content;
    const editing = beginPolarArrayEdit(loaded, created.selectedIds);
    assert.ok(editing);
    const changed = editPolarArrayPoint(editing, 'center', { x: 1, y: 2 });
    assert.deepEqual(changed.center, { x: 1, y: 2 });
    const angle = editPolarArrayPoint(editing, 'angle', { x: 0, y: 2 });
    near(angle.angle, 90);
    assert.equal(commitPolarArray(loaded, { ...editing, count: 8 }).entity.parts.length, 8);
    assert.equal(normalizePolarArray({ ...created.entity.array, seedParts: [{ type: 'polyline', parts: [] }] }), null);
});
