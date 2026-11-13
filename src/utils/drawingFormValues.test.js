import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDecimalValue, parseDecimalDraft } from './drawingFormValues.js';

test('decimal drafts preserve intermediate punctuation until a value is complete', () => {
    assert.deepEqual(parseDecimalDraft('3'), { kind: 'complete', value: 3 });
    assert.deepEqual(parseDecimalDraft('3.'), { kind: 'incomplete', value: undefined });
    assert.deepEqual(parseDecimalDraft('3.0'), { kind: 'complete', value: 3 });
    assert.deepEqual(parseDecimalDraft('3.6'), { kind: 'complete', value: 3.6 });
    assert.deepEqual(parseDecimalDraft(',6'), { kind: 'complete', value: 0.6 });
    assert.deepEqual(parseDecimalDraft('-'), { kind: 'incomplete', value: undefined });
    assert.deepEqual(parseDecimalDraft(''), { kind: 'empty', value: undefined });
    assert.deepEqual(parseDecimalDraft('3..6'), { kind: 'invalid', value: undefined });
});

test('finite external values have a stable editable representation', () => {
    assert.equal(formatDecimalValue(3.6), '3.6');
    assert.equal(formatDecimalValue(Number.NaN), '');
    assert.equal(formatDecimalValue(undefined), '');
});

test('decimal values follow the interface language and are rounded', () => {
    assert.equal(formatDecimalValue(6.27, { locale: 'fr' }), '6,27');
    assert.equal(formatDecimalValue(6.27, { locale: 'en' }), '6.27');
    assert.equal(formatDecimalValue(26.63970784, { locale: 'fr' }), '26,6397');
    assert.equal(formatDecimalValue(26.63970784, { locale: 'fr', precision: 2 }), '26,64');
    assert.equal(formatDecimalValue(-0.00001, { locale: 'fr' }), '0');
    assert.equal(formatDecimalValue(1234567.5, { locale: 'fr' }), '1234567,5');
    assert.deepEqual(parseDecimalDraft(formatDecimalValue(12.5, { locale: 'fr' })), { kind: 'complete', value: 12.5 });
    assert.deepEqual(parseDecimalDraft('12,5'), { kind: 'complete', value: 12.5 });
    assert.deepEqual(parseDecimalDraft('12.5'), { kind: 'complete', value: 12.5 });
});
