import { normalizeDrawingDimensionalConstraints, drawingDimensionalConstraintResiduals } from './drawingDimensionalConstraints.js';
import { remapDrawingExpressionVariables } from './drawingPrecisionInput.js';

/** Linked display annotations travel with a complete set of their driving sources. */
export function includeDrawingDrivingAnnotations(content, entities) {
    const result = [...entities]; const included = new Set(entities.map(entity => entity.id));
    for (const constraint of content.dimensionalConstraints || []) {
        if (!constraint.dimensionId || included.has(constraint.dimensionId) || !constraint.refs.every(ref => included.has(ref.entityId))) continue;
        const annotation = content.entities.find(entity => entity.id === constraint.dimensionId);
        if (annotation) { result.push(annotation); included.add(annotation.id); }
    }
    return result;
}

/** Copy complete drivers and their formula closure; external drivers become scalar definitions. */
export function collectDrawingDimensionalCatalog(content, entityIds, { parameterNames = [] } = {}) {
    const graph = normalizeDrawingDimensionalConstraints(content.dimensionalConstraints, content.entities, content.parameters);
    if (graph.error) return graph;
    const selected = new Set(entityIds);
    const constraints = graph.constraints.filter(item => item.refs.every(ref => selected.has(ref.entityId))
        && (!item.dimensionId || selected.has(item.dimensionId)));
    const needed = new Set([...constraints.map(item => item.name), ...parameterNames]);
    const visit = name => {
        for (const dependency of graph.dependencies[name] || []) {
            if (needed.has(dependency)) continue;
            needed.add(dependency); visit(dependency);
        }
    };
    for (const name of needed) visit(name);
    const drivingNames = new Set(constraints.map(item => item.name));
    const parameters = [...graph.parameters, ...graph.constraints.map(item => ({ name: item.name,
        type: item.type === 'angular' ? 'angle' : 'distance', expression: item.expression }))]
        .filter(item => needed.has(item.name) && !drivingNames.has(item.name));
    return { parameters, dimensionalConstraints: constraints };
}

/** Merge an independent translated copy, remapping entity links and parsed formula names. */
export function mergeDrawingDimensionalCatalog(target, source, entityIdMap, entities, createId) {
    const graph = normalizeDrawingDimensionalConstraints(source.dimensionalConstraints, source.entities, source.parameters);
    if (graph.error) return graph;
    const targetGraph = normalizeDrawingDimensionalConstraints(target.dimensionalConstraints, target.entities, target.parameters);
    if (targetGraph.error) return targetGraph;
    const definitions = [...graph.parameters, ...graph.constraints];
    const occupied = new Set([...targetGraph.parameters, ...targetGraph.constraints].map(item => item.name));
    const reserved = new Set([...occupied, ...definitions.map(item => item.name)]);
    const names = new Map();
    for (const item of definitions) {
        let name = item.name;
        if (occupied.has(name)) {
            let index = 2;
            do { const suffix = `_${index++}`; name = item.name.slice(0, 64 - suffix.length) + suffix; } while (reserved.has(name));
        }
        names.set(item.name, name); reserved.add(name);
    }
    const remapDefinition = item => ({ ...item, name: names.get(item.name),
        expression: remapDrawingExpressionVariables(item.expression, names, {
            variables: graph.values, unitType: ['angle', 'angular'].includes(item.type) ? 'angle' : 'length',
        }) });
    let parameters; let dimensionalConstraints;
    try {
        parameters = [...targetGraph.parameters, ...graph.parameters.map(remapDefinition)];
        dimensionalConstraints = [...targetGraph.constraints, ...graph.constraints.map(item => ({ ...remapDefinition(item),
            id: createId(), refs: item.refs.map(ref => ({ ...ref, entityId: entityIdMap.get(ref.entityId) })),
            ...(item.dimensionId ? { dimensionId: entityIdMap.get(item.dimensionId) } : {}),
        }))];
    } catch (error) {
        if (error.precisionInputCode) return { error: error.precisionInputCode === 'expressionTooLong' ? 'limit' : 'expression' };
        throw error;
    }
    // A missing linked annotation must not silently turn a converted constraint into a direct driver.
    if (graph.constraints.some(item => item.dimensionId && !entityIdMap.has(item.dimensionId))) return { error: 'definition' };
    const merged = normalizeDrawingDimensionalConstraints(dimensionalConstraints, entities, parameters);
    if (merged.error) return merged;
    const ids = new Set((target.geometricConstraints || []).map(item => item.id));
    if (ids.size + dimensionalConstraints.length > 256) return { error: 'limit' };
    if (dimensionalConstraints.some(item => ids.has(item.id))) return { error: 'definition' };
    return { parameters: merged.parameters, dimensionalConstraints: merged.constraints, names };
}

/** Copy complete dimensional relationships without changing their prescribed values or reshaping the result. */
export function transformedDrawingDimensionalCatalog(target, source, entityIdMap, copies, transform, createId) {
    const catalog = collectDrawingDimensionalCatalog(source, entityIdMap.keys());
    if (catalog.error) return catalog;
    const constraints = [];
    for (const item of catalog.dimensionalConstraints) {
        if (item.type !== 'linear' || item.dimensionId) { constraints.push(item); continue; }
        const axis = transform({ type: 'line', x1: 0, y1: 0, x2: item.axis === 'x' ? 1 : 0, y2: item.axis === 'y' ? 1 : 0 });
        if (axis?.type !== 'line') return { error: 'topology' };
        const dx = axis.x2 - axis.x1; const dy = axis.y2 - axis.y1;
        const length = Math.hypot(dx, dy);
        if (!(length > 1e-12)) return { error: 'topology' };
        const key = Math.abs(dy) <= length * 1e-9 ? 'x' : Math.abs(dx) <= length * 1e-9 ? 'y' : null;
        if (!key) return { error: 'topology' };
        constraints.push({ ...item, axis: key, direction: item.direction * Math.sign(key === 'x' ? dx : dy) });
    }
    const merged = mergeDrawingDimensionalCatalog(target, { ...catalog, dimensionalConstraints: constraints, entities: source.entities },
        entityIdMap, [...target.entities, ...copies], createId);
    if (merged.error) return merged;
    const graph = normalizeDrawingDimensionalConstraints(merged.dimensionalConstraints, [...target.entities, ...copies], merged.parameters);
    const existing = new Set((target.dimensionalConstraints || []).map(item => item.id));
    const map = new Map([...target.entities, ...copies].map(entity => [entity.id, entity]));
    for (const item of graph.constraints.filter(item => !existing.has(item.id))) {
        const residuals = drawingDimensionalConstraintResiduals(item, map, graph.values[item.name]);
        if (!residuals || residuals.some(value => Math.abs(value) > 1e-7)) return { error: 'conflict' };
    }
    return merged;
}
