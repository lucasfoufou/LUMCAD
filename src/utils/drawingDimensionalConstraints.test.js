import { createDrawingBlockEditDraft, saveDrawingBlockEdit } from './drawingBlockEditing.js';
import { normalizeDrawingContent } from './drawingDocument.js';
import { prepareDrawingConstraintEdit } from './drawingConstraintEditing.js';
import { commitDrawingHistoryState, redoDrawingHistoryState } from './drawingHistory.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { normalizeDrawingDimensionalConstraints, solveDrawingDimensionalConstraints, drawingDimensionalConstraintResiduals } from './drawingDimensionalConstraints.js';
import { drawingGeometricConstraintResiduals } from './drawingGeometricConstraints.js';

const line = (id, x1, y1, x2, y2) => ({ id, type: 'line', x1, y1, x2, y2 });
function fixture(entities) {
    const content = createDefaultDrawingContent();
    return { ...content, entities: entities.map(entity => ({ ...entity, layerId: content.activeLayerId })) };
}
const dimension = (id, type, expression, refs, extra = {}) => ({ id, name: id, type, expression, refs, ...extra });
function solve(content) {
    const saved = structuredClone(content);
    const result = solveDrawingDimensionalConstraints(content);
    assert.ok(!result.error, JSON.stringify(result));
    const catalog = normalizeDrawingDimensionalConstraints(content.dimensionalConstraints, content.entities, content.parameters);
    const map = new Map(result.content.entities.map(entity => [entity.id, entity]));
    for (const item of catalog.constraints) assert.ok(drawingDimensionalConstraintResiduals(item, map, catalog.values[item.name]).every(value => Math.abs(value) < 1e-7));
    for (const item of content.geometricConstraints || []) assert.ok(drawingGeometricConstraintResiduals(item, map).every(value => Math.abs(value) < 1e-7));
    assert.deepEqual(content, saved);
    return result.content;
}

test('driving length and parameter expressions solve together with horizontal and fixed-point relationships', () => {
    const content = fixture([line('a', 0, 0, 3, 1)]);
    content.geometricConstraints = [
        { id: 'pin', type: 'fix', refs: [{ entityId: 'a', point: 'start' }], values: [0, 0] },
        { id: 'horizontal', type: 'horizontal', refs: [{ entityId: 'a' }] },
    ];
    content.parameters = [{ name: 'width', expression: '250cm', type: 'distance' }];
    content.dimensionalConstraints = [dimension('d1', 'aligned', 'width * 2', [{ entityId: 'a' }])];
    const solved = solve(content);
    assert.ok(Math.abs(solved.entities[0].x2 - 5) < 1e-7);
    const changed = { ...solved, parameters: [{ name: 'width', expression: '4m', type: 'distance' }] };
    assert.ok(Math.abs(solve(changed).entities[0].x2 - 8) < 1e-7);
});

test('signed linear distance supports native segments and point references without switching sides', () => {
    for (const axis of ['x', 'y']) {
        const content = fixture([line('a', 0, 0, -3, -4)]);
        content.dimensionalConstraints = [dimension('d1', 'linear', '2', [{ entityId: 'a' }], { axis, direction: -1 })];
        solve(content);
    }
    const content = fixture([{ id: 'a', type: 'point', x: 1, y: 2 }, { id: 'b', type: 'point', x: 3, y: 4 }]);
    content.dimensionalConstraints = [dimension('d1', 'aligned', '5', [{ entityId: 'a', point: 'node' }, { entityId: 'b', point: 'node' }])];
    solve(content);
});

test('directed angular dimensions retain acute, obtuse and reflex branches with a locked reference', () => {
    for (const angle of [30, 120, 270]) {
        const content = fixture([{ ...line('a', 0, 0, 4, 0), locked: true }, line('b', 0, 0, 2, 2)]);
        content.dimensionalConstraints = [dimension('d1', 'angular', `${angle}deg`, [{ entityId: 'a' }, { entityId: 'b' }])];
        const solved = solve(content);
        assert.deepEqual(solved.entities[0], content.entities[0]);
    }
});

test('radius and diameter dimensions share named drivers and geometric equal-radius constraints', () => {
    const content = fixture([{ id: 'a', type: 'circle', cx: 0, cy: 0, r: 2 }, { id: 'b', type: 'circle', cx: 10, cy: 0, r: 1 }]);
    content.geometricConstraints = [{ id: 'equal', type: 'equal', refs: [{ entityId: 'a' }, { entityId: 'b' }] }];
    content.dimensionalConstraints = [dimension('r1', 'radius', '3m', [{ entityId: 'a' }]),
        dimension('dia', 'diameter', 'r1 * 2', [{ entityId: 'b' }])];
    const solved = solve(content);
    assert.ok(solved.entities.every(entity => Math.abs(entity.r - 3) < 1e-7));
});

