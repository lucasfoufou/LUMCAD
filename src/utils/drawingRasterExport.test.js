import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { resolveDrawingNonScalingStroke } from './drawingPublish.js';
import { drawingRasterExportFrame } from './drawingRasterExport.js';
import { exportDrawingWmfRaster } from './drawingWmfRasterExport.js';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';
import { parseDrawingWmfExportInput } from './drawingWmfFiles.js';

test('model raster frame preserves world coverage with bounded aspect-correct pixel dimensions', () => {
    for (const [w, h] of [[10, 1], [1, 100], [0, 0], [100, 100]]) {
        const frame = drawingRasterExportFrame({ minX: -12, minY: 3, maxX: -12 + w, maxY: 3 + h }, { width: 4096 });
        assert.ok(frame.width <= 4096 && frame.height <= 4096 && frame.width * frame.height <= 16000000);
        assert.ok(frame.viewBox.x < -12 && frame.viewBox.y < 3);
        assert.ok(frame.viewBox.x + frame.viewBox.width > -12 + w);
        assert.ok(Math.abs(frame.height - frame.width * frame.viewBox.height / frame.viewBox.width) < 1);
    }
    for (const bounds of [{}, null, { minX: 1, maxX: 0, minY: 0, maxY: 1 }]) assert.throws(() => drawingRasterExportFrame(bounds), /wmfGeometry/);
});

test('explicit raster mode accepts resolution/background and rejects ambiguous or invalid options', () => {
    assert.deepEqual(parseDrawingWmfExportInput('"/tmp/a b.wmf" RASTER BACKGROUND #Ab1234 WIDTH 512'),
        { path: '/tmp/a b.wmf', mode: 'raster', width: 512, background: '#ab1234' });
    assert.deepEqual(parseDrawingWmfExportInput('RASTER'), { path: null, mode: 'raster', width: 2048, background: '#ffffff' });
    for (const input of ['RASTER WIDTH 63', 'RASTER WIDTH 4097', 'RASTER WIDTH 1.5', 'RASTER BACKGROUND transparent',
        'RASTER WIDTH 128 WIDTH 256', 'RASTER BACKGROUND', 'RASTER unknown 1']) assert.throws(() => parseDrawingWmfExportInput(input), /wmfExportSyntax/);
});

test('composited raster WMF preserves opaque blended pixels and world placement without mutating source', async () => {
    const canvas = createCanvas(2, 1); const context = canvas.getContext('2d');
    context.fillStyle = '#0000ff'; context.fillRect(0, 0, 2, 1);
    context.fillStyle = 'rgba(255,0,0,0.5)'; context.fillRect(0, 0, 1, 1);
    const raster = { dataUrl: canvas.toDataURL('image/png'), width: 2, height: 1, background: '#0000ff',
        viewBox: { x: -3, y: 2, width: 4, height: 2 } };
    const before = structuredClone(raster);
    const result = await exportDrawingWmfRaster(raster, { createCanvas, loadImage });
    const [image] = readDrawingWmfGraphics(result.bytes).primitives;
    assert.deepEqual([...image.bitmap.pixels], [...context.getImageData(0, 0, 2, 1).data]);
    assert.ok(Math.abs(image.points[0].x + result.report.origin.x + 3) <= result.report.coordinateStep);
    assert.ok(Math.abs(image.points[0].y + result.report.origin.y - 2) <= result.report.coordinateStep);
    assert.ok(result.report.warnings.includes('fullRaster'));
    assert.deepEqual(raster, before);
});

test('model stroke conversion keeps pixel weight independent of world extent and nested transform', () => {
    for (const unitsPerPixel of [.001, .1, 10]) for (const transformScale of [.5, 1, 3]) {
        const result = resolveDrawingNonScalingStroke({ strokeWidth: 20, unitsPerPixel, transformScale });
        assert.ok(Math.abs(Number(result.strokeWidth) * transformScale / unitsPerPixel - 20) < .002);
    }
});

test('raster frame reserves stroke reach on every edge including flat and very tall geometry', () => {
    for (const [width, height] of [[10, 0], [0, 10], [1, 10000], [10, 10]]) {
        const frame = drawingRasterExportFrame({ minX: 0, minY: 0, maxX: width, maxY: height }, { width: 512, strokePadding: 201 });
        const unit = frame.viewBox.width / frame.width;
        assert.ok(-frame.viewBox.x / unit >= 201);
        assert.ok(-frame.viewBox.y / unit >= 201);
        assert.ok((frame.viewBox.x + frame.viewBox.width - width) / unit >= 201);
        assert.ok((frame.viewBox.y + frame.viewBox.height - height) / unit >= 201);
        assert.ok(frame.width <= 512 && frame.height <= 4096);
    }
    assert.throws(() => drawingRasterExportFrame({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { width: 64, strokePadding: 40 }), /wmfLimit/);
    assert.throws(() => drawingRasterExportFrame({ minX: -1e308, minY: 0, maxX: 1e308, maxY: 1 }), /wmfGeometry/);
});
