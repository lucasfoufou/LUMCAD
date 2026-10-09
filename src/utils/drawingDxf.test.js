import test from 'node:test';
import assert from 'node:assert/strict';
import { DxfWriter, Units, point3d } from '@tarikjabiri/dxf';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { importDrawingDxf, exportDrawingDxf } from './drawingDxf.js';
import { readDrawingDxf } from './drawingDxfReader.js';
import { materializeDrawingBlockReference } from './drawingBlocks.js';
import { arcSweep } from './drawingGeometry.js';

const blank = () => ({ content: createDefaultDrawingContent(), assets: [] });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('DXF millimetres, y-up coordinates, placement and true colour become native metres', () => {
    const writer = new DxfWriter(); writer.setUnits(Units.Millimeters);
    writer.addLine(point3d(1000, 2000, 0), point3d(3000, 4000, 0), { trueColor: String(0x123456), layerName: 'Roof' });
    const original = blank(); const before = structuredClone(original);
    const result = importDrawingDxf(original, writer.stringify(), { x: 10, y: 20, scale: 2 });
    const line = result.content.entities[0];
    assert.deepEqual([line.x1, line.y1, line.x2, line.y2], [12, 16, 16, 12]);
    assert.equal(line.color, '#123456');
    assert.equal(result.content.layers.find(layer => layer.id === line.layerId).name, 'Roof');
    assert.deepEqual(original, before);
});

test('DXF arcs preserve the occupied quadrant and sweep through export/import', () => {
    for (const counterClockwise of [true, false]) {
        const original = blank(); original.content.entities = [{ id: 'arc', type: 'arc', layerId: original.content.activeLayerId,
            cx: 5, cy: 6, r: 3, startAngle: Math.PI / 6, endAngle: Math.PI * 5 / 6, counterClockwise }];
        const result = importDrawingDxf(blank(), exportDrawingDxf(original.content).bytes).content.entities[0];
        near(result.cx, 5); near(result.cy, 6); near(result.r, 3);
        near(Math.abs(arcSweep(result)), Math.abs(arcSweep(original.content.entities[0])));
        const middle = result.startAngle + arcSweep(result) / 2;
        const expected = original.content.entities[0].startAngle + arcSweep(original.content.entities[0]) / 2;
        near(Math.cos(middle), Math.cos(expected)); near(Math.sin(middle), Math.sin(expected));
    }
});

test('DXF bulges remain exact circular arcs rather than tessellated segments', () => {
    const writer = new DxfWriter(); writer.setUnits(Units.Meters);
    writer.addLWPolyline([{ point: { x: 0, y: 0 }, bulge: 1 }, { point: { x: 10, y: 0 } }]);
    const entity = importDrawingDxf(blank(), writer.stringify()).content.entities[0];
    assert.equal(entity.parts[0].type, 'arc'); near(entity.parts[0].r, 5);
    near(Math.abs(arcSweep(entity.parts[0])), Math.PI);
});

test('DXF nested blocks retain placement, nonuniform scales and editable definitions', () => {
    const writer = new DxfWriter(); writer.setUnits(Units.Meters);
    const block = writer.addBlock('Roof'); block.addLine(point3d(0, 0, 0), point3d(2, 0, 0));
    writer.addInsert('Roof', point3d(10, 20, 0), { rotationAngle: 90, scaleFactor: { x: 2, y: 3, z: 1 } });
    let result = importDrawingDxf(blank(), writer.stringify());
    assert.equal(result.content.entities[0].type, 'blockReference');
    let entity = materializeDrawingBlockReference(result.content.entities[0], result.content.blocks)[0];
    near(entity.x1, 10); near(entity.y1, -20); near(entity.x2, 10); near(entity.y2, -24);
    result = importDrawingDxf(blank(), exportDrawingDxf(result.content).bytes);
    entity = materializeDrawingBlockReference(result.content.entities[0], result.content.blocks)[0];
    near(entity.x2, 10); near(entity.y2, -24);
});

test('DXF export carries RGB layers and metre units and refuses unsupported geometry atomically', () => {
    const document = blank(); document.content.layers[0].color = '#137abf';
    document.content.entities = [{ id: 'line', type: 'line', layerId: document.content.layers[0].id, x1: 0, y1: 0, x2: 4, y2: -2 }];
    const exported = exportDrawingDxf(document.content);
    assert.equal(readDrawingDxf(exported.text).header.$INSUNITS, '6');
    const imported = importDrawingDxf(blank(), exported.bytes).content;
    // The line follows its layer, so it stays ByLayer instead of carrying a copied colour.
    assert.equal(imported.entities[0].color, undefined);
    assert.equal(imported.layers.find(layer => layer.id === imported.entities[0].layerId).color, '#137abf');
    document.content.entities.push({ id: 'unsupported', type: 'image' });
    const before = structuredClone(document);
    assert.throws(() => exportDrawingDxf(document.content), /cadUnsupported/); assert.deepEqual(document, before);
});

