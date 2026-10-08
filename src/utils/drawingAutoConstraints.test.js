import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDrawingAutoConstraints, applyDrawingAutoConstraints } from './drawingAutoConstraints.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { runDrawingConstraintCommand } from './drawingConstraintCommands.js';
import { drawingGeometricConstraintResiduals } from './drawingGeometricConstraints.js';
import { commitDrawingHistoryState, undoDrawingHistoryState, redoDrawingHistoryState } from './drawingHistory.js';

function fixture(entities) {
    const content = createDefaultDrawingContent();
    content.entities = entities.map(entity => ({ layerId: content.activeLayerId, ...entity }));
    return content;
}
const line = (id, x1, y1, x2, y2) => ({ id, type: 'line', x1, y1, x2, y2 });

test('automatic detection is read-only, tolerance-sensitive and excludes unselected geometry', () => {
    const content = fixture([line('a', 0, 0, 4, 0.001), line('b', 4, 0.00101, 4, 3), line('c', 20, 0, 24, 0)]);
    const saved = structuredClone(content);
    const result = detectDrawingAutoConstraints(content, ['a', 'b']);
    assert.ok(result.candidates.some(item => item.type === 'horizontal'));
    assert.ok(result.candidates.some(item => item.type === 'vertical'));
    assert.ok(result.candidates.some(item => item.type === 'coincident'));
    assert.ok(result.candidates.some(item => item.type === 'perpendicular'));
    assert.ok(result.candidates.every(item => item.refs.every(ref => ref.entityId !== 'c')));
    assert.deepEqual(detectDrawingAutoConstraints(content, ['a', 'b'], { types: ['coincident'], tolerance: 1e-7 }).candidates, []);
    assert.deepEqual(content, saved);
});

test('automatic solve is one reversible history edit and repeated detection adds nothing', () => {
    const content = fixture([line('a', 0, 0, 4, 0.001), line('b', 4, 0.00101, 4, 3)]);
    const result = applyDrawingAutoConstraints(content, ['a', 'b']);
    assert.ok(!result.error, JSON.stringify(result));
    assert.ok(result.count >= 4);
    const entities = new Map(result.content.entities.map(entity => [entity.id, entity]));
    for (const constraint of result.content.geometricConstraints) {
        assert.ok(drawingGeometricConstraintResiduals(constraint, entities).every(value => Math.abs(value) < 1e-7));
    }
    const state = commitDrawingHistoryState({ past: [], present: content, future: [], coalesceKey: null }, result.content);
    assert.equal(state.rejection, null);
    assert.deepEqual(undoDrawingHistoryState(state).present, content);
    assert.deepEqual(redoDrawingHistoryState(undoDrawingHistoryState(state)).present, state.present);
    assert.equal(applyDrawingAutoConstraints(result.content, ['b', 'a']).count, 0);
});

test('finite line tangency excludes remote extensions and recognizes both circle branches', () => {
    const content = fixture([line('a', 0, 0, 4, 0),
        { id: 'c', type: 'circle', cx: 2, cy: 1, r: 1 },
        { id: 'remote', type: 'circle', cx: 20, cy: 1, r: 1 }]);
    const result = detectDrawingAutoConstraints(content, ['a', 'c', 'remote'], { types: ['tangent'] });
    assert.equal(result.candidates.length, 1);
    assert.deepEqual(result.candidates[0].refs, [{ entityId: 'a' }, { entityId: 'c' }]);
    for (const [distance, internal] of [[3, false], [1, true]]) {
        const circles = fixture([{ id: 'a', type: 'circle', cx: 0, cy: 0, r: 2 }, { id: 'b', type: 'circle', cx: distance, cy: 0, r: 1 }]);
        const detected = detectDrawingAutoConstraints(circles, ['a', 'b'], { types: ['tangent'] });
        assert.equal(detected.candidates.length, 1);
        assert.equal(Boolean(detected.candidates[0].internal), internal);
    }
});

