import assert from 'node:assert/strict';
import test from 'node:test';

import {
    evaluateDrawingCalculation,
    evaluateDrawingExpression,
    remapDrawingExpressionVariables,
    drawingDynamicInputAnchor,
    hasDrawingPointSyntax,
    parseDrawingPointInput,
    resolveDrawingPointInput,
} from './drawingPrecisionInput.js';

test('formula transfer renames variables without changing units, functions, constants or exponents', () => {
    const source = 'max(M, 2m) + max + 1e3mm + pi';
    const names = new Map([['m', 'm_copy'], ['max', 'max_copy'], ['mm', 'mm_copy'], ['e', 'e_copy'], ['pi', 'pi_copy']]);
    const variables = { m: 3, max: 4 };
    const result = remapDrawingExpressionVariables(source, names, { variables });
    assert.equal(result, 'max(m_copy, 2m) + max_copy + 1e3mm + pi');
    assert.equal(evaluateDrawingExpression(result, { variables: { m_copy: 3, max_copy: 4 } }), evaluateDrawingExpression(source, { variables }));
    assert.equal(remapDrawingExpressionVariables(' (Angle + angle) rad ', new Map([['angle', 'turn']]),
        { variables: { angle: 1 }, unitType: 'angle' }), '(turn + turn) rad');
    assert.throws(() => remapDrawingExpressionVariables('a', new Map([['a', 'pi']]), { variables: { a: 1 } }));
    assert.throws(() => remapDrawingExpressionVariables('missing', names));
});

test('drawing expressions safely evaluate arithmetic, functions, constants, and variables', () => {
    assert.equal(evaluateDrawingExpression('2 + 3 * 4'), 14);
    assert.equal(evaluateDrawingExpression('(2 + 3) * 4'), 20);
    assert.equal(evaluateDrawingExpression('2^3^2'), 512);
    assert.equal(evaluateDrawingExpression('sqrt(81) + min(4, 7)'), 13);
    assert.ok(Math.abs(evaluateDrawingExpression('2 * pi') - Math.PI * 2) < 1e-12);
    assert.equal(evaluateDrawingExpression('span / 2', { variables: { SPAN: 8 } }), 4);
    assert.throws(() => evaluateDrawingExpression('globalThis.alert(1)'), error => error.precisionInputCode === 'invalidExpression');
    assert.throws(() => evaluateDrawingExpression('1 / 0'), error => error.precisionInputCode === 'divisionByZero');
});

test('drawing expressions convert common metric and imperial lengths to metres', () => {
    assert.equal(evaluateDrawingExpression('2500mm'), 2.5);
    assert.equal(evaluateDrawingExpression('125cm + 0.75m'), 2);
    assert.equal(evaluateDrawingExpression('2ft + 6in'), 0.762);
    assert.equal(evaluateDrawingExpression('1yd'), 0.9144);
    assert.equal(evaluateDrawingExpression('12,5cm', { decimalComma: true }), 0.125);
    assert.equal(evaluateDrawingExpression('2,5 + 1,25', { decimalComma: true }), 3.75);
    assert.equal(evaluateDrawingExpression('min(2,5; 1,25)', { decimalComma: true }), 1.25);
});

test('angle expressions convert degrees, radians, and gradians to degrees', () => {
    assert.equal(evaluateDrawingExpression('90deg', { unitType: 'angle' }), 90);
    assert.ok(Math.abs(evaluateDrawingExpression('pi / 2 rad', { unitType: 'angle' }) - 90) < 1e-12);
    assert.equal(evaluateDrawingExpression('100gon', { unitType: 'angle' }), 90);
    assert.ok(Math.abs(evaluateDrawingExpression('90deg', {
        unitType: 'angle', angleUnit: 'radians',
    }) - Math.PI / 2) < 1e-12);
    assert.ok(Math.abs(evaluateDrawingExpression('pi / 2 rad', {
        unitType: 'angle', angleUnit: 'gradians',
    }) - 100) < 1e-12);
});

test('paper-space expressions keep unitless millimetres and convert explicit units to millimetres', () => {
    assert.equal(evaluateDrawingExpression('25', { lengthUnit: 'mm' }), 25);
    assert.equal(evaluateDrawingExpression('2.5cm', { lengthUnit: 'mm' }), 25);
    assert.deepEqual(parseDrawingPointInput('10,2cm', { lengthUnit: 'mm' }).point, { x: 10, y: 20 });
});

test('calculator assignments create case-insensitive reusable variables without mutating input', () => {
    const original = { existing: 2 };
    const assigned = evaluateDrawingCalculation('Span = 2500mm + existing', original);
    assert.equal(assigned.variable, 'span');
    assert.equal(assigned.value, 4.5);
    assert.deepEqual(assigned.variables, { existing: 2, span: 4.5 });
    assert.deepEqual(original, { existing: 2 });
    assert.equal(evaluateDrawingCalculation('SPAN / 3', assigned.variables).value, 1.5);
    assert.throws(() => evaluateDrawingCalculation('pi = 3'), error => error.precisionInputCode === 'reservedVariable');
});

