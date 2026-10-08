import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent, copySelectedEntities } from './drawingDocument.js';
import { copyDrawingSelectionToLayer } from './drawingPropertyCommands.js';
import { getDimensionGeometry } from './drawingDimensions.js';
import { createDrawingClipboardPayload, pasteDrawingClipboardPayload, validateDrawingClipboardPayload } from './drawingClipboard.js';
import { collectDrawingDimensionalCatalog } from './drawingDimensionalTransfer.js';
import { runDrawingDimensionalCommand } from './drawingDimensionalCommands.js';
import { normalizeDrawingDimensionalConstraints, drawingDimensionalConstraintResiduals } from './drawingDimensionalConstraints.js';

function fixture() {
    const content = createDefaultDrawingContent();
    content.entities = ['a', 'b'].map((id, index) => ({ id, type: 'line', layerId: content.activeLayerId,
        x1: 0, y1: index * 5, x2: 4, y2: index * 5 }));
    content.parameters = [{ name: 'width', type: 'distance', expression: '4m' }, { name: 'unused', type: 'number', expression: '7' }];
    content.dimensionalConstraints = [
        { id: 'da', name: 'length_a', type: 'aligned', expression: 'length_b', refs: [{ entityId: 'a' }] },
        { id: 'db', name: 'length_b', type: 'aligned', expression: 'width', refs: [{ entityId: 'b' }] },
    ];
    return content;
}

test('dimensional clipboard captures formula closure without unselected geometry or unused parameters', () => {
    const source = fixture(); const saved = structuredClone(source);
    const catalog = collectDrawingDimensionalCatalog(source, ['a']);
    assert.deepEqual(catalog.parameters.map(item => item.name), ['width', 'length_b']);
    assert.equal(catalog.dimensionalConstraints.length, 1);
    const payload = createDrawingClipboardPayload(source, ['a']);
    assert.deepEqual(payload.entities.map(item => item.id), ['a']);
    const result = pasteDrawingClipboardPayload(createDefaultDrawingContent(), payload, { insertionPoint: { x: 20, y: 30 } });
    const updated = runDrawingDimensionalCommand(result.content, 'parameters', 'SET width distance 8m', []);
    assert.ok(!updated.error, updated.error);
    assert.ok(Math.abs(Math.hypot(updated.content.entities[0].x2 - updated.content.entities[0].x1,
        updated.content.entities[0].y2 - updated.content.entities[0].y1) - 8) < 1e-7);
    assert.deepEqual(source, saved);
    assert.equal(normalizeDrawingContent(result.content).dimensionalConstraints.length, 1);
});

test('same-drawing paste renames a dependent graph and preserves independent edits', () => {
    const source = fixture();
    const result = pasteDrawingClipboardPayload(source, createDrawingClipboardPayload(source, ['a', 'b']));
    assert.deepEqual(result.content.parameters.map(item => item.name), ['width', 'unused', 'width_2']);
    assert.deepEqual(result.content.dimensionalConstraints.slice(2).map(item => [item.name, item.expression]),
        [['length_a_2', 'length_b_2'], ['length_b_2', 'width_2']]);
    const updated = runDrawingDimensionalCommand(result.content, 'parameters', 'SET width_2 distance 9m', []);
    assert.ok(!updated.error, updated.error);
    assert.deepEqual(updated.content.entities.slice(0, 2), source.entities);
    const graph = normalizeDrawingDimensionalConstraints(updated.content.dimensionalConstraints, updated.content.entities, updated.content.parameters);
    const map = new Map(updated.content.entities.map(item => [item.id, item]));
    for (const item of graph.constraints) assert.ok(drawingDimensionalConstraintResiduals(item, map, graph.values[item.name]).every(value => Math.abs(value) < 1e-7));
});

test('dimensional clipboard rejects malformed graph and cross-catalog ID collisions atomically', () => {
    const source = fixture(); const payload = createDrawingClipboardPayload(source, ['a']);
    assert.throws(() => validateDrawingClipboardPayload({ ...payload, parameters: [] }));
    assert.throws(() => validateDrawingClipboardPayload({ ...payload,
        geometricConstraints: [{ id: 'da', type: 'horizontal', refs: [{ entityId: 'a' }] }] }));
    const bad = structuredClone(payload); bad.dimensionalConstraints[0].refs[0].entityId = 'missing';
    assert.throws(() => pasteDrawingClipboardPayload(source, bad));
    assert.equal(source.entities.length, 2);
});

test('COPY and clipboard retain converted annotation links and independently editable measurements', () => {
    const raw = fixture(); raw.dimensionalConstraints = [];
    raw.entities.push({ id: 'annotation', type: 'linearDimension', layerId: raw.activeLayerId,
        sourceId: 'a', measurementMode: 'rotated', dimensionAngle: Math.PI / 6, offset: 2 });
    const source = runDrawingDimensionalCommand(normalizeDrawingContent(raw), 'dcConvert', '', ['annotation']).content;
    assert.ok(source);
    for (const copy of [
        () => pasteDrawingClipboardPayload(source, createDrawingClipboardPayload(source, ['a'])),
        () => copySelectedEntities(source, ['a'], { x: 20, y: -10 }),
        () => copyDrawingSelectionToLayer(source, ['a'], source.activeLayerId),
    ]) {
        const result = copy(); assert.ok(!result.error, result.error);
        assert.equal(result.entities.length, 2);
        const driver = result.content.dimensionalConstraints[1];
        const annotation = result.entities.find(item => item.id === driver.dimensionId);
        assert.equal(annotation.sourceId, driver.refs[0].entityId);
        const updated = runDrawingDimensionalCommand(result.content, 'dimConstraint', `SET ${driver.name} 8`, []);
        assert.ok(!updated.error, updated.error);
        const map = new Map(updated.content.entities.map(item => [item.id, item]));
        assert.ok(Math.abs(getDimensionGeometry(map.get(annotation.id), map).value - 8) < 1e-7);
        assert.deepEqual(updated.content.entities.slice(0, source.entities.length), source.entities);
    }
});
