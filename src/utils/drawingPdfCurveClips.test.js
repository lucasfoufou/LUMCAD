import { importDrawingPdfFills } from './drawingPdfFillImport.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { createCanvas } from '@napi-rs/canvas';
import { readDrawingPdfPage } from './drawingPdfReader.js';
import { importDrawingPdfCombined } from './drawingPdfCombinedImport.js';
import { decodeDrawingPdfPath } from './drawingPdfGeometry.js';
import { normalizeDrawingBlockClip, drawingBlockClipShape, clipDrawingSnapEntity, parseDrawingBlockClipInput } from './drawingBlockClip.js';
import { drawingClipShapeContainsPoint, drawingClipShapeBounds } from './drawingClipPaths.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference, materializeDrawingBlockReference } from './drawingBlocks.js';
import { drawingSnapEntities } from './drawingBlockSnapping.js';
import { entityMatchesSelectionWindow } from './drawingSelection.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg } from './drawingClipboard.js';

const rectangle = (a,b) => decodeDrawingPdfPath([0,a,a,1,b,a,1,b,b,1,a,b,4])[0];

test('compound block clips preserve winding holes, reflected snaps, selection, archive and SVG', () => {
    const document = createLcadDocument();
    const line = { id: 'source', type: 'line', layerId: document.content.activeLayerId, x1: -1,y1: 5,x2: 11,y2: 5 };
    for (const rule of ['evenodd','nonzero']) {
        const blockClip = normalizeDrawingBlockClip({ paths: [rectangle(0,10),rectangle(3,7)], rule });
        assert.equal(parseDrawingBlockClipInput('OFF',blockClip).blockClip.enabled,false);
        const block = createAnonymousDrawingBlock([line], { basePoint: { x: 0,y: 0 } });
        const reference = { ...createAnonymousDrawingBlockReference(block), blockClip, transform: { a: -1,b: 0,c: 0,d: 1,e: 20,f: 0 } };
        const content = { ...document.content, entities: [reference], blocks: [block] };
        const shape = drawingBlockClipShape(reference,{world:true});
        assert.equal(drawingClipShapeContainsPoint(shape,{x:15,y:5}),rule==='nonzero');
        const snaps = drawingSnapEntities(content);
        assert.deepEqual(snaps.map(entity => [entity.x1,entity.x2]), rule==='evenodd' ? [[20,17],[13,10]] : [[20,17],[17,13],[13,10]]);
        assert.equal(entityMatchesSelectionWindow(reference,{minX:14,minY:4,maxX:16,maxY:6,mode:'crossing'}),rule==='nonzero');
        assert.equal(materializeDrawingBlockReference(reference,[block]).length,0);
        const result = { ...document,content };
        const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
        assert.deepEqual(restored.content.entities[0].blockClip,blockClip);
        const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(restored,[reference.id]));
        assert.match(svg,new RegExp(`clip-rule="${rule}"`));
    }
});

test('real PDF curved compound clipping imports as editable native blocks with exact cubic contours', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = new jsPDF({unit:'mm',format:[100,100]});
    pdf.rect(10,10,80,80,null); pdf.circle(50,50,20,null); pdf.clipEvenOdd(); pdf.discardPath();
    pdf.setFillColor(255,0,0);pdf.rect(0,0,100,100,'F');
    pdf.text('Clipped text',20,50);
    const canvas = createCanvas(2,2);canvas.getContext('2d').fillRect(0,0,2,2);
    pdf.addImage(canvas.toDataURL('image/png'),'PNG',40,40,20,20);
    const page = await readDrawingPdfPage(new Uint8Array(pdf.output('arraybuffer')),{pdfjs,createCanvas,readImages:true});
    const result = importDrawingPdfCombined(createLcadDocument(),page,{scale:100});
    assert.equal(result.content.entities.length,2);
    assert.equal(result.assets.length,0);
    assert.ok(result.content.entities.every(entity=>entity.type==='blockReference'));
    const clip = result.content.entities[0].blockClip;
    assert.equal(clip.rule,'evenodd');assert.equal(clip.paths.length,2);
    assert.equal(clip.paths[1].parts.filter(part=>part.type==='spline').length,4);
    const shape = drawingBlockClipShape(result.content.entities[0],{world:true});
    assert.equal(drawingClipShapeContainsPoint(shape,{x:5,y:5}),false);
    assert.equal(drawingClipShapeContainsPoint(shape,{x:2,y:5}),true);
    const clipped = clipDrawingSnapEntity({type:'line',id:'line',x1:0,y1:5,x2:10,y2:5},shape);
    assert.equal(clipped.length,2);
    for (const [part,start,end] of [[clipped[0],1,3],[clipped[1],7,9]]) {
        assert.ok(Math.abs(part.x1-start)<1e-6);assert.ok(Math.abs(part.x2-end)<1e-6);
    }
    assert.deepEqual(Object.values(drawingClipShapeBounds(shape)).map(n=>Math.round(n)),[1,1,9,9]);
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(result,result.selectedIds));
    assert.match(svg, /clip-rule="evenodd"/);assert.match(svg, / C /);
});

test('curve clipping rejects malformed, open and over-limit native contours', () => {
    assert.equal(normalizeDrawingBlockClip({ paths: [{parts:[{type:'spline',controlPoints:'abcd'}]}] }),null);
    assert.equal(normalizeDrawingBlockClip({ paths: [{parts:[{type:'line',x1:0,y1:0,x2:1,y2:1}]}] }),null);
    assert.equal(normalizeDrawingBlockClip({ paths: Array(1025).fill(rectangle(0,1)) }),null);
    const large = rectangle(0,1); large.parts[0].x1 = 1e10;
    assert.equal(normalizeDrawingBlockClip({ paths: [large] }),null);
});


test('PDF clips beyond the bounded classification budget reject atomically instead of hiding objects', () => {
    const document = createLcadDocument(); const before = structuredClone(document);
    const paths = [{ closed: true, parts: [
        { type: 'spline', controlPoints: [{x:0,y:0},{x:0,y:1e8},{x:1e8,y:1e8},{x:1e8,y:0}] },
        { type: 'line',x1:1e8,y1:0,x2:0,y2:0 },
    ] }];
    const page = { paths: { records: [{ paint: 'fill', visible: true, fillAlpha: 1, fill: '#ff0000', paths: [rectangle(1,2)], clips: [{paths,rule:'nonzero'}] }] } };
    assert.throws(() => importDrawingPdfFills(document,page));
    assert.deepEqual(document,before);
});
