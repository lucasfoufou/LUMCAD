import { normalizeCurvePrimitive, extractEntityPaths, curvePointAt } from './drawingCurveKernel.js';
import { getEntityGrips } from './drawingSelection.js';
import { normalizeSplineDefinition, rebuildDefinedSpline } from './drawingSplineCreation.js';

const FIELDS = {
    point: ['x', 'y'],
    line: ['x1', 'y1', 'x2', 'y2'],
    circle: ['cx', 'cy', 'r'],
    arc: ['cx', 'cy', 'r', 'startAngle', 'endAngle'],
    ellipse: ['cx', 'cy', 'rx', 'ry', 'rotation', 'startAngle', 'endAngle'],
    rectangle: ['x', 'y', 'width', 'height', 'rotation'],
    polygon: ['cx', 'cy', 'r', 'rotation'],
};

function coordinatePaths(entity) {
    if (!entity || entity.affineFrame || entity.array || entity.linework || entity.revisionSymbol
        || entity.table || entity.tolerance || entity.annotation) return null;
    if (entity.splineDefinition) {
        const definition = normalizeSplineDefinition(entity.splineDefinition);
        if (!definition) return null;
        return [...definition.points.flatMap((_, index) => [['splineDefinition', 'points', index, 'x'], ['splineDefinition', 'points', index, 'y']]),
            ...['startTangent', 'endTangent'].filter(key => definition[key]).flatMap(key => [['splineDefinition', key, 'x'], ['splineDefinition', key, 'y']])];
    }
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        if (!entity.parts.length || entity.parts.length > 64) return null;
        const paths = entity.parts.map(part => ['line', 'circle', 'arc', 'ellipse', 'spline'].includes(part.type) && !part.parts ? coordinatePaths(part) : null);
        if (paths.some(part => !part)) return null;
        return paths.flatMap((part, index) => part.map(path => ['parts', index, ...path]));
    }
    if (entity.type === 'spline' || entity.type === 'polyline') {
        const field = entity.type === 'spline' ? 'controlPoints' : 'points';
        if (entity.parts || !Array.isArray(entity[field]) || entity[field].length > 64
            || entity[field].length < 2 || entity.type === 'spline' && entity[field].length !== 4) return null;
        return entity[field].flatMap((_, index) => [[field, index, 'x'], [field, index, 'y']]);
    }
    const fields = FIELDS[entity.type];
    if (!fields) return null;
    return fields.filter(field => !['rotation', 'startAngle', 'endAngle'].includes(field)
        || field in entity || entity.type === 'arc').map(field => [field]);
}

/** Stable scalar coordinates; metadata and entity identity stay outside the solver. */
export function drawingConstraintCoordinates(entity) {
    const paths = coordinatePaths(entity);
    if (!paths) return null;
    const values = paths.map(path => path.reduce((value, key) => value?.[key], entity));
    return values.every(value => Number.isFinite(value) && Math.abs(value) <= 1e12) ? values : null;
}

export function drawingConstraintCoordinateSignature(entity) {
    if (entity?.type === 'polygon') return JSON.stringify({ paths: coordinatePaths(entity), sides: entity.sides, mode: entity.mode || 'inscribed' });
    return JSON.stringify(coordinatePaths(entity));
}

export function translateDrawingConstraintSnapshot(entity, values, delta) {
    const paths = coordinatePaths(entity);
    if (!paths || paths.length !== values?.length) return null;
    const translated = values.map((value, index) => {
        const field = paths[index].at(-1);
        const tangent = paths[index].includes('startTangent') || paths[index].includes('endTangent');
        return value + (tangent ? 0 : ['x', 'x1', 'x2', 'cx'].includes(field) ? delta.x : ['y', 'y1', 'y2', 'cy'].includes(field) ? delta.y : 0);
    });
    return translated.every(value => Number.isFinite(value) && Math.abs(value) <= 1e12) ? translated : null;
}

export function drawingConstraintRadiusIndices(entity) {
    return (coordinatePaths(entity) || []).flatMap((path, index) => ['r', 'rx', 'ry'].includes(path.at(-1)) ? [index] : []);
}

/** Native path joints stay joined even when a relation drives just one span. */
export function drawingConstraintIntrinsicResiduals(original, candidate) {
    if (original.splineDefinition || !Array.isArray(original.parts)) return [];
    const pairs = original.parts.slice(1).map((_, index) => [index, index + 1]);
    if (original.closed) pairs.push([original.parts.length - 1, 0]);
    return pairs.flatMap(([a, b]) => {
        const first = curvePointAt(original.parts[a], 1); const second = curvePointAt(original.parts[b], 0);
        if (!first || !second || Math.hypot(first.x - second.x, first.y - second.y) > 1e-7) return [];
        const nextFirst = curvePointAt(candidate.parts[a], 1); const nextSecond = curvePointAt(candidate.parts[b], 0);
        return [nextFirst.x - nextSecond.x, nextFirst.y - nextSecond.y];
    });
}

