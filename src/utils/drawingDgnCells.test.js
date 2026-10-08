import test from 'node:test';
import assert from 'node:assert/strict';
import { dgnElement, dgnFile } from './fixtures/dgn.js';
import { readDrawingDgnRecords } from './drawingDgnRecords.js';
import { readDrawingDgnElementGeometry } from './drawingDgnGeometry.js';
import { readDrawingDgnCell } from './drawingDgnCells.js';
import { importDrawingDgn as importDgn } from './drawingDgnImport.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createAnonymousDrawingBlockReference, materializeDrawingBlockReference } from './drawingBlocks.js';
import { getEntityBounds } from './drawingGeometry.js';

const importDrawingDgn = (document, bytes, options = {}) => importDgn(document, bytes, { cellMode: 'explode', ...options });

function cell(children) {
    const value = dgnElement(2, 92); value.bytes[0] |= 128;
    value.view.setUint16(36, (92 + children.reduce((n, child) => n + child.length, 0) - 38) / 2, true);
    value.view.setUint16(38, 1 * 1600 + 2 * 40 + 3, true); // ABC
    value.view.setUint16(40, 30 * 1600 + 31 * 40 + 32, true); // 012
    value.view.setUint16(42, 0x1234, true); value.view.setUint16(44, 0x8001, true);
    [0, 0, 400000, 300000].forEach((n, i) => value.integer(52 + i * 4, n));
    value.integer(68, 1073741824); value.integer(80, -1073741824);
    value.integer(84, 100000); value.integer(88, 200000);
    return [value.bytes, ...children];
}
function contour(hole = false) {
    const value = dgnElement(6, 70); value.bytes[0] |= 128;
    value.view.setUint16(36, 4, true); value.view.setUint16(32, hole ? 0x8000 : 0, true);
    [0, 0, 100000, 0, 0, 100000, 0, 0].forEach((n, i) => value.integer(38 + i * 4, n));
    return value.bytes;
}
function records(elements) {
    const bytes = dgnFile(...elements); bytes.fill(0, 1240, 1264);
    return readDrawingDgnRecords(bytes);
}

test('DGN cell header retains radix-50 name, masks, physical range/origin and raw matrix metadata', () => {
    const parsed = records(cell([contour()])); const value = readDrawingDgnElementGeometry(parsed.records[1], parsed.header);
    assert.equal(value.geometry.name, 'ABC012'); assert.equal(value.geometry.classMask, 0x1234);
    assert.deepEqual(value.geometry.levelMask, [0x8001, 0, 0, 0]);
    assert.deepEqual(value.geometry.rangeLow, { x: 0, y: 0 });
    assert.deepEqual(value.geometry.rangeHigh, { x: 4, y: 3 });
    assert.deepEqual(value.geometry.origin, { x: 1, y: 2 });
    assert.deepEqual(value.geometry.sourceTransform, [.5, 0, 0, -.5]);
});

test('DGN nested cell snapshots preserve hole flags and original member coordinates without applying a second transform', () => {
    const parsed = records(cell(cell([contour(), contour(true)])));
    const before = parsed.records.map(r => r.bytes.slice()); const result = readDrawingDgnCell(parsed.records, 1, parsed.header);
    assert.equal(result.consumed, 3); assert.equal(result.children.length, 1);
    const members = result.children[0].children;
    assert.equal(members[0].primitive.properties & 0x8000, 0);
    assert.equal(members[1].primitive.properties & 0x8000, 0x8000);
    assert.deepEqual(members[0].primitive.geometry.points[1], { x: 1, y: 0 });
    assert.deepEqual(parsed.records.map(r => r.bytes), before);
});

test('DGN cells reject malformed radix-50, ranges, byte boundaries, membership and excessive nesting', () => {
    for (const mutate of [
        a => new DataView(a[0].buffer).setUint16(38, 64000, true),
        a => new DataView(a[0].buffer).setUint16(36, 10, true),
        a => new DataView(a[0].buffer).setUint16(36, 1000, true),
        a => new DataView(a[0].buffer).setUint16(52, 7, true),
        a => a[1][0] &= 127,
        a => a[1][1] |= 128,
    ]) {
        const values = cell([contour()]); mutate(values); const parsed = records(values);
        assert.throws(() => readDrawingDgnCell(parsed.records, 1, parsed.header), /dgnInvalid/);
    }
    let values = cell([contour()]); for (let i = 0; i < 20; i++) values = cell(values);
    const parsed = records(values);
    assert.throws(() => readDrawingDgnCell(parsed.records, 1, parsed.header), /dgnLimit/);
    const original = createLcadDocument(); const before = structuredClone(original);
    assert.throws(() => importDrawingDgn(original, dgnFile(...cell([contour(true)]))), /dgnUnsupported/);
    assert.deepEqual(original, before);
});


