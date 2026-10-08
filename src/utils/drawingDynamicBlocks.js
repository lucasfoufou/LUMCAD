import { normalizeDrawingBlockParameters, normalizeDrawingBlockParameterValue, resolveDrawingBlockParameterValues } from './drawingBlockParameters.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';
import { translationAffineMatrix, rotationAffineMatrix, scaleAffineMatrix, mirrorAffineMatrix } from './drawingAffine.js';
import { stretchDrawingEntity } from './drawingStretchOperations.js';
import { remapDrawingEntityDependencies } from './drawingDimensions.js';
import { prepareDrawingConstraintEdit } from './drawingConstraintEditing.js';
import { normalizeDrawingGeometricConstraints, remapDrawingGeometricConstraints, translateDrawingGeometricConstraints } from './drawingConstraintDefinition.js';
import { normalizeDrawingDimensionalConstraints } from './drawingDimensionalConstraints.js';
import { collectDrawingDimensionalCatalog, mergeDrawingDimensionalCatalog, includeDrawingDrivingAnnotations } from './drawingDimensionalTransfer.js';

const ACTION_TYPES = new Set(['move', 'rotate', 'scale', 'flip', 'stretch', 'array']);
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
const point = value => value && finite(value.x) && finite(value.y) ? { x: value.x, y: value.y } : null;

function transformDynamicEntity(entity, matrix) {
    return transformDrawingEntityAffine(entity, matrix, { preserveNativeTranslation: true });
}

export function normalizeDrawingDynamicBlock(source, entities) {
    const parameters = normalizeDrawingBlockParameters(source?.parameters);
    if (!parameters || !Array.isArray(source.actions) || source.actions.length > 128 || !Array.isArray(entities)) return null;
    const entityIds = new Set(entities.map(entity => entity.id));
    if (entityIds.size !== entities.length || entities.some(entity => typeof entity.id !== 'string' || !entity.id)) return null;
    const byName = new Map(parameters.map(parameter => [parameter.name.toLowerCase(), parameter]));
    const seen = new Set(); const actions = [];
    for (const item of source.actions) {
        const parameter = byName.get(typeof item?.parameter === 'string' ? item.parameter.toLowerCase() : '');
        if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) || seen.has(item.id)
            || !ACTION_TYPES.has(item.type) || !parameter || !Array.isArray(item.targets) || !item.targets.length
            || item.targets.length > 10000 || item.targets.some(id => !entityIds.has(id)) || new Set(item.targets).size !== item.targets.length) return null;
        seen.add(item.id);
        const action = { id: item.id, type: item.type, parameter: parameter.name, targets: [...item.targets] };
        if (['move', 'stretch'].includes(item.type)) {
            if (!['distance', 'number', 'point'].includes(parameter.type)) return null;
            if (parameter.type !== 'point') {
                action.direction = point(item.direction);
                const length = action.direction && Math.hypot(action.direction.x, action.direction.y);
                if (!length || length < 1e-9) return null;
                action.direction = { x: action.direction.x / length, y: action.direction.y / length };
            }
        }
        if (item.type === 'stretch') {
            const window = item.window;
            if (!window || !['minX', 'minY', 'maxX', 'maxY'].every(key => finite(window[key])) || window.minX > window.maxX || window.minY > window.maxY) return null;
            action.window = { minX: window.minX, minY: window.minY, maxX: window.maxX, maxY: window.maxY };
        }
        if (['rotate', 'scale', 'flip'].includes(item.type)) {
            action.origin = point(item.origin);
            if (!action.origin) return null;
        }
        if (item.type === 'rotate' && parameter.type !== 'angle') return null;
        if (item.type === 'scale' && (!['number', 'distance'].includes(parameter.type) || parameter.default <= 1e-9 || parameter.min <= 1e-9)) return null;
        if (item.type === 'flip') {
            action.axisEnd = point(item.axisEnd);
            if (parameter.type !== 'flip' || !action.axisEnd || Math.hypot(action.axisEnd.x - action.origin.x, action.axisEnd.y - action.origin.y) < 1e-9) return null;
        }
        if (item.type === 'array') {
            action.offset = point(item.offset);
            if (parameter.type !== 'number' || parameter.min < 1 || parameter.max > 1024 || !Number.isInteger(parameter.default)
                || !action.offset || Math.hypot(action.offset.x, action.offset.y) < 1e-9) return null;
        }
        actions.push(action);
    }
    let visibility;
    if (source.visibility !== undefined) {
        const parameter = byName.get(typeof source.visibility?.parameter === 'string' ? source.visibility.parameter.toLowerCase() : '');
        const states = source.visibility?.states;
        if (parameter?.type !== 'choice' || !states || typeof states !== 'object' || Array.isArray(states)
            || Object.keys(states).length !== parameter.choices.length) return null;
        const entries = [];
        for (const choice of parameter.choices) {
            if (!Object.hasOwn(states, choice) || !Array.isArray(states[choice]) || states[choice].some(id => !entityIds.has(id))
                || new Set(states[choice]).size !== states[choice].length) return null;
            entries.push([choice, [...states[choice]]]);
        }
        visibility = { parameter: parameter.name, states: Object.fromEntries(entries) };
    }
    const lookups = normalizeDynamicLookups(source.lookups ?? [], byName);
    if (!lookups) return null;
    return { parameters, actions, ...(visibility ? { visibility } : {}), ...(lookups.length ? { lookups } : {}) };
}

