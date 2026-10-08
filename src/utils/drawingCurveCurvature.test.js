import test from 'node:test';
import assert from 'node:assert/strict';
import { curveCurvatureVectorAt, curveSecondDerivativeAt, reverseCurve } from './drawingCurveKernel.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';
import { scaleAffineMatrix, rotationAffineMatrix } from './drawingAffine.js';

const near = (actual, expected) => {
    assert.ok(actual);
    for (const key of ['x', 'y']) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-8, `${key}: ${actual[key]} != ${expected[key]}`);
};

test('straight curves have zero curvature and circles point toward their centers', () => {
    near(curveCurvatureVectorAt({ type: 'line', x1: 0, y1: 0, x2: 3, y2: 2 }, 0.3), { x: 0, y: 0 });
    const circle = { type: 'circle', cx: 10, cy: -2, r: 2 };
    near(curveCurvatureVectorAt(circle, 0), { x: -0.5, y: 0 });
    near(curveCurvatureVectorAt(circle, 0.25), { x: 0, y: -0.5 });
    const ellipse = { type: 'ellipse', cx: 0, cy: 0, rx: 4, ry: 2, rotation: 0, fullEllipse: true };
    near(curveCurvatureVectorAt(ellipse, 0), { x: -1, y: 0 });
    near(curveCurvatureVectorAt(ellipse, 0.25), { x: 0, y: -0.125 });
});

test('cubic derivatives are exact and intrinsic curvature is independent of traversal direction', () => {
    const spline = { type: 'spline', controlPoints: [{ x: 0, y: 0 }, { x: 1 / 3, y: 0 }, { x: 2 / 3, y: 1 / 3 }, { x: 1, y: 1 }] };
    near(curveSecondDerivativeAt(spline, 0), { x: 0, y: 2 });
    near(curveSecondDerivativeAt(spline, 1), { x: 0, y: 2 });
    near(curveCurvatureVectorAt(spline, 0), { x: 0, y: 2 });
    for (const parameter of [0, 0.25, 0.8, 1]) {
        near(curveCurvatureVectorAt(spline, parameter), curveCurvatureVectorAt(reverseCurve(spline), 1 - parameter));
    }
    near(curveCurvatureVectorAt(transformDrawingEntityAffine(spline, scaleAffineMatrix(3)), 0), { x: 0, y: 2 / 3 });
    near(curveCurvatureVectorAt(transformDrawingEntityAffine(spline, rotationAffineMatrix(90)), 0), { x: -2, y: 0 });
});

test('partial arcs retain the same intrinsic curvature despite their parameter sweep', () => {
    const arc = { type: 'arc', cx: 0, cy: 0, r: 3, startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true };
    near(curveCurvatureVectorAt(arc, 0.5), { x: -Math.SQRT1_2 / 3, y: -Math.SQRT1_2 / 3 });
    near(curveCurvatureVectorAt(reverseCurve(arc), 0.5), curveCurvatureVectorAt(arc, 0.5));
});

test('invalid parameters and zero-speed cubic endpoints have no defined curvature', () => {
    assert.equal(curveCurvatureVectorAt({ type: 'circle', cx: 0, cy: 0, r: 0 }, 0), null);
    assert.equal(curveSecondDerivativeAt({ type: 'circle', cx: 0, cy: 0, r: 1 }, 2), null);
    const cusp = { type: 'spline', controlPoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }] };
    assert.equal(curveCurvatureVectorAt(cusp, 0), null);
});
