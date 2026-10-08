import test from 'node:test';
import assert from 'node:assert/strict';
import { readDrawingXpsFontResource, createDrawingXpsVerticalMetrics } from './drawingXpsFonts.js';

function fixture(signature = 0x00010000) {
    const bytes = new Uint8Array(40); const view = new DataView(bytes.buffer);
    view.setUint32(0, signature); view.setUint16(4, 1);
    bytes.set(new TextEncoder().encode('head'), 12);
    view.setUint32(20, 28); view.setUint32(24, 12);
    bytes.set([1,2,3,4,5,6,7,8,9,10,11,12],28);
    return bytes;
}

function collection(version = 0x00020000) {
    const bytes = new Uint8Array(112); const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x74746366); view.setUint32(4, version); view.setUint32(8, 2);
    view.setUint32(12, 32); view.setUint32(16, 72);
    for (const [directory, data] of [[32, 60], [72, 100]]) {
        bytes.set(fixture().subarray(0, 28), directory);
        view.setUint32(directory + 20, data);
        bytes.fill(data, data, data + 12);
    }
    return bytes;
}

test('XPS collections select indexed faces and accept shared tables before the selected directory', () => {
    for (const version of [0x00010000, 0x00020000]) {
        const bytes = collection(version); const before = bytes.slice();
        const files = new Map([['font.ttc', bytes]]);
        const read = index => readDrawingXpsFontResource(files, 'page', `font.ttc#${index}`);
        assert.equal(read(0).tables.get('head').bytes[0], 60);
        assert.equal(read(1).tables.get('head').bytes[0], 100);
        assert.equal(read(1).faceIndex, 1);
        assert.deepEqual(bytes, before);
        new DataView(bytes.buffer).setUint32(92, 60);
        assert.equal(read(1).tables.get('head').bytes[0], 60);
        assert.throws(() => read(2), /dwfxFont/);
    }
    const source = collection();
    const key = [255,238,221,204,187,170,153,136,119,102,85,68,51,34,17,0];
    const encoded = source.map((value, i) => i < 32 ? value ^ key[i % 16] : value);
    const name = '00112233-4455-6677-8899-aabbccddeeff.odttf';
    const result = readDrawingXpsFontResource(new Map([[name, encoded]]), 'page', `${name}#1`);
    assert.equal(result.obfuscated, true);
    assert.equal(result.tables.get('head').bytes[0], 100);
    assert.deepEqual(result.bytes, source);
});

test('XPS collections reject invalid directories, metadata overlap and malformed signature bounds', () => {
    const read = bytes => readDrawingXpsFontResource(new Map([['font.ttc', bytes]]), 'page', 'font.ttc#1');
    for (const [offset, value] of [[4, 0], [8, 0], [8, 257], [12, 16], [16, 33], [16, 112],
        [16, 32], [32, 0], [92, 76], [92, 4], [92, 108], [20, 1], [24, 4], [28, 100]]) {
        const bytes = collection(); new DataView(bytes.buffer).setUint32(offset, value);
        assert.throws(() => read(bytes), /dwfxFont|dwfxLimit/);
    }
    assert.throws(() => read(collection().slice(0, 28)), /dwfxFont/);
});

test('XPS vertical metrics use per-glyph bearings, final advance reuse and ordered fallbacks', () => {
    const horizontal = { glyphCount: 3, ascender: 800, descender: -200,
        glyph(index) { if (index < 0 || index >= 3) throw new Error('dwfxFont'); return { advanceWidth: 600 }; } };
    const tables = new Map();
    const make = (name, size) => {
        const bytes = new Uint8Array(size); tables.set(name, { bytes }); return new DataView(bytes.buffer);
    };
    assert.deepEqual(createDrawingXpsVerticalMetrics({ tables }, horizontal)(0, 700), { originX: 300, originY: 800, advanceWidth: 1000 });
    const windows = make('OS/2', 72); windows.setInt16(68, 900); windows.setInt16(70, -300);
    assert.deepEqual(createDrawingXpsVerticalMetrics({ tables }, horizontal)(0, 700), { originX: 300, originY: 900, advanceWidth: 1200 });
    const header = make('vhea', 36); header.setUint32(0, 0x11000); header.setUint16(34, 2);
    const metrics = make('vmtx', 10); metrics.setUint16(0, 1100); metrics.setInt16(2, 80);
    metrics.setUint16(4, 1300); metrics.setInt16(6, 100); metrics.setInt16(8, -20);
    const read = createDrawingXpsVerticalMetrics({ tables }, horizontal);
    assert.deepEqual(read(0, 700), { originX: 300, originY: 780, advanceWidth: 1100 });
    assert.deepEqual(read(2, 650), { originX: 300, originY: 630, advanceWidth: 1300 });
    header.setUint16(34, 4);
    assert.throws(() => createDrawingXpsVerticalMetrics({ tables }, horizontal), /dwfxFont/);
    header.setUint16(34, 2); tables.delete('vmtx');
    assert.throws(() => createDrawingXpsVerticalMetrics({ tables }, horizontal), /dwfxFont/);
    tables.delete('vhea'); tables.set('OS/2', { bytes: new Uint8Array(70) });
    assert.throws(() => createDrawingXpsVerticalMetrics({ tables }, horizontal), /dwfxFont/);
});

