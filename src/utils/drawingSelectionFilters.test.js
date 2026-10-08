import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { parseDrawingSelectionFilter, filterDrawingSelection, selectSimilarDrawingEntities, countDrawingEntities } from './drawingSelectionFilters.js';
import { createDrawingSchedule } from './drawingSchedule.js';
import { drawingContentWithHiddenObjects } from './drawingObjectVisibility.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

function fixture() {
    const content = createDefaultDrawingContent();
    return { ...content, entities: [
        { id: 'a', type: 'line', layerId: content.activeLayerId, x1: 0, y1: 0, x2: 2, y2: 0 },
        { id: 'b', type: 'line', layerId: content.activeLayerId, x1: 0, y1: 1, x2: 2, y2: 1, color: '#ff0000' },
        { id: 'c', type: 'circle', layerId: content.activeLayerId, cx: 0, cy: 0, r: 3 },
    ] };
}

test('selection filters combine type, layer and effective appearance with strict operators', () => {
    const content = fixture();
    assert.deepEqual(filterDrawingSelection(content, parseDrawingSelectionFilter('TYPE line COLOR != #ff0000 LAYER "0"')), ['a']);
    assert.deepEqual(filterDrawingSelection(content, parseDrawingSelectionFilter('COLOR #ff0000')), ['b']);
    assert.deepEqual(filterDrawingSelection(content, parseDrawingSelectionFilter('WEIGHT >= 1 TRANSPARENCY = 0')), ['a', 'b', 'c']);
    assert.equal(parseDrawingSelectionFilter('COLOR > red'), null);
    assert.equal(parseDrawingSelectionFilter('WEIGHT nope'), null);
    assert.equal(parseDrawingSelectionFilter('TYPE'), null);
    assert.deepEqual(filterDrawingSelection(drawingContentWithHiddenObjects(content, ['b']), parseDrawingSelectionFilter('TYPE line')), ['a']);
});

test('similar selection supports source unions and configurable effective properties', () => {
    const content = fixture();
    assert.deepEqual(selectSimilarDrawingEntities(content, ['a']), ['a', 'b']);
    assert.deepEqual(selectSimilarDrawingEntities(content, ['a'], ['TYPE', 'COLOR']), ['a']);
    assert.deepEqual(selectSimilarDrawingEntities(content, ['a', 'c']), ['a', 'b', 'c']);
});

test('counts highlight owners and nested block occurrences are bounded and cycle-safe', () => {
    const content = fixture();
    const result = countDrawingEntities(content, ['a', 'b', 'c']);
    assert.equal(result.total, 3);
    assert.equal(result.rows.find(row => row.type === 'line').count, 2);
    content.blocks = [{ id: 'outer', name: 'Outer', entities: [{ id: 'child', type: 'blockReference', layerId: content.activeLayerId, blockId: 'inner' }] }, { id: 'inner', name: 'Inner', entities: [] }];
    content.entities.push({ id: 'ref', type: 'blockReference', layerId: content.activeLayerId, blockId: 'outer' });
    const nested = countDrawingEntities(content, ['ref'], { nestedBlocks: true });
    assert.equal(nested.total, 2); assert.deepEqual(nested.selectedIds, ['ref']);
    content.blocks[1].entities.push({ id: 'cycle', type: 'blockReference', layerId: content.activeLayerId, blockId: 'outer' });
    assert.equal(countDrawingEntities(content, ['ref'], { nestedBlocks: true }), null);
});

test('saved filters and static count schedules round-trip as native content without changing source entities', () => {
    const original = fixture();
    const source = { ...original, selectionFilters: [{ id: 'f', name: 'Lines', criteria: parseDrawingSelectionFilter('TYPE line') }] };
    const result = createDrawingSchedule(source, [['Type', 'Count'], ['Line', '2']], { x: 10, y: 20 }, 'Count');
    assert.equal(result.content.entities[0], original.entities[0]);
    assert.equal(result.content.groups.length, 1);
    assert.equal(result.selectedIds.length, 1);
    assert.equal(result.content.entities.length, source.entities.length + 1);
    const table = result.content.entities.at(-1);
    assert.deepEqual(table.table.cells.map(row => row.map(cell => cell.value)), [['Type', 'Count'], ['Line', '2']]);
    assert.ok(table.parts.filter(part => part.type === 'line').every(part => part.lineWeight === 1));
    const document = { ...createLcadDocument(), content: result.content };
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content;
    assert.deepEqual(restored.selectionFilters, source.selectionFilters);
    assert.deepEqual(restored.groups[0].entityIds, result.selectedIds);
    assert.deepEqual(restored.entities.at(-1).table, table.table);
    assert.deepEqual(filterDrawingSelection(normalizeDrawingContent(source), source.selectionFilters[0].criteria), ['a', 'b']);
});

test('count schedules refuse malformed cells and locked or hidden insertion layers atomically', () => {
    const content = fixture();
    const cells = [['Type', 'Count'], ['Line', '2']];
    for (const invalid of [[null], [['a'], null], [['a'], ['b', 'c']], [[null]]]) {
        assert.equal(createDrawingSchedule(content, invalid, { x: 0, y: 0 }, 'Count'), null);
    }
    for (const override of [{ locked: true }, { visible: false }]) {
        const unavailable = { ...content, layers: content.layers.map(layer => layer.id === content.activeLayerId ? { ...layer, ...override } : layer) };
        assert.equal(createDrawingSchedule(unavailable, cells, { x: 0, y: 0 }, 'Count'), null);
    }
    assert.equal(content.entities.length, 3);
});

test('count reports retain one navigable occurrence per counted object without editing sources', () => {
    const content = fixture(); const before = structuredClone(content);
    const report = countDrawingEntities(content, ['a', 'c']);
    assert.equal(report.mode, 'countObjects');
    assert.equal(report.occurrences.length, report.total);
    assert.deepEqual(report.occurrences.map(item => item.path), [['a'], ['c']]);
    assert.deepEqual(report.occurrences[0].bounds, { minX: 0, minY: 0, maxX: 2, maxY: 0 });
    assert.deepEqual(report.occurrences[1].bounds, { minX: -3, minY: -3, maxX: 3, maxY: 3 });
    assert.deepEqual(content, before);
});

test('block counting preserves repeated child paths and centers transformed nested instances', () => {
    const content = fixture();
    const ref = (id, blockId, e, f, scale = 1) => ({ id, type: 'blockReference', blockId, layerId: content.activeLayerId,
        transform: { a: scale, b: 0, c: 0, d: scale, e, f }, definitionBounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 } });
    content.blocks = [{ id: 'outer', name: 'Outer', entities: [ref('child', 'inner', 5, 2, 2)] },
        { id: 'inner', name: 'Panel', entities: [] }];
    content.entities = [ref('first', 'outer', 100, 50, 3), ref('second', 'outer', -100, 50, 3)];
    const report = countDrawingEntities(content, ['first', 'second'], { nestedBlocks: true });
    assert.equal(report.total, 4); assert.equal(report.occurrences.length, 4);
    assert.deepEqual(report.occurrences.map(item => item.path), [['first'], ['first', 'child'], ['second'], ['second', 'child']]);
    assert.deepEqual(report.occurrences[1].bounds, { minX: 115, minY: 56, maxX: 127, maxY: 62 });
    assert.deepEqual(report.occurrences[3].bounds, { minX: -85, minY: 56, maxX: -73, maxY: 62 });
    assert.equal(report.rows.find(row => row.block === 'Panel').count, 2);
});
