const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const TYPES = new Set(['distance', 'angle', 'number', 'point', 'flip', 'choice']);
const boundedNumber = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
const validName = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) && !RESERVED.has(value.toLowerCase());
const validChoice = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value);

/** Validate the portable parameter catalogue before evaluating any block actions. */
export function normalizeDrawingBlockParameters(source) {
    if (!Array.isArray(source) || source.length > 64) return null;
    const names = new Set();
    const parameters = [];
    for (const item of source) {
        if (!item || !validName(item.name) || names.has(item.name.toLowerCase()) || !TYPES.has(item.type)) return null;
        names.add(item.name.toLowerCase());
        const parameter = { name: item.name, type: item.type };
        if (item.type === 'choice') {
            if (!Array.isArray(item.choices) || !item.choices.length || item.choices.length > 128
                || !item.choices.every(validChoice) || new Set(item.choices).size !== item.choices.length) return null;
            parameter.choices = [...item.choices];
        }
        if (['distance', 'angle', 'number'].includes(item.type)) {
            parameter.min = item.min ?? (item.type === 'distance' ? 0 : -1e9);
            parameter.max = item.max ?? 1e9;
            if (!boundedNumber(parameter.min) || !boundedNumber(parameter.max) || parameter.min > parameter.max
                || item.type === 'distance' && parameter.min < 0) return null;
            if (item.step !== undefined) {
                if (!boundedNumber(item.step) || item.step <= 0) return null;
                parameter.step = item.step;
            }
        }
        const value = normalizeDrawingBlockParameterValue(parameter, item.default);
        if (value === undefined) return null;
        parameters.push({ ...parameter, default: value });
    }
    return parameters;
}

export function normalizeDrawingBlockParameterValue(parameter, value) {
    if (parameter.type === 'point') return value && boundedNumber(value.x) && boundedNumber(value.y) ? { x: value.x, y: value.y } : undefined;
    if (parameter.type === 'flip') return typeof value === 'boolean' ? value : undefined;
    if (parameter.type === 'choice') return parameter.choices?.includes(value) ? value : undefined;
    if (!boundedNumber(value) || value < parameter.min || value > parameter.max) return undefined;
    if (parameter.step) {
        const steps = (value - parameter.min) / parameter.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-7) return undefined;
    }
    return value;
}

/** Strict edits reject the whole batch; archive recovery can fall back per parameter. */
export function resolveDrawingBlockParameterValues(parameters, overrides = {}, { recover = false } = {}) {
    const normalized = normalizeDrawingBlockParameters(parameters);
    if (!normalized || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return null;
    const catalogue = new Map(normalized.map(parameter => [parameter.name.toLowerCase(), parameter]));
    const provided = new Map();
    for (const [name, value] of Object.entries(overrides)) {
        const key = name.toLowerCase();
        if (!catalogue.has(key) || provided.has(key)) {
            if (!recover) return null;
            continue;
        }
        provided.set(key, value);
    }
    const result = {};
    for (const parameter of normalized) {
        const key = parameter.name.toLowerCase();
        const value = provided.has(key) ? normalizeDrawingBlockParameterValue(parameter, provided.get(key)) : parameter.default;
        if (value === undefined && !recover) return null;
        result[parameter.name] = value === undefined ? parameter.default : value;
    }
    return result;
}
