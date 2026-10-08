import { evaluateDrawingParameterGraph } from './drawingParameterGraph.js';
import { resolveDrawingConstraintReference } from './drawingConstraintEntities.js';
import { drawingGeometricConstraintResiduals, solveDrawingGeometricConstraints } from './drawingGeometricConstraints.js';
import { getDimensionGeometry, getDrawingEntityDependencyIds } from './drawingDimensions.js';

export const DRAWING_DIMENSIONAL_CONSTRAINT_TYPES = Object.freeze(['linear', 'aligned', 'angular', 'radius', 'diameter']);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const vector = curve => curve?.type === 'line' ? { x: curve.x2 - curve.x1, y: curve.y2 - curve.y1 } : null;

export function drawingConvertedDimensionType(entity) {
    if (entity?.type === 'linearDimension') return entity.measurementMode === 'aligned' || !entity.measurementMode ? 'aligned' : 'linear';
    if (entity?.type === 'radialDimension') return entity.mode === 'diameter' ? 'diameter' : 'radius';
    return entity?.type === 'angularDimension' ? 'angular' : null;
}

export function drawingConvertedDimensionSources(dimension, entities) {
    if (!drawingConvertedDimensionType(dimension)) return null;
    const ids = getDrawingEntityDependencyIds(dimension);
    const supported = dimension.type === 'linearDimension' ? ['line', 'rectangle', 'polygon', 'ellipse']
        : dimension.type === 'angularDimension' ? ['line', 'arc'] : ['circle', 'arc'];
    return ids.length && ids.length <= 3 && ids.every(id => supported.includes(entities.get(id)?.type)) ? ids : null;
}

/** Physical metre residuals and directed angular residuals in radians. */
export function drawingDimensionalConstraintResiduals(constraint, entities, target) {
    if (!Number.isFinite(target) || !Array.isArray(constraint.refs)) return null;
    const refs = constraint.refs.map(ref => resolveDrawingConstraintReference(entities, ref));
    if (!refs.length || refs.some(ref => !ref)) return null;
    if (constraint.dimensionId !== undefined) {
        const dimension = entities.get(constraint.dimensionId);
        if (drawingConvertedDimensionType(dimension) !== constraint.type || target <= 1e-9
            || constraint.type === 'angular' && target >= 360) return null;
        const sourceIds = drawingConvertedDimensionSources(dimension, entities);
        if (!sourceIds || sourceIds.length !== refs.length || constraint.refs.some(ref => ref.point !== undefined
            || ref.part !== undefined || !sourceIds.includes(ref.entityId)) || new Set(constraint.refs.map(ref => ref.entityId)).size !== refs.length) return null;
        const geometry = getDimensionGeometry(dimension, entities);
        if (!geometry || !Number.isFinite(geometry.value)) return null;
        return [geometry.value - (constraint.type === 'angular' ? target * Math.PI / 180 : target)];
    }
    const [first, second] = refs;
    if (['radius', 'diameter'].includes(constraint.type)) {
        if (refs.length !== 1 || first.point || !['circle', 'arc'].includes(first.curve?.type) || target <= 1e-9) return null;
        return [first.curve.r * (constraint.type === 'diameter' ? 2 : 1) - target];
    }
    if (constraint.type === 'angular') {
        const a = vector(first.curve); const b = second && vector(second.curve);
        if (refs.length !== 2 || first.point || second.point || !a || !b || target <= 0 || target >= 360
            || Math.hypot(a.x, a.y) <= 1e-9 || Math.hypot(b.x, b.y) <= 1e-9) return null;
        const angle = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
        const delta = angle - target * Math.PI / 180;
        return [Math.atan2(Math.sin(delta), Math.cos(delta))];
    }
    const delta = refs.length === 1 && !first.point ? vector(first.curve)
        : refs.length === 2 && first.point && second.point ? { x: second.point.x - first.point.x, y: second.point.y - first.point.y } : null;
    if (!delta) return null;
    if (constraint.type === 'aligned') return target > 1e-9 ? [Math.hypot(delta.x, delta.y) - target] : null;
    if (constraint.type === 'linear' && ['x', 'y'].includes(constraint.axis) && [1, -1].includes(constraint.direction) && target >= 0) {
        return [delta[constraint.axis] - constraint.direction * target];
    }
    return null;
}

