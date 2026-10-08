import { evaluateDrawingExpression } from './drawingPrecisionInput.js';

const MAX_PARAMETERS = 128;
const MAX_DEPTH = 64;

/** Evaluate a complete named graph without publishing partial or cached stale values. */
export function evaluateDrawingParameterGraph(source) {
    if (!Array.isArray(source)) return { error: 'definition' };
    if (source.length > MAX_PARAMETERS) return { error: 'limit' };
    const definitions = new Map();
    for (const item of source) {
        const name = typeof item?.name === 'string' ? item.name.trim().toLowerCase() : '';
        const expression = typeof item?.expression === 'string' ? item.expression.trim() : '';
        const type = item?.type || 'number';
        if (!/^[a-z_][a-z0-9_]{0,63}$/.test(name) || ['pi', 'e'].includes(name) || definitions.has(name)
            || !expression || expression.length > 512 || !['number', 'distance', 'angle'].includes(type)) return { error: 'definition' };
        definitions.set(name, { name, expression, type });
    }
    const values = new Map(); const dependencies = new Map(); const order = []; const visiting = [];
    const fail = (error, name) => { throw { parameterGraphError: error, name, path: [...visiting, name] }; };
    const resolve = name => {
        if (values.has(name)) return values.get(name);
        if (visiting.includes(name)) fail('cycle', name);
        if (!definitions.has(name)) fail('unknown', name);
        if (visiting.length >= MAX_DEPTH) fail('limit', name);
        const definition = definitions.get(name); const refs = new Set();
        visiting.push(name);
        let value;
        try {
            value = evaluateDrawingExpression(definition.expression, {
                unitType: definition.type === 'angle' ? 'angle' : 'length',
                resolveVariable: dependency => { refs.add(dependency); return resolve(dependency); },
            });
        } catch (error) {
            if (error.parameterGraphError) throw error;
            fail('expression', name);
        }
        if (Math.abs(value) > 1e12) fail('range', name);
        visiting.pop(); values.set(name, value); dependencies.set(name, [...refs]); order.push(name);
        return value;
    };
    try {
        for (const name of definitions.keys()) resolve(name);
        return { parameters: [...definitions.values()], values: Object.fromEntries(values),
            dependencies: Object.fromEntries(dependencies), order };
    } catch (error) {
        if (!error.parameterGraphError) throw error;
        return { error: error.parameterGraphError, parameter: error.name, path: error.path };
    }
}
