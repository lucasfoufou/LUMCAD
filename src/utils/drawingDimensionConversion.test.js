import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { runDrawingDimensionalCommand } from './drawingDimensionalCommands.js';
import { getDimensionGeometry } from './drawingDimensions.js';
import { prepareDrawingConstraintEdit } from './drawingConstraintEditing.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const line = (id, x1, y1, x2, y2) => ({ id, type: 'line', x1, y1, x2, y2 });
function fixture(entities) {
    const content = createDefaultDrawingContent();
    return normalizeDrawingContent({ ...content, entities: entities.map(entity => ({ layerId: content.activeLayerId, ...entity })) });
}
function convert(content, ids, prefix = '') {
    const saved = structuredClone(content);
    const result = runDrawingDimensionalCommand(content, 'dcConvert', prefix, ids);
    assert.ok(!result.error, JSON.stringify(result));
    assert.deepEqual(content, saved);
    assert.deepEqual(result.content.entities, content.entities);
    return result.content;
}
function measurement(content, id) {
    return getDimensionGeometry(content.entities.find(entity => entity.id === id), new Map(content.entities.map(entity => [entity.id, entity])));
}

test('DCCONVERT preserves associated linear annotations and their exact aligned/projected/rotated measurement', () => {
    for (const mode of ['aligned', 'horizontal', 'vertical', 'rotated']) {
        const content = fixture([line('edge', 0, 0, 4, 3), { id: 'dim', type: 'linearDimension', sourceId: 'edge',
            measurementMode: mode, dimensionAngle: Math.PI / 6, offset: 2, color: '#abcdef', dimensionTextOverride: '<> wide' }]);
        const converted = convert(content, ['dim']);
        assert.equal(converted.dimensionalConstraints[0].dimensionId, 'dim');
        const target = measurement(content, 'dim').value * 1.5;
        const changed = runDrawingDimensionalCommand(converted, 'dimConstraint', `SET d1 ${target}`);
        assert.ok(!changed.error, JSON.stringify(changed));
        assert.ok(Math.abs(measurement(changed.content, 'dim').value - target) < 1e-7);
        assert.deepEqual(changed.content.entities.find(entity => entity.id === 'dim'), content.entities.find(entity => entity.id === 'dim'));
    }
});

test('converted radial and diameter drivers retain their original display mode and arc geometry', () => {
    for (const mode of ['radius', 'diameter', 'joggedRadius']) {
        const content = fixture([{ id: 'circle', type: 'circle', cx: 5, cy: 6, r: 2 },
            { id: 'dim', type: 'radialDimension', sourceId: 'circle', mode, angle: 0.5, leaderScale: 1.8 }]);
        const converted = convert(content, ['dim'], 'radius');
        const changed = runDrawingDimensionalCommand(converted, 'dimConstraint', 'SET radius1 6');
        assert.ok(!changed.error, JSON.stringify(changed));
        assert.ok(Math.abs(measurement(changed.content, 'dim').value - 6) < 1e-7);
        assert.ok(Math.abs(changed.content.entities[0].r - (mode === 'diameter' ? 3 : 6)) < 1e-7);
    }
});

test('converted angular drivers use the annotation rays and reflex branch including circular arcs', () => {
    for (const reflex of [false, true]) {
        const content = fixture([line('a', 0, 0, 4, 0), line('b', 0, 0, 2, 3),
            { id: 'dim', type: 'angularDimension', sourceIds: ['a', 'b'], sourcePickPoints: [{ x: -2, y: 0 }, { x: 2, y: 3 }], reflex }]);
        const converted = convert(content, ['dim']);
        const target = reflex ? 240 : 120;
        const changed = runDrawingDimensionalCommand(converted, 'dimConstraint', `SET d1 ${target}`);
        assert.ok(!changed.error, JSON.stringify(changed));
        assert.ok(Math.abs(measurement(changed.content, 'dim').value * 180 / Math.PI - target) < 1e-5);
    }
    const arc = fixture([{ id: 'arc', type: 'arc', cx: 0, cy: 0, r: 3, startAngle: 0, endAngle: 1 },
        { id: 'dim', type: 'angularDimension', sourceId: 'arc' }]);
    const converted = convert(arc, ['dim']);
    const changed = runDrawingDimensionalCommand(converted, 'dimConstraint', 'SET d1 80');
    assert.ok(!changed.error, JSON.stringify(changed));
    assert.ok(Math.abs(measurement(changed.content, 'dim').value * 180 / Math.PI - 80) < 1e-5);
});

