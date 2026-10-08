import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { exportDrawingWmfWithAssets } from './drawingWmfExport.js';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';
import { readDrawingRasterImage, transposeDrawingRasterImage } from './drawingRasterImage.js';
import { importDrawingWmf } from './drawingWmfImport.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { attachDrawingReference } from './drawingReferences.js';

function fixture() {
    const canvas = createCanvas(2, 2); const context = canvas.getContext('2d');
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
    const data = context.createImageData(2, 2); data.data.set(pixels); context.putImageData(data, 0, 0);
    const assets = [{ id: 'image', link: canvas.toDataURL('image/png') }];
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'image', type: 'image', assetId: 'image', layerId: content.activeLayerId,
        x: 10, y: 20, width: 4, height: 6, opacity: 1 }];
    return { content, assets, pixels };
}
const options = { createCanvas, loadImage };

test('raster transpose exchanges non-square rows and columns without changing pixel values', () => {
    const source = { width: 2, height: 3, pixels: new Uint8Array([1, 2, 3, 4, 5, 6].flatMap(n => [n, 0, 0, 255])) };
    const before = structuredClone(source); const result = transposeDrawingRasterImage(source);
    assert.equal(result.width, 3); assert.equal(result.height, 2);
    assert.deepEqual([...result.pixels].filter((_, i) => i % 4 === 0), [1, 3, 5, 2, 4, 6]);
    assert.deepEqual(transposeDrawingRasterImage(result), source);
    assert.deepEqual(source, before);
});

test('WMF quarter-turn images retain every pixel center through reflection and nonuniform scale', async () => {
    for (const rotation of [0, 90, 180, 270]) for (const mirrored of [false, true]) {
        const { content, assets, pixels } = fixture();
        const entity = content.entities[0];
        Object.assign(entity, { rotation, mirrored, affineFrame: { a: -2, b: 0, c: 0, d: 3, e: 2, f: 5 } });
        const result = await exportDrawingWmfWithAssets(content, assets, options);
        const [decoded] = readDrawingWmfGraphics(result.bytes).primitives;
        const [a, b] = decoded.points; const { bitmap } = decoded;
        for (let index = 0; index < 4; index++) {
            const color = [...pixels.slice(index * 4, index * 4 + 4)];
            let target = -1;
            for (let i = 0; i < 4; i++) if (color.every((v, c) => bitmap.pixels[i * 4 + c] === v)) target = i;
            assert.notEqual(target, -1);
            const x = (index % 2 + .5) / 2 * 4 - 2;
            const y = (Math.floor(index / 2) + .5) / 2 * 6 - 3;
            const angle = rotation * Math.PI / 180; const flippedY = mirrored ? -y : y;
            const expected = { x: -2 * (12 + x * Math.cos(angle) - flippedY * Math.sin(angle)) + 2,
                y: 3 * (23 + x * Math.sin(angle) + flippedY * Math.cos(angle)) + 5 };
            const actual = { x: result.report.origin.x + a.x + (target % bitmap.width + .5) / bitmap.width * (b.x - a.x),
                y: result.report.origin.y + a.y + (Math.floor(target / bitmap.width) + .5) / bitmap.height * (b.y - a.y) };
            assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) <= result.report.coordinateStep * 2);
        }
    }
});

test('WMF rectangular image clipping rotates with the image and restores context for the next object', async () => {
    const { content, assets } = fixture();
    Object.assign(content.entities[0], { rotation: 90, imageClip: { enabled: true,
        points: [{ x: .25, y: 0 }, { x: .75, y: 0 }, { x: .75, y: .5 }, { x: .25, y: .5 }] } });
    content.entities.push({ id: 'line', layerId: content.activeLayerId, type: 'line', x1: 10, y1: 20, x2: 14, y2: 26 });
    const result = await exportDrawingWmfWithAssets(content, assets, options);
    const [image, line] = readDrawingWmfGraphics(result.bytes).primitives;
    const clip = image.deviceClip;
    for (const [key, expected] of Object.entries({ minX: 12, maxX: 15, minY: 22, maxY: 24 })) {
        const origin = key.endsWith('X') ? result.report.origin.x : result.report.origin.y;
        assert.ok(Math.abs(clip[key] + origin - expected) <= result.report.coordinateStep);
    }
    assert.equal(line.deviceClip, undefined);
});

test('WMF image export retains pixels, metre placement, mirroring and painter order', async () => {
    for (const mirrored of [false, true]) {
        const { content, assets, pixels } = fixture(); content.entities[0].mirrored = mirrored;
        content.entities.push({ id: 'line', layerId: content.activeLayerId, type: 'line', x1: 10, y1: 20, x2: 14, y2: 26 });
        const before = structuredClone({ content, assets });
        const result = await exportDrawingWmfWithAssets(content, assets, options);
        const decoded = readDrawingWmfGraphics(result.bytes).primitives;
        assert.ok(result.report.warnings.includes('rasterResampling'));
        assert.deepEqual(decoded.map(item => item.kind), ['bitmap', 'polyline']);
        assert.deepEqual(decoded[0].bitmap.pixels, pixels);
        assert.ok(Math.abs(decoded[0].points[0].y + result.report.origin.y - (mirrored ? 26 : 20)) <= result.report.coordinateStep);
        assert.ok(Math.abs(decoded[0].points[1].x + result.report.origin.x - 14) <= result.report.coordinateStep);
        assert.deepEqual({ content, assets }, before);
    }
});

