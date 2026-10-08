import test from 'node:test';
import assert from 'node:assert/strict';
import { writeDrawingDgnFile } from './drawingDgnWriterFile.js';
import { readDrawingDgnRecords } from './drawingDgnRecords.js';
import { readDrawingDgnElementGeometry } from './drawingDgnGeometry.js';
import { importDrawingDgn } from './drawingDgnImport.js';
import { dgnFile, dgnElement } from './fixtures/dgn.js';
import { createLcadDocument } from './lcadDocument.js';
import { getEntityBounds } from './drawingGeometry.js';

const line = { type: 'line', x1: -2, y1: 3, x2: 4, y2: 7 };

test('DGN file assembly replaces seed geometry, units and origin while retaining non-graphic setup', () => {
    const setup = dgnElement(10, 36).bytes; const old = dgnElement(3, 52).bytes;
    const seed = dgnFile(setup, old); const before = seed.slice();
    const source = [{ geometry: line, appearance: { level: 4, color: 3 } }];
    const bytes = writeDrawingDgnFile(source, { seed, uorPerSubunit: 10, originUor: { x: 120, y: -340 } });
    const parsed = readDrawingDgnRecords(bytes);
    assert.deepEqual(parsed.records.map(record => record.type), [9, 10, 3]);
    assert.deepEqual(parsed.records[1].bytes, setup);
    assert.equal(parsed.header.masterUnit, 'm'); assert.equal(parsed.header.subUnit, 'mm');
    assert.equal(parsed.header.uorPerMaster, 10000);
    assert.deepEqual(parsed.header.originUor, { x: 120, y: -340, z: 0 });
    assert.deepEqual(readDrawingDgnElementGeometry(parsed.records[2], parsed.header).geometry,
        { ...line, y1: -3, y2: -7 });
    const imported = importDrawingDgn(createLcadDocument(), bytes);
    assert.deepEqual(getEntityBounds(imported.content.entities[0]), getEntityBounds(line));
    assert.deepEqual([...bytes.slice(-2)], [255, 255]);
    assert.deepEqual(seed, before); assert.deepEqual(source[0].geometry, line);
});

test('DGN file assembly retains curved primitives through native coordinate reflection and reimport', () => {
    const ellipse = { type: 'ellipse', cx: 4, cy: 7, rx: 3, ry: 1, rotation: 30, fullEllipse: true };
    const bytes = writeDrawingDgnFile([{ geometry: ellipse }], { seed: dgnFile() });
    const imported = importDrawingDgn(createLcadDocument(), bytes).content.entities[0];
    const a = getEntityBounds(ellipse); const b = getEntityBounds(imported);
    for (const key of Object.keys(a)) assert.ok(Math.abs(a[key] - b[key]) < 1e-9);
});

test('DGN file assembly rejects 3D seeds, byte/record budgets and unsupported late geometry without mutation', () => {
    const seed = dgnFile(); const before = seed.slice();
    for (const limits of [{ maxRecords: 1 }, { maxBytes: 1538 }, { uorPerSubunit: 0 }]) {
        assert.throws(() => writeDrawingDgnFile([{ geometry: line }], { seed, ...limits }), /dgnLimit/);
    }
    assert.throws(() => writeDrawingDgnFile([{ geometry: line }, { geometry: { type: 'text', text: 'unsupported' } }], { seed }), /dgnUnsupported/);
    assert.throws(() => writeDrawingDgnFile([{ geometry: line, appearance: { complex: true } }], { seed }), /dgnUnsupported/);
    assert.deepEqual(seed, before);
    const threeD = seed.slice(); threeD[1214] |= 64;
    assert.throws(() => writeDrawingDgnFile([{ geometry: line }], { seed: threeD }), /dgnUnsupported/);
    assert.throws(() => writeDrawingDgnFile([], { seed }), /dgnEmpty/);
});
