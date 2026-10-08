import test from 'node:test';
import assert from 'node:assert/strict';
import { readDrawingFontCmap } from './drawingFontCmap.js';
function resource(subtables) {
    const size=4+subtables.length*8;const bytes=new Uint8Array(size+subtables.reduce((s,t)=>s+t.length,0));const view=new DataView(bytes.buffer);
    view.setUint16(2,subtables.length);let offset=size;
    subtables.forEach((table,i)=>{view.setUint16(4+i*8,3);view.setUint16(6+i*8,table[1]===12?10:1);view.setUint32(8+i*8,offset);bytes.set(table,offset);offset+=table.length;});
    return {tables:new Map([['cmap',{bytes}]])};
}
function bmp() {
    const bytes=new Uint8Array(44);const v=new DataView(bytes.buffer);v.setUint16(0,4);v.setUint16(2,44);v.setUint16(6,6);
    [65,68,65535].forEach((n,i)=>v.setUint16(14+i*2,n));[65,67,65535].forEach((n,i)=>v.setUint16(22+i*2,n));
    [-62,2,1].forEach((n,i)=>v.setInt16(28+i*2,n));v.setUint16(36,4);v.setUint16(40,5);v.setUint16(42,0);return bytes;
}
function full() {
    const bytes=new Uint8Array(40);const v=new DataView(bytes.buffer);v.setUint16(0,12);v.setUint32(4,40);v.setUint32(12,2);
    [[65,65,8],[0x1f600,0x1f602,20]].forEach((g,i)=>g.forEach((n,j)=>v.setUint32(16+i*12+j*4,n)));return bytes;
}
test('Unicode cmap format 4 handles deltas, indirect glyph arrays and missing entries',()=>{
    const map=readDrawingFontCmap(resource([bmp()]),100);
    assert.equal(map(65),3);assert.equal(map(67),7);assert.equal(map(68),0);assert.equal(map(66),0);assert.equal(map(65535),0);assert.equal(map(0x1f600),0);
});
test('Unicode cmap selects format 12 for BMP and supplementary characters',()=>{
    const map=readDrawingFontCmap(resource([bmp(),full()]),100);
    assert.equal(map(65),8);assert.equal(map(0x1f600),20);assert.equal(map(0x1f602),22);assert.equal(map(0x1f603),0);
    assert.throws(()=>map(0xd800),/dwfxFont/);
});
test('Unicode cmap rejects truncated, overlapping and out-of-font mappings',()=>{
    for(const [offset,value] of [[4,1000],[20,64],[24,100],[28,60]]){const bytes=full();new DataView(bytes.buffer).setUint32(offset,value);assert.throws(()=>readDrawingFontCmap(resource([bytes]),100),/dwfxFont/);}
    const bytes=bmp();new DataView(bytes.buffer).setUint16(36,200);assert.throws(()=>readDrawingFontCmap(resource([bytes]),100),/dwfxFont/);
    const map=readDrawingFontCmap(resource([bmp()]),3);assert.throws(()=>map(65),/dwfxFont/);
});
