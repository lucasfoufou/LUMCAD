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

test('derived indexes match a fresh build after appends, replacements, removals and refreshed items', () => {
    const next = random(11);
    const box = () => {
        const x = next() * 1000;
        const y = next() * 500;
        const size = next() * 6;
        return { minX: x, minY: y, maxX: x + size, maxY: y + size };
    };
    let items = Array.from({ length: 3000 }, (_, index) => (index % 101 === 0 ? null : box()));
    let index = createDrawingSpatialIndex(items, item => item);
    const original = index;
    const probes = Array.from({ length: 20 }, () => {
        const x = next() * 1000;
        const y = next() * 500;
        return { minX: x, minY: y, maxX: x + 30, maxY: y + 30 };
    });
    const originalResults = probes.map(area => original.query(area));
    // Refreshed items keep their identity while their bounds change.
    const dynamic = new Map(items.map(item => [item, item]));
    const refresh = item => item && item.dynamic;
    for (let step = 0; step < 40; step += 1) {
        const edited = items.slice();
        const operation = step % 4;
        if (operation === 0) edited.push(box(), { minX: 5000, minY: 5000, maxX: 5001, maxY: 5001 });
        else if (operation === 1) for (let n = 0; n < 5; n += 1) edited[Math.floor(next() * edited.length)] = box();
        else if (operation === 2) edited.length -= 3;
        else {
            const item = edited[Math.floor(next() * edited.length)];
            if (item) {
                item.dynamic = true;
                const moved = box();
                dynamic.set(item, moved);
            }
        }
        const boundsOf = item => (item?.dynamic ? dynamic.get(item) : item);
        const derived = createDrawingSpatialIndex(edited, boundsOf, { previous: index, refresh });
        const fresh = createDrawingSpatialIndex(edited, boundsOf);
        for (let query = 0; query < 60; query += 1) {
            const x = next() * 1100 - 50;
            const y = next() * 600 - 50;
            const area = query === 0 ? { minX: 4999, minY: 4999, maxX: 5002, maxY: 5002 } : { minX: x, minY: y, maxX: x + next() * 40, maxY: y + next() * 40 };
            assert.deepEqual(derived.query(area), fresh.query(area));
        }
        items = edited;
        index = derived;
    }
    // Derivations copy shared cells before writing: the original index is unchanged.
    assert.deepEqual(probes.map(area => original.query(area)), originalResults);
});

test('derivation falls back to a rebuild when most items changed', () => {
    const items = Array.from({ length: 200 }, (_, index) => ({ minX: index, minY: 0, maxX: index + 1, maxY: 1 }));
    const index = createDrawingSpatialIndex(items, item => item);
    const moved = items.map(item => ({ ...item, minY: 10, maxY: 11 }));
    const derived = createDrawingSpatialIndex(moved, item => item, { previous: index });
    assert.deepEqual(derived.query({ minX: 0, minY: 10, maxX: 300, maxY: 11 }).length, 200);
    assert.deepEqual(derived.query({ minX: 0, minY: 0, maxX: 300, maxY: 1 }), []);
});

test('covers reports whether a query would return every item', () => {
    const items = [{ minX: 0, minY: 0, maxX: 1, maxY: 1 }, null, { minX: 9, minY: 9, maxX: 10, maxY: 10 }];
    const index = createDrawingSpatialIndex(items, item => item);
    assert.equal(index.covers({ minX: -1, minY: -1, maxX: 11, maxY: 11 }), true);
    assert.equal(index.covers({ minX: -1, minY: -1, maxX: 5, maxY: 5 }), false);
    const appended = createDrawingSpatialIndex([...items, { minX: 50, minY: 50, maxX: 51, maxY: 51 }], item => item, { previous: index });
    assert.equal(appended.covers({ minX: -1, minY: -1, maxX: 11, maxY: 11 }), false, 'items outside the original grid still count');
    assert.equal(appended.covers({ minX: -1, minY: -1, maxX: 60, maxY: 60 }), true);
});
