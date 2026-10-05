import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { extractDrawingPdfPaths } from './drawingPdfOperators.js';
import { PDF_POINT_METRES } from './drawingPdfGeometry.js';

test('real PDF.js operator extraction preserves physical coordinates, graphics state and exact curves', async () => {
    const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = new jsPDF({ unit: 'pt', format: [200, 200] });
    pdf.setDrawColor('#ff0000'); pdf.line(10, 20, 80, 20);
    pdf.saveGraphicsState(); pdf.setDrawColor('#0000ff'); pdf.rect(30, 40, 20, 10, 'S'); pdf.restoreGraphicsState();
    pdf.line(10, 90, 80, 90);
    const task = getDocument({ data: new Uint8Array(pdf.output('arraybuffer')), isEvalSupported: false, useSystemFonts: true });
    try {
        const source = await task.promise; const page = await source.getPage(1);
        const result = extractDrawingPdfPaths(await page.getOperatorList(), OPS, page.getViewport({ scale: 1 }));
        assert.deepEqual(result.unsupported, []);
        assert.deepEqual(result.records.map(item => item.stroke), ['#ff0000', '#0000ff', '#ff0000']);
        const line = result.records[0].paths[0].parts[0];
        assert.ok(Math.abs(line.x1 - 10 * PDF_POINT_METRES) < 1e-10);
        assert.ok(Math.abs(line.y1 - 20 * PDF_POINT_METRES) < 1e-10);
        assert.equal(result.records[1].paths[0].closed, true);
    } finally { await task.destroy(); }
});

test('optional content and clipping are retained per record and graphics-state restoration restores the prior clip', () => {
    const ops = { save: 10, restore: 11, transform: 12, stroke: 20, endPath: 28, clip: 29, eoClip: 30,
        beginMarkedContent: 69, beginMarkedContentProps: 70, endMarkedContent: 71, constructPath: 91 };
    const rect = [0, 0, 0, 1, 10, 0, 1, 10, 10, 1, 0, 10, 4];
    const line = [0, 0, 0, 1, 20, 20];
    const list = { fnArray: [10, 29, 91, 70, 91, 71, 11, 91], argsArray: [[], [], [28, [rect]], ['OC', { type: 'OCG', id: 'layer' }], [20, [line]], [], [], [20, [line]]] };
    const result = extractDrawingPdfPaths(list, ops, { transform: [1, 0, 0, 1, 0, 0] }, { isVisible: item => item.id !== 'layer' });
    assert.equal(result.records[0].visible, false);
    assert.equal(result.records[0].clips.length, 1);
    assert.equal(result.records[0].optionalContent[0].id, 'layer');
    assert.equal(result.records[1].visible, true);
    assert.equal(result.records[1].clips.length, 0);
    assert.throws(() => extractDrawingPdfPaths(list, ops, { transform: [1, 0, 0, 1, 0, 0] }, { limit: 2 }));
});

test('pattern paints are marked unsupported without reusing the previous solid colour during import', () => {
    const ops = {setFillRGBColor:1,setFillColorN:2,save:3,restore:4,constructPath:5,fill:6};
    const path = [0,0,0,1,1,0,1,1,1,4];
    const list = {fnArray:[1,5,2,5,3,1,5,4,5],argsArray:[['#ff0000'],[6,[path]],[{name:'pattern'}],[6,[path]],[],['#0000ff'],[6,[path]],[],[6,[path]]]};
    const result = extractDrawingPdfPaths(list,ops,{transform:[1,0,0,1,0,0]});
    assert.deepEqual(result.records.map(record=>record.fillSupported),[true,false,true,false]);
    assert.deepEqual(result.unsupported,['pattern-fill']);
});