test('fixed geometry conflicts reject automatic solving without partial catalog or coordinate edits', () => {
    const content = fixture([line('a', 0, 0, 4, 0.001)]);
    const fixed = runDrawingConstraintCommand(content, 'gcFix', '', ['a']).content;
    const saved = structuredClone(fixed);
    const result = applyDrawingAutoConstraints(fixed, ['a']);
    assert.ok(result.error);
    assert.equal(result.content, undefined);
    assert.deepEqual(fixed, saved);
});

test('smooth candidates require matching curvature as well as a shared tangent', () => {
    const first = { id: 'a', type: 'spline', controlPoints: [{ x: -3, y: 0 }, { x: -2, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 0 }] };
    const second = { id: 'b', type: 'spline', controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] };
    const straight = fixture([first, second]);
    assert.equal(detectDrawingAutoConstraints(straight, ['a', 'b'], { types: ['smooth'] }).candidates.length, 1);
    second.controlPoints[2].y = 1;
    const curved = fixture([first, second]);
    const proposed = detectDrawingAutoConstraints(curved, ['a', 'b'], { types: ['tangent', 'smooth'] }).candidates;
    assert.deepEqual(proposed.map(item => item.type), ['tangent']);
});

test('circle center coincidence, concentricity and radius equality remain distinct relations', () => {
    const content = fixture([{ id: 'a', type: 'circle', cx: 0, cy: 0, r: 1 },
        { id: 'b', type: 'circle', cx: 0.00001, cy: 0, r: 1.00001 }]);
    const result = detectDrawingAutoConstraints(content, ['a', 'b']);
    assert.deepEqual(result.candidates.map(item => item.type), ['coincident', 'concentric', 'equal']);
    const applied = applyDrawingAutoConstraints(content, ['a', 'b']);
    assert.ok(!applied.error, JSON.stringify(applied));
    const [a, b] = applied.content.entities;
    assert.ok(Math.hypot(a.cx - b.cx, a.cy - b.cy) < 1e-7);
    assert.ok(Math.abs(a.r - b.r) < 1e-7);
});

test('candidate and selection budgets return no truncated proposal list', () => {
    const content = fixture(Array.from({ length: 65 }, (_, index) => line(`e${index}`, index * 10, 0, index * 10 + 1, 0)));
    assert.deepEqual(detectDrawingAutoConstraints(content, content.entities.map(entity => entity.id)), { error: 'limit' });
    const crowded = fixture(Array.from({ length: 24 }, (_, index) => line(`e${index}`, index * 10, 0, index * 10 + 1, 0)));
    assert.deepEqual(detectDrawingAutoConstraints(crowded, crowded.entities.map(entity => entity.id)), { error: 'limit' });
    assert.equal(crowded.geometricConstraints, undefined);
});

test('automatic command preview, explicit options and malformed inputs share validation', () => {
    const content = fixture([line('a', 0, 0, 4, 0.001)]);
    const report = runDrawingConstraintCommand(content, 'autoConstrain', 'PREVIEW ANGLE 1 TOLERANCE 0.001 TYPES horizontal', ['a']);
    assert.equal(JSON.parse(report.report).length, 1);
    assert.equal(report.content, undefined);
    assert.equal(runDrawingConstraintCommand(content, 'autoConstrain', 'TYPES vertical', ['a']).changed, false);
    for (const input of ['ANGLE', 'ANGLE 0', 'TOLERANCE NaN', 'TYPES fix', 'PREVIEW PREVIEW', 'ANGLE 1 ANGLE 2', 'UNKNOWN']) {
        assert.ok(runDrawingConstraintCommand(content, 'autoConstrain', input, ['a']).error, input);
    }
    assert.equal(detectDrawingAutoConstraints(content, []).error, 'selection');
    assert.equal(detectDrawingAutoConstraints(content, ['a', 'a']).error, 'selection');
    assert.equal(detectDrawingAutoConstraints(content, ['missing']).error, 'unsupported');
});
