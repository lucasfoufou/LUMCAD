import { createDrawingId } from './drawingDocument.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { drawingConstraintCoordinates, resolveDrawingConstraintReference } from './drawingConstraintEntities.js';
import { DRAWING_GEOMETRIC_CONSTRAINT_TYPES } from './drawingGeometricConstraints.js';
import { prepareDrawingConstraintEdit } from './drawingConstraintEditing.js';
import { detectDrawingAutoConstraints, applyDrawingAutoConstraints } from './drawingAutoConstraints.js';

export const DRAWING_CONSTRAINT_COMMANDS = Object.freeze(Object.fromEntries(
    DRAWING_GEOMETRIC_CONSTRAINT_TYPES.map(type => [`gc${type[0].toUpperCase()}${type.slice(1)}`, type]),
));

export function parseDrawingConstraintReference(token, selectedIds, entities) {
    const [target, selector, ...extra] = token.split('@');
    if (extra.length || !target) return null;
    const entityId = /^\d+$/.test(target) ? selectedIds[Number(target) - 1] : target;
    if (!entityId || !entities.has(entityId)) return null;
    const ref = { entityId };
    if (selector !== undefined) {
        const part = /^(\d+):(start|end)?$/.exec(selector);
        if (part) { ref.part = Number(part[1]); if (part[2]) ref.point = part[2]; }
        else if (selector) ref.point = selector;
        else return null;
    }
    return resolveDrawingConstraintReference(entities, ref) ? ref : null;
}

/** Shared command-bar/MCP authoring, with one atomic solved content result. */
export function runDrawingConstraintCommand(content, command, input, selectedIds = []) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens || !Array.isArray(selectedIds)) return { error: 'syntax' };
    if (command === 'autoConstrain') {
        const options = {}; const seen = new Set(); let preview = false;
        while (tokens.length) {
            const key = tokens.shift().toUpperCase();
            if (seen.has(key)) return { error: 'syntax' };
            seen.add(key);
            if (key === 'PREVIEW') { preview = true; continue; }
            if (!['TOLERANCE', 'ANGLE', 'TYPES'].includes(key) || !tokens.length) return { error: 'syntax' };
            const value = tokens.shift();
            options[key.toLowerCase()] = key === 'TYPES' ? value.toLowerCase().split(',') : Number(value);
        }
        if (!preview) return applyDrawingAutoConstraints(content, selectedIds, options);
        const result = detectDrawingAutoConstraints(content, selectedIds, options);
        return result.error ? result : { report: JSON.stringify(result.candidates, null, 2) };
    }
    let type = DRAWING_CONSTRAINT_COMMANDS[command];
    const existing = content.geometricConstraints || [];
    if (command === 'geomConstraint') {
        const operation = tokens.shift()?.toLowerCase();
        if (operation === 'list') return tokens.length ? { error: 'syntax' } : { report: JSON.stringify(existing, null, 2) };
        if (operation === 'delete') {
            if (tokens.length !== 1) return { error: 'syntax' };
            const target = tokens[0]; const selected = new Set(selectedIds);
            if (!['ALL', 'SELECTED'].includes(target.toUpperCase()) && !existing.some(constraint => constraint.id === target)) return { error: 'missing' };
            const constraints = existing.filter(constraint => target.toUpperCase() === 'ALL' ? false
                : target.toUpperCase() === 'SELECTED' ? !constraint.refs.some(ref => selected.has(ref.entityId)) : constraint.id !== target);
            return { content: constraints.length === existing.length ? content : { ...content, geometricConstraints: constraints },
                changed: constraints.length !== existing.length, count: existing.length - constraints.length };
        }
        type = operation;
    }
    if (!DRAWING_GEOMETRIC_CONSTRAINT_TYPES.includes(type)) return { error: 'syntax' };
    let internal;
    if (type === 'tangent' && ['INTERNAL', 'EXTERNAL'].includes(tokens.at(-1)?.toUpperCase())) internal = tokens.pop().toUpperCase() === 'INTERNAL';
    const entities = new Map(content.entities.map(entity => [entity.id, entity]));
    const refs = tokens.length ? tokens.map(token => parseDrawingConstraintReference(token, selectedIds, entities))
        : selectedIds.map(entityId => resolveDrawingConstraintReference(entities, { entityId }) ? { entityId } : null);
    if (!refs.length || refs.some(ref => !ref)) return { error: 'selection' };
    const additions = [];
    if (type === 'fix') {
        for (const ref of refs) {
            const resolved = resolveDrawingConstraintReference(entities, ref);
            const values = resolved.point ? [resolved.point.x, resolved.point.y] : drawingConstraintCoordinates(resolved.entity);
            if (ref.part !== undefined && !ref.point) return { error: 'selection' };
            additions.push({ id: createDrawingId('constraint'), type, refs: [ref], values });
        }
    } else additions.push({ id: createDrawingId('constraint'), type, refs, ...(internal !== undefined ? { internal } : {}) });
    if (existing.length + additions.length > 256) return { error: 'limit' };
    const result = prepareDrawingConstraintEdit(content, { ...content, geometricConstraints: [...existing, ...additions] });
    // A satisfied relation still changes the catalog even when no point moves.
    return result.error ? result : { ...result, changed: true, count: additions.length, addedIds: additions.map(constraint => constraint.id) };
}
