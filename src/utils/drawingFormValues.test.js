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