function normalizeDynamicLookups(source, parameters) {
    if (!Array.isArray(source) || source.length > 64) return null;
    const tables = []; const writers = new Set(); const names = new Set();
    for (const item of source) {
        const selector = parameters.get(typeof item?.parameter === 'string' ? item.parameter.toLowerCase() : '');
        if (!item || typeof item.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.name)
            || names.has(item.name.toLowerCase()) || selector?.type !== 'choice' || !Array.isArray(item.rows)
            || item.rows.length !== selector.choices.length) return null;
        names.add(item.name.toLowerCase());
        const rows = []; const keys = new Set(); let outputs;
        for (const row of item.rows) {
            if (!row || !selector.choices.includes(row.key) || keys.has(row.key) || !row.values || typeof row.values !== 'object' || Array.isArray(row.values)) return null;
            keys.add(row.key);
            const entries = []; const rowOutputs = new Set();
            for (const [key, value] of Object.entries(row.values)) {
                const parameter = parameters.get(key.toLowerCase());
                if (!parameter || parameter.name === selector.name || rowOutputs.has(parameter.name)) return null;
                const normalized = normalizeDrawingBlockParameterValue(parameter, value);
                if (normalized === undefined) return null;
                rowOutputs.add(parameter.name); entries.push([parameter.name, normalized]);
            }
            if (!rowOutputs.size || outputs && (outputs.size !== rowOutputs.size || [...outputs].some(key => !rowOutputs.has(key)))) return null;
            outputs = rowOutputs;
            rows.push({ key: row.key, values: Object.fromEntries(entries) });
        }
        if ([...outputs].some(key => writers.has(key))) return null;
        outputs.forEach(key => writers.add(key));
        tables.push({ name: item.name, parameter: selector.name, rows });
    }
    // A lookup may drive another selector. Topological order makes evaluation independent of catalogue order.
    const ordered = []; const pending = [...tables];
    while (pending.length) {
        const index = pending.findIndex(table => !pending.some(other => Object.hasOwn(other.rows[0].values, table.parameter)));
        if (index < 0) return null;
        ordered.push(pending.splice(index, 1)[0]);
    }
    return ordered;
}

export function resolveDrawingDynamicBlockValues(dynamic, overrides = {}) {
    const values = resolveDrawingBlockParameterValues(dynamic.parameters, overrides);
    if (!values) return null;
    for (const table of dynamic.lookups || []) {
        const row = table.rows.find(row => row.key === values[table.parameter]);
        if (!row) return null;
        Object.assign(values, structuredClone(row.values));
    }
    return values;
}

