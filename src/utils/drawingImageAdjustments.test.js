import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImageAdjustments, parseImageAdjustmentInput, applyImageAdjustmentsToPixels, imageAdjustmentTransfer, imageTransparencyKey, imageAdjustmentFilterMarkup } from './drawingImageAdjustments.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg } from './drawingClipboard.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

test('image adjustment parsing bounds values and retains unrelated settings', () => {
    assert.deepEqual(normalizeImageAdjustments({ brightness: Infinity, contrast: -10, monochrome: 'true' }), { brightness: 100, contrast: 0, monochrome: false });
    assert.deepEqual(parseImageAdjustmentInput('MONO ON', { brightness: 120, contrast: 80 }), { brightness: 120, contrast: 80, monochrome: true });
    assert.equal(parseImageAdjustmentInput('BRIGHTNESS 201'), null);
    assert.equal(parseImageAdjustmentInput('CONTRAST NaN'), null);
    assert.equal(parseImageAdjustmentInput('MONO MAYBE'), null);
    assert.equal(parseImageAdjustmentInput('RESET EXTRA'), null);
    assert.deepEqual(parseImageAdjustmentInput('RESET', { brightness: 0 }), normalizeImageAdjustments());
});

test('pixel baking matches the sRGB SVG transfer, grayscale weights and preserves alpha', () => {
    const source = new Uint8ClampedArray([255, 0, 0, 42, 100, 150, 200, 255]);
    assert.deepEqual(applyImageAdjustmentsToPixels(source.slice(), {}), source);
    assert.deepEqual([...applyImageAdjustmentsToPixels(source.slice(), { monochrome: true })], [54, 54, 54, 42, 143, 143, 143, 255]);
    assert.deepEqual([...applyImageAdjustmentsToPixels(source.slice(), { contrast: 0 })], [128, 128, 128, 42, 128, 128, 128, 255]);
    const settings = { brightness: 150, contrast: 120 };
    const { slope, intercept } = imageAdjustmentTransfer(settings);
    const result = applyImageAdjustmentsToPixels(source.slice(), settings);
    assert.equal(result[4], Math.round(100 * slope + 255 * intercept));
});

test('colour keys use original RGB, preserve other alpha and share exact 8-bit SVG membership tables', () => {
    const settings = parseImageAdjustmentInput('KEY #ffffff 1', { brightness: 0, contrast: 100 });
    const pixels = new Uint8ClampedArray([255, 255, 255, 255, 253, 254, 255, 200, 252, 255, 255, 150, 0, 0, 0, 100]);
    const result = applyImageAdjustmentsToPixels(pixels, settings);
    assert.deepEqual([result[3], result[7], result[11], result[15]], [0, 0, 150, 100]);
    assert.deepEqual([...result.slice(0, 3)], [0, 0, 0]);
    const key = imageTransparencyKey(settings);
    assert.equal(key.cutoff, 2);
    for (let channel = 0; channel < 3; channel += 1) {
        const table = key.tables[channel].split(' ').map(Number);
        assert.equal(table.length, 256);
        for (let value = 0; value < 256; value += 1) assert.equal(table[value], Math.abs(value - key.channels[channel]) <= key.cutoff ? 1 : 0);
    }
    assert.match(imageAdjustmentFilterMarkup('test', settings), /in2="keyMask" operator="in"/);
    assert.equal(parseImageAdjustmentInput('KEY #ffffff 101'), null);
    assert.equal(parseImageAdjustmentInput('KEY red'), null);
    assert.equal(parseImageAdjustmentInput('KEY OFF', settings).transparentColor, undefined);
    assert.equal(parseImageAdjustmentInput('RESET', settings).transparentColor, undefined);
    const exact = applyImageAdjustmentsToPixels(new Uint8ClampedArray([127, 128, 129, 42, 128, 128, 129, 43]), { transparentColor: '#7f8081' });
    assert.equal(exact[3], 0);
    assert.equal(exact[7], 43);
});

test('image settings persist without modifying asset bytes and clipboard SVG carries the filter', () => {
    const document = createLcadDocument({ name: 'Image adjustments' });
    document.assets = [{ id: 'asset', name: 'pixel.png', mimeType: 'image/png', width: 1, height: 1, link: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=' }];
    document.content = normalizeDrawingContent({ ...createDefaultDrawingContent(), entities: [{ id: 'image', type: 'image', layerId: 'references', assetId: 'asset', x: 0, y: 0, width: 4, height: 3, opacity: 0.8, rotation: 30, imageAdjustments: { brightness: 130, contrast: 90, monochrome: true, transparentColor: '#ffffff', colorTolerance: 4 } }] });
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content, document.content);
    assert.equal(restored.assets[0].link, document.assets[0].link);
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(document, ['image']));
    assert.match(svg, /feColorMatrix type="saturate" values="0"/);
    assert.match(svg, /opacity="0.8"/);
    assert.match(svg, /rotate\(30 2 1.5\)/);
    assert.doesNotMatch(svg, /NaN/);
});
