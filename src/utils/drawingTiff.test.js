import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeDrawingTiff } from './drawingTiff.js';
import { tiffFixture } from './fixtures/tiff.js';

const rgba = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255];

test('TIFF strips decode nonzero-offset views in both byte orders without changing input', () => {
    for (const little of [true, false]) {
        const source = tiffFixture({ little }); const before = source.slice();
        const backing = new Uint8Array(source.length + 14); backing.set(source, 7);
        const result = decodeDrawingTiff(backing.subarray(7, 7 + source.length));
        assert.deepEqual([...result.pixels], rgba); assert.equal(result.width, 2); assert.equal(result.height, 2);
        assert.equal(result.xResolution, 192); assert.equal(result.yResolution, 96);
        assert.deepEqual(source, before);
        result.pixels[0] = 0; assert.deepEqual(source, before);
    }
});

test('TIFF PackBits literals, repeats, no-ops and final partial strips respect row boundaries', () => {
    const packed = tiffFixture({ width: 2, height: 3, samples: 1, photo: 1, rows: 2, compression: 32773,
        strips: [[128, 1, 10, 20, 255, 30], [255, 40, 128]] });
    const pixels = decodeDrawingTiff(packed).pixels;
    assert.deepEqual([...pixels.filter((_, index) => index % 4 === 0)], [10, 20, 30, 30, 40, 40]);
    for (const strips of [[[2, 1, 2, 3]], [[255]], [[1, 10]], [[0, 10]], [[255, 10, 0, 20]]]) {
        assert.throws(() => decodeDrawingTiff(tiffFixture({ width: 2, height: 1, samples: 1, photo: 1,
            compression: 32773, strips })), /tiffInvalid/);
    }
});

test('TIFF bilevel, packed grayscale, reverse bit order and 16-bit samples map to RGBA', () => {
    for (const [depth, width, data, expected] of [[1, 3, [0xa0], [255, 0, 255]],
        [2, 3, [0x18], [0, 85, 170]], [4, 3, [0x08, 0xf0], [0, 136, 255]]]) {
        for (const photo of [0, 1]) {
            const image = decodeDrawingTiff(tiffFixture({ depth, width, height: 1, samples: 1, photo, strips: [data] }));
            assert.deepEqual([...image.pixels.filter((_, index) => index % 4 === 0)], expected.map(v => photo ? v : 255 - v));
        }
    }
    const reversed = decodeDrawingTiff(tiffFixture({ depth: 1, width: 3, height: 1, samples: 1, photo: 1,
        strips: [[5]], tags: [[266, 3, [2]]] }));
    assert.deepEqual([...reversed.pixels.filter((_, index) => index % 4 === 0)], [255, 0, 255]);
    for (const little of [true, false]) {
        const strip = little ? [0, 0, 0, 128, 255, 255] : [0, 0, 128, 0, 255, 255];
        const image = decodeDrawingTiff(tiffFixture({ little, depth: 16, width: 3, height: 1, samples: 1, photo: 1, strips: [strip] }));
        assert.deepEqual([...image.pixels.filter((_, index) => index % 4 === 0)], [0, 128, 255]);
    }
});

test('TIFF palette colors and straight, associated or unused alpha samples retain pixel meaning', () => {
    const palette = decodeDrawingTiff(tiffFixture({ depth: 1, width: 2, height: 1, samples: 1, photo: 3,
        strips: [[0x40]], tags: [[320, 3, [65535, 0, 0, 65535, 0, 0]]] }));
    assert.deepEqual([...palette.pixels], rgba.slice(0, 8));
    for (const [kind, input, output] of [[2, [255, 64, 0, 128], [255, 64, 0, 128]],
        [1, [128, 32, 0, 128], [255, 64, 0, 128]], [1, [0, 0, 0, 0], [0, 0, 0, 0]],
        [0, [255, 64, 0, 9], [255, 64, 0, 255]]]) {
        const image = decodeDrawingTiff(tiffFixture({ width: 1, height: 1, samples: 4, strips: [input], tags: [[338, 3, [kind]]] }));
        assert.deepEqual([...image.pixels], output);
    }
});

test('TIFF malformed fields, storage bounds and excessive work reject before partial results', () => {
    assert.throws(() => decodeDrawingTiff(tiffFixture(), { maxPixels: 3 }), /tiffLimit/);
    assert.throws(() => decodeDrawingTiff(tiffFixture(), { maxBytes: 10 }), /tiffLimit/);
    assert.throws(() => decodeDrawingTiff(tiffFixture().slice(0, -1)), /tiffInvalid/);
    for (const tags of [[[278, 4, [0]]], [[282, 5, [[1, 0]]]], [[256, 4, [0]]], [[258, 3, [8]]], [[296, 3, [0]]]]) {
        assert.throws(() => decodeDrawingTiff(tiffFixture({ tags })), /tiffInvalid/);
    }
    for (const tags of [[[259, 3, [6]]], [[284, 3, [2]]], [[317, 3, [2]]], [[262, 3, [5]]], [[34675, 4, [1]]]]) {
        assert.throws(() => decodeDrawingTiff(tiffFixture({ tags })), /tiffUnsupported/);
    }
    const duplicate = tiffFixture(); new DataView(duplicate.buffer).setUint16(22, 256, true);
    assert.throws(() => decodeDrawingTiff(duplicate), /tiffInvalid/);
    const offset = tiffFixture(); new DataView(offset.buffer).setUint32(4, offset.length, true);
    assert.throws(() => decodeDrawingTiff(offset), /tiffInvalid/);
    const count = tiffFixture(); new DataView(count.buffer).setUint32(38, 1000001, true);
    assert.throws(() => decodeDrawingTiff(count), /tiffLimit/);
});


test('TIFF raw and PackBits pixels agree with independently generated Pillow fixtures', () => {
    const fixtures = JSON.parse(readFileSync(new URL('./fixtures/tiff-pillow.json', import.meta.url), 'utf8'));
    for (const fixture of fixtures.images) {
        const image = decodeDrawingTiff(new Uint8Array(Buffer.from(fixture.base64, 'base64')));
        assert.equal(image.width, fixture.width); assert.equal(image.height, fixture.height);
        assert.deepEqual([...image.pixels], fixture.pixels, fixture.name);
    }
});
