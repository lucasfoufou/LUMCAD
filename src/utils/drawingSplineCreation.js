import { normalizeCurvePrimitive } from './drawingCurveKernel.js';

export const MAX_SPLINE_CREATION_POINTS = 128;
const EPSILON = 1e-9;

const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Natural cubic interpolation in chord-length parameter space. */
function fitParts(points, parameters, definition = {}) {
    const count = points.length;
    const intervals = parameters.slice(1).map((value, index) => value - parameters[index]);
    if (intervals.some(value => value <= EPSILON)) return null;
    const second = { x: Array(count).fill(0), y: Array(count).fill(0) };
    for (const axis of ['x', 'y']) {
        const diagonal = Array(count).fill(1);
        const upper = Array(count).fill(0);
        const rhs = Array(count).fill(0);
        if (definition.startTangent) {
            diagonal[0] = 2 * intervals[0];
            upper[0] = intervals[0];
            rhs[0] = 6 * ((points[1][axis] - points[0][axis]) / intervals[0] - definition.startTangent[axis]);
        }
        for (let index = 1; index < count - 1; index += 1) {
            const before = intervals[index - 1];
            const after = intervals[index];
            const factor = before / diagonal[index - 1];
            diagonal[index] = 2 * (before + after) - factor * upper[index - 1];
            upper[index] = after;
            rhs[index] = 6 * ((points[index + 1][axis] - points[index][axis]) / after
                - (points[index][axis] - points[index - 1][axis]) / before) - factor * rhs[index - 1];
        }
        if (definition.endTangent) {
            const last = count - 1;
            const interval = intervals[last - 1];
            const factor = interval / diagonal[last - 1];
            diagonal[last] = 2 * interval - factor * upper[last - 1];
            rhs[last] = 6 * (definition.endTangent[axis] - (points[last][axis] - points[last - 1][axis]) / interval)
                - factor * rhs[last - 1];
            second[axis][last] = rhs[last] / diagonal[last];
        }
        for (let index = count - 2; index >= 0; index -= 1) {
            second[axis][index] = (rhs[index] - upper[index] * second[axis][index + 1]) / diagonal[index];
        }
    }
    return intervals.map((interval, index) => {
        const start = points[index];
        const end = points[index + 1];
        const first = {};
        const last = {};
        for (const axis of ['x', 'y']) {
            first[axis] = start[axis] + (end[axis] - start[axis]) / 3
                - interval ** 2 * (2 * second[axis][index] + second[axis][index + 1]) / 18;
            last[axis] = end[axis] - (end[axis] - start[axis]) / 3
                - interval ** 2 * (second[axis][index] + 2 * second[axis][index + 1]) / 18;
        }
        return { type: 'spline', degree: 3, controlPoints: [start, first, last, end] };
    });
}

/** Clamped uniform cubic B-spline, converted exactly by knot insertion. */
function controlParts(points, sourceKnots) {
    let controls = points.map(point => ({ ...point }));
    let knots = [...sourceKnots];
    const internal = [...new Set(knots.filter(knot => knot > 0 && knot < 1))];
    for (const knot of internal) {
        const existing = knots.filter(value => value === knot).length;
        for (let multiplicity = existing; multiplicity < 3; multiplicity += 1) {
            const span = knots.lastIndexOf(knot);
            const next = Array(controls.length + 1);
            for (let index = 0; index <= span - 3; index += 1) next[index] = controls[index];
            for (let index = span - multiplicity; index < controls.length; index += 1) next[index + 1] = controls[index];
            for (let index = span - 2; index <= span - multiplicity; index += 1) {
                next[index] = mix(controls[index - 1], controls[index], (knot - knots[index]) / (knots[index + 3] - knots[index]));
            }
            controls = next;
            knots = [...knots.slice(0, span + 1), knot, ...knots.slice(span + 1)];
        }
    }
    return Array.from({ length: (controls.length - 1) / 3 }, (_, index) => ({
        type: 'spline', degree: 3, controlPoints: controls.slice(index * 3, index * 3 + 4),
    }));
}

