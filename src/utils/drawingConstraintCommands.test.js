import test from 'node:test';
import assert from 'node:assert/strict';
import { runDrawingConstraintCommand } from './drawingConstraintCommands.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { commitDrawingHistoryState } from './drawingHistory.js';

function fixture() {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'edge-a', type: 'line', layerId: content.activeLayerId, x1: 0, y1: 0, x2: 4, y2: 0.5 },
        { id: 'edge-b', type: 'line', layerId: content.activeLayerId, x1: 4, y1: 1, x2: 5, y2: 3 }];
    return content;
}

test('named and generic authoring persist a solved relation through the real history path', () => {
    for (const [command, input] of [['gcHorizontal', ''], ['geomConstraint', 'HORIZONTAL']]) {
        const content = fixture();
        const result = runDrawingConstraintCommand(content, command, input, ['edge-a']);
        assert.ok(!result.error, JSON.stringify(result));
        const state = { past: [], present: content, future: [], coalesceKey: null };
        const committed = commitDrawingHistoryState(state, result.content);
        assert.equal(committed.rejection, null);
        assert.equal(committed.present.geometricConstraints.length, 1);
        assert.ok(Math.abs(committed.present.entities[0].y1 - committed.present.entities[0].y2) < 1e-7);
        assert.equal(committed.past[0], content);
        assert.equal(content.geometricConstraints, undefined);
    }
});

test('point references support explicit IDs and selection indices without changing reference identity', () => {
    for (const input of ['1@end 2@start', '"edge-a@end" "edge-b@start"']) {
        const result = runDrawingConstraintCommand(fixture(), 'gcCoincident', input, ['edge-a', 'edge-b']);
        assert.ok(!result.error, JSON.stringify(result));
        assert.deepEqual(result.content.geometricConstraints[0].refs, [{ entityId: 'edge-a', point: 'end' }, { entityId: 'edge-b', point: 'start' }]);
    }
});

test('fix snapshots all selected objects and refuses a contradictory relation atomically', () => {
    const content = fixture();
    const fixed = runDrawingConstraintCommand(content, 'gcFix', '', ['edge-a', 'edge-b']);
    assert.equal(fixed.count, 2);
    assert.equal(fixed.changed, true);
    assert.deepEqual(fixed.content.geometricConstraints[0].values, [0, 0, 4, 0.5]);
    const saved = structuredClone(fixed.content);
    const impossible = runDrawingConstraintCommand(fixed.content, 'gcHorizontal', '', ['edge-a']);
    assert.ok(impossible.error); assert.equal(impossible.content, undefined);
    assert.deepEqual(fixed.content, saved);
});

test('an already satisfied relation still commits its catalog entry without moving points', () => {
    const content = fixture(); content.entities[0].y2 = 0;
    const result = runDrawingConstraintCommand(content, 'gcHorizontal', '', ['edge-a']);
    assert.equal(result.changed, true);
    assert.deepEqual(result.content.entities, content.entities);
    const state = { past: [], present: content, future: [], coalesceKey: null };
    const next = commitDrawingHistoryState(state, result.content);
    assert.equal(next.present.geometricConstraints.length, 1);
    assert.equal(next.past[0], content);
});

test('list is read-only and deletion retains geometry while removing only requested relations', () => {
    const content = runDrawingConstraintCommand(fixture(), 'gcFix', '', ['edge-a', 'edge-b']).content;
    const report = runDrawingConstraintCommand(content, 'geomConstraint', 'LIST');
    assert.deepEqual(JSON.parse(report.report), content.geometricConstraints);
    assert.equal(report.content, undefined);
    const selected = runDrawingConstraintCommand(content, 'geomConstraint', 'DELETE SELECTED', ['edge-a']);
    assert.equal(selected.count, 1); assert.equal(selected.content.entities, content.entities);
    assert.equal(selected.content.geometricConstraints[0].refs[0].entityId, 'edge-b');
    const one = runDrawingConstraintCommand(content, 'geomConstraint', `DELETE ${content.geometricConstraints[0].id}`);
    assert.deepEqual(one.content.geometricConstraints, selected.content.geometricConstraints);
    const all = runDrawingConstraintCommand(content, 'geomConstraint', 'DELETE ALL');
    assert.equal(all.count, 2); assert.deepEqual(all.content.geometricConstraints, []);
});

test('malformed commands and incompatible selectors do not produce partial content', () => {
    const content = fixture();
    for (const [command, input, selected] of [['gcCoincident', '', ['edge-a', 'edge-b']],
        ['gcFix', '3@end', ['edge-a']], ['gcFix', '1@999:', ['edge-a']],
        ['geomConstraint', 'DELETE nonexistent', []], ['geomConstraint', 'LIST extra', []],
        ['geomConstraint', 'unknown', ['edge-a']], ['gcHorizontal', '"unclosed', []]]) {
        const result = runDrawingConstraintCommand(content, command, input, selected);
        assert.ok(result.error); assert.equal(result.content, undefined);
    }
});
