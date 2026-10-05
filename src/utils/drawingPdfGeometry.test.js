import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDrawingPdfPath, drawingPdfPageMatrix, PDF_POINT_METRES } from './drawingPdfGeometry.js';

test('PDF paths retain exact cubic controls and independently closed subpaths in physical metres', () => {
    const matrix = drawingPdfPageMatrix({ transform: [1, 0, 0, -1, -10, 210] }, { x: 2, y: 3, scale: 100 });
    const paths = decodeDrawingPdfPath(new Float32Array([0, 10, 210, 1, 82, 210, 2, 82, 200, 70, 190, 60, 180, 4, 0, 20, 200, 1, 30, 200]), matrix);
    assert.equal(paths.length, 2);
    assert.equal(paths[0].closed, true);
    assert.equal(paths[1].closed, false);
    const [line, curve, closing] = paths[0].parts;
    assert.equal(line.x1, 2); assert.equal(line.y1, 3);
    assert.ok(Math.abs(line.x2 - 4.54) < 1e-12);
    assert.equal(curve.type, 'spline');
    assert.ok(Math.abs(curve.controlPoints[1].y - (3 + 10 * PDF_POINT_METRES * 100)) < 1e-12);
    assert.equal(closing.x2, 2); assert.equal(closing.y2, 3);
});

test('PDF quadratic curves become mathematically equivalent native cubics and malformed input is refused', () => {
    const [path] = decodeDrawingPdfPath([0, 0, 0, 3, 3, 6, 6, 0]);
    assert.deepEqual(path.parts[0].controlPoints, [{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 4, y: 4 }, { x: 6, y: 0 }]);
    for (const data of [[1, 0, 0], [0, 0], [0, 0, NaN], [0, 0, 0, 9], [4]]) assert.throws(() => decodeDrawingPdfPath(data));
    assert.throws(() => decodeDrawingPdfPath([0, 0, 0, 1, 1, 1, 1, 2, 2], undefined, 1));
    assert.throws(() => drawingPdfPageMatrix({ transform: [1, 0, 0, 1, 0, 0] }, { scale: 0 }));
});
