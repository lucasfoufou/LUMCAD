import { pathLength, getCurveStart, getCurveEnd } from './drawingCurveKernel.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { editDrawingPointPolyline, isEditablePointPolyline, parseDrawingPolylineEdit, editDrawingPolyline, isEditableCurvePolyline } from './drawingPolylineEditing.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { commitDrawingHistoryState, undoDrawingHistoryState, redoDrawingHistoryState } from './drawingHistory.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { getEntityBounds } from './drawingGeometry.js';
import { getEntityGrips } from './drawingSelection.js';

const fixture = () => ({ id: 'path', type: 'polyline', layerId: 'geometry', color: '#abcdef', closed: false,
    points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }] });

test('PEDIT parses bounded one-based vertex operations without accepting incomplete or extra input', () => {
    assert.deepEqual(parseDrawingPolylineEdit('VERTEX 2 4,5 -2'), { action: 'vertex', index: 1, point: { x: 4.5, y: -2 } });
    assert.deepEqual(parseDrawingPolylineEdit('INSERT 4 8 9'), { action: 'insert', index: 3, point: { x: 8, y: 9 } });
    assert.deepEqual(parseDrawingPolylineEdit('REMOVE 1'), { action: 'remove', index: 0 });
    assert.deepEqual(parseDrawingPolylineEdit('close'), { action: 'close', closed: true });
    assert.deepEqual(parseDrawingPolylineEdit('OPEN'), { action: 'close', closed: false });
    assert.deepEqual(parseDrawingPolylineEdit('REVERSE'), { action: 'reverse' });
    for (const input of ['', 'VERTEX 0 1 2', 'VERTEX 1.5 1 2', 'INSERT 1 2', 'REMOVE 1 2', 'CLOSE 1', 'REVERSE extra']) {
        assert.equal(parseDrawingPolylineEdit(input), null, input);
    }
});

test('point-polyline edits preserve identity and appearance with reversible vertex/topology operations', () => {
    const entity = fixture(); const saved = structuredClone(entity);
    const moved = editDrawingPointPolyline(entity, { action: 'vertex', index: 1, point: { x: 6, y: 0 } }).entity;
    assert.deepEqual(moved.points[1], { x: 6, y: 0 });
    assert.equal(moved.id, entity.id); assert.equal(moved.color, entity.color);
    const inserted = editDrawingPointPolyline(entity, { action: 'insert', index: 1, point: { x: 2, y: 0 } }).entity;
    assert.deepEqual(editDrawingPointPolyline(inserted, { action: 'remove', index: 1 }).entity, entity);
    const reversed = editDrawingPointPolyline(entity, { action: 'reverse' }).entity;
    assert.deepEqual(editDrawingPointPolyline(reversed, { action: 'reverse' }).entity, entity);
    const closed = editDrawingPointPolyline(entity, { action: 'close', closed: true }).entity;
    assert.equal(closed.closed, true);
    assert.deepEqual(editDrawingPointPolyline(closed, { action: 'close', closed: false }).entity, entity);
    assert.deepEqual(entity, saved);
});

test('point topology rejects degenerate paths and generated representations instead of discarding metadata', () => {
    const entity = fixture();
    for (const metadata of ['array', 'linework', 'revisionSymbol', 'table', 'tolerance', 'leader', 'wipeout', 'splineDefinition']) {
        assert.equal(isEditablePointPolyline({ ...entity, [metadata]: {} }), false);
    }
    assert.equal(editDrawingPointPolyline(entity, { action: 'vertex', index: 1, point: { x: 0, y: 0 } }).error, 'invalid');
    assert.equal(editDrawingPointPolyline(entity, { action: 'remove', index: -1 }).error, 'invalid');
    assert.equal(editDrawingPointPolyline({ ...entity, points: entity.points.slice(0, 2) }, { action: 'close', closed: true }).error, 'invalid');
    const repeated = { ...entity, points: [...entity.points, entity.points[0]] };
    assert.equal(editDrawingPointPolyline(repeated, { action: 'close', closed: true }).entity.points.length, 3);
});

test('point edits use shared constraint enforcement and topology refusal without breaking undo/redo', () => {
    const content = { ...createDefaultDrawingContent(), entities: [fixture()], geometricConstraints: [
        { id: 'horizontal', type: 'horizontal', refs: [{ entityId: 'path', part: 0 }] },
    ] };
    const state = { past: [], present: content, future: [] };
    const moved = editDrawingPointPolyline(content.entities[0], { action: 'vertex', index: 1, point: { x: 5, y: 1 } }).entity;
    const committed = commitDrawingHistoryState(state, { ...content, entities: [moved] });
    assert.equal(committed.rejection, null);
    assert.ok(Math.abs(committed.present.entities[0].points[0].y - 1) < 1e-7);
    assert.deepEqual(undoDrawingHistoryState(committed).present, content);
    assert.deepEqual(redoDrawingHistoryState(undoDrawingHistoryState(committed)).present, committed.present);
    const inserted = editDrawingPointPolyline(content.entities[0], { action: 'insert', index: 1, point: { x: 2, y: 0 } }).entity;
    const refused = commitDrawingHistoryState(state, { ...content, entities: [inserted] });
    assert.ok(refused.rejection); assert.equal(refused.present, content); assert.deepEqual(refused.past, []);
});

