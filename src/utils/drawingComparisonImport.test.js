import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument } from './lcadDocument.js';
import { compareDrawingDocuments } from './drawingComparison.js';
import { importDrawingComparison } from './drawingComparisonImport.js';
const line = (id, x = 0) => ({ id, type: 'line', layerId: 'geometry', x1: x, y1: 0, x2: x + 1, y2: 0 });
function fixture() {
    const before = createLcadDocument(); before.content.entities = [line('a'), line('b')];
    return [before, structuredClone(before)];
}
const indexes = (before, after, predicate = () => true) => compareDrawingDocuments(before, after).changes.flatMap((change, index) => predicate(change) ? [index] : []);

test('accepted edits preserve local changes, document identity and source insertion order without mutation', () => {
    const [before, after] = fixture(); after.content.entities = [line('a', 2), line('new'), line('b')];
    const current = structuredClone(before); current.content.entities[1].x2 = 99;
    const snapshot = structuredClone([current, before, after]);
    const result = importDrawingComparison(current, before, after, indexes(before, after));
    assert.ok(result.document, JSON.stringify(result));
    assert.deepEqual(result.document.content.entities.map(entity => entity.id), ['a', 'new', 'b']);
    assert.equal(result.document.content.entities[2].x2, 99);
    assert.equal(result.document.id, current.id);
    assert.deepEqual([current, before, after], snapshot);
    current.content.entities[0].x2 = 50;
    assert.equal(importDrawingComparison(current, before, after, indexes(before, after)).error, 'comparisonStale');
});

test('resource dependencies require a consistent accepted set; no partial entity import is returned', () => {
    const [before, after] = fixture();
    after.content.layers.push({ ...after.content.layers[0], id: 'new-layer', name: 'New' });
    after.content.entities.push({ ...line('new'), layerId: 'new-layer' });
    const onlyObject = indexes(before, after, change => change.scope === 'content.entities');
    const rejected = importDrawingComparison(before, before, after, onlyObject);
    assert.equal(rejected.error, 'comparisonDependencies'); assert.ok(!rejected.document);
    assert.ok(importDrawingComparison(before, before, after, indexes(before, after)).document);
});

test('painter-order changes are explicit and stale or incomplete reorder imports refuse atomically', () => {
    const [before, after] = fixture(); after.content.entities = [line('b'), line('new'), line('a')];
    assert.equal(importDrawingComparison(before, before, after, indexes(before, after, c => c.kind === 'order')).error, 'comparisonDependencies');
    const result = importDrawingComparison(before, before, after, indexes(before, after));
    assert.deepEqual(result.document.content.entities.map(entity => entity.id), ['b', 'new', 'a']);
    const current = structuredClone(before); current.content.entities.reverse();
    assert.equal(importDrawingComparison(current, before, after, indexes(before, after)).error, 'comparisonStale');
    assert.equal(importDrawingComparison(before, before, after, [999]).error, 'comparisonSelection');
});


test('locked source geometry cannot be replaced through comparison import', () => {
    const [before, after] = fixture(); before.content.entities[0].locked = true;
    after.content.entities[0].x2 = 3;
    assert.equal(importDrawingComparison(before, before, after, indexes(before, after)).error, 'comparisonLocked');
});
