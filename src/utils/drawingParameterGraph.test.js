import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDrawingParameterGraph } from './drawingParameterGraph.js';

test('parameter graph resolves forward references, shared dependencies, units and case without mutation', () => {
    const source = [
        { name: 'Area', expression: 'width * height' },
        { name: 'width', type: 'distance', expression: '200cm' },
        { name: 'height', type: 'distance', expression: 'WIDTH + 1m' },
        { name: 'Angle', type: 'angle', expression: 'pi / 2 rad' },
        { name: 'half', type: 'angle', expression: 'angle / 2' },
    ];
    const saved = structuredClone(source);
    const result = evaluateDrawingParameterGraph(source);
    assert.deepEqual(result.values, { width: 2, height: 3, area: 6, angle: 90, half: 45 });
    assert.deepEqual(result.dependencies.area, ['width', 'height']);
    assert.deepEqual(result.order, ['width', 'height', 'area', 'angle', 'half']);
    assert.deepEqual(source, saved);
    const changed = evaluateDrawingParameterGraph(source.map(item => item.name === 'width' ? { ...item, expression: '4m' } : item));
    assert.equal(changed.values.area, 20);
    assert.equal(result.values.area, 6);
});

test('cycles, unknown references, invalid expressions and overflow never publish partial values', () => {
    for (const [source, error] of [
        [[{ name: 'a', expression: 'b + 1' }, { name: 'b', expression: 'a + 1' }], 'cycle'],
        [[{ name: 'a', expression: 'a + 1' }], 'cycle'],
        [[{ name: 'a', expression: 'unknown + 1' }], 'unknown'],
        [[{ name: 'a', expression: '1 / 0' }], 'expression'],
        [[{ name: 'a', expression: '1e13' }], 'range'],
        [[{ name: 'a', expression: 'globalThis.process.exit()' }], 'expression'],
    ]) {
        const result = evaluateDrawingParameterGraph([{ name: 'valid', expression: '3' }, ...source]);
        assert.equal(result.error, error, JSON.stringify(result));
        assert.equal(result.values, undefined);
    }
});

test('parameter graph bounds depth and definitions and rejects ambiguous names', () => {
    const chain = Array.from({ length: 65 }, (_, index) => ({ name: `p${index}`, expression: index === 64 ? '1' : `p${index + 1} + 1` }));
    assert.equal(evaluateDrawingParameterGraph(chain).error, 'limit');
    assert.equal(evaluateDrawingParameterGraph(Array(129).fill({ name: 'a', expression: '1' })).error, 'limit');
    for (const source of [null, [{ name: 'pi', expression: '3' }], [{ name: 'A', expression: '1' }, { name: 'a', expression: '2' }],
        [{ name: 'a', expression: '2', type: 'script' }]]) assert.equal(evaluateDrawingParameterGraph(source).error, 'definition');
    assert.deepEqual(evaluateDrawingParameterGraph([]).values, {});
});
