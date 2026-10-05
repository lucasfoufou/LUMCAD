import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { importDrawingPdfFills } from './drawingPdfFillImport.js';
import { decodeDrawingPdfPath } from './drawingPdfGeometry.js';
import { readDrawingPdfPage } from './drawingPdfReader.js';
import { measureDrawingEntity } from './drawingInquiry.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg } from './drawingClipboard.js';
import { entityMatchesSelectionWindow } from './drawingSelection.js';

const rectangle = (a, b) => decodeDrawingPdfPath([0,a,a,1,b,a,1,b,b,1,a,b,4])[0];
const record = { paint: 'fill', visible: true, fill: '#123456', fillAlpha: 1, paths: [rectangle(0,10), rectangle(3,7)], clips: [] };
const page = records => ({ paths: { records } });

test('PDF solid fills preserve nonzero winding and even-odd holes in native area, selection, archive and SVG', () => {
    for (const [paint, area] of [['fill', 100], ['eoFill', 84]]) {
        const result = importDrawingPdfFills(createLcadDocument(), page([{ ...record, paint }]));
        const hatch = result.content.entities[0];
        assert.equal(hatch.type, 'hatch'); assert.equal(hatch.boundaryStroke, false);
        const measurement = measureDrawingEntity(hatch);
        assert.ok(Math.abs(measurement.area - area) < 1e-8);
        assert.ok(Math.abs(measurement.perimeter - (paint === 'fill' ? 40 : 56)) < 1e-8);
        const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
        assert.deepEqual(restored.content.entities[0], hatch);
        const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(restored, [hatch.id]));
        assert.match(svg, new RegExp(`fill-rule="${paint === 'fill' ? 'nonzero' : 'evenodd'}"`));
        assert.match(svg, /stroke="none"/);
        const selected = entityMatchesSelectionWindow(hatch, { minX: 4, minY: 4, maxX: 6, maxY: 6, mode: 'crossing' });
        assert.equal(selected, paint === 'fill');
    }
});

test('PDF fills implicitly close exact cubic boundaries and preserve transformed controls', () => {
    const path = decodeDrawingPdfPath([0,0,0,2,0,1,1,1,1,0])[0];
    const document = createLcadDocument(); const before = structuredClone(document);
    const result = importDrawingPdfFills(document, page([{ ...record, paths: [path] }]), { x: 10, y: 20, scale: 2 });
    const parts = result.content.entities[0].boundaries[0].parts;
    assert.equal(parts.length, 2); assert.equal(parts[0].type, 'spline'); assert.equal(parts[1].type, 'line');
    assert.deepEqual(parts[0].controlPoints, [{x:10,y:20},{x:10,y:22},{x:12,y:22},{x:12,y:20}]);
    assert.deepEqual(document, before);
    assert.ok(Math.abs(measureDrawingEntity(result.content.entities[0]).area - 2.4) < 1e-8);
});

test('PDF fill clipping reuses native blocks and invisible/transparent fills are not imported', () => {
    const clip = { paths: [rectangle(1,9)], rule: 'nonzero' };
    const result = importDrawingPdfFills(createLcadDocument(), page([
        {...record, clips:[clip]}, {...record,visible:false}, {...record,fillAlpha:0}, {...record,paint:'stroke'},
    ]));
    assert.equal(result.content.entities.length, 1);
    assert.equal(result.content.entities[0].type, 'blockReference');
    assert.equal(result.content.blocks[0].entities[0].type, 'hatch');
    assert.throws(() => importDrawingPdfFills(createLcadDocument(), page([{...record,visible:false}])));
});

test('real PDF solid-filled holes remain editable native hatch boundaries at physical scale', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); const { createCanvas } = await import('@napi-rs/canvas');
    const pdf = new jsPDF({unit:'mm',format:[100,100]}); pdf.setFillColor(255,0,0);
    pdf.rect(10,10,80,80,null); pdf.rect(30,30,40,40,null); pdf.fillEvenOdd();
    const decoded = await readDrawingPdfPage(new Uint8Array(pdf.output('arraybuffer')), {pdfjs,createCanvas});
    const result = importDrawingPdfFills(createLcadDocument(), decoded, {scale:100});
    const hatch = result.content.entities[0]; assert.equal(hatch.type,'hatch'); assert.equal(hatch.color,'#ff0000');
    assert.equal(hatch.boundaries.length,2); assert.ok(Math.abs(measureDrawingEntity(hatch).area-48)<1e-4);
});

test('nonzero nested fill orientation survives reflection and excludes only true holes from moments', () => {
    const outer = rectangle(0,10); const inner = rectangle(3,7);
    const reversed = { ...inner, parts: [...inner.parts].reverse().map(part => ({ ...part, x1:part.x2,y1:part.y2,x2:part.x1,y2:part.y1 })) };
    const result = importDrawingPdfFills(createLcadDocument(), page([{...record,paths:[outer,reversed]}]),
        {reference:{transform:{a:-1,b:0,c:0,d:1,e:0,f:0}}});
    const measured = measureDrawingEntity(result.content.entities[0]);
    assert.ok(Math.abs(measured.area-84)<1e-8); assert.ok(Math.abs(measured.centroidX+5)<1e-8);
    assert.ok(Math.abs(measured.centroidY-5)<1e-8); assert.ok(Math.abs(measured.inertiaX-812)<1e-6);
});

test('PDF clips close implicit polygon edges and empty clips hide imported fills', () => {
    const triangle = decodeDrawingPdfPath([0,1,1,1,9,1,1,1,9])[0];
    const result = importDrawingPdfFills(createLcadDocument(), page([{...record,clips:[{paths:[triangle],rule:'nonzero'}]},
        {...record,clips:[{paths:[],rule:'nonzero'}]}]));
    assert.equal(result.content.entities.length,1);
    assert.equal(result.content.entities[0].blockClip.points.length,3);
});
