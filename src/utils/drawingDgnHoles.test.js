import test from 'node:test';
import assert from 'node:assert/strict';
import { importDrawingDgn as importDgn } from './drawingDgnImport.js';
import { dgnFile, dgnCellGroup, dgnRectangleShape } from './fixtures/dgn.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { measureDrawingEntity } from './drawingInquiry.js';
import { drawingDgnGroupedHole } from './drawingDgnHoles.js';

const importDrawingDgn = (document, bytes, options = {}) => importDgn(document, bytes, { cellMode: 'explode', ...options });

function drawing(...shapes) { const bytes = dgnFile(...dgnCellGroup(shapes)); bytes.fill(0, 1240, 1264); return bytes; }
const outer = () => dgnRectangleShape(0, 0, 10, 8, { fill: 3 });
const hole = (x = 2, y = 2, w = 2, h = 2) => dgnRectangleShape(x, y, w, h, { hole: true, fill: 2 });

test('DGN grouped-hole topology retains exact elliptical curves and rejects tangent curved holes', () => {
    const ellipse = (cx, rx, ry, hole) => ({ properties: hole ? 0x8000 : 0,
        geometry: { type: 'ellipse', cx, cy: 0, rx, ry, rotation: 0,
            startAngle: 0, endAngle: Math.PI * 2, fullEllipse: true, counterClockwise: true } });
    const outer = ellipse(0, 10, 8, false);
    const inner = ellipse(0, 2, 1, true);
    const { boundaries } = drawingDgnGroupedHole([inner, outer]);
    assert.equal(boundaries.length, 2);
    assert.ok(boundaries.every(boundary => boundary.parts.length === 1 && boundary.parts[0].type === 'ellipse'));
    assert.ok(Math.abs(measureDrawingEntity({ type: 'hatch', boundaries }).area - 78 * Math.PI) < 1e-9);
    for (const cx of [8, 9, 12]) {
        assert.throws(() => drawingDgnGroupedHole([outer, ellipse(cx, 2, 1, true)]), /dgnUnsupported/);
    }
});

test('DGN grouped holes retain empty interiors, outline entities and named membership through placement and archives', () => {
    const original = createLcadDocument(); const before = structuredClone(original);
    const imported = importDrawingDgn(original, drawing(outer(), hole()), { x: 4, y: 7, scale: 2 });
    assert.deepEqual(imported.content.entities.map(e => e.type), ['hatch', 'polyline', 'polyline']);
    const hatch = imported.content.entities[0];
    assert.equal(hatch.boundaries.length, 2); assert.equal(hatch.color, '#ff0000');
    assert.ok(Math.abs(measureDrawingEntity(hatch).area - 304) < 1e-9);
    assert.deepEqual(imported.content.groups[0].entityIds, imported.selectedIds);
    assert.equal(imported.content.groups[0].name, 'HOLES');
    assert.deepEqual(original, before);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
    assert.deepEqual(loaded.content.entities, imported.content.entities);
    assert.deepEqual(loaded.content.blocks, imported.content.blocks);
    assert.equal(loaded.content.blocks[0].entities[0].boundaries.length, 2);
});

test('DGN grouped holes support several disjoint holes and unfilled contours without introducing fills', () => {
    const imported = importDrawingDgn(createLcadDocument(), drawing(hole(6, 2), outer(), hole()));
    assert.equal(imported.content.entities[0].boundaries.length, 3);
    assert.ok(Math.abs(measureDrawingEntity(imported.content.entities[0]).area - 72) < 1e-9);
    const empty = importDrawingDgn(createLcadDocument(), drawing(dgnRectangleShape(0, 0, 10, 8), hole()));
    assert.deepEqual(empty.content.entities.map(e => e.type), ['polyline', 'polyline']);
});

test('DGN grouped-hole preflight refuses outside, touching, crossing, nested and ambiguous holes atomically', () => {
    const original = createLcadDocument(); const before = structuredClone(original);
    for (const members of [
        [outer(), hole(12, 2)], [outer(), hole(0, 2)], [outer(), hole(9, 2)],
        [outer(), hole(1, 1, 5, 5), hole(2, 2)], [outer(), hole(), hole(3, 3)],
        [outer(), outer(), hole()], [hole()],
    ]) {
        assert.throws(() => importDrawingDgn(original, drawing(...members)), /dgnUnsupported/);
        assert.deepEqual(original, before);
    }
});
