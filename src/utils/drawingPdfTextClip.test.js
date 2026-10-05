import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { createCanvas } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { readDrawingPdfPage } from './drawingPdfReader.js';
import { importDrawingPdfCombined } from './drawingPdfCombinedImport.js';
import { drawingPdfSnapEntities } from './drawingPdfUnderlay.js';
import { drawingBlockClipShape } from './drawingBlockClip.js';
import { drawingClipShapeContainsPoint } from './drawingClipPaths.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const resourceOptions = { standardFontDataUrl: fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)) };

test('real PDF text masks retain glyph contours and holes for imported fills, images and vector snaps', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = new jsPDF({unit:'mm',format:[100,100]});
    pdf.setFontSize(100);pdf.text('O',20,60,{renderingMode:'addToPathForClipping'});
    pdf.setFillColor(255,0,0);pdf.rect(0,0,100,100,'F');
    const canvas = createCanvas(2,2);canvas.getContext('2d').fillRect(0,0,2,2);
    pdf.addImage(canvas.toDataURL('image/png'),'PNG',20,20,50,50);
    pdf.line(0,45,100,45);
    const page = await readDrawingPdfPage(new Uint8Array(pdf.output('arraybuffer')),{pdfjs,createCanvas,resourceOptions,readImages:true});
    assert.ok(!page.paths.unsupported.includes('text-clip'));
    assert.equal(page.paths.texts[0].visible,false);
    const result = importDrawingPdfCombined(createLcadDocument(),page,{scale:100});
    assert.deepEqual(result.content.entities.map(entity=>entity.type),['blockReference','blockReference','line','line']);
    assert.equal(result.assets.length,1);
    const shape = drawingBlockClipShape(result.content.entities[0],{world:true});
    assert.equal(shape.paths.length,2);
    assert.ok(shape.paths.some(path=>path.parts.some(part=>part.type==='spline')));
    assert.equal(drawingClipShapeContainsPoint(shape,{x:3.37,y:4.8}),false);
    const strokes = drawingPdfSnapEntities(page.paths.records.filter(record=>record.paint==='stroke'));
    assert.equal(strokes.length,2);
    assert.ok(strokes.every(part=>part.x1>0.02 && part.x2<0.05));
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(restored.content.entities,result.content.entities);
});

test('text clipping accumulates visible glyph runs until ET and restores the saved graphics clip', async () => {
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { extractDrawingPdfPaths } = await import('./drawingPdfOperators.js');
    const font = { fontMatrix: [0.001,0,0,0.001,0,0], fallbackName: 'sans-serif' };
    const glyph = { unicode:'A',fontChar:'A',width:1000,isInFont:true };
    const list = { fnArray: [],argsArray: [] };
    const add = (name,...args) => {list.fnArray.push(OPS[name]);list.argsArray.push(args);};
    add('save');add('beginText');add('setFont','font',10);add('setTextRenderingMode',7);
    add('setTextMatrix',[1,0,0,1,20,30]);add('showText',[glyph]);
    add('beginMarkedContentProps','OC',{id:'hidden'});add('showText',[glyph]);add('endMarkedContent');
    add('showText',[glyph]);add('endText');
    add('constructPath',OPS.stroke,[[0,0,35,1,100,35]]);
    add('restore');add('constructPath',OPS.stroke,[[0,0,35,1,100,35]]);
    const result = extractDrawingPdfPaths(list,OPS,{transform:[1,0,0,1,0,0]},{getFont:()=>font,isVisible:()=>false,
        getGlyphPath:()=>[0,0,0,1,0.5,0,1,0.5,1,1,0,1,4]});
    assert.equal(result.records[0].clips[0].paths.length,2);
    assert.equal(result.records[1].clips.length,0);
    assert.ok(!result.unsupported.includes('text-clip'));
    const snaps = drawingPdfSnapEntities([result.records[0]]);
    assert.equal(snaps.length,2);
    const mm = 0.0254/72;
    assert.ok(Math.abs(snaps[0].x1/mm-20)<1e-8);
    assert.ok(Math.abs(snaps[1].x1/mm-40)<1e-8);
});

test('a clipping-only space yields an empty clip and glyph outlines obey the page segment budget', async () => {
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { extractDrawingPdfPaths } = await import('./drawingPdfOperators.js');
    const font = { fontMatrix: [0.001,0,0,0.001,0,0] };
    const list = {fnArray:[OPS.beginText,OPS.setFont,OPS.setTextRenderingMode,OPS.showText,OPS.endText,OPS.constructPath],
        argsArray:[[],['font',10],[7],[[{unicode:' ',fontChar:' ',width:500,isInFont:true}]],[],[OPS.fill,[[0,0,0,1,10,0,1,10,10,1,0,10,4]]]]};
    const options = {getFont:()=>font,getGlyphPath:()=>[]};
    const paths = extractDrawingPdfPaths(list,OPS,{transform:[1,0,0,1,0,0]},options);
    assert.deepEqual(paths.records[0].clips[0].paths,[]);
    assert.equal(drawingPdfSnapEntities(paths.records).length,0);
    assert.throws(()=>extractDrawingPdfPaths(list,OPS,{transform:[1,0,0,1,0,0]},
        {...options,limit:2,getGlyphPath:()=>[0,0,0,1,1,0,1,1,1,1,0,1,4]}));
});
