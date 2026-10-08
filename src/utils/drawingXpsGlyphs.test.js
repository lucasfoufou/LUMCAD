import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8 } from 'fflate';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { Resvg } from '@resvg/resvg-js';
import { createDrawingXpsGlyphReader } from './drawingXpsGlyphs.js';
import { readDrawingXpsScene, drawingXpsSceneSvg } from './drawingXpsScene.js';

function font(cff = false) {
    const tables=new Map();
    const make=(tag,size)=>{const bytes=new Uint8Array(size);tables.set(tag,bytes);return new DataView(bytes.buffer);};
    const head=make('head',54);head.setUint32(0,0x10000);head.setUint32(12,0x5f0f3cf5);head.setUint16(18,1000);
    const hhea=make('hhea',36);hhea.setUint32(0,0x10000);hhea.setInt16(4,800);hhea.setInt16(6,-200);hhea.setUint16(34,2);
    const hmtx=make('hmtx',8);hmtx.setUint16(0,600);hmtx.setUint16(4,600);
    const maxp=make('maxp',32);maxp.setUint32(0,0x10000);maxp.setUint16(4,2);
    const loca=make('loca',6);loca.setUint16(4,17);
    const glyf=make('glyf',34);glyf.setInt16(0,1);glyf.setUint16(10,3);tables.get('glyf').set([1,1,1,1],14);
    [0,500,0,-500,0,0,700,0].forEach((n,i)=>glyf.setInt16(18+i*2,n));
    const cmap=make('cmap',40);cmap.setUint16(2,1);cmap.setUint16(4,3);cmap.setUint16(6,10);cmap.setUint32(8,12);
    cmap.setUint16(12,12);cmap.setUint32(16,28);cmap.setUint32(24,1);cmap.setUint32(28,65);cmap.setUint32(32,65);cmap.setUint32(36,1);
    if (cff) {
        const program = [139,139,21,28,1,244,139,139,28,2,188,28,254,12,139,139,28,253,68,5,14];
        tables.set('CFF ', Uint8Array.from([1,0,4,4,0,1,1,1,2,65,0,1,1,1,3,160,17,0,0,0,0,
            0,2,1,1,2,program.length+2,14,...program]));
    }
    const size=12+tables.size*16+[...tables.values()].reduce((s,b)=>s+Math.ceil(b.length/4)*4,0);
    const bytes=new Uint8Array(size);const view=new DataView(bytes.buffer);view.setUint32(0,cff ? 0x4f54544f : 0x10000);view.setUint16(4,tables.size);
    let offset=12+tables.size*16;let i=0;
    for(const [tag,data] of tables){const record=12+i++*16;bytes.set(strToU8(tag),record);view.setUint32(record+8,offset);view.setUint32(record+12,data.length);bytes.set(data,offset);offset+=Math.ceil(data.length/4)*4;}
    return bytes;
}

test('Glyphs scenes retain cluster advances and offsets without shaping the supplied Unicode again', () => {
    const scene = (unicodeString, indices) => readDrawingXpsScene(new Map([
        ['page', strToU8(`<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="100" Height="60"><Glyphs FontUri="font.ttf" FontRenderingEmSize="20" OriginX="5" OriginY="30" UnicodeString="${unicodeString}" Indices="${indices}" Fill="#163e70"/></FixedPage>`)],
        ['font.ttf', font()],
    ]), { path: 'page' });
    const explicit = drawingXpsSceneSvg(scene('', '1,70;1,30;1,0,-10,20;1'));
    // A ligature, a decomposed glyph cluster and a supplementary-plane character.
    assert.equal(drawingXpsSceneSvg(scene('fiA😀', '(2:1)1,70;(1:2)1,30;1,0,-10,20;(2:1)1')), explicit);
    // The valid prefix must not hide a malformed final UTF-16 cluster.
    assert.throws(() => scene('fiA😀', '(2:1)1,70;(1:2)1,30;1,0,-10,20;1'), /dwfxGlyphs/);
});

test('XPS glyph placement uses embedded metrics and explicit hundredths-em advances and offsets',()=>{
    const read=createDrawingXpsGlyphReader(new Map([['font.ttf',font()]]),'page');
    const input={fontUri:'font.ttf',unicodeString:'AA',fontSize:20,x:5,y:30};
    const defaultRun=read(input);assert.equal(defaultRun.paths.length,2);
    assert.equal(defaultRun.paths[0].parts[0].x1,5);assert.equal(defaultRun.paths[1].parts[0].x1,17);
    const explicit=read({...input,indices:'1,80,10,20;1,60'});
    assert.equal(explicit.paths[0].parts[0].x1,7);assert.equal(explicit.paths[0].parts[0].y1,26);
    assert.equal(explicit.paths[1].parts[0].x1,21);
    assert.throws(()=>read({...input,indices:'2,60'}),/dwfxFont/);
    assert.throws(()=>read({...input,indices:'1,-2'}),/dwfxGlyphs/);
    assert.equal(read({...input,indices:'(2:1)1'}).paths.length,1);
    const split=read({...input,unicodeString:'A',indices:'(1:2)1,30;1,0,-10,20'});
    assert.equal(split.paths.length,2);
    assert.equal(split.paths[1].parts[0].x1,9);
    assert.equal(split.paths[1].parts[0].y1,26);
    assert.throws(()=>read(input,{maxParts:3}),/dwfxLimit/);
});

