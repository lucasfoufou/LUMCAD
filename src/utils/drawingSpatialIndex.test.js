import test from 'node:test';
import assert from 'node:assert/strict';

import { createDrawingSpatialIndex } from './drawingSpatialIndex.js';

function random(seed) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

function intersects(left, right) {
    return left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;
}

test('queries match a linear scan, in original order', () => {
    const next = random(7);
    const items = Array.from({ length: 2000 }, (_, index) => {
        if (index % 97 === 0) return null;
        const x = next() * 1000;
        const y = next() * 500;
        const size = index % 50 === 0 ? 400 : next() * 4;
        return { minX: x, minY: y, maxX: x + size, maxY: y + size * next() };
    });
    const index = createDrawingSpatialIndex(items, item => item);
    for (let query = 0; query < 200; query += 1) {
        const x = next() * 1100 - 50;
        const y = next() * 600 - 50;
        const area = { minX: x, minY: y, maxX: x + next() * 30, maxY: y + next() * 30 };
        const expected = items.flatMap((item, itemIndex) => !item || intersects(item, area) ? [itemIndex] : []);
        assert.deepEqual(index.query(area), expected);
    }
});

test('degenerate inputs stay conservative', () => {
    assert.deepEqual(createDrawingSpatialIndex([], item => item).query({ minX: 0, minY: 0, maxX: 1, maxY: 1 }), []);
    const items = [{ minX: 2, minY: 2, maxX: 2, maxY: 2 }, { minX: NaN, minY: 0, maxX: 1, maxY: 1 }];
    const index = createDrawingSpatialIndex(items, item => item);
    assert.deepEqual(index.query({ minX: 0, minY: 0, maxX: 1, maxY: 1 }), [1]);
    assert.deepEqual(index.query({ minX: 1, minY: 1, maxX: 3, maxY: 3 }), [0, 1]);
    assert.deepEqual(index.query(null), [0, 1]);
});
