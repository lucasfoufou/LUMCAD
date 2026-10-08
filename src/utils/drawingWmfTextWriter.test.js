import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDrawingWmfText, writeDrawingWmfFont, writeDrawingWmfExtTextOut, readDrawingWmfFont, readDrawingWmfExtTextOut } from './drawingWmfText.js';
import { createDrawingWmfWriter, drawingWmfWords } from './drawingWmfWriter.js';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';

test('WMF text encoding preserves accented and currency characters without substitution', () => {
    assert.deepEqual([...encodeDrawingWmfText('Café €')], [67, 97, 102, 233, 32, 128]);
    assert.deepEqual([...encodeDrawingWmfText('Привет', 204)], [207, 240, 232, 226, 229, 242]);
    assert.throws(() => encodeDrawingWmfText('Emoji 😀'), /wmfUnsupportedCharset/);
    assert.throws(() => encodeDrawingWmfText('日本語', 128), /wmfUnsupportedCharset/);
    assert.throws(() => encodeDrawingWmfText('a'.repeat(32768)), /wmfLimit/);
});

test('EXTTEXTOUT writer matches independent little-endian bytes including odd padding and signed advances', () => {
    const bytes = writeDrawingWmfExtTextOut({ text: 'Aé€', x: -2, y: 3, advances: [12, -3, 4] });
    assert.equal(Buffer.from(bytes).toString('hex'), '0300feff0300000041e980000c00fdff0400');
    const decoded = readDrawingWmfExtTextOut(bytes, { charset: 0 });
    assert.equal(decoded.text, 'Aé€'); assert.deepEqual(decoded.advances, [12, -3, 4]);
});

test('WMF font and text records retain explicit height, orientation, decoration and code page', () => {
    const font = { height: -120, width: 0, escapement: 450, weight: 700, italic: true,
        underline: true, strikeout: true, charset: 204, name: 'Arial', pitchAndFamily: 32 };
    const bytes = writeDrawingWmfFont(font); const decoded = readDrawingWmfFont(bytes);
    for (const [key, value] of Object.entries(font)) assert.equal(decoded[key], value);
    assert.equal(decoded.orientation, 450);
    const writer = createDrawingWmfWriter({ objects: 1 });
    writer.append(0x02fb, bytes); writer.append(0x012d, drawingWmfWords(0));
    writer.append(0x0102, drawingWmfWords(1)); writer.append(0x012e, drawingWmfWords(24));
    writer.append(0x0a32, writeDrawingWmfExtTextOut({ text: 'Привет', charset: 204, x: 2, y: -3, advances: [10, 11, 12, 13, 14, 15] }));
    const primitive = readDrawingWmfGraphics(writer.finish()).primitives[0];
    assert.equal(primitive.text, 'Привет'); assert.equal(primitive.font.height, -120);
    assert.equal(primitive.textAlign, 24); assert.deepEqual(primitive.advances, [10, 11, 12, 13, 14, 15]);
});

test('WMF text writers reject overflow, malformed spacing and invalid face names', () => {
    for (const font of [{ height: -32769 }, { height: -10, name: 'a'.repeat(32) }, { height: -10, name: 'bad\0face' }, { height: -10, weight: 1001 }]) {
        assert.throws(() => writeDrawingWmfFont(font), /wmfInvalidText/);
    }
    assert.throws(() => writeDrawingWmfExtTextOut({ text: 'abc', x: 0, y: 0, advances: [2] }), /wmfInvalidText/);
    assert.throws(() => writeDrawingWmfExtTextOut({ text: 'a', x: 32768, y: 0 }), /wmfPlacement/);
    assert.throws(() => writeDrawingWmfExtTextOut({ text: 'a', x: 0, y: 0, advances: [1.5] }), /wmfInvalidText/);
});