test('CFF VORG uses signed per-glyph origins with a default and rejects invalid record order', () => {
    const bytes = new Uint8Array(16); const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x10000); view.setInt16(4, 880); view.setUint16(6, 2);
    view.setUint16(8, 0); view.setInt16(10, 900); view.setUint16(12, 2); view.setInt16(14, -10);
    const resource = { format: 'cff', tables: new Map([['VORG', { bytes }]]) };
    const horizontal = { glyphCount: 3, ascender: 800, descender: -200, glyph: () => ({ advanceWidth: 600 }) };
    const read = createDrawingXpsVerticalMetrics(resource, horizontal);
    assert.equal(read(0, 700).originY, 900);
    assert.equal(read(1, 700).originY, 880);
    assert.equal(read(2, 700).originY, -10);
    view.setUint16(12, 0);
    assert.throws(() => createDrawingXpsVerticalMetrics(resource, horizontal), /dwfxFont/);
    view.setUint16(12, 3);
    assert.throws(() => createDrawingXpsVerticalMetrics(resource, horizontal), /dwfxFont/);
});

test('XPS embedded font transport owns raw TrueType/CFF tables and resolves page-relative parts', () => {
    for (const signature of [0x00010000,0x4f54544f]) {
        const source = fixture(signature); const before = source.slice();
        const result = readDrawingXpsFontResource(new Map([['fonts/font.otf',source]]),'pages/one.fpage','../fonts/font.otf#0');
        assert.equal(result.format,signature === 0x00010000 ? 'truetype' : 'cff');
        assert.deepEqual(result.tables.get('head').bytes,before.subarray(28));
        assert.equal(result.obfuscated,false);
        result.bytes[28]=99;
        assert.deepEqual(source,before);
    }
});

test('XPS font GUID XOR restores exactly the first 32 bytes in the prescribed byte order', () => {
    const source = fixture();
    const key = [255,238,221,204,187,170,153,136,119,102,85,68,51,34,17,0];
    const encoded = source.map((byte,index)=>index<32 ? byte ^ key[index%16] : byte);
    const before = encoded.slice();
    const path='fonts/00112233-4455-6677-8899-aabbccddeeff.odttf';
    const result = readDrawingXpsFontResource(new Map([[path,encoded]]),'page.fpage',path);
    assert.equal(result.obfuscated,true);
    assert.deepEqual(result.bytes,source);
    assert.deepEqual(encoded,before);
});

test('XPS font transport rejects missing, malformed, oversized and unsupported resources', () => {
    const read=(bytes,uri='font.ttf',options)=>readDrawingXpsFontResource(new Map([['font.ttf',bytes]]),'page',uri,options);
    for (const uri of ['font.ttf#1','font.ttf#bad','font.ttf#0#0','https://host/font.ttf','../font.ttf','missing.ttf']) assert.throws(()=>read(fixture(),uri));
    assert.throws(()=>read(fixture(),'font.ttf',{maxBytes:20}),/dwfxLimit/);
    assert.throws(()=>read(fixture(0x74746366)),/dwfxFont/);
    const truncated=fixture().slice(0,20);assert.throws(()=>read(truncated),/dwfxFont/);
    for (const [offset,value] of [[20,100],[20,29],[20,4],[24,100]]) {
        const bytes=fixture();new DataView(bytes.buffer).setUint32(offset,value);assert.throws(()=>read(bytes),/dwfxFont/);
    }
    const bytes=fixture();bytes[12]=0;assert.throws(()=>read(bytes),/dwfxFont/);
});

test('XPS horizontal metrics preserve em units, signed bearings and repeated final advance', async () => {
    const { readDrawingXpsFontMetrics } = await import('./drawingXpsFonts.js');
    const tables = new Map();
    const make=(name,size)=>{const bytes=new Uint8Array(size);tables.set(name,{bytes});return new DataView(bytes.buffer);};
    const head=make('head',54);head.setUint32(0,0x10000);head.setUint32(12,0x5f0f3cf5);head.setUint16(18,1000);
    const maxp=make('maxp',6);maxp.setUint32(0,0x5000);maxp.setUint16(4,3);
    const hhea=make('hhea',36);hhea.setUint32(0,0x10000);hhea.setInt16(4,800);hhea.setInt16(6,-200);hhea.setUint16(34,2);
    const hmtx=make('hmtx',10);hmtx.setUint16(0,500);hmtx.setInt16(2,-10);hmtx.setUint16(4,700);hmtx.setInt16(6,20);hmtx.setInt16(8,-30);
    const metrics=readDrawingXpsFontMetrics({tables});
    assert.equal(metrics.unitsPerEm,1000);assert.equal(metrics.descender,-200);
    assert.deepEqual(metrics.glyph(0),{advanceWidth:500,leftSideBearing:-10});
    assert.deepEqual(metrics.glyph(2),{advanceWidth:700,leftSideBearing:-30});
    assert.throws(()=>metrics.glyph(3),/dwfxFont/);
    hhea.setUint16(34,4);assert.throws(()=>readDrawingXpsFontMetrics({tables}),/dwfxFont/);
    hhea.setUint16(34,2);tables.delete('hmtx');assert.throws(()=>readDrawingXpsFontMetrics({tables}),/dwfxFont/);
});
