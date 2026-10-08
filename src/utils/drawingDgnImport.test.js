import test from 'node:test';
import assert from 'node:assert/strict';
import { importDrawingDgn } from './drawingDgnImport.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { curvePointAt } from './drawingCurveKernel.js';
import { getEntityBounds } from './drawingGeometry.js';
import { dgnFile, dgnElement } from './fixtures/dgn.js';

function drawing(...elements) {
    const bytes = dgnFile(...elements.map(element => element.bytes || element));
    bytes.fill(0, 1240, 1264); return bytes;
}
function line(level = 2) {
    const value = dgnElement(3, 52); value.bytes[0] = level; value.bytes[34] = 0; value.bytes[35] = 3;
    [100000, 200000, 300000, 400000].forEach((n, i) => value.integer(36 + i * 4, n));
    return value;
}
function shape(fillColor = 3, strokeColor = 3) {
    const value = dgnElement(6, 86); value.bytes[0] = 5; value.bytes[34] = 0; value.bytes[35] = strokeColor;
    value.view.setUint16(36, 4, true);
    [0, 0, 100000, 0, 0, 100000, 0, 0].forEach((n, i) => value.integer(38 + i * 4, n));
    value.view.setUint16(30, 19, true); value.view.setUint16(32, 0x0800, true);
    value.bytes.set([7, 16, 65, 0, 2, 8, 1, 0, fillColor, 0, 0, 0, 0, 0, 0, 0], 70);
    return value;
}

test('DGN import converts metres and Y direction once, retains levels and does not mutate source documents', () => {
    const document = createLcadDocument({ name: 'DGN destination' }); const original = structuredClone(document);
    const bytes = drawing(line()); const source = bytes.slice();
    const imported = importDrawingDgn(document, bytes, { x: 10, y: 20, scale: 2 });
    const entity = imported.content.entities[0];
    assert.deepEqual([entity.x1, entity.y1, entity.x2, entity.y2], [12, 16, 16, 12]);
    assert.equal(entity.color, '#ff0000'); assert.equal(entity.lineWidth, 1);
    assert.equal(imported.content.layers.find(layer => layer.id === entity.layerId).name, 'DGN 2');
    assert.equal(imported.content.activeLayerId, document.content.activeLayerId);
    assert.deepEqual(imported.report.warnings, []); assert.deepEqual(document, original); assert.deepEqual(bytes, source);
    const millimetres = importDrawingDgn(document, bytes, { unit: 'mm' }).content.entities[0];
    assert.equal(millimetres.x1, .001); assert.equal(millimetres.y1, -.002);
});

test('DGN filled shapes preserve fill-before-outline ordering, graphic groups and archive round trips', () => {
    const filled = shape(3, 2); filled.view.setUint16(28, 12, true);
    const document = createLcadDocument({ name: 'DGN fill' });
    const imported = importDrawingDgn(document, drawing(filled));
    assert.deepEqual(imported.content.entities.map(e => [e.type, e.color]), [['hatch', '#ff0000'], ['polyline', '#00ff00']]);
    const group = imported.content.groups[0]; assert.equal(group.name, 'DGN 12'); assert.deepEqual(group.entityIds, imported.selectedIds);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
    assert.deepEqual(loaded.content.groups, imported.content.groups);
    assert.equal(loaded.content.entities[0].boundaryStroke, false);
    assert.deepEqual(getEntityBounds(loaded.content.entities[0]), { minX: 0, minY: -1, maxX: 1, maxY: 0 });
    assert.equal(importDrawingDgn(document, drawing(shape())).content.entities.length, 1);
});

test('DGN level import preserves existing identities and creates distinct names on repeat', () => {
    const first = importDrawingDgn(createLcadDocument({ name: 'Levels' }), drawing(line(2), line(3)));
    const oldIds = first.content.entities.map(e => e.id); const oldLayerIds = first.content.layers.map(l => l.id);
    const second = importDrawingDgn(first, drawing(line(2)));
    assert.deepEqual(second.content.entities.slice(0, 2).map(e => e.id), oldIds);
    assert.deepEqual(second.content.layers.slice(0, oldLayerIds.length).map(l => l.id), oldLayerIds);
    assert.equal(second.content.layers.at(-1).name, 'DGN 2 (2)');
});

test('DGN appearance approximations and omitted non-geometric metadata are reported', () => {
    const value = line(); value.bytes[34] = 5 * 8 + 4; value.view.setUint16(32, 0x100, true);
    const imported = importDrawingDgn(createLcadDocument(), drawing(dgnElement(66, 36), dgnElement(10, 36), value));
    assert.deepEqual(imported.report.warnings, ['applicationData', 'levelSymbology', 'objectLocks', 'strokeAppearance']);
    assert.equal(imported.content.entities[0].lineWidth, 5); assert.equal(imported.content.entities[0].lineType, 'dashed');
});

test('DGN import refuses unsupported late elements, holes, links, limits and locked destinations without partial changes', () => {
    const document = createLcadDocument(); const before = structuredClone(document);
    const complex = line(); complex.bytes[0] |= 128;
    const hole = shape(); hole.view.setUint16(32, 0x8800, true);
    const unknown = shape(); unknown.bytes[72] = 66;
    for (const last of [dgnElement(17, 60), complex, hole, unknown]) {
        assert.throws(() => importDrawingDgn(document, drawing(line(), last)), /dgnUnsupported/);
        assert.deepEqual(document, before);
    }
    assert.throws(() => importDrawingDgn(document, drawing(line()), { maxEntities: 1, x: 1e10 }), /dgnPlacement/);
    assert.throws(() => importDrawingDgn(document, drawing(line(), line()), { maxEntities: 1 }), /dgnLimit/);
    assert.throws(() => importDrawingDgn(document, drawing(shape()), { maxPoints: 2 }), /dgnLimit/);
    document.content.layers.find(layer => layer.id === document.content.activeLayerId).locked = true;
    assert.throws(() => importDrawingDgn(document, drawing(line())), /dgnLayer/);
});


test('DGN ellipse import retains exact reflected curves through native archive normalization', () => {
    const ellipse = dgnElement(15, 72); ellipse.bytes[34] = 0;
    ellipse.view.setUint16(36, 0x4200, true); ellipse.view.setUint16(44, 0x4180, true);
    ellipse.view.setUint16(56, 0x4100, true); ellipse.view.setUint16(64, 0x4080, true);
    ellipse.integer(52, 90 * 360000);
    const bytes = drawing(ellipse); bytes.set([0, 0, 1, 0], 1112); bytes.set([0, 0, 1, 0], 1116); bytes.set([109, 32], 1122);
    const imported = importDrawingDgn(createLcadDocument(), bytes, { scale: 2, x: 10, y: 20 });
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
    const curve = loaded.content.entities[0]; assert.equal(curve.type, 'ellipse'); assert.equal(curve.fullEllipse, true);
    const source = { type: 'ellipse', cx: 2, cy: 1, rx: 8, ry: 4, rotation: 90, fullEllipse: true };
    for (let i = 0; i < 20; i++) {
        const expected = curvePointAt(source, i / 20); const actual = curvePointAt(curve, i / 20);
        assert.ok(Math.abs(actual.x - (10 + 2 * expected.x)) < 1e-10);
        assert.ok(Math.abs(actual.y - (20 - 2 * expected.y)) < 1e-10);
    }
});