/** Derive instance geometry from the definition each time, without accumulating edits. */
export function evaluateDrawingDynamicBlock(definition, overrides = {}) {
    if (!definition?.dynamic) return { entities: definition?.entities || [], values: {} };
    const dynamic = normalizeDrawingDynamicBlock(definition.dynamic, definition.entities);
    if (!dynamic) return { error: 'definition' };
    const values = resolveDrawingDynamicBlockValues(dynamic, overrides);
    if (!values) return { error: 'values' };
    const defaults = new Map(dynamic.parameters.map(parameter => [parameter.name, parameter.default]));
    let entities = definition.entities.map(entity => structuredClone(entity));
    let constraints = normalizeDrawingGeometricConstraints(definition.geometricConstraints, definition.entities);
    if (!constraints) return { error: 'constraints' };
    const graph = normalizeDrawingDimensionalConstraints(definition.dimensionalConstraints, definition.entities, definition.parameters);
    if (graph.error) return { error: 'constraints' };
    let dimensionalConstraints = graph.constraints; let parameters = graph.parameters;
    const baselineEntities = new Map(definition.entities.map(entity => [entity.id, entity]));
    const originals = new Map(entities.map(entity => [entity.id, entity.id]));
    for (const action of dynamic.actions) {
        const value = values[action.parameter]; const baseline = defaults.get(action.parameter);
        const selected = new Set(action.targets);
        const target = entity => selected.has(originals.get(entity.id));
        let matrix;
        let delta;
        if (['move', 'stretch'].includes(action.type)) {
            delta = typeof value === 'object' ? { x: value.x - baseline.x, y: value.y - baseline.y }
                : { x: (value - baseline) * action.direction.x, y: (value - baseline) * action.direction.y };
            matrix = translationAffineMatrix(delta.x, delta.y);
        } else if (action.type === 'rotate') matrix = rotationAffineMatrix(value - baseline, action.origin);
        else if (action.type === 'scale') matrix = scaleAffineMatrix(value / baseline, value / baseline, action.origin);
        else if (action.type === 'flip') {
            if (value === baseline) continue;
            matrix = mirrorAffineMatrix(action.origin, action.axisEnd);
        }
        if (matrix && matrix.a === 1 && matrix.d === 1 && matrix.b === 0 && matrix.c === 0 && matrix.e === 0 && matrix.f === 0) continue;
        if (action.type === 'array') {
            if (!Number.isInteger(value) || value < 1 || value > 1024) return { error: 'values' };
            const sources = includeDrawingDrivingAnnotations({ entities, dimensionalConstraints }, entities.filter(target));
            if (entities.length + sources.length * (value - 1) > 10000) return { error: 'limit' };
            const occupied = new Set(entities.map(entity => entity.id));
            for (let index = 1; index < value; index += 1) {
                const copies = [];
                const ids = new Map(sources.map(entity => [entity.id, `${entity.id}:dynamic:${action.id}:${index}`]));
                if ([...ids.values()].some(id => occupied.has(id))) return { error: 'identity' };
                ids.forEach(id => occupied.add(id));
                const copiedConstraints = translateDrawingGeometricConstraints(constraints
                    .filter(item => item.refs.every(ref => ids.has(ref.entityId))), sources,
                { x: action.offset.x * index, y: action.offset.y * index });
                if (copiedConstraints.some(item => !item)) return { error: 'constraints' };
                constraints = [...constraints, ...remapDrawingGeometricConstraints(copiedConstraints, ids,
                    id => `${id}:dynamic:${action.id}:${index}`)];
                if (constraints.length > 256) return { error: 'constraints' };
                for (const source of sources) {
                    const copy = transformDynamicEntity(remapDrawingEntityDependencies(source, ids, { preserveAppearance: true }),
                        translationAffineMatrix(action.offset.x * index, action.offset.y * index));
                    copy.id = ids.get(source.id);
                    originals.set(copy.id, originals.get(source.id));
                    baselineEntities.set(copy.id, { ...transformDynamicEntity(baselineEntities.get(source.id),
                        translationAffineMatrix(action.offset.x * index, action.offset.y * index)), id: copy.id });
                    copies.push(copy);
                }
                const catalog = collectDrawingDimensionalCatalog({ entities, dimensionalConstraints, parameters }, ids.keys());
                if (catalog.error) return { error: 'constraints' };
                let sequence = 0;
                const merged = mergeDrawingDimensionalCatalog({ entities, dimensionalConstraints, parameters, geometricConstraints: constraints },
                    { ...catalog, entities: sources }, ids, [...entities, ...copies], () => `dimensional:dynamic:${action.id}:${index}:${sequence++}`);
                if (merged.error) return { error: 'constraints' };
                dimensionalConstraints = merged.dimensionalConstraints; parameters = merged.parameters;
                entities.push(...copies);
            }
        } else {
            const next = [];
            for (const entity of entities) {
                if (!target(entity)) { next.push(entity); continue; }
                if (action.type === 'stretch') {
                    const result = stretchDrawingEntity(entity, action.window, delta);
                    if (!result.changed && !['no-op', 'no-control-points'].includes(result.reason)) return { error: 'stretch' };
                    next.push(result.entity || entity);
                } else next.push(transformDynamicEntity(entity, matrix));
            }
            entities = next;
        }
    }
    if (constraints.length || dimensionalConstraints.length) {
        // Actions drive changed scalars; remaining coordinates in each component may follow.
        // Solve before visibility filtering, so a hidden constrained member retains its role.
        const layers = [...new Set(entities.map(entity => entity.layerId))].map(id => ({ id, visible: true, locked: false }));
        const before = { entities: [...baselineEntities.values()], layers, geometricConstraints: definition.geometricConstraints || [],
            dimensionalConstraints: definition.dimensionalConstraints || [], parameters: definition.parameters || [] };
        const result = prepareDrawingConstraintEdit(before, { ...before, entities, geometricConstraints: constraints, dimensionalConstraints, parameters });
        if (result.error) return { error: 'constraints' };
        entities = result.content.entities;
    }
    if (dynamic.visibility) {
        const visible = new Set(dynamic.visibility.states[values[dynamic.visibility.parameter]]);
        const catalog = collectDrawingDimensionalCatalog({ entities, dimensionalConstraints, parameters }, entities.filter(entity => visible.has(originals.get(entity.id))).map(entity => entity.id));
        if (catalog.error) return { error: 'constraints' };
        dimensionalConstraints = catalog.dimensionalConstraints; parameters = catalog.parameters;
        entities = entities.filter(entity => visible.has(originals.get(entity.id)));
    }
    return { entities, values, ...(constraints.length ? { geometricConstraints: constraints } : {}),
        ...(dimensionalConstraints.length || parameters.length ? { dimensionalConstraints, parameters } : {}) };
}