test('DGN cells import as named groups with distinct levels, nested membership and source coordinates', () => {
    const first = contour(); first[0] = 128 | 2;
    const second = contour(); second[0] = 128 | 3;
    const group = cell([first, ...cell([second])]);
    new DataView(group[0].buffer).setUint16(28, 15, true);
    const bytes = dgnFile(...group); bytes.fill(0, 1240, 1264);
    const original = createLcadDocument(); const before = structuredClone(original);
    const imported = importDrawingDgn(original, bytes, { x: 10, y: 20, scale: 2 });
    assert.equal(imported.content.entities.length, 2);
    assert.deepEqual(imported.content.layers.slice(-3).map(l => l.name), ['DGN 2', 'DGN 3', 'DGN 7']);
    const outer = imported.content.groups.find(g => g.name === 'ABC012');
    const inner = imported.content.groups.find(g => g.name === 'ABC012 (2)');
    assert.deepEqual(outer.entityIds, imported.selectedIds);
    assert.deepEqual(inner.entityIds, [imported.selectedIds[1]]);
    assert.deepEqual(imported.content.groups.find(g => g.name === 'DGN 15').entityIds, imported.selectedIds);
    assert.deepEqual(imported.content.entities[0].points[1], { x: 12, y: 20 });
    assert.ok(imported.report.warnings.includes('cellGroups'));
    assert.deepEqual(original, before);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
    assert.deepEqual(loaded.content.entities, imported.content.entities);
    assert.deepEqual(loaded.content.groups, imported.content.groups);
    assert.deepEqual(loaded.content.blocks, imported.content.blocks);
});

test('DGN cells retain reusable nested definitions and insertion origins without double transforms', () => {
    const bytes = dgnFile(...cell([contour(), ...cell([contour()])])); bytes.fill(0, 1240, 1264);
    const source = createLcadDocument();
    const result = importDrawingDgn(source, bytes, { x: 10, y: 20, scale: 2 });
    const [outer, inner] = result.content.blocks;
    assert.equal(outer.entities.length, 2);
    assert.equal(outer.entities[1].blockId, inner.id);
    assert.notEqual(outer.name, inner.name);
    const reference = createAnonymousDrawingBlockReference(outer, { insertionPoint: { x: 12, y: 16 } });
    const materialized = materializeDrawingBlockReference(reference, result.content.blocks, { recursive: true });
    assert.deepEqual(materialized.map(getEntityBounds), result.content.entities.map(getEntityBounds));
    const repeated = importDrawingDgn(result, bytes);
    assert.equal(new Set(repeated.content.blocks.map(block => block.name.toLowerCase())).size, 4);
    assert.deepEqual(source.content.blocks, []);
    const full = { ...source, content: { ...source.content, blocks: Array.from({ length: 1024 }, (_, i) => ({ id: `b${i}`, name: `b${i}`, entities: [] })) } };
    assert.throws(() => importDrawingDgn(full, bytes), /dgnLimit/);
    assert.equal(full.content.entities.length, 0);
});

test('DGN default cell import creates linked instances with valid groups, layers and archive references', () => {

    const bytes = dgnFile(...cell([...cell([contour()]), contour()])); bytes.fill(0, 1240, 1264);
    const source = createLcadDocument(); const before = structuredClone(source);
    const result = importDgn(source, bytes, { x: 10, y: 20, scale: 2 });
    const [reference] = result.content.entities;
    assert.equal(result.content.entities.length, 1);
    assert.equal(reference.type, 'blockReference');
    assert.equal(reference.blockId, result.content.blocks[0].id);
    assert.equal(result.content.blocks[0].entities[0].type, 'blockReference');
    assert.equal(result.content.layers.find(layer => layer.id === reference.layerId).name, 'DGN 7');
    assert.ok(result.content.groups.every(group => group.entityIds.length === 1 && group.entityIds[0] === reference.id));
    assert.deepEqual(result.selectedIds, [reference.id]);
    assert.ok(result.report.warnings.includes('cellMetadata'));
    const exploded = importDrawingDgn(source, bytes, { x: 10, y: 20, scale: 2 });
    const materialize = blocks => materializeDrawingBlockReference(reference, blocks, { recursive: true });
    assert.deepEqual(materialize(result.content.blocks).map(getEntityBounds), exploded.content.entities.map(getEntityBounds));
    const changed = structuredClone(result.content.blocks);
    changed[1].entities[0].color = '#123456';
    assert.equal(materialize(changed)[0].color, '#123456');
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(loaded.content.blocks, result.content.blocks);
    assert.deepEqual(loaded.content.entities, result.content.entities);
    assert.deepEqual(source, before);
    assert.throws(() => importDgn(source, bytes, { cellMode: 'invalid' }), /dgnSyntax/);
});
