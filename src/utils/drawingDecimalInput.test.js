import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCommittedDecimal, resolveCommittedDecimal } from './drawingDecimalInput.js';

test('rounds long values for display and uses the French decimal comma', () => {
    assert.equal(formatCommittedDecimal(-0.6024524215023329), '-0.6025');
    assert.equal(formatCommittedDecimal(-0.6024524215023329, { locale: 'fr' }), '-0,6025');
    assert.equal(formatCommittedDecimal(2), '2');
    assert.equal(formatCommittedDecimal(-0.00001), '0');
    assert.equal(formatCommittedDecimal(undefined), '');
});

test('accepts point and comma and clamps to the field range', () => {
    assert.equal(resolveCommittedDecimal('0.2'), 0.2);
    assert.equal(resolveCommittedDecimal('0,2'), 0.2);
    assert.equal(resolveCommittedDecimal('0,001', { min: 0.01 }), 0.01);
    assert.equal(resolveCommittedDecimal('12', { max: 8 }), 8);
});

test('discards incomplete, invalid and unchanged drafts', () => {
    assert.equal(resolveCommittedDecimal('0,'), null);
    assert.equal(resolveCommittedDecimal('abc'), null);
    assert.equal(resolveCommittedDecimal(''), null);
    assert.equal(resolveCommittedDecimal('-0,6025', { current: -0.6024524215023329 }), null);
    assert.equal(resolveCommittedDecimal('-0,6', { current: -0.6024524215023329 }), -0.6);
});