test('edited closed polyline retains vertices, bounds, grips and appearance through archive reload', () => {
    let entity = fixture();
    for (const input of ['INSERT 2 2 -1', 'VERTEX 3 6 0', 'CLOSE', 'REVERSE']) {
        const result = editDrawingPointPolyline(entity, parseDrawingPolylineEdit(input));
        assert.ok(!result.error, result.error); entity = result.entity;
    }
    const document = { ...createLcadDocument(), content: { ...createDefaultDrawingContent(), entities: [entity] } };
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content.entities[0];
    assert.equal(restored.id, entity.id); assert.equal(restored.color, entity.color);
    assert.equal(restored.closed, true); assert.deepEqual(restored.points, entity.points);
    assert.deepEqual(getEntityBounds(restored), getEntityBounds(entity));
    assert.deepEqual(getEntityGrips(restored), getEntityGrips(entity));
});


test('mixed native PEDIT preserves curves, length, metadata and source through reverse, split and closure', () => {
    const entity = { id: 'mixed', type: 'polyline', layerId: 'geometry', color: '#abcdef', closed: false, parts: [
        { type: 'line', x1: -2, y1: 0, x2: 1, y2: 0 },
        { type: 'arc', cx: 0, cy: 0, r: 1, startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true, color: '#fedcba' },
    ] };
    const saved = structuredClone(entity);
    assert.equal(isEditableCurvePolyline(entity), true);
    const split = editDrawingPolyline(entity, parseDrawingPolylineEdit('SPLIT 2 0.5')).entity;
    assert.deepEqual(split.parts.map(part => part.type), ['line', 'arc', 'arc']);
    assert.equal(split.parts[1].color, '#fedcba'); assert.equal(split.parts[2].color, '#fedcba');
    assert.ok(Math.abs(pathLength(split) - pathLength(entity)) < 1e-9);
    const reverse = editDrawingPolyline(split, { action: 'reverse' }).entity;
    assert.deepEqual(getCurveStart(reverse.parts[0]), getCurveEnd(split.parts.at(-1)));
    assert.ok(Math.abs(pathLength(reverse) - pathLength(entity)) < 1e-9);
    const closed = editDrawingPolyline(entity, { action: 'close', closed: true }).entity;
    assert.equal(closed.closed, true); assert.equal(closed.parts.length, 3);
    const opened = editDrawingPolyline(closed, { action: 'close', closed: false }).entity;
    assert.equal(opened.closed, false);
    assert.ok(Math.abs(pathLength(opened) - pathLength(closed)) < 1e-9);
    assert.equal(opened.id, entity.id); assert.equal(opened.color, entity.color);
    assert.deepEqual(entity, saved);
    for (const input of ['SPLIT 0 0.5', 'SPLIT 2 0', 'SPLIT 2 1', 'SPLIT 2 NaN']) assert.equal(parseDrawingPolylineEdit(input), null);
    assert.ok(editDrawingPolyline(entity, { action: 'split', index: 20, parameter: 0.5 }).error);
    assert.equal(isEditableCurvePolyline({ ...entity, parts: [entity.parts[1], { type: 'line', x1: 8, y1: 8, x2: 9, y2: 9 }] }), false);
    assert.equal(isEditableCurvePolyline({ ...entity, linework: {} }), false);
});


test('native curve subdivision survives archives without flattening cubic or ellipse segments', async () => {
    for (const part of [
        { type: 'spline', controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 3 }, { x: 2, y: -1 }, { x: 4, y: 0 }] },
        { type: 'ellipse', cx: 0, cy: 0, rx: 4, ry: 2, rotation: 0.3, startAngle: 0, endAngle: Math.PI, counterClockwise: true },
    ]) {
        const document = createLcadDocument();
        const entity = { id: 'native', type: 'polyline', layerId: document.content.activeLayerId, closed: false, parts: [part] };
        document.content.entities = [entity];
        const edited = editDrawingPolyline(entity, { action: 'split', index: 0, parameter: 0.35 }).entity;
        assert.equal(edited.parts.length, 2);
        assert.ok(edited.parts.every(piece => piece.type === part.type));
        assert.ok(Math.abs(pathLength(edited) - pathLength(entity)) < 1e-6);
        document.content.entities = [edited];
        const loaded = await readLcadArchive(await createLcadArchive(createLcadEnvelope(document)));
        assert.deepEqual(loaded.document.content.entities[0].parts, edited.parts);
    }
});
