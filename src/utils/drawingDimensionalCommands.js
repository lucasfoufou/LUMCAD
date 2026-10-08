import { convertDrawingDimensions } from './drawingDimensionConversion.js';
import { createDrawingId } from './drawingDocument.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { parseDrawingConstraintReference } from './drawingConstraintCommands.js';
import { resolveDrawingConstraintReference } from './drawingConstraintEntities.js';
import { normalizeDrawingDimensionalConstraints, DRAWING_DIMENSIONAL_CONSTRAINT_TYPES } from './drawingDimensionalConstraints.js';
import { prepareDrawingConstraintEdit } from './drawingConstraintEditing.js';

export const DRAWING_DIMENSIONAL_COMMANDS = Object.freeze(Object.fromEntries(
    DRAWING_DIMENSIONAL_CONSTRAINT_TYPES.map(type => [`dc${type[0].toUpperCase()}${type.slice(1)}`, type]),
));

function finalize(content, proposed) {
    const normalized = normalizeDrawingDimensionalConstraints(proposed.dimensionalConstraints, proposed.entities, proposed.parameters);
    if (normalized.error) return normalized;
    const canonical = { ...proposed,
        ...(proposed.parameters !== undefined ? { parameters: normalized.parameters } : {}),
        ...(proposed.dimensionalConstraints !== undefined ? { dimensionalConstraints: normalized.constraints } : {}),
    };
    if (JSON.stringify(canonical) === JSON.stringify(content)) return { content, changed: false };
    const result = prepareDrawingConstraintEdit(content, canonical);
    if (result.error) return result;
    return { ...result, changed: true };
}

/** Shared command/MCP entry point. Every mutation validates the whole graph before committing. */
export function runDrawingDimensionalCommand(content, command, input, selectedIds = []) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens || !Array.isArray(selectedIds)) return { error: 'syntax' };
    const dimensions = content.dimensionalConstraints || []; const parameters = content.parameters || [];
    const normalized = normalizeDrawingDimensionalConstraints(dimensions, content.entities, parameters);
    if (normalized.error) return normalized;
    const report = () => ({ report: JSON.stringify({
        parameters: normalized.parameters.map(item => ({ ...item, value: normalized.values[item.name] })),
        dimensions: normalized.constraints.map(item => ({ ...item, value: normalized.values[item.name] })),
    }, null, 2) });
    if (command === 'dcConvert') {
        if (tokens.length > 1) return { error: 'syntax' };
        const result = convertDrawingDimensions(content, selectedIds, tokens[0]);
        return result.error ? result : { ...finalize(content, result.content), count: result.count };
    }
    if (command === 'parameters') {
        const operation = tokens.shift()?.toUpperCase() || 'LIST';
        if (operation === 'LIST') return tokens.length ? { error: 'syntax' } : report();
        const name = tokens.shift()?.trim().toLowerCase();
        if (!name) return { error: 'syntax' };
        if (operation === 'DELETE') {
            if (tokens.length) return { error: 'syntax' };
            if (!normalized.parameters.some(item => item.name === name)) return { error: 'missing' };
            return finalize(content, { ...content, parameters: normalized.parameters.filter(item => item.name !== name) });
        }
        if (operation !== 'SET' || tokens.length !== 2) return { error: 'syntax' };
        if (normalized.constraints.some(item => item.name === name)) return { error: 'duplicate' };
        const parameter = { name, type: tokens[0].toLowerCase(), expression: tokens[1] };
        const index = normalized.parameters.findIndex(item => item.name === name);
        const next = index < 0 ? [...normalized.parameters, parameter] : normalized.parameters.map((item, i) => i === index ? parameter : item);
        return finalize(content, { ...content, parameters: next });
    }
    let type = DRAWING_DIMENSIONAL_COMMANDS[command];
    if (command === 'dimConstraint') {
        const operation = tokens.shift()?.toLowerCase();
        if (operation === 'list') return tokens.length ? { error: 'syntax' } : report();
        if (operation === 'set') {
            if (tokens.length !== 2) return { error: 'syntax' };
            const name = tokens[0].toLowerCase();
            const target = normalized.constraints.find(item => item.name === name || item.id === tokens[0]);
            if (!target) return { error: 'missing' };
            return finalize(content, { ...content, dimensionalConstraints: normalized.constraints.map(item => item.id === target.id ? { ...item, expression: tokens[1] } : item) });
        }
        if (operation === 'delete') {
            if (tokens.length !== 1) return { error: 'syntax' };
            const target = tokens[0]; const keyword = target.toUpperCase(); const selected = new Set(selectedIds);
            if (!['ALL', 'SELECTED'].includes(keyword) && !normalized.constraints.some(item => item.id === target || item.name === target.toLowerCase())) return { error: 'missing' };
            return finalize(content, { ...content, dimensionalConstraints: normalized.constraints.filter(item => keyword === 'ALL' ? false
                : keyword === 'SELECTED' ? !selected.has(item.dimensionId) && !item.refs.some(ref => selected.has(ref.entityId)) : item.id !== target && item.name !== target.toLowerCase()) });
        }
        type = operation;
    }
    if (!DRAWING_DIMENSIONAL_CONSTRAINT_TYPES.includes(type) || tokens.length < 2) return { error: 'syntax' };
    const name = tokens.shift().toLowerCase(); const expression = tokens.shift();
    if ([...normalized.parameters, ...normalized.constraints].some(item => item.name === name)) return { error: 'duplicate' };
    let axis;
    if (type === 'linear') {
        axis = tokens.shift()?.toLowerCase();
        if (!['x', 'y'].includes(axis)) return { error: 'syntax' };
    }
    const entities = new Map(content.entities.map(entity => [entity.id, entity]));
    const refs = tokens.length ? tokens.map(token => parseDrawingConstraintReference(token, selectedIds, entities))
        : selectedIds.map(entityId => parseDrawingConstraintReference(entityId, selectedIds, entities));
    if (!refs.length || refs.some(ref => !ref)) return { error: 'selection' };
    let direction;
    if (type === 'linear') {
        const resolved = refs.map(ref => resolveDrawingConstraintReference(entities, ref));
        const [a, b] = resolved;
        const delta = refs.length === 1 && a.curve?.type === 'line' && !a.point
            ? { x: a.curve.x2 - a.curve.x1, y: a.curve.y2 - a.curve.y1 }
            : refs.length === 2 && a.point && b.point ? { x: b.point.x - a.point.x, y: b.point.y - a.point.y } : null;
        if (!delta) return { error: 'selection' };
        direction = delta[axis] < 0 ? -1 : 1;
    }
    const constraint = { id: createDrawingId('dimension-constraint'), name, expression, type, refs,
        ...(type === 'linear' ? { axis, direction } : {}) };
    return finalize(content, { ...content, dimensionalConstraints: [...normalized.constraints, constraint] });
}
