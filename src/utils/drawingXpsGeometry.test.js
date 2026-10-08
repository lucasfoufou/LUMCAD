import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDrawingXpsGeometry } from './drawingXpsGeometry.js';
import { curvePointAt } from './drawingCurveKernel.js';
const near = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9);

test('XPS abbreviated geometry preserves compound fill rules and relative closed figures', () => {
    const result = parseDrawingXpsGeometry('F1 M0,0 l10,0 0,10 -10,0z M2,2h6v6h-6z');
    assert.equal(result.rule, 'nonzero');
    assert.equal(result.paths.length, 2);
    assert.ok(result.paths.every(path => path.closed && path.parts.length === 4));
    assert.equal(parseDrawingXpsGeometry('M0 0 L1 1').rule, 'evenodd');
    for (const data of ['F2 M0 0 L1 1', 'L0 0', 'M0 0 F1 L1 1', 'M0 0 Q1 2', 'M0 0 A1 1 0 2 0 4 4']) {
        assert.throws(() => parseDrawingXpsGeometry(data), /dwfxGeometry/);
    }
});

test('shared SVG/XPS quadratics convert exactly to cubic curves and reflect smooth controls', () => {
    const { parts } = parseDrawingXpsGeometry('M0 0 Q3 6 6 0 t6 0').paths[0];
    for (const t of [0, .25, .5, .75, 1]) {
        near(curvePointAt(parts[0], t), { x: 6 * t, y: 12 * (1 - t) * t });
        near(curvePointAt(parts[1], t), { x: 6 + 6 * t, y: -12 * (1 - t) * t });
    }
});

test('smooth cubic reflection follows only cubic segments and resets after lines or moves', () => {
    const geometry = parseDrawingXpsGeometry('M0 0 C1 2 3 4 5 6 s3 4 5 6 L20 20 S21 22 23 24 M0 0 S1 2 3 4');
    const parts = geometry.paths[0].parts;
    near(parts[1].controlPoints[1], { x: 7, y: 8 });
    near(parts[1].controlPoints[2], { x: 8, y: 10 });
    near(parts[3].controlPoints[1], { x: 20, y: 20 });
    near(geometry.paths[1].parts[0].controlPoints[1], { x: 0, y: 0 });
    const mixed = parseDrawingXpsGeometry('M0 0 Q1 2 3 4 S4 5 6 7 T8 9').paths[0].parts;
    near(mixed[1].controlPoints[1], { x: 3, y: 4 });
    near(mixed[2].controlPoints[1], { x: 6, y: 7 });
});
