import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { importDrawingPdfText } from './drawingPdfTextImport.js';
import { readDrawingPdfPage } from './drawingPdfReader.js';
import { getDrawingTextLayout, normalizeDrawingTextEntity } from './drawingText.js';
import { transformAffinePoint } from './drawingAffine.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg } from './drawingClipboard.js';

const record = { text: 'CAD', advance: 18, fontSize: 10, matrix: { a: 0.01, b: 0, c: 0, d: 0.01, e: 1, f: 2 },
    mode: 0, font: { family: 'sans-serif', bold: false, italic: false }, visible: true,
    fill: '#ff0000', stroke: '#000000', fillAlpha: 1, strokeAlpha: 1, clips: [] };
const page = records => ({ paths: { texts: records, unsupported: [] } });
const rectClip = (x0, y0, x1, y1) => ({ paths: [{ parts: [[x0,y0,x1,y0],[x1,y0,x1,y1],[x1,y1,x0,y1],[x0,y1,x0,y0]].map(([x1,y1,x2,y2]) => ({ type: 'line',x1,y1,x2,y2 })) }] });

test('PDF native text keeps its baseline, fitted advance, appearance and affine frame through archives', () => {
    const document = createLcadDocument(); const before = structuredClone(document);
    const result = importDrawingPdfText(document, page([record]), { scale: 100, x: 10, y: 20 });
    const text = result.content.entities[0]; const layout = getDrawingTextLayout(text);
    assert.equal(text.type, 'text'); assert.equal(text.fitWidth, true); assert.equal(text.color, '#ff0000');
    assert.ok(Math.abs(layout.availableWidth - 1.8) < 1e-10);
    assert.deepEqual(transformAffinePoint({ x: layout.textX, y: layout.firstBaseline }, text.affineFrame), { x: 110, y: 220 });
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(restored.content.entities[0], text); assert.deepEqual(document, before);
    const payload = createDrawingClipboardPayload(restored, [text.id]);
    assert.match(drawingClipboardPayloadToSvg(payload), /textLength="1.8"/); assert.match(drawingClipboardPayloadToSvg(payload), /lengthAdjust="spacingAndGlyphs"/);
    assert.equal(normalizeDrawingTextEntity({ ...text, textMode: 'multiline' }).fitWidth, undefined);
});

test('partially clipped PDF text uses a native editable block; outside and invisible text are excluded', () => {
    const result = importDrawingPdfText(createLcadDocument(), page([
        { ...record, clips: [rectClip(1.005, 1.9, 2, 2.1)] },
        { ...record, clips: [rectClip(10, 10, 20, 20)] }, { ...record, visible: false },
    ]));
    assert.equal(result.content.entities.length, 1);
    const reference = result.content.entities[0];
    assert.equal(reference.type, 'blockReference'); assert.equal(reference.blockClip.points[0].x, 1.005);
    assert.equal(result.content.blocks.find(block => block.id === reference.blockId).entities[0].text, 'CAD');
    assert.equal(result.report.imported, 1);
});

test('text import refuses unsupported clipping, missing font semantics and locked destination layers atomically', () => {
    const document = createLcadDocument(); const before = structuredClone(document);
    assert.throws(() => importDrawingPdfText(document, page([{ ...record, clips: [{ paths: [{ parts: [{ type: 'spline' }] }] }] }])));
    assert.throws(() => importDrawingPdfText(document, { paths: { texts: [record], unsupported: ['text-font'] } }));
    assert.throws(() => importDrawingPdfText(document, page([record]), { x: 1e10 }));
    assert.deepEqual(document, before);
    document.content.layers.find(layer => layer.id === document.content.activeLayerId).locked = true;
    assert.throws(() => importDrawingPdfText(document, page([record])));
});

test('real rotated PDF text imports as editable fitted text while invisible OCR text stays excluded', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); const { createCanvas } = await import('@napi-rs/canvas');
    const pdf = new jsPDF({ unit: 'mm', format: [100, 100] });
    pdf.setFontSize(12); pdf.text('Editable PDF', 10, 20, { angle: 15 });
    pdf.text('Invisible', 20, 50, { renderingMode: 'invisible' });
    const decoded = await readDrawingPdfPage(new Uint8Array(pdf.output('arraybuffer')), { pdfjs, createCanvas });
    const result = importDrawingPdfText(createLcadDocument(), decoded, { scale: 100 });
    assert.equal(result.content.entities.length, 1); const text = result.content.entities[0];
    assert.equal(text.text, 'Editable PDF'); assert.equal(text.fitWidth, true);
    assert.ok(Math.abs(text.affineFrame.e - 1) < 1e-6); assert.ok(Math.abs(text.affineFrame.f - 2) < 1e-6);
    assert.ok(Math.abs(Math.atan2(text.affineFrame.b, text.affineFrame.a) + Math.PI / 12) < 1e-7);
});