export function remapDrawingDynamicBlock(dynamic, entityIds) {
    if (!dynamic) return undefined;
    const remap = id => entityIds.get(id) || id;
    return { ...dynamic, actions: dynamic.actions.map(action => ({ ...action, targets: action.targets.map(remap) })),
        ...(dynamic.visibility ? { visibility: { ...dynamic.visibility,
            states: Object.fromEntries(Object.entries(dynamic.visibility.states).map(([name, ids]) => [name, ids.map(remap)])) } } : {}) };
}

/** Shared instance geometry for canvas, snapping, bounds, materialization and export. */
export function drawingBlockInstanceEvaluation(definition, reference = {}) {
    const fallback = { entities: definition?.entities || [], geometricConstraints: definition?.geometricConstraints || [],
        dimensionalConstraints: definition?.dimensionalConstraints || [], parameters: definition?.parameters || [] };
    if (!definition?.dynamic) return fallback;
    const dynamic = normalizeDrawingDynamicBlock(definition.dynamic, definition.entities);
    if (!dynamic) return fallback;
    const overrides = resolveDrawingBlockParameterValues(dynamic.parameters, reference.dynamicValues || {}, { recover: true });
    const result = evaluateDrawingDynamicBlock(definition, overrides || {});
    return result.entities ? result : fallback;
}

export function drawingBlockInstanceEntities(definition, reference = {}) {
    return drawingBlockInstanceEvaluation(definition, reference).entities;
}
