const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const OBJECT_PROPERTIES = new Set(['length', 'perimeter', 'area', 'radius', 'diameter', 'width', 'height', 'x', 'y', 'type', 'layer', 'text']);

/** A bounded declarative field definition. No JavaScript or arbitrary property paths. */
export function normalizeDrawingField(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8) return null;
    const identifier = input => typeof input === 'string' && input.length > 0 && input.length <= 256 && !input.includes('\0');
    const field = { kind: value.kind };
    if (value.kind === 'metadata') {
        if (typeof value.key !== 'string' || !IDENTIFIER.test(value.key) || RESERVED.has(value.key)) return null;
        field.key = value.key;
    } else if (value.kind === 'document') {
        if (!['name', 'createdAt', 'updatedAt'].includes(value.property)) return null;
        field.property = value.property;
    } else if (['object', 'table', 'field'].includes(value.kind)) {
        if (!identifier(value.entityId)) return null;
        field.entityId = value.entityId;
        if (value.kind === 'object') {
            if (!OBJECT_PROPERTIES.has(value.property)) return null;
            field.property = value.property;
        } else if (value.kind === 'table') {
            if (typeof value.address !== 'string' || !/^\$?[A-Z]{1,2}\$?[1-9]\d{0,2}$/i.test(value.address)) return null;
            field.address = value.address.toUpperCase();
        }
    } else if (value.kind === 'date') {
        if (!['iso', 'datetime', 'year', 'dmy', 'mdy'].includes(value.format)) return null;
        field.format = value.format;
    } else if (value.kind === 'page') {
        if (!['number', 'count', 'name'].includes(value.property)) return null;
        if (value.layoutId !== undefined && !identifier(value.layoutId)) return null;
        field.property = value.property;
        if (value.layoutId !== undefined) field.layoutId = value.layoutId;
    } else if (value.kind === 'formula') {
        if (typeof value.expression !== 'string' || !value.expression.trim() || value.expression.length > 512) return null;
        field.expression = value.expression;
        const entries = value.bindings === undefined ? [] : value.bindings && typeof value.bindings === 'object' && !Array.isArray(value.bindings) ? Object.entries(value.bindings) : null;
        if (!entries || entries.length > 32) return null;
        field.bindings = {};
        for (const [name, definition] of entries) {
            if (!IDENTIFIER.test(name) || RESERVED.has(name)) return null;
            const binding = normalizeDrawingField(definition, depth + 1);
            if (!binding) return null;
            field.bindings[name] = binding;
        }
    } else return null;
    for (const key of ['prefix', 'suffix']) {
        if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 512)) return null;
        if (value[key]) field[key] = value[key];
    }
    if (value.precision !== undefined) {
        if (!Number.isInteger(value.precision) || value.precision < 0 || value.precision > 8) return null;
        field.precision = value.precision;
    }
    return field;
}

export function drawingFieldDependencyIds(value) {
    const field = normalizeDrawingField(value);
    if (!field) return [];
    if (field.entityId) return [field.entityId];
    return [...new Set(Object.values(field.bindings || {}).flatMap(drawingFieldDependencyIds))];
}

export function remapDrawingField(value, idMap) {
    const field = normalizeDrawingField(value);
    if (!field) return null;
    const resolve = id => idMap instanceof Map ? idMap.get(id) || id : typeof idMap === 'function' ? idMap(id) || id
        : idMap && Object.hasOwn(idMap, id) ? idMap[id] || id : id;
    if (field.entityId) field.entityId = resolve(field.entityId);
    if (field.bindings) field.bindings = Object.fromEntries(Object.entries(field.bindings).map(([name, binding]) => [name, remapDrawingField(binding, idMap)]));
    return field;
}
