import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeDrawingTiffLzw } from './drawingTiffLzw.js';
import { decodeDrawingTiff } from './drawingTiff.js';
import { tiffFixture } from './fixtures/tiff.js';

// Hand-authored streams below remain below the first width change, independently of the decoder.
function codes9(codes) {
    const bits = codes.map(code => code.toString(2).padStart(9, '0')).join('');
    return Uint8Array.from(bits.padEnd(Math.ceil(bits.length / 8) * 8, '0').match(/.{8}/g).map(byte => parseInt(byte, 2)));
}

test('TIFF LZW handles literal strings, dictionary references, repeated-prefix codes and clear resets', () => {
    assert.deepEqual([...decodeDrawingTiffLzw(codes9([256, 65, 66, 258, 260, 257]), 7)], [65, 66, 65, 66, 65, 66, 65]);
    assert.deepEqual([...decodeDrawingTiffLzw(codes9([256, 65, 258, 259, 256, 66, 258, 257]), 9)], [65, 65, 65, 65, 65, 65, 66, 66, 66]);
    assert.deepEqual([...decodeDrawingTiffLzw(codes9([256, 256, 257]), 0)], []);
});

test('TIFF LZW rejects missing control codes, forward references, truncation, trailing bytes and size overflow', () => {
    for (const codes of [[65, 257], [256, 258, 257], [256, 65, 260, 257], [256, 65], [256, 257]]) {
        assert.throws(() => decodeDrawingTiffLzw(codes9(codes), 1), /tiffInvalid/);
    }
    const valid = codes9([256, 65, 257]);
    assert.throws(() => decodeDrawingTiffLzw(valid, 0), /tiffInvalid/);
    assert.throws(() => decodeDrawingTiffLzw(valid, 2), /tiffInvalid/);
    assert.throws(() => decodeDrawingTiffLzw(Uint8Array.from([...valid, 0]), 1), /tiffInvalid/);
    assert.throws(() => decodeDrawingTiffLzw(valid, 128 * 1024 * 1024 + 1), /tiffLimit/);
});

test('TIFF horizontal predictor wraps individual channels and resets at row and strip boundaries', () => {
    const bytes = tiffFixture({ width: 2, height: 2, samples: 3, compression: 5,
        strips: [[250, 10, 90, 16, 250, 170], [20, 30, 40, 240, 240, 240]].map(row => codes9([256, ...row, 257])),
        tags: [[317, 3, [2]]] });
    const before = bytes.slice(); const image = decodeDrawingTiff(bytes);
    assert.deepEqual([...image.pixels], [250, 10, 90, 255, 10, 4, 4, 255, 20, 30, 40, 255, 4, 14, 24, 255]);
    assert.deepEqual(bytes, before);
    for (const little of [false, true]) {
        const data = new Uint8Array(8); const view = new DataView(data.buffer);
        [65530, 12, 32768, 32768].forEach((value, i) => view.setUint16(i * 2, value, little));
        const image16 = decodeDrawingTiff(tiffFixture({ little, width: 2, height: 2, samples: 1, photo: 1, depth: 16,
            rows: 2, compression: 5, strips: [codes9([256, ...data, 257])], tags: [[317, 3, [2]]] }));
        assert.deepEqual([...image16.pixels.filter((_, i) => i % 4 === 0)], [255, 0, 128, 0]);
    }
    const packed = decodeDrawingTiff(tiffFixture({ width: 3, height: 1, samples: 1, photo: 1, depth: 4,
        compression: 5, strips: [codes9([256, 0xe4, 0x30, 257])], tags: [[317, 3, [2]]] }));
    assert.deepEqual([...packed.pixels.filter((_, i) => i % 4 === 0)], [238, 34, 85]);
});


test('libtiff LZW fixtures retain exact pixels through width transitions, resets and predictors', () => {
    const fixtures = JSON.parse(readFileSync(new URL('./fixtures/tiff-lzw-pillow.json', import.meta.url), 'utf8'));
    for (const fixture of fixtures.images) {
        const source = new Uint8Array(Buffer.from(fixture.base64, 'base64')); const before = source.slice();
        const image = decodeDrawingTiff(source);
        assert.equal(image.width, fixture.width); assert.equal(image.height, fixture.height);
        assert.equal(createHash('sha256').update(image.pixels).digest('hex'), fixture.rgbaSha256, fixture.name);
        assert.deepEqual(source, before);
    }
});
