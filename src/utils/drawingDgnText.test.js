import test from 'node:test';
import assert from 'node:assert/strict';
import { readDrawingDgnElementGeometry } from './drawingDgnGeometry.js';
import { importDrawingDgn } from './drawingDgnImport.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { getDrawingTextLayout } from './drawingText.js';
import { framedDrawingPoint } from './drawingAffineFrame.js';
import { dgnElement, dgnFile } from './fixtures/dgn.js';

function textRecord() {
    const value = dgnElement(17, 64);
    value.bytes[36] = 3; value.bytes[37] = 7; value.bytes[58] = 4;
    value.bytes.set([84, 101, 120, 116], 60);
    value.integer(38, 500000); value.integer(42, 1000000);
    value.integer(46, 90 * 360000); value.integer(50, 100000); value.integer(54, 200000);
    return value;
}
const header = { dimension: 2, uorPerMaster: 100000, originUor: { x: 0, y: 0 } };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('V7 text decoding retains font, justification, width, height and rotated bottom-left origin', () => {
    const record = textRecord(); const before = record.bytes.slice();
    const text = readDrawingDgnElementGeometry(record.record, header).geometry;
    assert.equal(text.text, 'Text'); assert.equal(text.fontId, 3); assert.equal(text.justification, 7);
    assert.deepEqual(text.origin, { x: 1, y: 2 }); near(text.characterWidth, .03); near(text.characterHeight, .06);
    assert.equal(text.rotation, 90); assert.deepEqual(record.bytes, before);
    const shifted = readDrawingDgnElementGeometry(record.record, { ...header, originUor: { x: 50000, y: -100000 } }).geometry;
    assert.deepEqual(shifted.origin, { x: .5, y: 3 });
});

test('V7 text imports as editable framed text with one Y reflection and portable geometry', () => {
    const bytes = dgnFile(textRecord().bytes); bytes.fill(0, 1240, 1264);
    const original = createLcadDocument(); const before = structuredClone(original);
    const result = importDrawingDgn(original, bytes, { x: 10, y: 20, scale: 2 });
    const entity = result.content.entities[0]; const layout = getDrawingTextLayout(entity);
    assert.equal(entity.type, 'text'); assert.equal(entity.text, 'Text');
    const anchor = framedDrawingPoint(entity, { x: .16, y: layout.blockTop + layout.blockHeight });
    near(anchor.x, 12); near(anchor.y, 16);
    near(entity.affineFrame.a, 0); near(entity.affineFrame.b, -.06);
    near(entity.affineFrame.c, .12); near(entity.affineFrame.d, 0);
    assert.ok(result.report.warnings.includes('textFont')); assert.deepEqual(original, before);
    const reloaded = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(reloaded.content.entities[0], entity);
    assert.throws(() => importDrawingDgn(original, bytes, { scale: 1e-8 }), /dgnPlacement/);
    assert.throws(() => importDrawingDgn(original, bytes, { maxCharacters: 3 }), /dgnLimit/);
    assert.deepEqual(original, before);
});

test('V7 text refuses malformed dimensions, truncation, font-specific encoding and invalid justification', () => {
    const mutations = [v => v.bytes[58] = 12, v => v.integer(38, 0), v => v.integer(42, -1)];
    for (const mutate of mutations) {
        const value = textRecord(); mutate(value);
        assert.throws(() => readDrawingDgnElementGeometry(value.record, header), /dgnInvalid/);
    }
    for (const mutate of [v => v.bytes[60] = 255, v => v.bytes[61] = 0, v => v.bytes[37] = 3]) {
        const value = textRecord(); mutate(value);
        assert.throws(() => readDrawingDgnElementGeometry(value.record, header), /dgnUnsupported/);
    }
    const linked = textRecord(); linked.view.setUint16(32, 0x800, true); linked.view.setUint16(30, 14, true);
    assert.throws(() => readDrawingDgnElementGeometry(linked.record, header), /dgnInvalid/);
});
