import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument } from './lcadDocument.js';
import { compareDrawingDocuments, drawingComparisonValue } from './drawingComparison.js';
const line = (id, x = 0) => ({ id, type: 'line', layerId: 'geometry', x1: x, y1: 0, x2: x + 1, y2: 0 });

test('document comparison finds entity/resource/layout changes without modifying either drawing', () => {
    const first = createLcadDocument(); first.content.entities = [line('a'), line('b')];
    const second = structuredClone(first); second.content.entities = [line('a', 2), line('c')];
    second.content.layers[0].color = '#ff0000'; second.layouts[0].name = 'New sheet';
    const before = structuredClone([first, second]);
    const result = compareDrawingDocuments(first, second);
    assert.deepEqual(result.counts, { added: 1, removed: 1, changed: 3, order: 0 });
    assert.equal(result.changes.find(c => c.key === 'id:a').after.x1, 2);
    assert.ok(result.changes.some(c => c.scope === 'content.layers'));
    assert.ok(result.changes.some(c => c.scope === 'layouts'));
    assert.deepEqual([first, second], before);
    result.changes.find(c => c.key === 'id:a').after.x1 = 99;
    assert.equal(second.content.entities[0].x1, 2);
});

test('timestamp/cache/object-key changes do not hide painter order or metadata changes', () => {
    const first = createLcadDocument(); first.content.entities = [line('a'), line('b')];
    const second = structuredClone(first); second.updatedAt = 'different'; second.id = 'different';
    second.content.entities[0] = Object.fromEntries(Object.entries(second.content.entities[0]).reverse());
    second.content.entities[0].bounds = { minX: 123 };
    assert.equal(compareDrawingDocuments(first, second).changes.length, 0);
    second.content.entities.reverse();
    assert.equal(compareDrawingDocuments(first, second).counts.order, 1);
    second.name = 'Renamed';
    assert.ok(compareDrawingDocuments(first, second).changes.some(change => change.scope === 'document' && change.key === 'name'));
});

test('duplicate identities, cyclic values and nonfinite geometry reject ambiguous or partial comparisons', () => {
    const first = createLcadDocument(); first.content.entities = [line('a'), line('a')];
    assert.throws(() => compareDrawingDocuments(first, first), /Identity/);
    const cycle = {}; cycle.child = cycle;
    assert.throws(() => drawingComparisonValue(cycle), /Invalid/);
    assert.throws(() => drawingComparisonValue({ x: Infinity }), /Invalid/);
    let deep = {}; for (let i = 0; i < 66; i++) deep = { deep };
    assert.throws(() => drawingComparisonValue(deep), /Limit/);
});