/** Validate definitions and formulas without solving saved geometry. */
export function normalizeDrawingDimensionalConstraints(source, entities, parameters = []) {
    if (source === undefined) source = [];
    if (!Array.isArray(source) || !Array.isArray(entities)) return { error: 'definition' };
    if (source.length > 128) return { error: 'limit' };
    const map = new Map(entities.map(entity => [entity.id, entity])); const ids = new Set(); const constraints = [];
    for (const item of source) {
        if (!identifier(item?.id) || ids.has(item.id) || !DRAWING_DIMENSIONAL_CONSTRAINT_TYPES.includes(item.type)
            || !Array.isArray(item.refs) || item.refs.length < 1 || item.refs.length > (item.dimensionId ? 3 : 2)
            || item.dimensionId !== undefined && !identifier(item.dimensionId)) return { error: 'definition' };
        const refs = item.refs.map(ref => ({ entityId: ref?.entityId,
            ...(ref?.part !== undefined ? { part: ref.part } : {}), ...(ref?.point !== undefined ? { point: ref.point } : {}) }));
        if (refs.some(ref => !identifier(ref.entityId) || !resolveDrawingConstraintReference(map, ref))) return { error: 'definition' };
        const constraint = { id: item.id, name: item.name, type: item.type, expression: item.expression, refs,
            ...(item.dimensionId !== undefined ? { dimensionId: item.dimensionId }
                : item.type === 'linear' ? { axis: item.axis, direction: item.direction } : {}) };
        constraints.push(constraint); ids.add(item.id);
    }
    if (!Array.isArray(parameters)) return { error: 'definition' };
    const graph = evaluateDrawingParameterGraph([...parameters, ...constraints.map(item => ({ name: item.name,
        expression: item.expression, type: item.type === 'angular' ? 'angle' : 'distance' }))]);
    if (graph.error) return graph;
    for (let index = 0; index < constraints.length; index += 1) {
        const definition = graph.parameters[parameters.length + index];
        constraints[index] = { ...constraints[index], name: definition.name, expression: definition.expression };
        const errors = drawingDimensionalConstraintResiduals(constraints[index], map, graph.values[definition.name]);
        if (!errors || !errors.every(Number.isFinite)) return { error: 'definition', constraintId: constraints[index].id };
    }
    return { constraints, parameters: graph.parameters.slice(0, parameters.length), values: graph.values,
        dependencies: graph.dependencies, order: graph.order };
}

/** One coupled solve enforces dimensional drivers and existing geometric relationships. */
export function solveDrawingDimensionalConstraints(content, { constraintIds, ...options } = {}) {
    const normalized = normalizeDrawingDimensionalConstraints(content.dimensionalConstraints, content.entities, content.parameters);
    if (normalized.error) return normalized;
    const dimensional = new Set(normalized.constraints.map(item => item.id));
    const geometric = content.geometricConstraints || [];
    if (geometric.some(item => dimensional.has(item.id))) return { error: 'definition' };
    const all = [...geometric, ...normalized.constraints];
    if (all.length > 256) return { error: 'limit' };
    const constraints = constraintIds ? all.filter(item => constraintIds.has(item.id)) : all;
    return solveDrawingGeometricConstraints(content, constraints, { ...options,
        residuals: (constraint, entities) => dimensional.has(constraint.id)
            ? drawingDimensionalConstraintResiduals(constraint, entities, normalized.values[constraint.name])
            : drawingGeometricConstraintResiduals(constraint, entities),
    });
}
