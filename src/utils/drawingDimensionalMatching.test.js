import test from 'node:test';
import assert from 'node:assert/strict';
import { matchDrawingDimensionalCatalogs } from './drawingDimensionalMatching.js';

function fixture(suffix = '') {
    return { entities: [{ id: 'edge', type: 'line', x1: 0, y1: 0, x2: 4, y2: 0 }],
        parameters: [{ name: `width${suffix}`, type: 'distance', expression: '2m' }],
        dimensionalConstraints: [
            { id: `first${suffix}`, name: `first${suffix}`, type: 'aligned', expression: `width${suffix} * 2`, refs: [{ entityId: 'edge' }] },
            { id: `second${suffix}`, name: `second${suffix}`, type: 'aligned', expression: `first${suffix}`, refs: [{ entityId: 'edge' }] },
        ] };
}

test('dimensional graph matching ignores renamed identifiers and definition ordering but retains formulas', () => {
    const first = fixture(); const second = fixture('_copy'); second.dimensionalConstraints.reverse();
    assert.deepEqual(matchDrawingDimensionalCatalogs(first, second), { matches: true });
    second.parameters[0].expression = '1m + 1m';
    assert.deepEqual(matchDrawingDimensionalCatalogs(first, second), { matches: false });
    assert.deepEqual(matchDrawingDimensionalCatalogs(first, fixture('_copy'), { maxComparisons: 0 }), { error: 'limit' });
});

test('matching preserves sharing and distinguishes unit-significant expression whitespace', () => {
    const first = fixture(); first.dimensionalConstraints[1].expression = 'width * 2';
    const second = fixture('_copy'); second.parameters.push({ name: 'other', type: 'distance', expression: '2m' });
    second.dimensionalConstraints[1].expression = 'other * 2';
    assert.deepEqual(matchDrawingDimensionalCatalogs(first, second), { matches: false });
    const angle = expression => ({ entities: [], dimensionalConstraints: [], parameters: [
        { name: 'a', type: 'angle', expression: '1' }, { name: 'b', type: 'angle', expression }] });
    assert.deepEqual(matchDrawingDimensionalCatalogs(angle('a + 1 rad'), angle('a + 1rad')), { matches: false });
});
