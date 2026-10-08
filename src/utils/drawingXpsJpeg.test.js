import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { Resvg } from '@resvg/resvg-js';
import { readDrawingXpsImage } from './drawingXpsImages.js';
import { readDrawingXpsScene, drawingXpsSceneSvg } from './drawingXpsScene.js';

function jpeg() {
    const canvas = createCanvas(20, 10); const context = canvas.getContext('2d');
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, 20, 10);
    const bytes = new Uint8Array(canvas.toBuffer('image/jpeg', 100));
    const length = bytes[2] === 255 && bytes[3] === 224 ? 2 + (bytes[4] * 256 + bytes[5]) : 0;
    return Uint8Array.from([...bytes.subarray(0, 2), ...bytes.subarray(2 + length)]);
}
const append = (bytes, marker, data) => Uint8Array.from([255,216,255,marker,(data.length+2)>>8,(data.length+2)&255,...data,...bytes.subarray(2)]);
const jfif = [74,70,73,70,0,1,2,1,0,192,0,96,0,0];
function exif(little) {
    const bytes = new Uint8Array(66); const view = new DataView(bytes.buffer);
    view.setUint16(0, little ? 0x4949 : 0x4d4d); view.setUint16(2,42,little); view.setUint32(4,8,little);
    view.setUint16(8,3,little);
    for (const [i, tag, type, value] of [[0,0x11a,5,50],[1,0x11b,5,58],[2,0x128,3,2]]) {
        const p=10+i*12; view.setUint16(p,tag,little);view.setUint16(p+2,type,little);view.setUint32(p+4,1,little);
        if(type===3)view.setUint16(p+8,value,little);else view.setUint32(p+8,value,little);
    }
    view.setUint32(50,96,little);view.setUint32(54,1,little);view.setUint32(58,192,little);view.setUint32(62,1,little);
    return [69,120,105,102,0,0,...bytes];
}

test('XPS JPEG resolution prefers EXIF over JFIF and otherwise defaults to 96 dpi', () => {
    const base = jpeg(); assert.equal(readDrawingXpsImage(base).widthUnits, 20);
    const withJfif = append(base,224,jfif);
    assert.equal(readDrawingXpsImage(withJfif).widthUnits, 10);
    const centimetres = [...jfif]; centimetres[7] = 2;
    assert.ok(Math.abs(readDrawingXpsImage(append(base,224,centimetres)).widthUnits - 10 / 2.54) < 1e-10);
    for (const little of [true,false]) {
        const image = readDrawingXpsImage(append(withJfif,225,exif(little)));
        assert.equal(image.widthUnits, 20); assert.equal(image.heightUnits, 5);
        assert.match(image.link,/^data:image\/jpeg;base64,/);
    }
});

test('JPEG metadata rejects truncation, invalid rational offsets and excessive pixel budgets', () => {
    const base = jpeg();
    assert.throws(() => readDrawingXpsImage(base,{maxPixels:199}),/dwfxLimit/);
    assert.throws(() => readDrawingXpsImage(base.slice(0,-2)),/dwfxImage/);
    assert.throws(() => readDrawingXpsImage(append(base,224,jfif.slice(0,-1))),/dwfxImage/);
    const invalid = exif(true); invalid[6+54]=0;
    assert.throws(() => readDrawingXpsImage(append(base,225,invalid)),/dwfxImage/);
    const truncated = exif(false).slice(0,-1);
    assert.throws(() => readDrawingXpsImage(append(base,225,truncated)),/dwfxImage/);
    const rotated = Uint8Array.from(exif(true)); const view = new DataView(rotated.buffer);
    view.setUint16(6+34,0x112,true); view.setUint16(6+42,9,true);
    assert.throws(() => readDrawingXpsImage(append(base,225,rotated)),/dwfxImage/);
});

test('JPEG image brushes render through shared XPS viewbox and clipping geometry', async () => {
    const bytes = append(jpeg(),224,jfif);
    const xml = '<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="40" Height="30"><Path Data="M0 0H40V30H0Z"><Path.Fill><ImageBrush ImageSource="image.jpg" Viewbox="0 0 10 10" Viewport="5 5 20 20" ViewboxUnits="Absolute" ViewportUnits="Absolute" TileMode="None"/></Path.Fill></Path></FixedPage>';
    const scene = readDrawingXpsScene(new Map([['page',new TextEncoder().encode(xml)],['image.jpg',bytes]]),{path:'page'});
    const canvas=createCanvas(40,30);const context=canvas.getContext('2d');
    context.drawImage(await loadImage(new Resvg(drawingXpsSceneSvg(scene)).render().asPng()),0,0);
    const center=[...context.getImageData(15,15,1,1).data];
    assert.ok(center[0]>250 && center[1]<5 && center[2]<5 && center[3]===255);
    assert.equal(context.getImageData(2,2,1,1).data[3],0);
});


test('XPS JPEG orientation tags preserve raw asymmetric pixels and never mutate source bytes', async () => {
    const canvas = createCanvas(40, 20); const context = canvas.getContext('2d');
    for (const [color, x, y] of [['red', 0, 0], ['lime', 20, 0], ['blue', 0, 10], ['yellow', 20, 10]]) {
        context.fillStyle = color; context.fillRect(x, y, 20, 10);
    }
    const base = new Uint8Array(canvas.toBuffer('image/jpeg', 100));
    for (const little of [false, true]) for (let orientation = 1; orientation <= 8; orientation++) {
        const metadata = Uint8Array.from(exif(little)); const view = new DataView(metadata.buffer);
        view.setUint16(6 + 34, 0x112, little); view.setUint16(6 + 42, orientation, little);
        const source = append(base, 225, metadata); const original = source.slice();
        const image = readDrawingXpsImage(source);
        assert.deepEqual(source, original);
        assert.equal(image.widthUnits, 40); assert.equal(image.heightUnits, 10);
        const decoded = await loadImage(image.link);
        assert.equal(decoded.width, 40); assert.equal(decoded.height, 20);
        const output = createCanvas(40, 20).getContext('2d'); output.drawImage(decoded, 0, 0);
        for (const [x, y, expected] of [[5, 5, [255, 0, 0]], [35, 5, [0, 255, 0]],
            [5, 15, [0, 0, 255]], [35, 15, [255, 255, 0]]]) {
            const pixel = output.getImageData(x, y, 1, 1).data;
            expected.forEach((value, index) => assert.ok(Math.abs(pixel[index] - value) < 5,
                `orientation ${orientation}, endian ${little}, corner ${x},${y}`));
        }
    }
});
