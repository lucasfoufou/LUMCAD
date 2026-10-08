import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { findDrawingCountDuplicates } from './drawingCountDuplicates.js';

const line = (id, y = 0) => ({ id, type: 'line', layerId: 'geometry', x1: 0, y1: y, x2: 2, y2: y });
const run = (entities, options = {}) => {
    const content = { ...createDefaultDrawingContent(), entities };
    return findDrawingCountDuplicates(content, entities.map(entity => entity.id), options);
};

test('count diagnosis finds reversed coincident geometry across appearance and locked layers without edits', () => {
    const content = createDefaultDrawingContent();
    content.layers.push({ ...content.layers[0], id: 'other', name: 'Other', locked: true });
    content.entities = [line('a'), { ...line('b'), x1: 2, x2: 0, layerId: 'other', color: '#ff0000', locked: true }, line('c', 2)];
    content.groups = [{ id: 'group', name: 'Kept', entityIds: ['a', 'b'], selectable: true }];
    const before = structuredClone(content);
    const result = findDrawingCountDuplicates(content, ['a', 'b', 'c']);
    assert.deepEqual(result.groups, [['a', 'b']]);
    assert.equal(result.pairs, 1); assert.equal(result.total, 2);
    assert.deepEqual(content, before);
    assert.deepEqual(findDrawingCountDuplicates(content, ['a', 'c']).groups, []);
});

test('duplicate tolerance reports connected suspect groups and refuses incomplete budget-limited results', () => {
    const entities = [line('a'), line('b', .0009), line('c', .0018)];
    const result = run(entities, { tolerance: .001 });
    assert.deepEqual(result.groups, [['a', 'b', 'c']]); assert.equal(result.pairs, 2);
    assert.deepEqual(run(entities, { tolerance: 0 }).groups, []);
    assert.deepEqual(run(entities, { tolerance: .001, maxComparisons: 1 }), { error: 'limit' });
    assert.deepEqual(run(entities, { tolerance: -1 }), { error: 'invalid' });
});

test('block duplicate diagnosis retains definition and instance state and reports unsupported geometry', () => {
    const block = { id: 'a', type: 'blockReference', layerId: 'geometry', blockId: 'panel',
        transform: { a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 }, definitionBounds: { minX: 0, minY: 0, maxX: 1, maxY: 2 } };
    const result = run([block, { ...block, id: 'b', transform: { ...block.transform, e: 2.0000001 } },
        { ...block, id: 'c', blockId: 'different' }, { ...block, id: 'd', transform: { ...block.transform, a: 2 } },
        { id: 'unknown', type: 'futureEntity', layerId: 'geometry' }]);
    assert.deepEqual(result.groups, [['a', 'b']]);
    assert.deepEqual(result.unsupportedIds, ['unknown']);
});

test('duplicate diagnosis skips hidden layers and reuses closed-path cyclic matching', () => {
    const points = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }];
    const a = { id: 'a', type: 'polyline', layerId: 'geometry', closed: true, points };
    const b = { ...a, id: 'b', points: [points[2], points[1], points[0]] };
    assert.deepEqual(run([a, b]).groups, [['a', 'b']]);
    const content = createDefaultDrawingContent(); content.entities = [a, b]; content.layers[0].visible = false;
    assert.equal(findDrawingCountDuplicates(content, ['a', 'b']).examined, 0);
});

const reference = (id, blockId, e = 0, f = 0, scale = 1) => ({ id, type: 'blockReference', blockId, layerId: 'geometry',
    transform: { a: scale, b: 0, c: 0, d: scale, e, f }, definitionBounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 } });

test('nested duplicate occurrences retain paths, world bounds and unique selectable roots', () => {
    const content = createDefaultDrawingContent();
    content.blocks = [{ id: 'pair', name: 'Pair', entities: [line('a'), line('b')] },
        { id: 'assembly', name: 'Assembly', entities: [reference('inside', 'pair', 5, 0, 2)] }];
    content.entities = [reference('root', 'assembly', 100, 50, 3)];
    const before = structuredClone(content);
    const result = findDrawingCountDuplicates(content, ['root'], { nested: true });
    assert.deepEqual(result.groups, [[JSON.stringify(['root', 'inside', 'a']), JSON.stringify(['root', 'inside', 'b'])]]);
    assert.deepEqual(result.groupRootIds, [['root']]);
    assert.deepEqual(result.selectedIds, ['root']);
    assert.deepEqual(result.groupBounds, [{ minX: 115, minY: 50, maxX: 127, maxY: 50 }]);
    assert.deepEqual(content, before);
});

test('nested diagnosis compares different containing blocks and top-level geometry in the same coordinate system', () => {
    const content = createDefaultDrawingContent();
    content.blocks = [{ id: 'first', name: 'First', entities: [line('same-child-id')] },
        { id: 'second', name: 'Second', entities: [{ ...line('same-child-id'), x1: 4, x2: 6 }] }];
    content.entities = [reference('a', 'first', 4), reference('b', 'second'), { ...line('plain'), x1: 4, x2: 6 }];
    const result = findDrawingCountDuplicates(content, content.entities.map(entity => entity.id), { nested: true });
    assert.equal(result.groups.length, 1); assert.equal(result.groups[0].length, 3);
    assert.deepEqual(new Set(result.selectedIds), new Set(['a', 'b', 'plain']));
    assert.deepEqual(result.groupBounds[0], { minX: 4, minY: 0, maxX: 6, maxY: 0 });
});

