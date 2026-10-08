import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingTrueTypeReader, drawingTrueTypeContoursGeometry } from './drawingTrueTypeOutlines.js';
import { curvePointAt } from './drawingCurveKernel.js';
function fixture(long = false) {
    const head = new Uint8Array(54); new DataView(head.buffer).setInt16(50,long ? 1 : 0);
    const loca = new Uint8Array(long ? 12 : 6); const locations = new DataView(loca.buffer);
    const glyf = new Uint8Array(34); const view = new DataView(glyf.buffer);
    view.setInt16(0,1);view.setInt16(8,100);view.setUint16(10,3);view.setUint16(12,0);
    glyf.set([1,1,1,1],14);
    [0,100,0,-100,0,0,100,0].forEach((n,i)=>view.setInt16(18+i*2,n));
    if(long){locations.setUint32(4,34);locations.setUint32(8,34);}else{locations.setUint16(2,17);locations.setUint16(4,17);}
    return {format:'truetype',tables:new Map([['head',{bytes:head}],['loca',{bytes:loca}],['glyf',{bytes:glyf}]])};
}
test('TrueType short/long loca decode owned simple contours and empty glyphs',()=>{
    for(const long of [false,true]){
        const resource=fixture(long);const before=resource.tables.get('glyf').bytes.slice();const read=createDrawingTrueTypeReader(resource,2);
        assert.deepEqual(read(0),[[{x:0,y:0,onCurve:true},{x:100,y:0,onCurve:true},{x:100,y:100,onCurve:true},{x:0,y:100,onCurve:true}]]);
        assert.deepEqual(read(1),[]);assert.equal(read(0),read(0));assert.deepEqual(resource.tables.get('glyf').bytes,before);
        assert.equal(drawingTrueTypeContoursGeometry(read(0)).paths[0].parts.length,4);
        assert.equal(read.yMax(0), 100);
        assert.equal(read.yMax(1), 0);
        assert.throws(() => read.yMax(2), /dwfxFont/);
    }
});
test('TrueType implied on-curve midpoints preserve exact quadratic outlines and nonzero winding',()=>{
    const points=[{x:0,y:0,onCurve:true},{x:50,y:100,onCurve:false},{x:100,y:100,onCurve:false},{x:150,y:0,onCurve:true}];
    const geometry=drawingTrueTypeContoursGeometry([points]);assert.equal(geometry.rule,'nonzero');
    const first=geometry.paths[0].parts[0];assert.equal(first.type,'spline');
    assert.deepEqual(curvePointAt(first,1),{x:75,y:100});
    const allOff=drawingTrueTypeContoursGeometry([points.map(p=>({...p,onCurve:false}))]);assert.ok(allOff.paths[0].parts.every(p=>p.type==='spline'));
});
test('TrueType reader refuses malformed locations, flags, composites and point budget exhaustion',()=>{
    assert.throws(()=>createDrawingTrueTypeReader(fixture(),2,{maxPoints:3})(0),/dwfxLimit/);
    const composite=fixture();new DataView(composite.tables.get('glyf').bytes.buffer).setInt16(0,-1);assert.throws(()=>createDrawingTrueTypeReader(composite,2)(0),/dwfxFont/);
    const flags=fixture();flags.tables.get('glyf').bytes[14]=9;flags.tables.get('glyf').bytes[15]=255;assert.throws(()=>createDrawingTrueTypeReader(flags,2)(0),/dwfxFont/);
    const locations=fixture();new DataView(locations.tables.get('loca').bytes.buffer).setUint16(4,1);assert.throws(()=>createDrawingTrueTypeReader(locations,2),/dwfxFont/);
});

test('TrueType packed coordinate signs and repeated point flags decode within glyph boundaries',()=>{
    const resource=fixture();const bytes=resource.tables.get('glyf').bytes;
    bytes.set([0x31,0x33,0x35,0x23,100,100,100],14);
    const points=createDrawingTrueTypeReader(resource,2)(0)[0];
    assert.deepEqual(points.map(({x,y})=>[x,y]),[[0,0],[100,0],[100,100],[0,100]]);
    bytes.set([0x39,3],14);
    assert.deepEqual(createDrawingTrueTypeReader(resource,2)(0)[0].map(({x,y})=>[x,y]),[[0,0],[0,0],[0,0],[0,0]]);
    new DataView(bytes.buffer).setUint16(12,1000);
    assert.throws(()=>createDrawingTrueTypeReader(resource,2)(0),/dwfxFont/);
});

function compositeFixture(records) {
    const resource=fixture(true);const simple=resource.tables.get('glyf').bytes;
    const composite=new Uint8Array(10+records.flat().length*2);const view=new DataView(composite.buffer);view.setInt16(0,-1);
    records.flat().forEach((value,i)=>view.setUint16(10+i*2,value));
    const glyf=new Uint8Array(simple.length+composite.length);glyf.set(simple);glyf.set(composite,simple.length);
    resource.tables.set('glyf',{bytes:glyf});const loca=resource.tables.get('loca').bytes;new DataView(loca.buffer).setUint32(8,glyf.length);
    return resource;
}
test('TrueType composites retain scaled/unscaled offsets and point-aligned child placement',()=>{
    const scaled=createDrawingTrueTypeReader(compositeFixture([[0x080b,0,20,10,8192]]),2)(1);
    assert.deepEqual(scaled[0][0],{x:10,y:5,onCurve:true});assert.deepEqual(scaled[0][2],{x:60,y:55,onCurve:true});
    const unscaled=createDrawingTrueTypeReader(compositeFixture([[0x100b,0,20,10,8192]]),2)(1);
    assert.deepEqual(unscaled[0][0],{x:20,y:10,onCurve:true});
    const aligned=createDrawingTrueTypeReader(compositeFixture([[0x23,0,10,20],[1,0,2,0]]),2)(1);
    assert.equal(aligned.length,2);assert.deepEqual(aligned[1][0],aligned[0][2]);
});
test('TrueType composites preserve affine shear and reject cycles or accumulated point exhaustion',()=>{
    const transformed=createDrawingTrueTypeReader(compositeFixture([[0x83,0,3,4,16384,8192,4096,16384]]),2)(1);
    assert.deepEqual(transformed[0][2],{x:128,y:154,onCurve:true});
    assert.throws(()=>createDrawingTrueTypeReader(compositeFixture([[3,1,0,0]]),2)(1),/dwfxFont/);
    assert.throws(()=>createDrawingTrueTypeReader(compositeFixture([[0x23,0,0,0],[3,0,0,0]]),2,{maxPoints:10})(1),/dwfxLimit/);
    assert.throws(()=>createDrawingTrueTypeReader(compositeFixture([[1,0,0,0]]),2)(1),/dwfxUnsupported/);
});
