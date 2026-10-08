import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDrawingData, drawingDataSchema, aggregateDrawingData } from './drawingDataExtraction.js';

const line = { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 3, y2: 4 };
const insert = (id, x) => ({ id, type: 'blockReference', blockId: 'assembly', layerId: 'doors', transform: { a: 2, b: 0, c: 0, d: 3, e: x, f: 4 } });
const fixture = () => ({ layers: [{ id: 'doors', name: 'Doors' }], entities: [line, insert('a', 0), insert('b', 10)],
    blocks: [{ id: 'assembly', name: 'Assembly', entities: [line, { id: 'circle', type: 'circle', layerId: 'geometry', cx: 0, cy: 0, r: 1 }] }] });

test('metadata extraction measures each nested instance in world units without changing the document', () => {
    const content = fixture(); const before = structuredClone(content);
    const records = extractDrawingData(content, { nested: true });
    assert.equal(records.length, 7);
    assert.equal(records[0].length, 5);
    assert.equal(records[1].length, null);
    assert.equal(records[2].length, Math.hypot(6, 12));
    assert.equal(records[2].layer, 'Doors');
    assert.ok(Math.abs(records[3].area - 6 * Math.PI) < 1e-8);
    assert.deepEqual(records[5].path, ['b', 'line']);
    assert.equal(records[5].rootId, 'b');
    assert.deepEqual(content, before);
    assert.equal(extractDrawingData(content).length, 3);
    assert.equal(extractDrawingData(content, { selectedIds: ['b'], nested: true }).length, 3);
    assert.deepEqual(extractDrawingData(content, { selectedIds: [] }), []);
});

test('aggregation preserves unknown quantities, counts measured occurrences, and keeps occurrence roots', () => {
    const records = extractDrawingData(fixture(), { nested: true });
    const report = aggregateDrawingData(records);
    assert.equal(report.units, 'm');
    const nestedLines = report.rows.find(row => row.values[0] === 'line' && row.values[1] === 'Doors');
    assert.equal(nestedLines.count, 2);
    assert.deepEqual(nestedLines.roots, ['a', 'b']);
    assert.equal(nestedLines.sums.length, 2 * Math.hypot(6, 12));
    assert.equal(nestedLines.sums.area, null);
    assert.equal(nestedLines.measured.area, 0);
    const total = aggregateDrawingData(records, { groupBy: [], sums: ['length'] });
    assert.equal(total.rows[0].count, 7);
    assert.equal(total.rows[0].measured.length, 5);
    assert.throws(() => aggregateDrawingData(records, { sums: ['layer'] }), /Fields/);
    assert.throws(() => aggregateDrawingData(records, { groupBy: ['missing'] }), /Fields/);
});

test('attribute fields are namespaced and grouping distinguishes missing, empty and delimiter-containing values', () => {
    const records = [null, '', 'a|b', 'a'].map((value, i) => ({ id: String(i), rootId: String(i), type: 'blockReference',
        attributes: value === null ? {} : { type: value, '__proto__': 'ignored' }, length: null, area: null }));
    assert.ok(drawingDataSchema(records).some(field => field.key === 'attribute:type'));
    const grouped = aggregateDrawingData(records, { groupBy: ['attribute:type'], sums: [] });
    assert.equal(grouped.rows.length, 4);
    assert.deepEqual(grouped.rows.map(row => row.values[0]), [null, '', 'a|b', 'a']);
    assert.throws(() => aggregateDrawingData(records, { groupBy: ['constructor'] }), /Fields/);
});

test('bad dependencies and output limits reject complete extraction instead of returning partial quantities', () => {
    const content = fixture(); content.blocks[0].entities.push(insert('cycle', 0));
    assert.throws(() => extractDrawingData(content, { nested: true }), /Dependency/);
    content.blocks = [];
    assert.throws(() => extractDrawingData(content), /Dependency/);
    assert.throws(() => extractDrawingData({ entities: Array.from({ length: 10001 }, (_, i) => ({ ...line, id: String(i) })) }), /Limit/);
    assert.throws(() => aggregateDrawingData([{ type: 'line', length: 1e308 }, { type: 'line', length: 1e308 }], { groupBy: ['type'], sums: ['length'] }), /Limit/);
});
