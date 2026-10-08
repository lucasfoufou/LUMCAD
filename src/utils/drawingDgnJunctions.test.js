import test from 'node:test';
import assert from 'node:assert/strict';
import { writeDrawingDgnFile } from './drawingDgnWriterFile.js';
import { readDrawingDgnRecords } from './drawingDgnRecords.js';
import { drawingDgnInt32, writeDrawingDgnInt32 } from './drawingDgnNumbers.js';
import { importDrawingDgn } from './drawingDgnImport.js';
import { dgnFile, dgnComplexGroup } from './fixtures/dgn.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { getCurveEnd, getCurveStart } from './drawingCurveKernel.js';

const arc = { type: 'arc', cx: 0, cy: 0, r: 1, startAngle: .2, endAngle: 1.2, counterClockwise: true };
const line = { type: 'line', x1: Math.cos(1.2), y1: Math.sin(1.2), x2: 3, y2: 0 };
const file = geometry => writeDrawingDgnFile([{ geometry }], { seed: dgnFile() });
const near = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9);

test('DGN rounded arc/line junctions become connected native paths with warnings and archive preservation', () => {
    for (const closed of [false, true]) {
        const last = closed ? { ...line, x2: Math.cos(.2), y2: Math.sin(.2) } : line;
        const bytes = file({ type: 'polyline', parts: [arc, last], closed });
        const original = createLcadDocument(); const before = structuredClone(original);
        const imported = importDrawingDgn(original, bytes);
        const entity = imported.content.entities[0];
        assert.ok(imported.report.warnings.includes('curveJunctions'));
        assert.deepEqual(entity.parts.map(part => part.type), ['ellipse', 'line']);
        near(getCurveEnd(entity.parts[0]), getCurveStart(entity.parts[1]));
        if (closed) near(getCurveEnd(entity.parts[1]), getCurveStart(entity.parts[0]));
        assert.equal(entity.parts[0].rx, 1); assert.equal(entity.parts[0].ry, 1);
        assert.deepEqual(original, before);
        const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
        assert.deepEqual(loaded.content.entities, imported.content.entities);
    }
});

test('DGN backwards rounded members retain their appearance and true gaps still reject atomically', () => {
    const bytes = file({ type: 'polyline', parts: [arc, line], closed: false });
    const member = readDrawingDgnRecords(bytes).records[3];
    const start = bytes.slice(member.offset + 36, member.offset + 44);
    bytes.copyWithin(member.offset + 36, member.offset + 44, member.offset + 52);
    bytes.set(start, member.offset + 44); bytes[member.offset + 35] = 1;
    const imported = importDrawingDgn(createLcadDocument(), bytes);
    const parts = imported.content.entities[0].parts;
    near(getCurveEnd(parts[0]), getCurveStart(parts[1]));
    assert.equal(parts[1].color, '#0000ff');
    const view = new DataView(bytes.buffer);
    writeDrawingDgnInt32(view, member.offset + 44, drawingDgnInt32(view, member.offset + 44) + 1000);
    const original = createLcadDocument(); const before = structuredClone(original);
    assert.throws(() => importDrawingDgn(original, bytes), /dgnUnsupported/);
    assert.deepEqual(original, before);
});

test('DGN angular roundoff between two arcs adds only a bounded connector and retains both curves', () => {
    const first = { ...arc, r: 1000, endAngle: .7123456789 };
    const point = getCurveEnd(first); const start = .123456789;
    const second = { type: 'arc', cx: point.x - 2000 * Math.cos(start), cy: point.y - 2000 * Math.sin(start),
        r: 2000, startAngle: start, endAngle: 1.4, counterClockwise: true };
    const imported = importDrawingDgn(createLcadDocument(), file({ type: 'polyline', parts: [first, second], closed: false }));
    const parts = imported.content.entities[0].parts;
    assert.deepEqual(parts.map(part => part.type), ['ellipse', 'line', 'ellipse']);
    near(getCurveEnd(parts[0]), getCurveStart(parts[1])); near(getCurveEnd(parts[1]), getCurveStart(parts[2]));
    assert.ok(Math.hypot(parts[1].x2 - parts[1].x1, parts[1].y2 - parts[1].y1) < .001);
    assert.equal(parts[0].rx, 1000); assert.equal(parts[2].rx, 2000);
    assert.ok(imported.report.warnings.includes('curveJunctions'));
});

test('DGN nested chains propagate repaired junction warnings and source appearance mappings', () => {
    const original = file({ type: 'polyline', parts: [arc, line], closed: false });
    const group = readDrawingDgnRecords(original).records.slice(1).map(record => record.bytes);
    group.at(-1)[35] = 1;
    const nested = dgnComplexGroup(12, [group]); nested[0][0] = group[0][0];
    const bytes = dgnFile(...nested); bytes.fill(0, 1240, 1264);
    const imported = importDrawingDgn(createLcadDocument(), bytes);
    assert.ok(imported.report.warnings.includes('curveJunctions'));
    const parts = imported.content.entities[0].parts;
    assert.equal(parts[1].color, '#0000ff');
    near(getCurveEnd(parts[0]), getCurveStart(parts[1]));
});
