import { getDimensionGeometry } from './drawingDimensions.js';
import { normalizeDrawingDimensionalConstraints, solveDrawingDimensionalConstraints } from './drawingDimensionalConstraints.js';
import { normalizeDrawingGeometricConstraints } from './drawingConstraintDefinition.js';
import { drawingConstraintCoordinates, drawingConstraintCoordinateSignature } from './drawingConstraintEntities.js';
import { solveDrawingGeometricConstraints } from './drawingGeometricConstraints.js';

/** Prepare one proposed history edit; callers commit only when no error is returned. */
export function prepareDrawingConstraintEdit(previous, proposed) {
    if (proposed.geometricConstraints === undefined && proposed.dimensionalConstraints === undefined && proposed.parameters === undefined) return { content: proposed };
    const geometric = proposed.geometricConstraints === undefined ? [] : proposed.geometricConstraints;
    const dimensions = proposed.dimensionalConstraints === undefined ? [] : proposed.dimensionalConstraints;
    if (!Array.isArray(geometric) || !Array.isArray(dimensions)) return { error: 'definition' };
    const before = new Map(previous.entities.map(entity => [entity.id, entity]));
    const after = new Map(proposed.entities.map(entity => [entity.id, entity]));
    const removed = new Set([...before.keys()].filter(id => !after.has(id)));
    // Deleting an object deletes its relationships in the same undo entry.
    // A changed representation with the same ID must instead remain compatible.
    const retained = geometric.filter(constraint => Array.isArray(constraint?.refs)
        && !constraint.refs.some(ref => removed.has(ref?.entityId)));
    if (retained.length !== geometric.length
        && geometric.some(constraint => !Array.isArray(constraint?.refs))) return { error: 'definition' };
    const normalizedGeometry = normalizeDrawingGeometricConstraints(retained, proposed.entities);
    if (!normalizedGeometry) return { error: 'definition' };
    const retainedDimensions = dimensions.filter(item => Array.isArray(item?.refs) && !removed.has(item.dimensionId) && !item.refs.some(ref => removed.has(ref?.entityId)));
    if (dimensions.some(item => !Array.isArray(item?.refs))) return { error: 'definition' };
    const dimensional = normalizeDrawingDimensionalConstraints(retainedDimensions, proposed.entities, proposed.parameters);
    if (dimensional.error) return { error: 'definition', parameterError: dimensional.error };
    const constraints = [...normalizedGeometry, ...dimensional.constraints];
    if (constraints.length > 256) return { error: 'limit' };
    if (new Set(constraints.map(item => item.id)).size !== constraints.length) return { error: 'definition' };
    const content = retained.length === geometric.length && retainedDimensions.length === dimensions.length ? proposed : { ...proposed,
        ...(proposed.geometricConstraints !== undefined ? { geometricConstraints: normalizedGeometry } : {}),
        ...(proposed.dimensionalConstraints !== undefined ? { dimensionalConstraints: dimensional.constraints } : {}),
    };
    const changed = new Set();
    const fixedCoordinates = new Map();
    const previousConstraints = new Map([...(previous.geometricConstraints || []), ...(previous.dimensionalConstraints || [])].map(constraint => [constraint.id, constraint]));
    for (const constraint of constraints) {
        if (JSON.stringify(constraint) !== JSON.stringify(previousConstraints.get(constraint.id))) constraint.refs.forEach(ref => changed.add(ref.entityId));
    }
    const oldDimensions = normalizeDrawingDimensionalConstraints(previous.dimensionalConstraints, previous.entities, previous.parameters);
    for (const item of dimensional.constraints) {
        const measurementChanged = item.dimensionId && getDimensionGeometry(before.get(item.dimensionId), before)?.value
            !== getDimensionGeometry(after.get(item.dimensionId), after)?.value;
        if (oldDimensions.values?.[item.name] !== dimensional.values[item.name] || measurementChanged) item.refs.forEach(ref => changed.add(ref.entityId));
    }
    const targets = new Set(constraints.flatMap(constraint => constraint.refs.map(ref => ref.entityId)));
    for (const id of targets) {
        const oldEntity = before.get(id); const newEntity = after.get(id);
        if (!oldEntity) { changed.add(id); continue; }
        const oldValues = drawingConstraintCoordinates(oldEntity); const newValues = drawingConstraintCoordinates(newEntity);
        if (!oldValues || !newValues || oldEntity.type !== newEntity.type || oldValues.length !== newValues.length
            || drawingConstraintCoordinateSignature(oldEntity) !== drawingConstraintCoordinateSignature(newEntity)) return { error: 'topology', entityId: id };
        const driven = newValues.flatMap((value, index) => value !== oldValues[index] ? [index] : []);
        if (driven.length) { changed.add(id); fixedCoordinates.set(id, driven); }
    }
    // Expand only affected components: unrelated edits must not solve an older
    // unsatisfied component loaded from an archive.
    let expanded = true;
    while (expanded) {
        expanded = false;
        for (const constraint of constraints) if (constraint.refs.some(ref => changed.has(ref.entityId))) {
            for (const ref of constraint.refs) if (!changed.has(ref.entityId)) { changed.add(ref.entityId); expanded = true; }
        }
    }
    const active = constraints.filter(constraint => constraint.refs.some(ref => changed.has(ref.entityId)));
    if (!active.length) return { content };
    const options = { fixedCoordinates, intrinsicEntities: before };
    return dimensional.constraints.length
        ? solveDrawingDimensionalConstraints(content, { ...options, constraintIds: new Set(active.map(item => item.id)) })
        : solveDrawingGeometricConstraints(content, active, options);
}