test('XPS bidi parity changes advance and offset direction without mirroring glyph outlines', () => {
    const read = createDrawingXpsGlyphReader(new Map([['font.ttf', font()]]), 'page');
    const input = { fontUri: 'font.ttf', unicodeString: 'AA', fontSize: 20, x: 80, y: 30,
        indices: '1,80,10,20;1,0,-10,0' };
    const left = read(input);
    const right = read({ ...input, bidiLevel: 1 });
    assert.deepEqual(read({ ...input, bidiLevel: 60 }), left);
    assert.deepEqual(read({ ...input, bidiLevel: 61 }), right);
    const first = right.paths[0].parts[0];
    assert.equal(first.x1, 66); // 80 - 12 intrinsic advance - 2 offset.
    assert.equal(first.y1, 26);
    assert.equal(first.x2, 76); // Positive contour direction: no mirror.
    assert.equal(right.paths[1].parts[0].x1, 54); // 80 - 16 run advance - 12 + 2.
    assert.equal(right.paths[1].parts[0].y1, 30);
    for (const bidiLevel of [-1, 62, 0.5, NaN, '1']) {
        assert.throws(() => read({ ...input, bidiLevel }), /dwfxGlyphs/);
    }
});

test('Sideways glyphs rotate around the top-center origin and use vertical advances', () => {
    const read = createDrawingXpsGlyphReader(new Map([['font.ttf', font()]]), 'page');
    const input = { fontUri: 'font.ttf', unicodeString: 'AA', fontSize: 20, x: 5, y: 30, isSideways: true };
    const run = read(input);
    assert.equal(run.paths[0].parts[0].x1, 21);
    assert.equal(run.paths[0].parts[0].y1, 36);
    assert.equal(run.paths[0].parts[0].x2, 21);
    assert.equal(run.paths[0].parts[0].y2, 26);
    assert.equal(run.paths[1].parts[0].x1, 41);
    const shifted = read({ ...input, indices: '1,30,10,20;1' });
    assert.equal(shifted.paths[0].parts[0].x1, 23);
    assert.equal(shifted.paths[0].parts[0].y1, 32);
    assert.equal(shifted.paths[1].parts[0].x1, 27);
    assert.deepEqual(read({ ...input, bidiLevel: 2 }), run);
    assert.throws(() => read({ ...input, bidiLevel: 1 }), /dwfxGlyphs/);
});

test('Italic simulation shears contours by twenty degrees without changing glyph advances or offsets', () => {
    const read = createDrawingXpsGlyphReader(new Map([['font.ttf', font()]]), 'page');
    const input = { fontUri: 'font.ttf', unicodeString: 'AA', fontSize: 20, x: 80, y: 30,
        indices: '1,80,10,20;1,0,-10,0' };
    const shift = Math.tan(20 * Math.PI / 180) * 14;
    for (const options of [{}, { bidiLevel: 1 }, { isSideways: true }]) {
        const normal = read({ ...input, ...options });
        const italic = read({ ...input, ...options, style: 'ItalicSimulation' });
        for (let i = 0; i < 2; i++) {
            assert.deepEqual(italic.paths[i].parts[0], normal.paths[i].parts[0]);
            const top = italic.paths[i].parts[2]; const before = normal.paths[i].parts[2];
            if (options.isSideways) {
                assert.equal(top.x1, before.x1);
                assert.ok(Math.abs(top.y1 - before.y1 + shift) < 1e-10);
            } else {
                assert.equal(top.y1, before.y1);
                assert.ok(Math.abs(top.x1 - before.x1 - shift) < 1e-10);
            }
        }
    }
    assert.throws(() => read({ ...input, style: 'Unknown' }), /dwfxUnsupported/);
});

test('Bold simulation increases only default advances and budgets both outline representations', () => {
    const read = createDrawingXpsGlyphReader(new Map([['font.ttf', font()]]), 'page');
    const input = { fontUri: 'font.ttf', unicodeString: 'AA', fontSize: 100, x: 10, y: 90, style: 'BoldSimulation' };
    const run = read(input);
    assert.equal(run.paths[1].parts[0].x1, 72);
    assert.equal(run.boldMask.width, 2);
    assert.equal(read({ ...input, indices: '1,60;1' }).paths[1].parts[0].x1, 70);
    assert.equal(read({ ...input, isSideways: true }).paths[1].parts[0].x1, 192);
    assert.equal(read({ ...input, bidiLevel: 1 }).paths[1].parts[0].x1, -112);
    assert.throws(() => read(input, { maxParts: 12 }), /dwfxLimit/);
    assert.equal(read({ ...input, fontSize: 0 }).boldMask, undefined);
});