test('conversion is idempotent, persists annotation links and rejects a detached member of a batch', () => {
    const content = fixture([line('edge', 0, 0, 4, 0),
        { id: 'dim', type: 'linearDimension', sourceId: 'edge' },
        { id: 'detached', type: 'linearDimension', p1: { x: 0, y: 0 }, p2: { x: 3, y: 0 } }]);
    const rejected = runDrawingDimensionalCommand(content, 'dcConvert', '', ['dim', 'detached']);
    assert.equal(rejected.error, 'selection'); assert.equal(rejected.content, undefined);
    const converted = convert(content, ['dim']);
    assert.equal(runDrawingDimensionalCommand(converted, 'dcConvert', '', ['dim']).changed, false);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope({ ...createLcadDocument(), content: converted }))).document;
    assert.deepEqual(loaded.content.dimensionalConstraints, converted.dimensionalConstraints);
    const undriven = runDrawingDimensionalCommand(converted, 'dimConstraint', 'DELETE SELECTED', ['dim']);
    assert.ok(!undriven.error, undriven.error);
    assert.deepEqual(undriven.content.dimensionalConstraints, []);
    assert.deepEqual(undriven.content.entities, converted.entities);
    const removed = prepareDrawingConstraintEdit(converted, { ...converted, entities: converted.entities.filter(entity => entity.id !== 'dim') });
    assert.deepEqual(removed.content.dimensionalConstraints, []);
    const orphan = structuredClone(converted); orphan.dimensionalConstraints[0].dimensionId = 'missing';
    assert.throws(() => normalizeDrawingContent(orphan));
});

test('projection edits enforce the linked driver while appearance edits retain archived geometry', () => {
    const content = fixture([line('edge', 0, 0, 4, 3),
        { id: 'dim', type: 'linearDimension', sourceId: 'edge', measurementMode: 'rotated', dimensionAngle: 0.3 }]);
    const converted = convert(content, ['dim']);
    const target = measurement(converted, 'dim').value;
    const proposed = structuredClone(converted); proposed.entities[1].dimensionAngle = 0.7;
    const result = prepareDrawingConstraintEdit(converted, proposed);
    assert.ok(!result.error, JSON.stringify(result));
    assert.ok(Math.abs(measurement(result.content, 'dim').value - target) < 1e-7);
    assert.equal(result.content.entities[1].dimensionAngle, 0.7);
    const styled = structuredClone(converted); styled.entities[1].offset = 7; styled.entities[1].color = '#abcdef';
    assert.equal(prepareDrawingConstraintEdit(converted, styled).content, styled);
});

test('ellipse-axis and explicit associative point measurements stay linked after conversion', () => {
    const cases = [
        fixture([{ id: 'ellipse', type: 'ellipse', cx: 0, cy: 0, rx: 2, ry: 1, rotation: 20, fullEllipse: true },
            { id: 'dim', type: 'linearDimension', sourceId: 'ellipse', edgeIndex: 0, measurementMode: 'aligned' }]),
        fixture([line('a', 0, 0, 3, 0), line('b', 5, 1, 7, 1),
            { id: 'dim', type: 'linearDimension', measurementMode: 'aligned', sourcePointReferences: [
                { sourceId: 'a', endpointIndex: 1 }, { sourceId: 'b', endpointIndex: 0 }] }]),
    ];
    for (const content of cases) {
        const converted = convert(content, ['dim']);
        const changed = runDrawingDimensionalCommand(converted, 'dimConstraint', 'SET d1 10');
        assert.ok(!changed.error, JSON.stringify(changed));
        assert.ok(Math.abs(measurement(changed.content, 'dim').value - 10) < 1e-7);
    }
});
