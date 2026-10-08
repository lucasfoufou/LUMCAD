import test from 'node:test';
import assert from 'node:assert/strict';
import { solveDrawingConstraintSystem } from './drawingConstraintSolver.js';
import { curveTangentAt, curveCurvatureVectorAt } from './drawingCurveKernel.js';

const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('coincident free points converge symmetrically without mutating their input', () => {
    const initial = [0, 0, 4, 2];
    const result = solveDrawingConstraintSystem(initial, ([x1, y1, x2, y2]) => [x2 - x1, y2 - y1]);
    assert.ok(!result.error, JSON.stringify(result));
    result.values.forEach((value, index) => near(value, [2, 1, 2, 1][index]));
    assert.deepEqual(initial, [0, 0, 4, 2]);
});

test('fixed coordinates are exact while a connected rectangle solves horizontal and vertical relations', () => {
    const initial = [0, 0, 4, 0.3, 4.5, 3, -0.2, 3.2];
    const result = solveDrawingConstraintSystem(initial, ([ax, ay, bx, by, cx, cy, dx, dy]) => [
        by - ay, cx - bx, cy - dy, dx - ax, bx - ax - 4, dy - ay - 3,
    ], { fixed: [0, 1] });
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(result.values[0], 0); assert.equal(result.values[1], 0);
    result.values.forEach((value, index) => near(value, [0, 0, 4, 0, 4, 3, 0, 3][index]));
});

test('nonlinear circle intersection converges to the nearby branch', () => {
    const solve = y => solveDrawingConstraintSystem([1.4, y], ([x, v]) => [Math.hypot(x, v) - 2, Math.hypot(x - 2, v) - 2]);
    for (const sign of [-1, 1]) {
        const result = solve(sign);
        assert.ok(!result.error, JSON.stringify(result));
        near(result.values[0], 1); near(result.values[1], sign * Math.sqrt(3));
    }
});

test('cubic endpoint controls can satisfy both tangency and prescribed G2 curvature', () => {
    const curve = ([firstY, secondY]) => ({ type: 'spline', controlPoints: [
        { x: 0, y: 0 }, { x: 1, y: firstY }, { x: 2, y: secondY }, { x: 3, y: 2 },
    ] });
    // A horizontal line has zero curvature; a unit circle above the joint has (0,1).
    // Tangency alone would leave the second handle unrestricted.
    for (const curvature of [0, 1]) {
        const result = solveDrawingConstraintSystem([0.5, 0.4], values => {
            const spline = curve(values);
            const tangent = curveTangentAt(spline, 0);
            const vector = curveCurvatureVectorAt(spline, 0);
            return [tangent.y, vector.x, vector.y - curvature];
        });
        assert.ok(!result.error, JSON.stringify(result));
        near(result.values[0], 0); near(result.values[1], curvature * 1.5);
        near(curveCurvatureVectorAt(curve(result.values), 0).y, curvature);
    }
});

test('redundant consistent equations are accepted; contradictory equations expose no partial geometry', () => {
    const redundant = solveDrawingConstraintSystem([0, 0], ([x, y]) => [x - y, 2 * (x - y), x - 3]);
    assert.ok(!redundant.error); near(redundant.values[0], 3); near(redundant.values[1], 3);
    const conflict = solveDrawingConstraintSystem([0], ([x]) => [x - 1, x - 2]);
    assert.equal(conflict.error, 'conflict'); assert.equal(conflict.values, undefined);
    assert.equal(solveDrawingConstraintSystem([0], ([x]) => [x - 1], { fixed: [0] }).error, 'conflict');
});

test('validity guards prevent collapsed or negative geometry from being committed', () => {
    const result = solveDrawingConstraintSystem([1], ([r]) => [r + 1], { valid: ([r]) => r > 0 });
    assert.ok(result.error); assert.equal(result.values, undefined);
    const radius = solveDrawingConstraintSystem([4], ([r]) => [r * r - 4], { valid: ([r]) => r > 0 });
    assert.ok(!radius.error); near(radius.values[0], 2);
});

test('malformed equations, sizes and exhausted budgets fail atomically', () => {
    assert.equal(solveDrawingConstraintSystem([NaN], () => []).error, 'invalid');
    assert.equal(solveDrawingConstraintSystem(Array(129).fill(0), () => []).error, 'invalid');
    assert.equal(solveDrawingConstraintSystem([0], () => Array(513).fill(0)).error, 'invalid');
    assert.equal(solveDrawingConstraintSystem([0], () => [Infinity]).error, 'invalid');
    assert.equal(solveDrawingConstraintSystem([0], ([x]) => [x - 2], { maxEvaluations: 1 }).error, 'limit');
    assert.equal(solveDrawingConstraintSystem([0], ([x]) => x === 0 ? [1] : [1, 2]).error, 'invalid');
    assert.deepEqual(solveDrawingConstraintSystem([], () => []).values, []);
});