test('nested diagnosis refuses cycles, missing definitions and expansion overflow atomically', () => {
    const content = createDefaultDrawingContent();
    content.entities = [reference('root', 'loop')];
    content.blocks = [{ id: 'loop', name: 'Loop', entities: [reference('again', 'loop')] }];
    assert.deepEqual(findDrawingCountDuplicates(content, ['root'], { nested: true }), { error: 'dependency' });
    content.blocks = [];
    assert.deepEqual(findDrawingCountDuplicates(content, ['root'], { nested: true }), { error: 'dependency' });
    content.blocks = [{ id: 'loop', name: 'Pair', entities: [line('a'), line('b')] }];
    assert.deepEqual(findDrawingCountDuplicates(content, ['root'], { nested: true, maxOccurrences: 2 }), { error: 'limit' });
});

test('clipped interiors are reported as unverified and inherited hidden layers are skipped', () => {
    const content = createDefaultDrawingContent();
    content.blocks = [{ id: 'pair', name: 'Pair', entities: [line('a'), line('b')] }];
    const clipped = { ...reference('clipped', 'pair'), blockClip: { enabled: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] } };
    content.entities = [clipped];
    const result = findDrawingCountDuplicates(content, ['clipped'], { nested: true });
    assert.deepEqual(result.unsupportedPaths, [['clipped']]);
    assert.deepEqual(result.groups, []);
    content.layers.push({ ...content.layers[0], id: 'hidden', visible: false });
    content.entities = [{ ...reference('hidden-root', 'pair'), layerId: 'hidden' }];
    assert.equal(findDrawingCountDuplicates(content, ['hidden-root'], { nested: true }).examined, 0);
});


test('point duplicates use physical location independently of symbol bounds and appearance', () => {
    const a = { id: 'a', type: 'point', layerId: 'geometry', x: 10, y: 20, pointStyle: { size: 1, symbol: 'cross' } };
    const b = { ...a, id: 'b', x: 10.0001, pointStyle: { size: 10, symbol: 'circle' } };
    const c = { ...a, id: 'c', y: 20.01 };
    assert.deepEqual(run([a, b, c], { tolerance: .001 }).groups, [['a', 'b']]);
    assert.deepEqual(run([a, b], { tolerance: 0 }).groups, []);
});

test('text duplicates preserve text and typography while accepting near placement across layers', () => {
    const a = { id: 'a', type: 'text', layerId: 'geometry', x: 0, y: 0, width: 2, height: 1, text: 'Panel', fontSize: .25 };
    const result = run([a, { ...a, id: 'b', x: .0001, color: '#ff0000' },
        { ...a, id: 'different-text', text: 'Roof' }, { ...a, id: 'different-size', fontSize: .5 }], { tolerance: .001 });
    assert.deepEqual(result.groups, [['a', 'b']]);
    assert.deepEqual(result.unsupportedIds, []);
});

test('image duplicates require the same source and image state, not merely overlapping frames', () => {
    const a = { id: 'a', type: 'image', layerId: 'geometry', x: 0, y: 0, width: 2, height: 1, assetId: 'photo' };
    const result = run([a, { ...a, id: 'b', y: .0001 }, { ...a, id: 'other-image', assetId: 'different' },
        { ...a, id: 'mirrored', mirrored: true }, { ...a, id: 'adjusted', imageAdjustments: { brightness: 50 } }], { tolerance: .001 });
    assert.deepEqual(result.groups, [['a', 'b']]);
});

test('rectangle outlines match native closed paths and hatch holes retain their geometry', () => {
    const points = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }];
    const rectangle = { id: 'rect', type: 'rectangle', layerId: 'geometry', x: 0, y: 0, width: 2, height: 1 };
    assert.deepEqual(run([rectangle, { id: 'path', type: 'polyline', layerId: 'geometry', points, closed: true }]).groups, [['rect', 'path']]);
    const outer = { type: 'circle', cx: 0, cy: 0, r: 5 }; const inner = { type: 'circle', cx: 0, cy: 0, r: 1 };
    const hatch = { id: 'a', type: 'hatch', layerId: 'geometry', boundaries: [outer, inner], pattern: 'solid' };
    const result = run([hatch, { ...hatch, id: 'b', boundaries: [inner, outer] },
        { ...hatch, id: 'filled', boundaries: [outer] }, { ...hatch, id: 'other-hole', boundaries: [outer, { ...inner, r: 2 }] }]);
    assert.deepEqual(result.groups, [['a', 'b']]);
    const nonzero = run([{ ...hatch, id: 'nonzero', fillRule: 'nonzero' }, { ...hatch, id: 'copy', fillRule: 'nonzero' }]);
    assert.deepEqual(nonzero.groups, [['nonzero', 'copy']]);
    assert.deepEqual(nonzero.exactOnlyIds, ['nonzero', 'copy']);
});


test('generated assemblies compare exact semantic copies while retaining source dependencies', () => {
    const a = { id: 'a', type: 'polyline', layerId: 'geometry', parts: [line('part-a')],
        array: { columns: 1, rows: 1, horizontal: { x: 2, y: 0 }, vertical: { x: 0, y: 2 } } };
    const result = run([a, { ...a, id: 'b', parts: [{ ...line('part-b'), color: '#ff0000' }] },
        { ...a, id: 'near', parts: [line('near-part', .0001)] }, { ...a, id: 'different-source', sourceId: 'another' }], { tolerance: .01 });
    assert.deepEqual(result.groups, [['a', 'b']]);
    assert.equal(result.exactOnlyIds.length, 4);
    assert.deepEqual(result.unsupportedIds, []);
});
