import { rebuildDefinedSpline, reconcileSplineDefinition } from './drawingSplineCreation.js';
import { changeSplinePointList, convertSplineToControl, convertSplineToPolyline, insertSplineKnot, refitSpline } from './drawingSplineTopology.js';
import { normalizeCurvePrimitive } from './drawingCurveKernel.js';

const EPSILON = 1e-9;
const samePoint = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= EPSILON;

export function isEditableSpline(entity) {
    return entity?.type === 'spline' || (entity?.type === 'polyline' && !entity.array && entity.parts?.length > 0
        && entity.parts.every(part => part.type === 'spline'));
}

export function editSplineControl(entity, partIndex, controlIndex, point) {
    if (!isEditableSpline(entity)) return entity;
    if (entity.type === 'polyline') return editSplinePathControl(entity, partIndex, controlIndex, point) || entity;
    if (partIndex !== 0 || !Number.isInteger(controlIndex) || controlIndex < 0 || controlIndex > 3) return entity;
    const spline = normalizeCurvePrimitive(entity);
    if (!spline) return entity;
    const { splineDefinition, ...detached } = spline;
    return normalizeCurvePrimitive({ ...detached, controlPoints: spline.controlPoints.map((control, index) => (
        index === controlIndex ? { x: point?.x, y: point?.y } : control
    )) }) || entity;
}

export function parseSplineControlInput(value) {
    const tokens = String(value || '').trim().split(/[\s,;]+/);
    if (tokens.length !== 5 || tokens[0].toUpperCase() !== 'CONTROL') return null;
    const [span, control, x, y] = tokens.slice(1).map(Number);
    return Number.isInteger(span) && span >= 1 && Number.isInteger(control) && control >= 1 && control <= 4
        && Number.isFinite(x) && Number.isFinite(y)
        ? { partIndex: span - 1, controlIndex: control - 1, point: { x, y } } : null;
}

function neighborAt(parts, index, endpoint, closed) {
    let neighbor = index + (endpoint === 0 ? -1 : 1);
    if (closed) neighbor = (neighbor + parts.length) % parts.length;
    if (neighbor < 0 || neighbor >= parts.length) return null;
    const otherEndpoint = endpoint === 0 ? 3 : 0;
    return samePoint(parts[index].controlPoints[endpoint], parts[neighbor].controlPoints[otherEndpoint])
        ? { index: neighbor, endpoint: otherEndpoint } : null;
}

