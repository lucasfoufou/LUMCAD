import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDrawingAttributes, serializeDrawingAttributeExtraction } from './drawingAttributeExtraction.js';

function fixture() {
    const attribute = { id: 'text', type: 'text', text: 'Default', attributeDefinition: { tag: 'CODE', invisible: true } };
    const reference = (id, blockId, x, value) => ({ id, type: 'blockReference', blockId, layerId: 'geometry', transform: { a: 1, b: 0, c: 0, d: 1, e: x, f: -2 }, attributeValues: { CODE: value } });
    return {
        entities: [{ ...reference('first', 'parent', 10), layerId: 'doors', locked: true }, reference('second', 'parent', 20)],
        blocks: [{ id: 'door', name: 'Door', entities: [attribute] }, { id: 'parent', name: 'Assembly', entities: [reference('nested', 'door', 3, 'D-01')] }],
    };
}

test('extraction traverses each instance with world coordinates, paths and inherited layers', () => {
    const content = fixture();
    const before = structuredClone(content);
    const records = extractDrawingAttributes(content);
    assert.deepEqual(records.map(record => record.path), [['first', 'nested'], ['second', 'nested']]);
    assert.deepEqual(records.map(record => [record.x, record.y]), [[13, -4], [23, -4]]);
    assert.equal(records[0].layerId, 'doors');
    assert.equal(records[0].attributes.CODE, 'D-01');
    assert.deepEqual(content, before);
    assert.equal(extractDrawingAttributes(content, { selectedIds: ['second'] }).length, 1);
    assert.equal(extractDrawingAttributes(content, { selectedIds: [] }).length, 0);
});

test('cycles, missing definitions and excessive nesting reject the whole extraction', () => {
    const content = fixture();
    content.blocks[1].entities[0].blockId = 'parent';
    assert.throws(() => extractDrawingAttributes(content), /Dependency/);
    content.blocks[1].entities[0].blockId = 'missing';
    assert.throws(() => extractDrawingAttributes(content), /Dependency/);
    const chain = Array.from({ length: 34 }, (_, index) => ({ id: String(index), entities: [{ id: 'child', type: 'blockReference', blockId: String(index + 1) }] }));
    assert.throws(() => extractDrawingAttributes({ entities: [{ type: 'blockReference', id: 'root', blockId: '0' }], blocks: chain }), /Limit/);
});

test('CSV quotes multiline values, separates metadata tags and neutralizes formula strings; JSON is lossless', () => {
    const records = extractDrawingAttributes(fixture());
    records[0].attributes = { CODE: 'a,"b"\nc', Path: '=1+1', FORMULA: '\t@SUM(A1)', NEGATIVE: '-12' };
    const csv = serializeDrawingAttributeExtraction(records);
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes('"Attribute:Path"'));
    assert.ok(csv.includes('"a,""b""\nc"'));
    assert.ok(csv.includes('"\'=1+1"'));
    assert.ok(csv.includes(',13,-4,'));
    assert.deepEqual(JSON.parse(serializeDrawingAttributeExtraction(records, 'json')).records, records);
    assert.throws(() => serializeDrawingAttributeExtraction(records, 'xml'), /Format/);
});