test('DXF refuses unknown entities, 3D and cyclic blocks, and ignores paper space, without changing the drawing', () => {
    const writer = new DxfWriter(); writer.setUnits(Units.Meters);
    writer.addLine(point3d(0, 0, 3), point3d(1, 2, 0));
    assert.throws(() => importDrawingDxf(blank(), writer.stringify()), /cadUnsupportedObjects/);
    assert.throws(() => importDrawingDxf(blank(), writer.stringify().replace('\nLINE\n', '\n3DSOLID\n')), /cadUnsupportedObjects/);
    const paper = writer.stringify().replace('\nLINE\n', '\nLINE\n67\n1\n');
    assert.throws(() => importDrawingDxf(blank(), paper), /cadEmpty/);
    const cycle = new DxfWriter(); cycle.setUnits(Units.Meters);
    cycle.addBlock('cycle').addInsert('cycle', point3d(0, 0, 0)); cycle.addInsert('cycle', point3d(0, 0, 0));
    assert.throws(() => importDrawingDxf(blank(), cycle.stringify()), /cadUnsupported/);
});

test('unitless DXF requires an explicit unit and malformed containers are rejected', () => {
    const writer = new DxfWriter(); writer.setUnits(Units.Unitless); writer.addCircle(point3d(0, 0, 0), 10);
    assert.throws(() => importDrawingDxf(blank(), writer.stringify()), /cadUnits/);
    near(importDrawingDxf(blank(), writer.stringify(), { unit: 'mm' }).content.entities[0].r, .01);
    assert.throws(() => readDrawingDxf('0\nSECTION\n2\nENTITIES\n0\nLINE'), /cadInvalid/);
    assert.throws(() => readDrawingDxf('0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n1,5\n0\nENDSEC\n0\nEOF\n'), /cadInvalid/);
});

test('clamped cubic DXF splines reuse native definitions and preserve control points', () => {
    const writer = new DxfWriter(); writer.setUnits(Units.Meters);
    writer.addSpline({ degreeCurve: 3, controlPoints: [point3d(0, 0, 0), point3d(1, 4, 0), point3d(3, 2, 0), point3d(5, 0, 0)], knots: [2, 2, 2, 2, 5, 5, 5, 5] });
    const imported = importDrawingDxf(blank(), writer.stringify());
    const curve = imported.content.entities[0];
    assert.equal(curve.splineDefinition.mode, 'control');
    assert.deepEqual(curve.controlPoints, [{ x: 0, y: 0 }, { x: 1, y: -4 }, { x: 3, y: -2 }, { x: 5, y: 0 }]);
    const exported = readDrawingDxf(exportDrawingDxf(imported.content).text).entities[0];
    assert.deepEqual(exported.controlPoints.map(p => [p.x, p.y]), [[0, 0], [1, 4], [3, 2], [5, 0]]);
});

test('block layer zero inherits the insertion layer across DXF round trips', () => {
    const writer = new DxfWriter(); writer.setUnits(Units.Meters);
    writer.addLayer('Roof', 1, 'Continuous');
    writer.addBlock('Part').addLine(point3d(0, 0, 0), point3d(2, 0, 0));
    writer.addInsert('Part', point3d(10, 20, 0), { layerName: 'Roof' });
    for (let result = importDrawingDxf(blank(), writer.stringify()), pass = 0; pass < 2; pass++) {
        const reference = result.content.entities[0];
        assert.equal(result.content.blocks[0].entities[0].layerId, 'geometry');
        assert.equal(materializeDrawingBlockReference(reference, result.content.blocks)[0].layerId, reference.layerId);
        result = importDrawingDxf(blank(), exportDrawingDxf(result.content).bytes);
    }
});

test('LibreDWG comments before the first section are accepted and text cannot inject DXF records', () => {
    const writer = new DxfWriter(); writer.setUnits(Units.Meters); writer.addCircle(point3d(0, 0, 0), 10);
    assert.equal(importDrawingDxf(blank(), `999\nLibreDWG 0.14\n${writer.stringify()}`).content.entities.length, 1);
    const original = blank(); original.content.entities = [{ id: 'text', type: 'text', layerId: 'geometry',
        x: 0, y: 0, width: 10, height: 2, fontSize: 1, textMode: 'singleLine', text: 'Label\n0\nEOF' }];
    assert.throws(() => exportDrawingDxf(original.content), /cadUnsupported/);
});

test('DWG intermediate declares R2000, indexed colours and ASCII Unicode escapes', () => {
    const original = blank(); original.content.layers[0].name = 'Étage';
    original.content.entities = [{ id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 0 }];
    const text = exportDrawingDxf(original.content, { legacy: true }).text;
    const parsed = readDrawingDxf(text);
    assert.equal(parsed.header.$ACADVER, 'AC1015');
    assert.equal(parsed.header.$INSUNITS, '6');
    assert.equal(/[^\x00-\x7f]/.test(text), false);
    assert.equal(/\n420\n/.test(text), false);
    assert.equal(parsed.layers.get('\\U+00c9tage').colorIndex, 7);
    assert.ok(text.endsWith('\nEOF\n'));
    const imported = importDrawingDxf(blank(), text);
    assert.ok(imported.content.layers.some(layer => layer.name === 'Étage'));
});