/** Edit a native cubic path while retaining its connected joints and smooth tangents. */
export function editSplinePathControl(entity, partIndex, controlIndex, point) {
    if (entity?.type !== 'polyline' || !Array.isArray(entity.parts)
        || !entity.parts.length || !entity.parts.every(part => part.type === 'spline')) return null;
    const parts = entity.parts.map(part => normalizeCurvePrimitive(part));
    if (parts.some(part => !part) || !Number.isInteger(partIndex) || !parts[partIndex]
        || !Number.isInteger(controlIndex) || controlIndex < 0 || controlIndex > 3
        || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return entity;
    const result = parts.map(part => ({ ...part, controlPoints: part.controlPoints.map(control => ({ ...control })) }));
    const controls = parts[partIndex].controlPoints;
    result[partIndex].controlPoints[controlIndex] = { x: point.x, y: point.y };
    const endpoint = controlIndex < 2 ? 0 : 3;
    const neighbor = neighborAt(parts, partIndex, endpoint, entity.closed === true);
    if (controlIndex === endpoint) {
        const delta = { x: point.x - controls[endpoint].x, y: point.y - controls[endpoint].y };
        const translate = (index, control) => {
            const original = parts[index].controlPoints[control];
            result[index].controlPoints[control] = { x: original.x + delta.x, y: original.y + delta.y };
        };
        translate(partIndex, endpoint === 0 ? 1 : 2);
        if (neighbor) {
            result[neighbor.index].controlPoints[neighbor.endpoint] = { x: point.x, y: point.y };
            translate(neighbor.index, neighbor.endpoint === 0 ? 1 : 2);
        }
    } else if (neighbor) {
        const otherControl = neighbor.endpoint === 0 ? 1 : 2;
        const joint = controls[endpoint];
        const a = { x: controls[controlIndex].x - joint.x, y: controls[controlIndex].y - joint.y };
        const other = parts[neighbor.index].controlPoints[otherControl];
        const b = { x: other.x - joint.x, y: other.y - joint.y };
        const lengthA = Math.hypot(a.x, a.y);
        const lengthB = Math.hypot(b.x, b.y);
        // Preserve existing smooth joins; intentional corners stay independent.
        if (lengthA > EPSILON && lengthB > EPSILON && a.x * b.x + a.y * b.y < 0
            && Math.abs(a.x * b.y - a.y * b.x) <= 1e-8 * lengthA * lengthB) {
            const ratio = lengthB / lengthA;
            result[neighbor.index].controlPoints[otherControl] = {
                x: joint.x - (point.x - joint.x) * ratio,
                y: joint.y - (point.y - joint.y) * ratio,
            };
        }
    }
    if (result.some(part => !normalizeCurvePrimitive(part))) return entity;
    const { splineDefinition, ...detached } = entity;
    return { ...detached, parts: result };
}

/** One visible endpoint grip per connected cubic joint. */
export function isDuplicateSplineJointGrip(entity, partIndex, gripId) {
    if (!entity.parts?.every(part => part.type === 'spline')) return false;
    if (entity.closed && partIndex === entity.parts.length - 1 && gripId === 'control-3') {
        const first = normalizeCurvePrimitive(entity.parts[0]);
        const last = normalizeCurvePrimitive(entity.parts[partIndex]);
        return Boolean(first && last && samePoint(first.controlPoints[0], last.controlPoints[3]));
    }
    if (gripId !== 'control-0' || partIndex === 0 || entity.parts?.[partIndex]?.type !== 'spline'
        || entity.parts[partIndex - 1]?.type !== 'spline') return false;
    const current = normalizeCurvePrimitive(entity.parts[partIndex]);
    const previous = normalizeCurvePrimitive(entity.parts[partIndex - 1]);
    return Boolean(current && previous && samePoint(current.controlPoints[0], previous.controlPoints[3]));
}

export function editSplineDefinitionPoint(entity, index, point) {
    const definition = reconcileSplineDefinition(entity).splineDefinition;
    if (!definition || !Number.isInteger(index) || !definition.points[index]) return entity;
    return rebuildDefinedSpline(entity, { ...definition, points: definition.points.map((current, pointIndex) => (
        pointIndex === index ? point : current
    )) }) || entity;
}

export function editSplineDefinitionKnot(entity, index, value) {
    const definition = reconcileSplineDefinition(entity).splineDefinition;
    if (!definition || !Number.isInteger(index) || index < 0 || index >= definition.knots.length) return entity;
    return rebuildDefinedSpline(entity, { ...definition, knots: definition.knots.map((current, knotIndex) => (
        knotIndex === index ? value : current
    )) }) || entity;
}

export function applySplineEditInput(entity, value) {
    if (String(value || '').trim().toUpperCase() === 'FIT') return refitSpline(entity);
    if (!isEditableSpline(entity)) return entity;
    const control = parseSplineControlInput(value);
    if (control) return editSplineControl(entity, control.partIndex, control.controlIndex, control.point);
    const tokens = String(value || '').trim().split(/[\s,;]+/);
    const command = tokens[0].toUpperCase();
    if (command === 'INSERT' && tokens.length === 4) return changeSplinePointList(entity, Number(tokens[1]) - 1, { x: Number(tokens[2]), y: Number(tokens[3]) });
    if (command === 'REMOVE' && tokens.length === 2) return changeSplinePointList(entity, Number(tokens[1]) - 1);
    if (command === 'INSERTKNOT' && tokens.length === 2) return insertSplineKnot(entity, Number(tokens[1]));
    if (command === 'CONTROL' && tokens.length === 1) return convertSplineToControl(entity);
    if (command === 'POLYLINE' && tokens.length === 2) return convertSplineToPolyline(entity, Number(tokens[1]));
    if (command === 'TANGENT' && ['START', 'END'].includes(tokens[1]?.toUpperCase())) {
        if (tokens.length === 3 && tokens[2].toUpperCase() === 'NATURAL') return editSplineEndpointTangent(entity, tokens[1].toLowerCase(), null);
        if (tokens.length === 4) return editSplineEndpointTangent(entity, tokens[1].toLowerCase(), { x: Number(tokens[2]), y: Number(tokens[3]) });
        return entity;
    }
    if (command === 'BEZIER' && tokens.length === 1 && entity.splineDefinition) {
        const { splineDefinition, ...detached } = entity;
        return detached;
    }
    if (command === 'POINT' && tokens.length === 4) {
        return editSplineDefinitionPoint(entity, Number(tokens[1]) - 1, { x: Number(tokens[2]), y: Number(tokens[3]) });
    }
    if (command === 'KNOT' && tokens.length === 3) return editSplineDefinitionKnot(entity, Number(tokens[1]) - 1, Number(tokens[2]));
    return entity;
}

export function splineEndpointDerivative(entity, endpoint) {
    const definition = reconcileSplineDefinition(entity).splineDefinition;
    if (!definition || !['start', 'end'].includes(endpoint)) return null;
    const start = endpoint === 'start';
    const parts = entity.type === 'spline' ? [entity] : entity.parts;
    const controls = parts[start ? 0 : parts.length - 1].controlPoints;
    const knots = [...new Set(definition.knots)];
    const interval = start ? knots[1] : 1 - knots.at(-2);
    const a = controls[start ? 0 : 2];
    const b = controls[start ? 1 : 3];
    return { x: 3 * (b.x - a.x) / interval, y: 3 * (b.y - a.y) / interval };
}

export function editSplineEndpointTangent(entity, endpoint, tangent) {
    const definition = reconcileSplineDefinition(entity).splineDefinition;
    if (!definition || !['start', 'end'].includes(endpoint)) return entity;
    if (tangent !== null && (!Number.isFinite(tangent?.x) || !Number.isFinite(tangent?.y)
        || Math.abs(tangent.x) > 1e12 || Math.abs(tangent.y) > 1e12
        || Math.hypot(tangent.x, tangent.y) <= EPSILON)) return entity;
    if (definition.mode === 'fit') {
        const key = endpoint === 'start' ? 'startTangent' : 'endTangent';
        const next = { ...definition };
        if (tangent === null) delete next[key];
        else next[key] = tangent;
        return rebuildDefinedSpline(entity, next) || entity;
    }
    if (tangent === null) return entity;
    const start = endpoint === 'start';
    const index = start ? 1 : definition.points.length - 2;
    const anchor = start ? definition.points[0] : definition.points.at(-1);
    const interval = start ? definition.knots[4] : 1 - definition.knots.at(-5);
    const sign = start ? 1 : -1;
    return editSplineDefinitionPoint(entity, index, {
        x: anchor.x + sign * tangent.x * interval / 3,
        y: anchor.y + sign * tangent.y * interval / 3,
    });
}