export function rebuildDrawingConstraintEntity(entity, values) {
    const paths = coordinatePaths(entity);
    if (!paths || !Array.isArray(values) || paths.length !== values.length
        || !values.every(value => Number.isFinite(value) && Math.abs(value) <= 1e12)) return null;
    const result = structuredClone(entity);
    paths.forEach((path, index) => {
        let target = result;
        for (const key of path.slice(0, -1)) target = target[key];
        target[path.at(-1)] = values[index];
    });
    if (entity.splineDefinition) return rebuildDefinedSpline(result, result.splineDefinition);
    if (Array.isArray(result.parts)) {
        const parts = result.parts.map(part => rebuildDrawingConstraintEntity(part, drawingConstraintCoordinates(part)));
        return parts.some(part => !part) ? null : { ...result, parts };
    }
    if (['line', 'circle', 'arc', 'ellipse', 'spline'].includes(result.type)) {
        if (['circle', 'arc'].includes(result.type) && result.r <= 1e-9) return null;
        if (result.type === 'ellipse' && (result.rx <= 1e-9 || result.ry <= 1e-9)) return null;
        if (!normalizeCurvePrimitive(result)) return null;
    }
    if (result.type === 'rectangle' && (Math.abs(result.width) <= 1e-9 || Math.abs(result.height) <= 1e-9)) return null;
    if (result.type === 'polygon' && (result.r <= 1e-9 || !Number.isInteger(result.sides) || result.sides < 3 || result.sides > 1000)) return null;
    if (result.type === 'polyline' && result.points.some((point, index) => index
        && Math.hypot(point.x - result.points[index - 1].x, point.y - result.points[index - 1].y) <= 1e-9)) return null;
    return result;
}

/** A whole primitive, a path segment, or a named grip; indices never imply a new entity ID. */
export function resolveDrawingConstraintReference(entities, reference) {
    if (!reference || typeof reference.entityId !== 'string') return null;
    const entity = entities.get(reference.entityId);
    if (!entity || !drawingConstraintCoordinates(entity)) return null;
    let curve = normalizeCurvePrimitive(entity);
    if (reference.part !== undefined) {
        if (!Number.isInteger(reference.part) || reference.part < 0) return null;
        const paths = entity.parts ? [{ parts: entity.parts }] : extractEntityPaths(entity);
        if (paths.length !== 1) return null;
        curve = normalizeCurvePrimitive(paths[0].parts[reference.part]);
        if (!curve) return null;
    }
    let point = null;
    if (reference.point !== undefined) {
        if (typeof reference.point !== 'string') return null;
        if (reference.part !== undefined) {
            if (!['start', 'end'].includes(reference.point)) return null;
            point = curvePointAt(curve, reference.point === 'start' ? 0 : 1);
        } else {
            point = getEntityGrips(entity).find(grip => grip.id === reference.point);
            // Cubic endpoint constraints use the same names as other native curves.
            if (!point && curve && ['start', 'end'].includes(reference.point)) point = curvePointAt(curve, reference.point === 'start' ? 0 : 1);
        }
        if (!point) return null;
    }
    return { entity, curve, point };
}

/** Enumerate the same stable selectors accepted by commands and archive validation. */
export function drawingConstraintReferenceChoices(entity) {
    if (!drawingConstraintCoordinates(entity)) return [];
    const map = new Map([[entity.id, entity]]);
    const selectors = new Set(['', ...getEntityGrips(entity).map(grip => `@${grip.id}`)]);
    const primitive = normalizeCurvePrimitive(entity);
    if (primitive) { selectors.add('@start'); selectors.add('@end'); }
    else {
        const paths = extractEntityPaths(entity);
        if (paths.length === 1) paths[0].parts.forEach((_, part) => {
            selectors.add(`@${part}:`); selectors.add(`@${part}:start`); selectors.add(`@${part}:end`);
        });
    }
    return [...selectors].filter(selector => {
        const part = /^@(\d+):(start|end)?$/.exec(selector);
        const ref = { entityId: entity.id, ...(part ? { part: Number(part[1]), ...(part[2] ? { point: part[2] } : {}) }
            : selector ? { point: selector.slice(1) } : {}) };
        return Boolean(resolveDrawingConstraintReference(map, ref));
    });
}