test('point input supports absolute, relative Cartesian, and relative polar coordinates', () => {
    assert.deepEqual(parseDrawingPointInput('2 + 3, 4 * 2'), {
        kind: 'absoluteCartesian',
        point: { x: 5, y: 8 },
        components: { x: 5, y: 8 },
    });
    assert.deepEqual(parseDrawingPointInput('@2m,-50cm', { referencePoint: { x: 10, y: 5 } }), {
        kind: 'relativeCartesian',
        point: { x: 12, y: 4.5 },
        components: { x: 2, y: -0.5 },
    });
    const polar = parseDrawingPointInput('@2<90', { referencePoint: { x: 3, y: 4 } });
    assert.equal(polar.kind, 'relativePolar');
    assert.ok(Math.abs(polar.point.x - 3) < 1e-12);
    assert.ok(Math.abs(polar.point.y - 6) < 1e-12);
    const radians = parseDrawingPointInput('@2<pi rad', { referencePoint: { x: 3, y: 4 } });
    assert.ok(Math.abs(radians.point.x - 1) < 1e-12);
    assert.ok(Math.abs(radians.point.y - 4) < 1e-12);
    const configuredRadians = parseDrawingPointInput('@2<pi / 2', {
        referencePoint: { x: 3, y: 4 }, angleUnit: 'radians',
    });
    assert.ok(Math.abs(configuredRadians.point.x - 3) < 1e-12);
    assert.ok(Math.abs(configuredRadians.point.y - 6) < 1e-12);
    const configuredGradians = parseDrawingPointInput('@2<90deg', {
        referencePoint: { x: 3, y: 4 }, angleUnit: 'gradians',
    });
    assert.ok(Math.abs(configuredGradians.point.x - 3) < 1e-12);
    assert.ok(Math.abs(configuredGradians.point.y - 6) < 1e-12);
});

test('French decimal commas coexist with semicolon coordinate separators', () => {
    assert.equal(hasDrawingPointSyntax('12,5'), true);
    assert.equal(hasDrawingPointSyntax('12,5', { decimalComma: true }), false);
    assert.equal(hasDrawingPointSyntax('12, 5', { decimalComma: true }), true);
    assert.equal(hasDrawingPointSyntax('@12,5', { decimalComma: true }), true);
    assert.equal(parseDrawingPointInput('12,5', { decimalComma: true }), null);
    assert.deepEqual(parseDrawingPointInput('12,5;4,25', { decimalComma: true }), {
        kind: 'absoluteCartesian',
        point: { x: 12.5, y: 4.25 },
        components: { x: 12.5, y: 4.25 },
    });
    assert.deepEqual(parseDrawingPointInput('#12,5', { decimalComma: true }), {
        kind: 'absoluteCartesian',
        point: { x: 12, y: 5 },
        components: { x: 12, y: 5 },
    });
});

test('direct distance follows the current pointer direction from the reference point', () => {
    const horizontal = resolveDrawingPointInput('5', {
        referencePoint: { x: 2, y: 3 },
        directionPoint: { x: 12, y: 3 },
    });
    assert.deepEqual(horizontal, {
        matched: true,
        valid: true,
        kind: 'directDistance',
        distance: 5,
        point: { x: 7, y: 3 },
    });
    const diagonal = resolveDrawingPointInput('sqrt(8)', {
        referencePoint: { x: 1, y: 1 },
        directionPoint: { x: 3, y: 3 },
    });
    assert.ok(Math.abs(diagonal.point.x - 3) < 1e-12);
    assert.ok(Math.abs(diagonal.point.y - 3) < 1e-12);
    const frenchExpression = resolveDrawingPointInput('2,5 + 1,25', {
        decimalComma: true,
        referencePoint: { x: 1, y: 1 },
        directionPoint: { x: 2, y: 1 },
    });
    assert.equal(frenchExpression.distance, 3.75);
    assert.deepEqual(frenchExpression.point, { x: 4.75, y: 1 });
});

test('point input returns stable validation codes for incomplete contexts', () => {
    assert.deepEqual(resolveDrawingPointInput('@2,3'), {
        matched: true,
        valid: false,
        error: 'relativeReferenceRequired',
    });
    assert.deepEqual(resolveDrawingPointInput('5', { referencePoint: { x: 0, y: 0 } }), {
        matched: true,
        valid: false,
        error: 'directDistanceDirectionRequired',
    });
    assert.equal(resolveDrawingPointInput('0', {
        referencePoint: { x: 0, y: 0 },
        directionPoint: { x: 1, y: 0 },
    }).error, 'distancePositive');
    assert.deepEqual(resolveDrawingPointInput('unknownName'), { matched: false });
    assert.deepEqual(resolveDrawingPointInput('5', { allowDirectDistance: false }), { matched: false });
    assert.equal(resolveDrawingPointInput('2+').error, 'invalidExpression');
});

test('dynamic input anchors follow SVG meet letterboxing and remain inside the canvas', () => {
    assert.deepEqual(drawingDynamicInputAnchor(
        { x: 50, y: 50 },
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 1000, height: 500 },
        { offset: 0 },
    ), { x: 500, y: 250 });
    assert.deepEqual(drawingDynamicInputAnchor(
        { x: 100, y: 100 },
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 300, height: 200 },
    ), { x: 102, y: 158 });
    assert.equal(drawingDynamicInputAnchor(null, {}, {}), null);
});
