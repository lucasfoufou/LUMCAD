import { buildSplineCreationEntity, MAX_SPLINE_CREATION_POINTS, rebuildDefinedSpline, reconcileSplineDefinition } from './drawingSplineCreation.js';
import { normalizeCurvePrimitive, splitCurve } from './drawingCurveKernel.js';

export function changeSplinePointList(entity, index, point = null) {
    const definition = reconcileSplineDefinition(entity).splineDefinition;
    const inserting = point !== null;
    if (!definition || !Number.isInteger(index) || index < 0 || index > definition.points.length - (inserting ? 0 : 1)) return entity;
    const points = [...definition.points];
    if (inserting) points.splice(index, 0, point);
    else points.splice(index, 1);
    // Changing the vertex count rebuilds the initial chord/uniform parameterization.
    const created = buildSplineCreationEntity(points, entity.layerId, definition.mode, entity.id);
    if (!created) return entity;
    const next = { ...created.splineDefinition };
    if (definition.mode === 'fit') {
        if (index !== 0 && definition.startTangent) next.startTangent = definition.startTangent;
        if (index !== definition.points.length - (inserting ? 0 : 1) && definition.endTangent) next.endTangent = definition.endTangent;
    }
    return rebuildDefinedSpline(entity, next) || entity;
}

export function insertSplineKnot(entity, knot) {
    const definition = reconcileSplineDefinition(entity).splineDefinition;
    if (definition?.mode !== 'control' || !Number.isFinite(knot) || knot <= 0 || knot >= 1
        || definition.points.length >= MAX_SPLINE_CREATION_POINTS) return entity;
    const { points, knots } = definition;
    const multiplicity = knots.filter(value => value === knot).length;
    if (multiplicity >= 3) return entity;
    const span = knots.findIndex(value => value > knot) - 1;
    const next = Array(points.length + 1);
    for (let index = 0; index <= span - 3; index += 1) next[index] = points[index];
    for (let index = span - multiplicity; index < points.length; index += 1) next[index + 1] = points[index];
    for (let index = span - 2; index <= span - multiplicity; index += 1) {
        const weight = (knot - knots[index]) / (knots[index + 3] - knots[index]);
        next[index] = {
            x: points[index - 1].x + weight * (points[index].x - points[index - 1].x),
            y: points[index - 1].y + weight * (points[index].y - points[index - 1].y),
        };
    }
    return rebuildDefinedSpline(entity, { ...definition, points: next, knots: [...knots.slice(0, span + 1), knot, ...knots.slice(span + 1)] }) || entity;
}

function connectedCubicParts(entity) {
    if (entity?.array || entity?.closed) return null;
    const source = entity.type === 'spline' ? [entity] : entity.type === 'polyline' ? entity.parts : null;
    if (!source?.length || source.length > 4096) return null;
    const parts = source.map(part => normalizeCurvePrimitive(part));
    if (parts.some((part, index) => part?.type !== 'spline' || (index > 0
        && Math.hypot(part.controlPoints[0].x - parts[index - 1].controlPoints[3].x,
            part.controlPoints[0].y - parts[index - 1].controlPoints[3].y) > 1e-9))) return null;
    return parts;
}

export function convertSplineToControl(entity) {
    const parts = connectedCubicParts(entity);
    if (!parts || parts.length * 3 + 1 > MAX_SPLINE_CREATION_POINTS) return entity;
    const points = [parts[0].controlPoints[0], ...parts.flatMap(part => part.controlPoints.slice(1))];
    const knots = [0, 0, 0, 0];
    for (let index = 1; index < parts.length; index += 1) knots.push(index / parts.length, index / parts.length, index / parts.length);
    knots.push(1, 1, 1, 1);
    return rebuildDefinedSpline(entity, { mode: 'control', points, knots }) || entity;
}

export function refitSpline(entity) {
    const parts = connectedCubicParts(entity);
    const points = parts ? [parts[0].controlPoints[0], ...parts.map(part => part.controlPoints[3])]
        : entity?.type === 'polyline' && !entity.array && !entity.closed && !entity.parts ? entity.points : null;
    if (!points) return entity;
    const created = buildSplineCreationEntity(points, entity.layerId, 'fit', entity.id);
    return created ? rebuildDefinedSpline(entity, created.splineDefinition) || entity : entity;
}

export function convertSplineToPolyline(entity, tolerance) {
    const parts = connectedCubicParts(entity);
    if (!parts || !Number.isFinite(tolerance) || tolerance < 1e-8) return entity;
    const points = [{ ...parts[0].controlPoints[0] }];
    const segmentDistance = (point, a, b) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;
        const parameter = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
        return Math.hypot(point.x - a.x - parameter * dx, point.y - a.y - parameter * dy);
    };
    const flatten = (part, depth) => {
        if (points.length >= 4096) return false;
        const [a, b, c, d] = part.controlPoints;
        if (Math.max(segmentDistance(b, a, d), segmentDistance(c, a, d)) <= tolerance) {
            points.push({ ...d });
            return true;
        }
        if (depth >= 20) return false;
        const halves = splitCurve(part, 0.5);
        return halves?.length === 2 && halves.every(half => half && flatten(half, depth + 1));
    };
    if (!parts.every(part => flatten(part, 0))) return entity;
    const { parts: oldParts, controlPoints, degree, splineDefinition, ...properties } = entity;
    return { ...properties, type: 'polyline', closed: false, points };
}
