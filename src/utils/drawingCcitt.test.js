import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeDrawingCcitt } from './drawingCcitt.js';
import { decodeDrawingTiff } from './drawingTiff.js';
import { readDrawingXpsImage } from './drawingXpsImages.js';
import { tiffFixture } from './fixtures/tiff.js';

const packed = bits => Uint8Array.from(bits.padEnd(Math.ceil(bits.length / 8) * 8, '0').match(/.{8}/g).map(byte => parseInt(byte, 2)));
const decode = (bits, options = {}) => decodeDrawingCcitt(packed(bits), { width: 8, rows: 1, compression: 2, ...options });

test('CCITT decodes byte-aligned 1D rows, initial black runs and Group 4 reference rows', () => {
    assert.deepEqual([...decode('10011')], [0]); // White terminating run 8.
    assert.deepEqual([...decode('00110101000101')], [255]); // White 0, black 8.
    assert.deepEqual([...decode('1001100010011000', { rows: 2 })], [0, 0]);
    // Horizontal white 0 / black 8, then two vertical-zero codes referencing the black row.
    assert.deepEqual([...decode('0010011010100010111', { rows: 2, compression: 4 })], [255, 255]);
    assert.deepEqual([...decode('11', { rows: 2, compression: 4 })], [0, 0]);
});

test('CCITT refuses truncated words, overflowing runs, invalid modes and unbounded work', () => {
    for (const bits of ['00000000', '10100', '0000000000000001']) assert.throws(() => decode(bits), /tiffInvalid/);
    assert.throws(() => decode('0000000', { compression: 4 }), /tiffInvalid/);
    assert.throws(() => decode('0000001', { compression: 4 }), /tiffUnsupported/);
    assert.throws(() => decode('1', { compression: 4, rows: 2 }), /tiffInvalid/);
    assert.throws(() => decode('1', { width: 16385 }), /tiffLimit/);
    assert.throws(() => decode('1', { compression: 4, t6Options: 1 }), /tiffInvalid/);
    assert.throws(() => decode('1', { compression: 4, t6Options: 2 }), /tiffUnsupported/);
    assert.throws(() => decode('1', { compression: 3, t4Options: 8 }), /tiffInvalid/);
    assert.throws(() => decode('1', { compression: 3, t4Options: 2 }), /tiffUnsupported/);
    const zeroPair = '001101010000110111';
    assert.throws(() => decode(zeroPair.repeat(40)), /tiffLimit/);
});

test('Group 3 requires EOL, aligned fill when declared, and an initial 1D reference row', () => {
    assert.deepEqual([...decode('00000000000110011', { compression: 3 })], [0]);
    assert.deepEqual([...decode('000000000000000110011', { compression: 3, t4Options: 4 })], [0]);
    assert.throws(() => decode('00000000000110011', { compression: 3, t4Options: 4 }), /tiffInvalid/);
    assert.throws(() => decode('00000000000101', { compression: 3, t4Options: 1 }), /tiffInvalid/);
});

test('TIFF CCITT honors photometric inversion and rejects incompatible sample layouts', () => {
    for (const photo of [0, 1]) {
        const bytes = tiffFixture({ width: 8, height: 1, samples: 1, depth: 1, photo, compression: 2, strips: [packed('10011')] });
        assert.equal(decodeDrawingTiff(bytes).pixels[0], photo === 0 ? 255 : 0);
    }
    assert.throws(() => decodeDrawingTiff(tiffFixture({ compression: 4 })), /tiffUnsupported/);
});

test('CCITT matches 36 independent libtiff images across 1D, Group 3/4, fill order and strip resets', () => {
    const fixtures = JSON.parse(readFileSync(new URL('./fixtures/tiff-ccitt-pillow.json', import.meta.url)));
    for (const fixture of fixtures.images) {
        const bytes = new Uint8Array(Buffer.from(fixture.base64, 'base64')); const before = bytes.slice();
        const image = decodeDrawingTiff(bytes);
        assert.equal(createHash('sha256').update(image.pixels).digest('hex'), fixture.rgbaSha256, fixture.name);
        assert.deepEqual(bytes, before);
        const preview = readDrawingXpsImage(bytes);
        assert.equal(preview.width, fixture.width); assert.equal(preview.height, fixture.height);
        assert.match(preview.link, /^data:image\/png;base64,/);
    }
});
