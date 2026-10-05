import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { importDrawingPdfGeometry } from './drawingPdfImport.js';
import { readDrawingPdfPage } from './drawingPdfReader.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const line = { type: 'line', x1: 0, y1: 1, x2: 4, y2: 1 };
const record = { paint: 'stroke', visible: true, stroke: '#ff0000', strokeAlpha: 1, fillAlpha: 1, width: 2,
    dash: [], clips: [], paths: [{ type: 'polyline', parts: [line], closed: false }] };
const page = records => ({ paths: { records, unsupported: [] }, text: { items: [] } });

test('PDF geometry import preserves exact cubic controls, existing IDs and source immutability', () => {
    const document = createLcadDocument();
    document.content.entities = [{ ...line, id: 'existing', layerId: 'geometry' }];
    const before = structuredClone(document);
    const spline = { type: 'spline', degree: 3, controlPoints: [{ x: 1, y: 2 }, { x: 3, y: 5 }, { x: 7, y: -1 }, { x: 8, y: 2 }] };
    const result = importDrawingPdfGeometry(document, page([{ ...record, paths: [{ parts: [spline] }] }]), { x: 10, y: 20, scale: 100 });
    assert.deepEqual(document, before);
    assert.equal(result.content.entities[0], document.content.entities[0]);
    assert.deepEqual(result.content.entities[1].controlPoints, spline.controlPoints.map(({ x, y }) => ({ x: 10 + 100 * x, y: 20 + 100 * y })));
    assert.equal(result.content.entities[1].color, '#ff0000');
    assert.equal(result.content.entities[1].lineWeight, 2);
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(restored.content.entities[1], result.content.entities[1]);
    assert.equal(restored.assets.length, 0);
});

test('PDF underlay import uses its local clip before affine insertion and leaves the source in place', () => {
    const document = createLcadDocument();
    const reference = { transform: { a: 0, b: 2, c: -2, d: 0, e: 10, f: 20 },
        blockClip: { enabled: true, points: [{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 2 }] } };
    const result = importDrawingPdfGeometry(document, page([record, { ...record, visible: false }]), { reference });
    assert.equal(result.selectedIds.length, 1);
    const imported = result.content.entities[0];
    assert.ok(Math.abs(imported.x1 - 8) < 1e-9); assert.ok(Math.abs(imported.x2 - 8) < 1e-9);
    assert.ok(Math.abs(imported.y1 - 22) < 1e-9); assert.ok(Math.abs(imported.y2 - 26) < 1e-9);
    assert.equal(document.content.entities.length, 0);
});

test('PDF geometry category excludes fills and invisible strokes, refuses locked layers and coordinate overflow', () => {
    const document = createLcadDocument();
    const input = page([record, { ...record, paint: 'fill' }, { ...record, strokeAlpha: 0 }]);
    const result = importDrawingPdfGeometry(document, input);
    assert.equal(result.report.imported, 1); assert.equal(result.report.ignoredFills, 1);
    assert.throws(() => importDrawingPdfGeometry(document, page([{ ...record, paint: 'fill' }])));
    assert.throws(() => importDrawingPdfGeometry(document, input, { x: 1e10 }));
    document.content.layers.find(layer => layer.id === document.content.activeLayerId).locked = true;
    assert.throws(() => importDrawingPdfGeometry(document, input));
});

test('a real PDF page imports visible vectors into an independent archive at the requested physical scale', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');
    const pdf = new jsPDF({ unit: 'mm', format: [100, 100] });
    pdf.setDrawColor('0.070588235294', '0.203921568627', '0.337254901961'); pdf.line(-10, 20, 80, 20); pdf.text('Excluded by geometry filter', 10, 40);
    const decoded = await readDrawingPdfPage(new Uint8Array(pdf.output('arraybuffer')), { pdfjs, createCanvas });
    const result = importDrawingPdfGeometry(createLcadDocument(), decoded, { scale: 100 });
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.equal(restored.content.entities.length, 1);
    const imported = restored.content.entities[0];
    assert.ok(Math.abs(imported.x1) < 1e-8); assert.ok(Math.abs(imported.x2 - 8) < 1e-4);
    assert.ok(Math.abs(imported.y1 - 2) < 1e-4); assert.equal(imported.color, '#123456');
    assert.equal(result.report.ignoredText, 1);
    assert.equal(restored.assets.length, 0);
});
