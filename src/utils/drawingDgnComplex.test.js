import test from 'node:test';
import assert from 'node:assert/strict';
import { dgnElement, dgnFile } from './fixtures/dgn.js';
import { readDrawingDgnRecords } from './drawingDgnRecords.js';
import { readDrawingDgnComplex } from './drawingDgnComplex.js';
import { importDrawingDgn } from './drawingDgnImport.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { getEntityBounds } from './drawingGeometry.js';

function chain(closed = false) {
    const coordinates = closed ? [[0, 0, 200000, 0], [200000, 0, 200000, 100000], [200000, 100000, 0, 0]]
        : [[0, 0, 200000, 0], [200000, 100000, 200000, 0]];
    const members = coordinates.map(values => {
        const value = dgnElement(3, 52); value.bytes[0] |= 128; value.bytes[34] = 0;
        values.forEach((n, i) => value.integer(36 + i * 4, n)); return value;
    });
    const parent = dgnElement(closed ? 14 : 12, 48); parent.bytes[0] |= 128; parent.bytes[34] = 0;
    parent.view.setUint16(36, (48 + members.length * 52 - 38) / 2, true);
    parent.view.setUint16(38, members.length, true);
    const bytes = () => { const file = dgnFile(parent.bytes, ...members.map(v => v.bytes)); file.fill(0, 1240, 1264); return file; };
    return { parent, members, bytes };
}

test('DGN complex chains combine ordered members and reverse a backwards member without resampling', () => {
    const fixture = chain(); const file = readDrawingDgnRecords(fixture.bytes());
    const group = readDrawingDgnComplex(file.records, 1, file.header);
    assert.equal(group.consumed, 2); assert.equal(group.parent.geometry.parts.length, 2);
    const part = group.parent.geometry.parts[1];
    assert.deepEqual([part.x1, part.y1, part.x2, part.y2], [2, 0, 2, 1]);
    const original = createLcadDocument(); const before = structuredClone(original);
    const result = importDrawingDgn(original, fixture.bytes(), { x: 4, y: 5, scale: 2 });
    assert.equal(result.content.entities.length, 1); assert.equal(result.content.entities[0].type, 'polyline');
    assert.deepEqual(getEntityBounds(result.content.entities[0]), { minX: 4, minY: 3, maxX: 8, maxY: 5 });
    assert.deepEqual(original, before);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(loaded.content.entities[0], result.content.entities[0]);
});

test('DGN complex shape closure and source point budgets are checked before committing', () => {
    const fixture = chain(true); const result = importDrawingDgn(createLcadDocument(), fixture.bytes());
    assert.equal(result.content.entities[0].closed, true);
    assert.equal(result.content.entities[0].parts.length, 3);
    assert.throws(() => importDrawingDgn(createLcadDocument(), fixture.bytes(), { maxPoints: 5 }), /dgnLimit/);
    fixture.members[2].integer(48, 100);
    assert.throws(() => importDrawingDgn(createLcadDocument(), fixture.bytes()), /dgnUnsupported/);
});

test('DGN complex groups reject mismatched counts, lengths, membership, groups and disconnected paths atomically', () => {
    const original = createLcadDocument(); const before = structuredClone(original);
    for (const mutate of [
        v => v.parent.view.setUint16(38, 3, true),
        v => v.parent.view.setUint16(36, 1, true),
        v => v.members[0].bytes[0] &= 127,
        v => v.members[0].bytes[1] |= 128,
        v => v.members[0].view.setUint16(28, 7, true),
        v => v.members[1].integer(44, 300000),
    ]) {
        const fixture = chain(); mutate(fixture);
        assert.throws(() => importDrawingDgn(original, fixture.bytes()), /dgnInvalid|dgnUnsupported/);
        assert.deepEqual(original, before);
    }
});

