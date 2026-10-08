import { normalizeDrawingDimensionalConstraints } from './drawingDimensionalConstraints.js';
import { evaluateDrawingExpression } from './drawingPrecisionInput.js';

function describeGraph(content) {
    const graph = normalizeDrawingDimensionalConstraints(content.dimensionalConstraints, content.entities, content.parameters);
    if (graph.error) return graph;
    const nodes = new Map();
    for (const item of [...graph.parameters, ...graph.constraints]) {
        const names = new Map(); const dependencies = []; const spans = [];
        const options = { variables: graph.values, unitType: ['angle', 'angular'].includes(item.type) ? 'angle' : 'length' };
        evaluateDrawingExpression(item.expression, { ...options, onVariable: (name, start, end) => {
            if (!names.has(name)) { names.set(name, `variable_${names.size}`); dependencies.push(name); }
            spans.push({ start, end, replacement: names.get(name) });
        } });
        // Keep unit-significant whitespace ("a + 1 rad" differs from "a + 1rad").
        let expression = item.expression.toLowerCase();
        for (const { start, end, replacement } of spans.reverse()) expression = expression.slice(0, start) + replacement + expression.slice(end);
        const shape = JSON.stringify(item.refs ? { kind: 'dimension', type: item.type, refs: item.refs,
            axis: item.axis, direction: item.direction, dimensionId: item.dimensionId } : { kind: 'parameter', type: item.type });
        nodes.set(item.name, { shape, expression, dependencies });
    }
    return { nodes, constraints: graph.constraints.map(item => item.name), roots: [...graph.constraints, ...graph.parameters].map(item => item.name) };
}

/** Bounded graph isomorphism: preserve formula structure and shared dependencies, not just current values. */
export function matchDrawingDimensionalCatalogs(first, second, { maxComparisons = 20000 } = {}) {
    const left = describeGraph(first); const right = describeGraph(second);
    if (left.error || right.error) return { error: left.error || right.error };
    if (left.nodes.size !== right.nodes.size || left.constraints.length !== right.constraints.length) return { matches: false };
    let remaining = maxComparisons;
    const matchNode = (a, b, forward, reverse) => {
        if (--remaining < 0) throw new Error('matching-limit');
        if (forward.has(a)) return forward.get(a) === b;
        if (reverse.has(b)) return false;
        const source = left.nodes.get(a); const target = right.nodes.get(b);
        if (!source || !target || source.shape !== target.shape || source.expression !== target.expression
            || source.dependencies.length !== target.dependencies.length) return false;
        forward.set(a, b); reverse.set(b, a);
        return source.dependencies.every((dependency, index) => matchNode(dependency, target.dependencies[index], forward, reverse));
    };
    const search = (index, forward, reverse) => {
        if (index === left.roots.length) return forward.size === left.nodes.size;
        const a = left.roots[index];
        const candidates = forward.has(a) ? [forward.get(a)] : right.roots.filter(b => !reverse.has(b));
        for (const b of candidates) {
            const nextForward = new Map(forward); const nextReverse = new Map(reverse);
            if (matchNode(a, b, nextForward, nextReverse) && search(index + 1, nextForward, nextReverse)) return true;
        }
        return false;
    };
    try { return { matches: search(0, new Map(), new Map()) }; }
    catch (error) { if (error.message === 'matching-limit') return { error: 'limit' }; throw error; }
}
