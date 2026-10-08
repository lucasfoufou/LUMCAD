import test from 'node:test';
import assert from 'node:assert/strict';
import { dgnElement, dgnComplexGroup, dgnFile } from './fixtures/dgn.js';
import { readDrawingDgnRecords } from './drawingDgnRecords.js';
import { readDrawingDgnComplex } from './drawingDgnComplex.js';
import { importDrawingDgn } from './drawingDgnImport.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

function line(x1, y1, x2, y2, color = 83) {
    const value = dgnElement(3, 52); value.bytes[0] |= 128; value.bytes[34] = 0; value.bytes[35] = color;
    [x1, y1, x2, y2].forEach((n, i) => value.integer(36 + i * 4, n * 100000)); return value.bytes;
}
function file(group) { const bytes = dgnFile(...group); bytes.fill(0, 1240, 1264); return bytes; }
function nested() {
    return dgnComplexGroup(12, [line(0, 0, 1, 0), dgnComplexGroup(12, [line(3, 1, 2, 1, 3), line(2, 1, 1, 0, 2)])]);
}

test('DGN nested chains consume direct members and reverse complete child paths with their styles', () => {
    const bytes = file(nested()); const original = bytes.slice(); const parsed = readDrawingDgnRecords(bytes);
    const group = readDrawingDgnComplex(parsed.records, 1, parsed.header);
    assert.equal(group.consumed, 4); assert.equal(group.points, 6);
    const result = importDrawingDgn(createLcadDocument(), bytes);
    const parts = result.content.entities[0].parts;
    assert.deepEqual(parts.map(p => p.color), ['#b40000', '#00ff00', '#ff0000']);
    assert.deepEqual(parts.map(p => [p.x1, p.y1, p.x2, p.y2]), [[0, 0, 1, 0], [1, 0, 2, -1], [2, -1, 3, -1]]);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(loaded.content.entities, result.content.entities); assert.deepEqual(bytes, original);
});

test('DGN nested chains can close a parent shape without closing their own child path', () => {
    const group = dgnComplexGroup(14, [dgnComplexGroup(12, [line(0, 0, 1, 0), line(1, 0, 1, 1)]), line(1, 1, 0, 0)]);
    const entity = importDrawingDgn(createLcadDocument(), file(group)).content.entities[0];
    assert.equal(entity.closed, true); assert.equal(entity.parts.length, 3);
});

test('DGN nested groups enforce each parent boundary, direct count, depth and source point budget atomically', () => {
    const original = createLcadDocument(); const before = structuredClone(original);
    for (const mutation of [
        g => new DataView(g[0].buffer).setUint16(38, 4, true),
        g => new DataView(g[2].buffer).setUint16(36, 1, true),
        g => g[3][0] &= 127,
        g => new DataView(g[2].buffer).setUint16(28, 2, true),
    ]) {
        const group = nested(); mutation(group);
        assert.throws(() => importDrawingDgn(original, file(group)), /dgnInvalid|dgnUnsupported/);
        assert.deepEqual(original, before);
    }
    let deep = dgnComplexGroup(12, [line(0, 0, 1, 0)]);
    for (let i = 0; i < 20; i++) deep = dgnComplexGroup(12, [deep]);
    assert.throws(() => importDrawingDgn(original, file(deep)), /dgnLimit/);
    assert.throws(() => importDrawingDgn(original, file(nested()), { maxPoints: 5 }), /dgnLimit/);
    assert.deepEqual(original, before);
});
