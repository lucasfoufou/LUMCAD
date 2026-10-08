import { drawingGeometricConstraintResiduals, DRAWING_GEOMETRIC_CONSTRAINT_TYPES } from './drawingGeometricConstraints.js';
import { translateDrawingConstraintSnapshot, rebuildDrawingConstraintEntity, drawingConstraintCoordinates } from './drawingConstraintEntities.js';

const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

/** Strict optional archive catalog. Invalid relationships must not silently disappear. */
export function normalizeDrawingGeometricConstraints(source, entities) {
    if (source === undefined) return [];
    if (!Array.isArray(source) || source.length > 256 || !Array.isArray(entities)) return null;
    const entityMap = new Map(entities.map(entity => [entity.id, entity]));
    const ids = new Set();
    const result = [];
    for (const entry of source) {
        if (!identifier(entry?.id) || ids.has(entry.id) || !DRAWING_GEOMETRIC_CONSTRAINT_TYPES.includes(entry.type)
            || !Array.isArray(entry.refs) || entry.refs.length < 1 || entry.refs.length > 3) return null;
        const refs = [];
        for (const ref of entry.refs) {
            if (!identifier(ref?.entityId) || !entityMap.has(ref.entityId)
                || ref.point !== undefined && !identifier(ref.point)
                || ref.part !== undefined && (!Number.isInteger(ref.part) || ref.part < 0 || ref.part > 4095)) return null;
            refs.push({ entityId: ref.entityId, ...(ref.part !== undefined ? { part: ref.part } : {}),
                ...(ref.point !== undefined ? { point: ref.point } : {}) });
        }
        const constraint = { id: entry.id, type: entry.type, refs };
        if (entry.type === 'fix') {
            if (!Array.isArray(entry.values) || !entry.values.length || entry.values.length > 128
                || !entry.values.every(value => Number.isFinite(value) && Math.abs(value) <= 1e12)) return null;
            constraint.values = [...entry.values];
        }
        if (entry.internal !== undefined) {
            if (entry.type !== 'tangent' || typeof entry.internal !== 'boolean') return null;
            constraint.internal = entry.internal;
        }
        // Check reference compatibility, but never solve on archive load/save.
        const residuals = drawingGeometricConstraintResiduals(constraint, entityMap);
        if (!residuals || !residuals.every(Number.isFinite)) return null;
        ids.add(entry.id); result.push(constraint);
    }
    return result;
}

/** Copy only complete relationships; external references are never attached to new objects. */
export function remapDrawingGeometricConstraints(constraints, entityIds, createId) {
    return constraints.filter(constraint => constraint.refs.every(ref => entityIds.has(ref.entityId)))
        .map(constraint => ({ ...constraint, id: createId(constraint.id),
            refs: constraint.refs.map(ref => ({ ...ref, entityId: entityIds.get(ref.entityId) })),
            ...(constraint.values ? { values: [...constraint.values] } : {}),
        }));
}

/** Translate saved fixation targets, including unsatisfied snapshots, without solving. */
export function translateDrawingGeometricConstraints(constraints, entities, delta) {
    const entityMap = new Map(entities.map(entity => [entity.id, entity]));
    return constraints.map(constraint => {
        if (constraint.type !== 'fix') return constraint;
        const ref = constraint.refs[0];
        if (ref.point) return { ...constraint, values: [constraint.values[0] + delta.x, constraint.values[1] + delta.y] };
        const values = translateDrawingConstraintSnapshot(entityMap.get(ref.entityId), constraint.values, delta);
        return values ? { ...constraint, values } : null;
    });
}

/** Transform complete snapshots without solving. */
export function transformDrawingGeometricConstraints(constraints, sources, idMap, transform, createId) {
    const sourceMap = new Map(sources.map(entity => [entity.id, entity]));
    const retained = constraints.filter(item => item.refs.every(ref => idMap.has(ref.entityId)));
    const transformed = [];
    for (const constraint of retained) {
        if (constraint.type !== 'fix') { transformed.push(constraint); continue; }
        const ref = constraint.refs[0]; const source = sourceMap.get(ref.entityId);
        if (ref.point) {
            const point = transform({ id: source.id, type: 'point', layerId: source.layerId, x: constraint.values[0], y: constraint.values[1] });
            transformed.push({ ...constraint, values: [point.x, point.y] });
        } else {
            const snapshot = rebuildDrawingConstraintEntity(source, constraint.values);
            const values = snapshot && drawingConstraintCoordinates(transform(snapshot));
            if (!values) return { error: 'topology' };
            transformed.push({ ...constraint, values });
        }
    }
    return { constraints: remapDrawingGeometricConstraints(transformed, idMap, createId) };
}

/** Duplicate relations without letting a solve undo the requested copy transform. */
export function transformedDrawingCopyConstraints(content, sources, copies, idMap, transform, createId) {
    const result = transformDrawingGeometricConstraints(content.geometricConstraints || [], sources, idMap, transform, createId);
    if (result.error) return result;
    const additions = result.constraints;
    const constraints = [...(content.geometricConstraints || []), ...additions];
    if (constraints.length > 256) return { error: 'limit' };
    if (!normalizeDrawingGeometricConstraints(constraints, [...content.entities, ...copies])) return { error: 'topology' };
    const entityMap = new Map(copies.map(entity => [entity.id, entity]));
    if (additions.some(item => drawingGeometricConstraintResiduals(item, entityMap).some(value => Math.abs(value) > 1e-7))) return { error: 'conflict' };
    return { constraints };
}

/** Express axis relations after a transform when they remain aligned with drawing axes. */
export function transformDrawingConstraintAxes(constraints, matrix) {
    const result = [];
    for (const constraint of constraints) {
        if (!['horizontal', 'vertical'].includes(constraint.type)) { result.push(constraint); continue; }
        const direction = constraint.type === 'horizontal' ? { x: matrix.a, y: matrix.b } : { x: matrix.c, y: matrix.d };
        const length = Math.hypot(direction.x, direction.y);
        if (!(length > 0)) return null;
        const type = Math.abs(direction.y) <= length * 1e-9 ? 'horizontal'
            : Math.abs(direction.x) <= length * 1e-9 ? 'vertical' : null;
        if (!type) return null;
        result.push({ ...constraint, type });
    }
    return result;
}