test('DGN complex shapes retain exact semicircular arcs and header fills through archive reload', () => {
    const parent = dgnElement(14, 64); parent.bytes[0] |= 128; parent.bytes[34] = 0;
    parent.view.setUint16(36, (64 + 80 + 52 - 38) / 2, true); parent.view.setUint16(38, 2, true);
    parent.view.setUint16(30, 8, true); parent.view.setUint16(32, 0x800, true);
    parent.bytes.set([7, 16, 65, 0, 2, 8, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0], 48);
    const arc = dgnElement(16, 80); arc.bytes[0] |= 128; arc.bytes[34] = 0;
    arc.integer(36, 0); arc.integer(40, 180 * 360000);
    arc.view.setUint16(44, 0x4080, true); arc.view.setUint16(52, 0x4080, true);
    const line = dgnElement(3, 52); line.bytes[0] |= 128; line.bytes[34] = 0;
    [-1, 0, 1, 0].forEach((v, i) => line.integer(36 + i * 4, v));
    const bytes = dgnFile(parent.bytes, arc.bytes, line.bytes); bytes.fill(0, 1240, 1264);
    bytes.set([0, 0, 1, 0], 1112); bytes.set([0, 0, 1, 0], 1116);
    const imported = importDrawingDgn(createLcadDocument(), bytes, { unit: 'm' });
    assert.deepEqual(imported.content.entities.map(e => e.type), ['hatch', 'polyline']);
    const curve = imported.content.entities[1].parts[0];
    assert.equal(curve.type, 'ellipse'); assert.equal(curve.rx, 1); assert.equal(curve.ry, 1);
    assert.equal(imported.content.entities[0].color, '#ff0000');
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
    assert.deepEqual(loaded.content.entities, imported.content.entities);
});


test('DGN complex parts retain different colors and styles through reversal and archive persistence', () => {
    const fixture = chain();
    fixture.members[0].bytes[35] = 3;
    fixture.members[1].bytes[35] = 2; fixture.members[1].bytes[34] = (5 << 3) | 1;
    fixture.members[1].view.setUint16(32, 0x100, true);
    const imported = importDrawingDgn(createLcadDocument(), fixture.bytes());
    const entity = imported.content.entities[0];
    assert.equal(entity.color, undefined);
    assert.equal(entity.lineWidth, undefined);
    assert.deepEqual(entity.parts.map(p => [p.color, p.lineWidth, p.lineType]),
        [['#ff0000', 1, 'continuous'], ['#00ff00', 5, 'dotted']]);
    assert.equal(entity.parts[1].y2, -1);
    assert.ok(imported.report.warnings.includes('strokeAppearance'));
    assert.ok(imported.report.warnings.includes('objectLocks'));
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
    assert.deepEqual(loaded.content.entities[0], entity);
});

test('DGN filled complex shapes keep contrasting member strokes even when header stroke matches fill', () => {
    const fixture = chain(true);
    const parent = dgnElement(14, 64); parent.bytes.set(fixture.parent.bytes);
    parent.view.setUint16(2, 30, true); parent.view.setUint16(36, (64 + 3 * 52 - 38) / 2, true);
    parent.view.setUint16(30, 8, true); parent.view.setUint16(32, 0x800, true);
    parent.bytes.set([7, 16, 65, 0, 2, 8, 1, 0, 83, 0, 0, 0, 0, 0, 0, 0], 48);
    fixture.members[0].bytes[35] = 3;
    const bytes = dgnFile(parent.bytes, ...fixture.members.map(v => v.bytes)); bytes.fill(0, 1240, 1264);
    const imported = importDrawingDgn(createLcadDocument(), bytes);
    assert.deepEqual(imported.content.entities.map(e => e.type), ['hatch', 'polyline']);
    assert.equal(imported.content.entities[0].color, '#b40000');
    assert.equal(imported.content.entities[1].parts[0].color, '#ff0000');
});

test('DGN complex member DMRS links are bounded and reported without following external data', () => {
    const fixture = chain(); const member = dgnElement(3, 60); member.bytes.set(fixture.members[0].bytes);
    member.view.setUint16(2, 28, true); member.view.setUint16(30, 10, true); member.view.setUint16(32, 0x800, true);
    member.bytes.set([0, 0, 12, 0, 34, 0, 0, 1], 52);
    fixture.parent.view.setUint16(36, (48 + 60 + 52 - 38) / 2, true);
    const bytes = dgnFile(fixture.parent.bytes, member.bytes, fixture.members[1].bytes);
    bytes.fill(0, 1240, 1264);
    const imported = importDrawingDgn(createLcadDocument(), bytes);
    assert.deepEqual(imported.report.warnings, ['databaseLinks']);
    assert.equal(imported.content.entities.length, 1);
});