export function normalizeSplineDefinition(value) {
    if (!value || !['fit', 'control'].includes(value.mode) || !Array.isArray(value.points)
        || value.points.length < (value.mode === 'fit' ? 2 : 4) || value.points.length > MAX_SPLINE_CREATION_POINTS
        || value.points.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y)
            || Math.abs(point.x) > 1e12 || Math.abs(point.y) > 1e12)) return null;
    const points = value.points.map(({ x, y }) => ({ x, y }));
    const knots = value.knots;
    if (!Array.isArray(knots) || knots.some(knot => !Number.isFinite(knot) || knot < 0 || knot > 1)
        || knots[0] !== 0 || knots.at(-1) !== 1) return null;
    if (value.mode === 'fit') {
        if (knots.length !== points.length || knots.some((knot, index) => index > 0 && knot - knots[index - 1] <= EPSILON)) return null;
    } else {
        if (knots.length !== points.length + 4 || knots.slice(0, 4).some(knot => knot !== 0)
            || knots.slice(-4).some(knot => knot !== 1)
            || knots.some((knot, index) => index > 0 && knot < knots[index - 1])) return null;
        const internal = knots.slice(4, -4);
        if (internal.some(knot => knot <= EPSILON || knot >= 1 - EPSILON
            || internal.filter(value => value === knot).length > 3)) return null;
        const unique = [...new Set(knots)];
        if (unique.some((knot, index) => index > 0 && knot - unique[index - 1] <= EPSILON)) return null;
    }
    const tangents = {};
    for (const key of ['startTangent', 'endTangent']) {
        if (value[key] === undefined) continue;
        const tangent = value[key];
        if (value.mode !== 'fit' || !Number.isFinite(tangent?.x) || !Number.isFinite(tangent?.y)
            || Math.abs(tangent.x) > 1e12 || Math.abs(tangent.y) > 1e12
            || Math.hypot(tangent.x, tangent.y) <= EPSILON) return null;
        tangents[key] = { x: tangent.x, y: tangent.y };
    }
    return { mode: value.mode, points, knots: [...knots], ...tangents };
}

function materializeSplineDefinition(definition, layerId, id) {
    const { points, mode, knots } = definition;
    const rawParts = mode === 'fit' ? fitParts(points, knots, definition) : controlParts(points, knots);
    if (!rawParts) return null;
    const parts = rawParts.map(part => normalizeCurvePrimitive(part));
    if (parts.some(part => !part)) return null;
    if (parts.length === 1) return { ...parts[0], id, layerId, splineDefinition: definition };
    return { id, type: 'polyline', layerId, closed: false, parts, splineDefinition: definition };
}

export function buildSplineCreationEntity(points, layerId, mode = 'fit', id = 'draft') {
    if (!Array.isArray(points) || points.length > MAX_SPLINE_CREATION_POINTS) return null;
    let knots;
    if (mode === 'fit') {
        knots = [0];
        for (let index = 1; index < points.length; index += 1) {
            knots.push(knots[index - 1] + Math.hypot(points[index]?.x - points[index - 1]?.x, points[index]?.y - points[index - 1]?.y));
        }
        const total = knots.at(-1);
        if (!Number.isFinite(total) || total <= EPSILON) return null;
        knots = knots.map(value => value / total);
    } else {
        const spans = points.length - 3;
        knots = [0, 0, 0, 0, ...Array.from({ length: Math.max(0, spans - 1) }, (_, index) => (index + 1) / spans), 1, 1, 1, 1];
    }
    const definition = normalizeSplineDefinition({ mode, points, knots });
    return definition ? materializeSplineDefinition(definition, layerId, id) : null;
}

export function rebuildDefinedSpline(entity, value) {
    const definition = normalizeSplineDefinition(value);
    const geometry = definition && materializeSplineDefinition(definition, entity.layerId, entity.id);
    if (!geometry) return null;
    const { parts, controlPoints, degree, points, closed, splineDefinition, ...properties } = entity;
    return { ...properties, ...geometry };
}

// Geometry is authoritative after trim, break, direct Bezier edits or old-file imports.
// Discard mismatched definitions rather than silently undoing those operations.
export function reconcileSplineDefinition(entity) {
    if (!entity?.splineDefinition) return entity;
    const rebuilt = !entity.array && rebuildDefinedSpline(entity, entity.splineDefinition);
    const parts = entity.type === 'spline' ? [entity] : entity.parts;
    const expected = rebuilt?.type === 'spline' ? [rebuilt] : rebuilt?.parts;
    const matches = rebuilt && rebuilt.type === entity.type && !entity.closed
        && Array.isArray(parts) && expected?.length === parts.length
        && parts.every((part, index) => part.type === 'spline' && part.controlPoints?.length === 4
            && part.controlPoints.every((point, control) => {
                const target = expected[index].controlPoints[control];
                return Math.hypot(point.x - target.x, point.y - target.y) <= 1e-8;
            }));
    if (matches) return { ...entity, splineDefinition: rebuilt.splineDefinition };
    const { splineDefinition, ...detached } = entity;
    return detached;
}

export function transformDefinedSpline(entity, matrix) {
    const definition = normalizeSplineDefinition(reconcileSplineDefinition(entity).splineDefinition);
    if (!definition) return null;
    const { a, b, c, d, e, f } = matrix;
    const tangents = {};
    for (const key of ['startTangent', 'endTangent']) {
        if (definition[key]) tangents[key] = {
            x: a * definition[key].x + c * definition[key].y,
            y: b * definition[key].x + d * definition[key].y,
        };
    }
    return rebuildDefinedSpline(entity, { ...definition, ...tangents, points: definition.points.map(point => ({
        x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f,
    })) });
}

export function buildSplineCreationPreview(points, layerId, mode = 'fit') {
    return buildSplineCreationEntity(points, layerId, mode)
        || (points.length >= 2 ? { id: 'draft', type: 'polyline', layerId, points, closed: false } : null);
}
