import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDrawingBlockParameters, resolveDrawingBlockParameterValues } from './drawingBlockParameters.js';

const parameters = () => [
    { name: 'Width', type: 'distance', default: 2, min: 1, max: 10, step: 0.5 },
    { name: 'Angle', type: 'angle', default: 0 },
    { name: 'Anchor', type: 'point', default: { x: 0, y: 1 } },
    { name: 'Handedness', type: 'flip', default: false },
    { name: 'Variant', type: 'choice', default: 'Open', choices: ['Open', 'Closed'] },
];

test('block parameter catalogues preserve typed defaults with stable canonical names', () => {
    const source = parameters();
    const normalized = normalizeDrawingBlockParameters(source);
    assert.deepEqual(normalizeDrawingBlockParameters(normalized), normalized);
    assert.deepEqual(resolveDrawingBlockParameterValues(source, { width: 3.5, handedness: true, Variant: 'Closed' }),
        { Width: 3.5, Angle: 0, Anchor: { x: 0, y: 1 }, Handedness: true, Variant: 'Closed' });
    assert.equal(source[0].default, 2);
    assert.notEqual(normalized[2].default, source[2].default);
});

test('invalid catalogues and unsafe names fail before any block is changed', () => {
    for (const name of ['__proto__', 'constructor', 'prototype', 'two words', '']) {
        assert.equal(normalizeDrawingBlockParameters([{ name, type: 'number', default: 0 }]), null);
    }
    assert.equal(normalizeDrawingBlockParameters([...parameters(), { name: 'WIDTH', type: 'number', default: 0 }]), null);
    assert.equal(normalizeDrawingBlockParameters([{ name: 'Size', type: 'distance', min: -1, default: 0 }]), null);
    assert.equal(normalizeDrawingBlockParameters([{ name: 'Choice', type: 'choice', choices: ['A', 'A'], default: 'A' }]), null);
    assert.equal(normalizeDrawingBlockParameters(Array.from({ length: 65 }, (_, i) => ({ name: `p${i}`, type: 'number', default: 0 }))), null);
});

test('parameter edits enforce types, intervals and increments atomically', () => {
    for (const override of [{ Width: 0 }, { Width: 2.1 }, { Width: 11 }, { Width: '3' }, { Angle: Infinity },
        { Handedness: 1 }, { Anchor: { x: 0, y: NaN } }, { Variant: 'Missing' }, { Other: 1 }, { width: 2, WIDTH: 3 }]) {
        assert.equal(resolveDrawingBlockParameterValues(parameters(), override), null, JSON.stringify(override));
    }
    assert.equal(resolveDrawingBlockParameterValues(parameters(), { Width: 10 }).Width, 10);
});

test('archive recovery preserves valid overrides and resets obsolete or invalid values', () => {
    assert.deepEqual(resolveDrawingBlockParameterValues(parameters(), { Width: -1, Angle: 45, OldParameter: 9 }, { recover: true }),
        { Width: 2, Angle: 45, Anchor: { x: 0, y: 1 }, Handedness: false, Variant: 'Open' });
});
