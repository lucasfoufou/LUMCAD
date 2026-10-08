import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { runDrawingDimensionalCommand } from './drawingDimensionalCommands.js';
import { normalizeDrawingDimensionalConstraints, drawingDimensionalConstraintResiduals } from './drawingDimensionalConstraints.js';

const line = (id, x1 = 0, y1 = 0, x2 = 3, y2 = 0) => ({ id, type: 'line', x1, y1, x2, y2 });
function fixture(entities = [line('a')]) {
    const content = createDefaultDrawingContent();
    return { ...content, entities: entities.map(entity => ({ ...entity, layerId: content.activeLayerId })) };
}
function run(content, command, input, selection = []) {
    const saved = structuredClone(content);
    const result = runDrawingDimensionalCommand(content, command, input, selection);
    assert.ok(!result.error, JSON.stringify(result));
    assert.deepEqual(content, saved);
    return result.content;
}
function satisfied(content) {
    const normalized = normalizeDrawingDimensionalConstraints(content.dimensionalConstraints, content.entities, content.parameters);
    const map = new Map(content.entities.map(entity => [entity.id, entity]));
    for (const item of normalized.constraints) assert.ok(drawingDimensionalConstraintResiduals(item, map, normalized.values[item.name]).every(value => Math.abs(value) < 1e-7));
}

test('PARAMETERS and driving commands author, report and update geometry without mutating the source', () => {
    const content = fixture();
    content.geometricConstraints = [{ id: 'pin', type: 'fix', refs: [{ entityId: 'a', point: 'start' }], values: [0, 0] }];
    const parameterized = run(content, 'parameters', 'SET Width distance "2m"');
    const driven = run(parameterized, 'dcAligned', 'length "width * 2"', ['a']);
    assert.ok(Math.abs(driven.entities[0].x2 - 4) < 1e-7);
    const changed = run(driven, 'parameters', 'SET WIDTH distance "3m"');
    assert.ok(Math.abs(changed.entities[0].x2 - 6) < 1e-7);
    const report = runDrawingDimensionalCommand(changed, 'parameters', 'LIST');
    assert.equal(JSON.parse(report.report).dimensions[0].value, 6);
    assert.equal(runDrawingDimensionalCommand(changed, 'parameters', 'SET width distance "3m"').changed, false);
    const edited = run(changed, 'dimConstraint', 'SET LENGTH "width + 5"');
    assert.ok(Math.abs(edited.entities[0].x2 - 8) < 1e-7);
    assert.equal(edited.dimensionalConstraints[0].id, driven.dimensionalConstraints[0].id);
});

test('all direct dimensional commands and generic dispatch accept shared native references', () => {
    const cases = [
        ['dcLinear', 'dx "2m" X 1', [line('a', 0, 0, -3, 1)]],
        ['dimConstraint', 'aligned span "5m" 1@start 2@end', [line('a'), line('b', 10, 1, 12, 2)]],
        ['dcAngular', 'angle "120deg" 1 2', [line('a'), line('b', 0, 0, 2, 2)]],
        ['dcRadius', 'radius "3m" 1', [{ id: 'a', type: 'circle', cx: 0, cy: 0, r: 1 }]],
        ['dcDiameter', 'diameter "6m" 1', [{ id: 'a', type: 'arc', cx: 0, cy: 0, r: 1, startAngle: 0, endAngle: 1 }]],
    ];
    for (const [command, input, entities] of cases) {
        const content = run(fixture(entities), command, input, entities.map(entity => entity.id));
        satisfied(content);
        if (command === 'dcLinear') assert.equal(content.dimensionalConstraints[0].direction, -1);
    }
});

test('parameter deletion, dimensional deletion and formula cycles preserve dependent definitions atomically', () => {
    const parameterized = run(fixture(), 'parameters', 'SET width distance 4');
    const driven = run(parameterized, 'dcAligned', 'd1 width', ['a']);
    const saved = structuredClone(driven);
    assert.equal(runDrawingDimensionalCommand(driven, 'parameters', 'DELETE width').error, 'unknown');
    assert.equal(runDrawingDimensionalCommand(driven, 'parameters', 'SET width distance d1').error, 'cycle');
    assert.equal(runDrawingDimensionalCommand(driven, 'dcAligned', 'width 5', ['a']).error, 'duplicate');
    assert.deepEqual(driven, saved);
    const removed = run(driven, 'dimConstraint', 'DELETE SELECTED', ['a']);
    assert.deepEqual(removed.dimensionalConstraints, []);
    assert.deepEqual(run(removed, 'parameters', 'DELETE WIDTH').parameters, []);
});

test('named driving dimensions participate in the shared dependency graph', () => {
    const content = fixture([line('a'), line('b', 10, 0, 12, 0)]);
    const first = run(content, 'dcAligned', 'd1 4', ['a']);
    const second = run(first, 'dcAligned', 'd2 "d1 * 2"', ['b']);
    const changed = run(second, 'dimConstraint', 'SET d1 5');
    satisfied(changed);
    assert.equal(normalizeDrawingDimensionalConstraints(changed.dimensionalConstraints, changed.entities).values.d2, 10);
    assert.equal(runDrawingDimensionalCommand(changed, 'dimConstraint', 'DELETE d1').error, 'unknown');
});

test('invalid syntax and incompatible fixed geometry cannot produce a partial command result', () => {
    const content = fixture();
    content.geometricConstraints = [{ id: 'pin', type: 'fix', refs: [{ entityId: 'a' }], values: [0, 0, 3, 0] }];
    const saved = structuredClone(content);
    assert.equal(runDrawingDimensionalCommand(content, 'dcAligned', 'd1 5', ['a']).error, 'conflict');
    for (const [command, input] of [['dcLinear', 'd1 5'], ['parameters', 'SET width 5'], ['dimConstraint', 'SET d1'], ['parameters', 'LIST unexpected']]) {
        assert.equal(runDrawingDimensionalCommand(content, command, input, ['a']).error, 'syntax');
    }
    assert.equal(runDrawingDimensionalCommand(content, 'dcAligned', 'd1 5', ['missing']).error, 'selection');
    assert.deepEqual(content, saved);
});
