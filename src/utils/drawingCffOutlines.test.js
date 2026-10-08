import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingCffOutlineReader } from './drawingCffOutlines.js';
import { curvePointAt } from './drawingCurveKernel.js';

const numbers = (...values) => values.map(value => value + 139);
const font = (program, local = [], global = []) => ({ charStrings: [Uint8Array.from(program)],
    localSubrs: local.map(value => Uint8Array.from(value)), globalSubrs: global.map(value => Uint8Array.from(value)) });
const read = (program, local, global, options) => createDrawingCffOutlineReader(font(program, local, global), options)(0);

test('Type 2 contours preserve relative lines, shared-stack subroutines and implicit closure', () => {
    const program = [...numbers(10, 20), 21, ...numbers(30, 0, -107), 10, ...numbers(0, 40, -107), 29, 14];
    const result = read(program, [[5, 11]], [[5, 11]]);
    assert.equal(result.rule, 'nonzero');
    assert.equal(result.paths[0].closed, true);
    assert.deepEqual(curvePointAt(result.paths[0].parts[0], 0), { x: 10, y: 20 });
    assert.deepEqual(curvePointAt(result.paths[0].parts[1], 1), { x: 40, y: 60 });
    const cached = createDrawingCffOutlineReader(font(program, [[5, 11]], [[5, 11]]));
    assert.equal(cached(0), cached(0));
});

test('Type 2 cubic operators and flex retain control points and final-axis deltas', () => {
    const start = [...numbers(0, 0), 21];
    for (const [op, args, end] of [[8, [10, 20, 30, 40, 50, 60], { x: 90, y: 120 }],
        [26, [5, 10, 20, 30, 40], { x: 25, y: 80 }], [27, [5, 10, 20, 30, 40], { x: 70, y: 35 }],
        [30, [10, 20, 30, 40, 5], { x: 60, y: 45 }], [31, [10, 20, 30, 40, 5], { x: 35, y: 70 }]]) {
        const result = read([...start, ...numbers(...args), op, 14]);
        assert.equal(result.paths[0].parts[0].type, 'spline');
        assert.deepEqual(curvePointAt(result.paths[0].parts[0], 1), end);
    }
    const flex = read([...start, ...numbers(10, 10, 20, 10, 10, 10, 10), 12, 34, 14]);
    assert.deepEqual(curvePointAt(flex.paths[0].parts[1], 1), { x: 60, y: 0 });
});

test('Type 2 hint masks and width operands do not alter unhinted geometry', () => {
    const outline = [...numbers(10, 20), 21, ...numbers(30, 40), 5, 14];
    assert.deepEqual(read([...numbers(100, 0, 20), 1, 19, 0x80, ...outline]), read(outline));
    assert.deepEqual(read([...numbers(100), 14]), { paths: [], rule: 'nonzero' });
    const fractional = read([255, 0, 0, 128, 0, ...numbers(0), 21, ...numbers(1, 1), 5, 14]);
    assert.equal(fractional.paths[0].parts[0].x1, .5);
});

test('Type 2 rejects invalid stacks, truncated masks, recursion and exhausted work budgets', () => {
    for (const program of [[11], [14, 14], [28, 0], [255, 0], [139, 5, 14], [139, 10, 14],
        [...numbers(0, 20), 1, 19], Array(49).fill(139), [...numbers(0, 0), 21, 14, 0]]) {
        assert.throws(() => read(program), /dwfxFont/);
    }
    assert.throws(() => read([32, 10, 14], [[32, 10, 11]]), /dwfxFont/);
    const program = [...numbers(0, 0), 21, ...numbers(10, 20), 5, 14];
    assert.throws(() => read(program, [], [], { maxParts: 1 }), /dwfxLimit/);
    assert.throws(() => read(program, [], [], { maxOperations: 2 }), /dwfxLimit/);
});

test('Type 2 arithmetic and conditions compute coordinates without clearing lower stack operands', () => {
    const xAt = instructions => read([...instructions, ...numbers(0), 21, ...numbers(1, 1), 5, 14]).paths[0].parts[0].x1;
    for (const [op, args, expected] of [[9, [-5], 5], [10, [10, 20], 30], [11, [10, 20], -10],
        [12, [9, 2], 4.5], [14, [9], -9], [24, [4, 5], 20], [26, [81], 9],
        [3, [2, -5], 1], [4, [0, 3], 1], [5, [0], 1], [15, [5, 6], 0],
        [22, [10, 20, 4, 4], 10], [22, [10, 20, 5, 4], 20]]) {
        assert.equal(xAt([...numbers(...args), 12, op]), expected);
    }
    assert.equal(xAt([...numbers(10, 4, 5), 12, 24, 12, 10]), 30);
    const random = xAt([12, 23]);
    assert.ok(random > 0 && random <= 1);
    assert.equal(xAt([12, 23]), random);
});

test('Type 2 transient storage, index, exchange and roll remain shared across subroutine calls', () => {
    const start = program => read([...program, 21, ...numbers(1, 1), 5, 14]).paths[0].parts[0];
    assert.equal(start([...numbers(10), 12, 27]).y1, 10);
    const exchanged = start([...numbers(10, 20), 12, 28]);
    assert.equal(exchanged.x1, 20); assert.equal(exchanged.y1, 10);
    assert.equal(start([...numbers(10, -1), 12, 29]).y1, 10);
    for (const shift of [1, -1, 3]) {
        const rolled = start([...numbers(10, 20, 2, shift), 12, 30]);
        assert.equal(rolled.x1, 20); assert.equal(rolled.y1, 10);
    }
    const program = [...numbers(42, 3), 12, 20, ...numbers(-107), 10, ...numbers(0), 21, ...numbers(1, 1), 5, 14];
    assert.equal(read(program, [[...numbers(3), 12, 21, 11]]).paths[0].parts[0].x1, 42);
    const reader = createDrawingCffOutlineReader({ ...font(program, [[...numbers(3), 12, 21, 11]]),
        charStrings: [Uint8Array.from(program), Uint8Array.from([...numbers(3), 12, 21, 14])] });
    reader(0);
    assert.throws(() => reader(1), /dwfxFont/);
});

test('Type 2 calculations reject invalid addresses, underflow, division by zero and non-finite results', () => {
    for (const code of [[12, 10], [...numbers(5, 0), 12, 12], [...numbers(-1), 12, 26],
        [...numbers(1, 32), 12, 20], [...numbers(0), 12, 21], [...numbers(10, 1), 12, 29],
        [...numbers(10, 2, 1), 12, 30], [...numbers(10, -1, 1), 12, 30]]) {
        assert.throws(() => read([...code, 14]), /dwfxFont/);
    }
});
