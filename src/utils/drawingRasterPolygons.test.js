import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingRasterPolygons } from './drawingRasterPolygons.js';
import { triangulateDrawingPolygon } from './drawingPolygonClip.js';
const raster = (width, height, values) => ({ width, height, pixels: new Uint8Array(values.flatMap(value => value ? [255, 0, 0, 255] : [0, 0, 0, 0])) });
const area = points => Math.abs(points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a.x * b.y - a.y * b.x; }, 0)) / 2;

test('raster regions merge equal runs across rows, preserving binary transparent holes', () => {
    const image = raster(3, 3, [1, 1, 1, 1, 0, 1, 1, 1, 1]); const before = structuredClone(image);
    const result = drawingRasterPolygons(image);
    assert.equal(result.length, 4);
    assert.ok(Math.abs(result.reduce((sum, p) => sum + area(p.points), 0) - 8 / 9) < 1e-12);
    assert.ok(result.every(p => p.color === '#ff0000')); assert.deepEqual(image, before);
    assert.equal(drawingRasterPolygons(raster(3, 3, Array(9).fill(1))).length, 1);
});

test('concave polygon clipping preserves disconnected row intersections and winding independence', () => {
    const clip = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: .75, y: 1 },
        { x: .75, y: .25 }, { x: .25, y: .25 }, { x: .25, y: 1 }, { x: 0, y: 1 }];
    for (const points of [clip, [...clip].reverse()]) {
        const result = drawingRasterPolygons(raster(2, 2, [0, 0, 1, 1]), { clip: points });
        assert.ok(Math.abs(result.reduce((sum, p) => sum + area(p.points), 0) - .25) < 1e-12);
        assert.ok(result.every(p => p.points.every(point => point.x <= .25 + 1e-12) || p.points.every(point => point.x >= .75 - 1e-12)));
    }
});

test('pixel regions reject partial alpha and bound triangulation and output work', () => {
    const image = raster(1, 1, [1]); image.pixels[3] = 128;
    assert.throws(() => drawingRasterPolygons(image), /wmfExportTransparency/);
    assert.throws(() => drawingRasterPolygons(raster(3, 1, [1, 0, 1]), { maxPolygons: 1 }), /wmfLimit/);
    const clip = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    assert.throws(() => triangulateDrawingPolygon(clip, { maxChecks: 1 }), /wmfLimit/);
    assert.throws(() => drawingRasterPolygons(raster(1, 1, [1]), { clip, maxChecks: 10 }), /wmfLimit/);
});