test('validation preserves unsatisfied saved geometry while conflicting solves and graphs are atomic', () => {
    const content = fixture([line('a', 0, 0, 3, 0)]);
    content.dimensionalConstraints = [dimension('d1', 'aligned', '5', [{ entityId: 'a' }])];
    const saved = structuredClone(content);
    assert.ok(!normalizeDrawingDimensionalConstraints(content.dimensionalConstraints, content.entities).error);
    assert.deepEqual(content, saved);
    content.geometricConstraints = [{ id: 'fixed', type: 'fix', refs: [{ entityId: 'a' }], values: [0, 0, 3, 0] }];
    const conflict = solveDrawingDimensionalConstraints(content);
    assert.equal(conflict.error, 'conflict'); assert.equal(conflict.content, undefined);
    content.parameters = [{ name: 'width', expression: 'd1' }];
    content.dimensionalConstraints[0].expression = 'width';
    assert.equal(solveDrawingDimensionalConstraints(content).error, 'cycle');
    content.parameters = []; content.dimensionalConstraints[0].expression = '-1';
    assert.equal(solveDrawingDimensionalConstraints(content).error, 'definition');
});


test('dimensional definitions and parameters round-trip without silently solving or accepting invalid catalogs', () => {
    const content = fixture([line('a', 0, 0, 3, 0)]);
    content.parameters = [{ name: 'width', expression: '5m', type: 'distance' }];
    content.dimensionalConstraints = [dimension('d1', 'aligned', 'width', [{ entityId: 'a' }])];
    const document = { ...createLcadDocument(), content: normalizeDrawingContent(content) };
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(loaded.content.dimensionalConstraints, content.dimensionalConstraints);
    assert.deepEqual(loaded.content.parameters, content.parameters);
    assert.equal(loaded.content.entities[0].x2, 3);
    assert.throws(() => normalizeDrawingContent({ ...content, parameters: [{ name: 'width', expression: 'd1' }] }));
    assert.throws(() => normalizeDrawingContent({ ...content, dimensionalConstraints: null }));
    assert.equal(normalizeDrawingContent(fixture([])).dimensionalConstraints, undefined);
    assert.equal(normalizeDrawingContent(fixture([])).parameters, undefined);
});

test('history jointly enforces dimensional and geometric relations and rejects conflicts without damaging redo', () => {
    const content = fixture([line('a', 0, 0, 4, 0)]);
    content.parameters = [{ name: 'width', type: 'distance', expression: '4' }];
    content.dimensionalConstraints = [dimension('d1', 'aligned', 'width', [{ entityId: 'a' }])];
    content.geometricConstraints = [{ id: 'pin', type: 'fix', refs: [{ entityId: 'a', point: 'start' }], values: [0, 0] },
        { id: 'horizontal', type: 'horizontal', refs: [{ entityId: 'a' }] }];
    const current = { past: [], present: content, future: [] };
    const proposed = { ...content, parameters: [{ name: 'width', type: 'distance', expression: '6' }] };
    const changed = commitDrawingHistoryState(current, proposed);
    assert.equal(changed.rejection, null);
    assert.ok(Math.abs(changed.present.entities[0].x2 - 6) < 1e-7);
    assert.deepEqual(changed.past, [content]);
    assert.deepEqual(redoDrawingHistoryState({ past: [], present: content, future: [changed.present] }).present, changed.present);
    const moved = structuredClone(changed.present); moved.entities[0].x2 = 8;
    const rejected = commitDrawingHistoryState(changed, moved);
    assert.equal(rejected.rejection.code, 'conflict');
    assert.equal(rejected.present, changed.present); assert.equal(rejected.past, changed.past); assert.equal(rejected.future, changed.future);
});

test('ordinary geometry edits propagate dimensions while unrelated styling does not solve archived geometry', () => {
    const content = fixture([line('a', 0, 0, 4, 0)]);
    content.dimensionalConstraints = [dimension('d1', 'aligned', '4', [{ entityId: 'a' }])];
    const moved = structuredClone(content); moved.entities[0].x2 = 6;
    const result = prepareDrawingConstraintEdit(content, moved);
    assert.ok(!result.error); assert.equal(result.content.entities[0].x2, 6);
    assert.ok(Math.abs(result.content.entities[0].x1 - 2) < 1e-7);
    const unsatisfied = { ...content, dimensionalConstraints: [dimension('d1', 'aligned', '10', [{ entityId: 'a' }])] };
    const styled = { ...unsatisfied, entities: [{ ...unsatisfied.entities[0], color: '#abcdef' }] };
    assert.equal(prepareDrawingConstraintEdit(unsatisfied, styled).content, styled);
    const deleted = prepareDrawingConstraintEdit(content, { ...content, entities: [] });
    assert.deepEqual(deleted.content.dimensionalConstraints, []);
    assert.equal(prepareDrawingConstraintEdit(content, { ...content, dimensionalConstraints: null }).error, 'definition');
});


test('BEDIT isolates model dimensions and parameters from the local definition draft', () => {
    const content = fixture([line('a', 0, 0, 4, 0)]);
    content.parameters = [{ name: 'width', type: 'distance', expression: '4' }];
    content.dimensionalConstraints = [dimension('d1', 'aligned', 'width', [{ entityId: 'a' }])];
    content.blocks = [{ id: 'block', name: 'Local', entities: [{ ...line('local', 10, 0, 12, 0), layerId: content.activeLayerId }] }];
    const draft = createDrawingBlockEditDraft(content, 'Local');
    assert.deepEqual(draft.content.dimensionalConstraints, []);
    assert.deepEqual(draft.content.parameters, []);
    const saved = saveDrawingBlockEdit(content, 'block', draft.content);
    assert.deepEqual(saved.content.dimensionalConstraints, content.dimensionalConstraints);
    assert.deepEqual(saved.content.parameters, content.parameters);
});
