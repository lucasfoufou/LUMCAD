import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDrawingWmfText, readDrawingWmfFont, readDrawingWmfTextOut, readDrawingWmfExtTextOut } from './drawingWmfText.js';

test('WMF font records preserve signed metrics, tenths-degree angles and Latin-1 face names', () => {
    const bytes = new Uint8Array(50); const data = new DataView(bytes.buffer);
    data.setInt16(0, -24, true); data.setInt16(2, 12, true); data.setInt16(4, -900, true);
    data.setInt16(6, 450, true); data.setInt16(8, 700, true);
    bytes.set([1, 1, 0, 204], 10); bytes.set([67, 97, 102, 233, 0], 18);
    const font = readDrawingWmfFont(bytes);
    assert.equal(font.height, -24); assert.equal(font.width, 12); assert.equal(font.escapement, -900);
    assert.equal(font.orientation, 450); assert.equal(font.weight, 700); assert.equal(font.name, 'Café');
    assert.equal(font.italic, true); assert.equal(font.underline, true); assert.equal(font.charset, 204);
    assert.throws(() => readDrawingWmfFont(bytes.subarray(1)), /wmfInvalid/);
    bytes.fill(65, 18); assert.throws(() => readDrawingWmfFont(bytes), /wmfInvalid/);
});

test('WMF text output follows exact byte length, padding and signed coordinates', () => {
    // MS-WMF 3.2.7 example parameters, without the record header.
    const sample = Uint8Array.from(Buffer.from('0c0048656c6c6f2050656f706c650a000a00', 'hex'));
    assert.deepEqual(readDrawingWmfTextOut(sample, { charset: 0 }), { text: 'Hello People', x: 10, y: 10 });
    const odd = Uint8Array.from([3, 0, 65, 233, 128, 0, 0xfe, 0xff, 0xfd, 0xff]);
    assert.deepEqual(readDrawingWmfTextOut(odd, { charset: 0 }), { text: 'Aé€', x: -3, y: -2 });
    assert.throws(() => readDrawingWmfTextOut(odd.slice(0, -1), { charset: 0 }), /wmfInvalid/);
    assert.throws(() => readDrawingWmfTextOut(odd, { charset: 0 }, { maxCharacters: 2 }), /wmfLimit/);
});

test('WMF codepages retain Cyrillic and Japanese characters and reject unknown or broken encodings', () => {
    assert.equal(decodeDrawingWmfText(Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]), 204), 'Привет');
    assert.equal(decodeDrawingWmfText(Uint8Array.from([0x82, 0xa0]), 128), 'あ');
    assert.throws(() => decodeDrawingWmfText(Uint8Array.from([0x82]), 128), /wmfInvalidText/);
    for (const charset of [1, 2, 130, 255]) assert.throws(() => decodeDrawingWmfText(Uint8Array.from([65]), charset), /wmfUnsupportedCharset/);
});

test('WMF extended text retains clipping, opacity, signed spacing and odd-byte padding', () => {
    const bytes = Uint8Array.from(Buffer.from('fefffdff03000600f6ffecff6400500041e980001000fcff0800', 'hex'));
    assert.deepEqual(readDrawingWmfExtTextOut(bytes, { charset: 0 }), {
        text: 'Aé€', x: -3, y: -2, rectangle: { left: -10, top: -20, right: 100, bottom: 80 },
        advances: [16, -4, 8], opaque: true, clipped: true, rightToLeft: false,
    });
    assert.equal(readDrawingWmfExtTextOut(bytes.subarray(0, 20), { charset: 0 }).advances, null);
    for (const size of [7, 15, 19, 21, 24, 25]) {
        assert.throws(() => readDrawingWmfExtTextOut(bytes.subarray(0, size), { charset: 0 }), /wmfInvalid/);
    }
    assert.throws(() => readDrawingWmfExtTextOut(bytes, { charset: 0 }, { maxCharacters: 2 }), /wmfLimit/);
});

test('WMF extended text preserves reading order and refuses glyph interpretation or ambiguous spacing', () => {
    const bytes = Uint8Array.from(Buffer.from('00000000020080004142', 'hex'));
    assert.equal(readDrawingWmfExtTextOut(bytes, { charset: 0 }).rightToLeft, true);
    bytes[6] = 16;
    assert.throws(() => readDrawingWmfExtTextOut(bytes, { charset: 0 }), /wmfUnsupportedTextOptions/);
    bytes[6] = 0; bytes[4] = 255; bytes[5] = 255;
    assert.throws(() => readDrawingWmfExtTextOut(bytes, { charset: 0 }), /wmfInvalid/);
    const japanese = Uint8Array.from(Buffer.from('000000000200000082a0', 'hex'));
    assert.equal(readDrawingWmfExtTextOut(japanese, { charset: 128 }).text, 'あ');
    assert.throws(() => readDrawingWmfExtTextOut(Uint8Array.from([...japanese, 10, 0]), { charset: 128 }), /wmfInvalid/);
});

test('WMF DBCS advances sum lead and trail byte spacing', () => {
    const bytes = Uint8Array.from(Buffer.from('000000000300000082a041000a000500faff', 'hex'));
    const result = readDrawingWmfExtTextOut(bytes, { charset: 128 });
    assert.equal(result.text, 'あA');
    assert.deepEqual(result.advances, [15, -6]);
});