test('WMF exported images reimport as portable PNG assets with original pixels', async () => {
    const { content, assets, pixels } = fixture();
    const exported = await exportDrawingWmfWithAssets(content, assets, options);
    const imported = importDrawingWmf(createLcadDocument(), exported.bytes, { createCanvas, ...exported.report.origin });
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
    const image = await readDrawingRasterImage(restored.assets[0].link, options);
    assert.deepEqual(image.pixels, pixels);
    const frame = restored.content.entities[0].affineFrame;
    assert.ok(Math.abs(frame.e - 10) <= exported.report.coordinateStep);
    assert.ok(Math.abs(frame.f - 20) <= exported.report.coordinateStep);
    assert.ok(Math.abs(frame.a - 4) <= exported.report.coordinateStep);
    assert.ok(Math.abs(frame.d - 6) <= exported.report.coordinateStep);
});

test('loaded external references export their remapped embedded image assets from the host snapshot', async () => {
    const { content, assets, pixels } = fixture();
    assets[0] = { ...assets[0], name: 'colors.png', mimeType: 'image/png', width: 2, height: 2 };
    const external = { ...createLcadDocument(), content, assets };
    const host = attachDrawingReference(createLcadDocument(), external, { path: '/missing/cached-reference.lcad', insertionPoint: { x: 7, y: 8 } });
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(host))).document;
    const before = structuredClone(restored);
    const result = await exportDrawingWmfWithAssets(restored.content, restored.assets, options);
    const [decoded] = readDrawingWmfGraphics(result.bytes).primitives;
    assert.equal(decoded.kind, 'bitmap'); assert.deepEqual(decoded.bitmap.pixels, pixels);
    assert.ok(Math.abs(result.report.origin.x + decoded.points[0].x - 17) <= result.report.coordinateStep);
    assert.ok(Math.abs(result.report.origin.y + decoded.points[0].y - 28) <= result.report.coordinateStep);
    assert.deepEqual(restored, before);
});

test('WMF image export shares decoding, applies adjustments and snapshots pending source data', async () => {
    const { content, assets } = fixture(); content.entities[0].imageAdjustments = { brightness: 0 };
    content.entities.push({ ...content.entities[0], id: 'second', x: 30 });
    let calls = 0;
    const pending = exportDrawingWmfWithAssets(content, assets, { createCanvas, loadImage: async link => { calls++; return loadImage(link); } });
    content.entities[0].x = -100; assets[0].link = '';
    const result = await pending; assert.equal(calls, 1);
    assert.ok(Math.abs(result.report.origin.x + 2 * result.report.coordinateStep - 10) < 1e-10);
    for (const item of readDrawingWmfGraphics(result.bytes).primitives) {
        assert.deepEqual([...item.bitmap.pixels], Array.from({ length: 16 }, (_, i) => i % 4 === 3 ? 255 : 0));
    }
});

test('WMF image export rejects partial opacity, missing assets and resource excess atomically', async () => {
    for (const patch of [{ opacity: .5 }, { assetId: 'missing' }]) {
        const { content, assets } = fixture(); Object.assign(content.entities[0], patch);
        const before = structuredClone({ content, assets });
        await assert.rejects(exportDrawingWmfWithAssets(content, assets, options), /wmfExportUnsupported|wmfExportTransparency/);
        assert.deepEqual({ content, assets }, before);
    }
    const { content, assets } = fixture();
    await assert.rejects(exportDrawingWmfWithAssets(content, assets, { ...options, maxBytes: 45 }), /wmfLimit/);
    await assert.rejects(readDrawingRasterImage(assets[0].link, { ...options, maxPixels: 1 }), /wmfLimit/);
});

test('WMF arbitrary image rotations and triangular clips preserve colored areas without painting transparent pixels', async () => {
    const { content, assets } = fixture();
    Object.assign(content.entities[0], { rotation: 30, imageAdjustments: { transparentColor: '#ff0000' },
        imageClip: { enabled: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } });
    const before = structuredClone({ content, assets });
    const result = await exportDrawingWmfWithAssets(content, assets, options);
    const decoded = readDrawingWmfGraphics(result.bytes).primitives;
    assert.ok(result.report.warnings.includes('rasterPolygons'));
    assert.deepEqual(decoded.map(p => p.fill).sort(), ['#0000ff', '#00ff00']);
    for (const polygon of decoded) {
        assert.equal(polygon.stroke, null);
        const sourcePoints = polygon.fill === '#00ff00'
            ? [{ x: .5, y: 0 }, { x: 1, y: 0 }, { x: .5, y: .5 }]
            : [{ x: 0, y: .5 }, { x: .5, y: .5 }, { x: 0, y: 1 }];
        for (const point of sourcePoints) {
            const dx = point.x * 4 - 2; const dy = point.y * 6 - 3;
            const x = 12 + dx * Math.cos(Math.PI / 6) - dy / 2 - result.report.origin.x;
            const y = 23 + dx / 2 + dy * Math.cos(Math.PI / 6) - result.report.origin.y;
            assert.ok(polygon.points.some(p => Math.hypot(p.x - x, p.y - y) <= result.report.coordinateStep));
        }
        const area = Math.abs(polygon.points.reduce((sum, a, i) => {
            const b = polygon.points[(i + 1) % polygon.points.length]; return sum + a.x * b.y - a.y * b.x;
        }, 0)) / 2;
        assert.ok(Math.abs(area - 3) < result.report.coordinateStep * 20);
    }
    assert.deepEqual({ content, assets }, before);
});