test('CFF outlines share TrueType glyph placement, clusters, directional runs and style masks', () => {
    const readers = [false, true].map(cff => createDrawingXpsGlyphReader(new Map([['font.ttf', font(cff)]]), 'page'));
    for (const options of [{}, { bidiLevel: 1 }, { isSideways: true }, { style: 'BoldItalicSimulation' }]) {
        const input = { fontUri: 'font.ttf', unicodeString: 'fiA', indices: '(2:1)1,80,10,20;1',
            fontSize: 20, x: 80, y: 30, ...options };
        const [truetype, cff] = readers.map(read => read(input));
        const positions = run => run.paths.map(path => path.parts.map(({ x1, y1, x2, y2 }) => [x1, y1, x2, y2]));
        assert.deepEqual(positions(cff), positions(truetype));
        assert.equal(cff.boldMask?.width, truetype.boldMask?.width);
    }
});

test('Bold XPS masks expand curves once while retaining brush opacity and bold-before-italic order', async () => {
    const render = async style => {
        const xml = `<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="200" Height="110"><Glyphs FontUri="font.ttf" FontRenderingEmSize="100" OriginX="10" OriginY="90" UnicodeString="A" StyleSimulations="${style}" Fill="#80FF0000"/></FixedPage>`;
        const scene = readDrawingXpsScene(new Map([['page', strToU8(xml)], ['font.ttf', font()]]), { path: 'page' });
        const canvas = createCanvas(200, 110); const context = canvas.getContext('2d');
        context.drawImage(await loadImage(new Resvg(drawingXpsSceneSvg(scene)).render().asPng()), 0, 0);
        return (x, y) => [...context.getImageData(x, y, 1, 1).data];
    };
    const bold = await render('BoldSimulation');
    assert.deepEqual(bold(9, 50), [255, 0, 0, 128]);
    assert.deepEqual(bold(10, 50), [255, 0, 0, 128]);
    assert.equal(bold(8, 50)[3], 0);
    assert.equal(bold(30, 90)[3], 128);
    const italic = await render('BoldItalicSimulation');
    assert.equal(italic(9, 50)[3], 0);
    assert.equal(italic(25, 50)[3], 128);
    assert.equal(italic(80, 50)[3], 0);
});

test('XPS scene applies right-to-left placement before visual transforms and clipping', async () => {
    const xml = '<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="100" Height="60"><Glyphs FontUri="font.ttf" FontRenderingEmSize="20" OriginX="80" OriginY="30" UnicodeString="AA" BidiLevel="3" Fill="#FF0000" RenderTransform="1 0 0 1 -10 0" Clip="M0 0H68V60H0Z"/></FixedPage>';
    const files = new Map([['page', strToU8(xml)], ['font.ttf', font()]]);
    const scene = readDrawingXpsScene(files, { path: 'page' });
    const canvas = createCanvas(100, 60); const context = canvas.getContext('2d');
    context.drawImage(await loadImage(new Resvg(drawingXpsSceneSvg(scene)).render().asPng()), 0, 0);
    assert.deepEqual([...context.getImageData(50, 20, 1, 1).data], [255, 0, 0, 255]);
    assert.equal(context.getImageData(62, 20, 1, 1).data[3], 0);
    assert.equal(context.getImageData(82, 20, 1, 1).data[3], 0);
    files.set('page', strToU8(xml.replace('BidiLevel="3"', 'BidiLevel="0.5"')));
    assert.throws(() => readDrawingXpsScene(files, { path: 'page' }), /dwfxGlyphs/);
});

test('Glyphs scene paints embedded outlines through the common fill, transform and clipping renderer',async()=>{
    const xml='<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="80" Height="60"><Glyphs FontUri="font.ttf" FontRenderingEmSize="20" OriginX="5" OriginY="30" UnicodeString="AA" Fill="#FF0000" RenderTransform="1 0 0 1 10 0" Clip="M0 0H25V60H0Z"/></FixedPage>';
    const files=new Map([['page',strToU8(xml)],['font.ttf',font()]]);
    const scene=readDrawingXpsScene(files,{path:'page'});const canvas=createCanvas(80,60);const context=canvas.getContext('2d');
    context.drawImage(await loadImage(new Resvg(drawingXpsSceneSvg(scene)).render().asPng()),0,0);
    assert.deepEqual([...context.getImageData(18,20,1,1).data],[255,0,0,255]);
    assert.equal(context.getImageData(36,20,1,1).data[3],0);
    files.set('page',strToU8(xml.replace('UnicodeString="AA"','UnicodeString="AA" IsSideways="true" BidiLevel="1"')));
    assert.throws(()=>readDrawingXpsScene(files,{path:'page'}),/dwfxGlyphs/);
});
