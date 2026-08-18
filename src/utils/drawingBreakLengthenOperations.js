import { canEditEntity, createDrawingId } from './drawingDocument.js';
import {
    closestPointOnPath,
    curveLength,
    curvePointAt,
    curveSubcurve,
    curveTangentAt,
    extractEntityPaths,
    getCurveEnd,
    getCurveStart,
    normalizeCurvePath,
    normalizeCurvePrimitive,
    openClosedPathAt,
    pathLength,
    pathSubpath,
    splitPath,
} from './drawingCurveKernel.js';

const TAU = Math.PI * 2;
const EPSILON = 1e-9;
const MAX_COORDINATE = 1e12;
const MAX_PATHS = 1_024;
const PART_METADATA_KEYS = new Set([
    'id', 'layerId', 'color', 'lineWeight', 'lineWidth', 'lineType', 'transparency', 'locked',
    'sourceId', 'previewMode',
]);
const GEOMETRY_KEYS = new Set([
    'type', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'startAngle', 'endAngle',
    'counterClockwise', 'fullCircle', 'fullEllipse', 'controlPoints', 'degree', 'x', 'y', 'width',
    'height', 'rotation', 'sides', 'mode', 'points', 'parts', 'closed', 'cornerStyle', 'cornerValue',
    'fillet', 'chamfer',
]);

export const DRAWING_LENGTHEN_MODES = Object.freeze(['delta', 'percent', 'total', 'dynamic']);

/** Removes the directed path interval from firstPoint to secondPoint. */
export function breakDrawingEntity(entity, firstPoint, secondPoint, options = {}) {
    const first = finitePoint(firstPoint);
    const second = finitePoint(secondPoint);
    if (!entity || !first || !second) return breakUnchanged('invalid-input');
    if (pointDistance(first, second) <= operationTolerance(options.tolerance)) {
        return breakDrawingEntityAtPoint(entity, first, options);
    }
    const paths = extractEntityPaths(entity, options);
    if (!paths.length || paths.length > MAX_PATHS) return breakUnchanged('unsupported-target');
    const firstLocation = closestEntityPath(paths, first, options);
    const secondLocation = closestEntityPath(paths, second, options);
    if (!firstLocation || !secondLocation || firstLocation.pathIndex !== secondLocation.pathIndex) {
        return breakUnchanged('different-paths');
    }
    const path = firstLocation.path;
    const firstScalar = locationScalar(path, firstLocation.location);
    const secondScalar = locationScalar(path, secondLocation.location);
    const tolerance = operationTolerance(options.tolerance);
    if (cyclicDistance(firstScalar, secondScalar, path.closed) <= tolerance) {
        return breakDrawingEntityAtPoint(entity, first, options);
    }

    let removedPath;
    let fragments;
    if (path.closed) {
        removedPath = pathBetween(path, firstLocation.location, secondLocation.location, options);
        const remaining = pathBetween(path, secondLocation.location, firstLocation.location, options);
        fragments = remaining ? [remaining] : [];
    } else {
        const start = scalarPathLocation(path, 0);
        const end = scalarPathLocation(path, 1);
        const before = firstScalar <= secondScalar ? firstLocation.location : secondLocation.location;
        const after = firstScalar <= secondScalar ? secondLocation.location : firstLocation.location;
        removedPath = pathSubpath(path, before, after, options);
        fragments = [pathSubpath(path, start, before, options), pathSubpath(path, after, end, options)].filter(Boolean);
    }
    if (!removedPath) return breakUnchanged('degenerate-break');
    const outputPaths = paths.flatMap((candidate, index) => (
        index === firstLocation.pathIndex ? fragments : [candidate]
    ));
    return breakResult(entity, outputPaths, [removedPath], 'break');
}

/** Splits an open path, or opens a closed path, without removing geometry. */
export function breakDrawingEntityAtPoint(entity, point, options = {}) {
    const target = finitePoint(point);
    if (!entity || !target) return breakUnchanged('invalid-input');
    const paths = extractEntityPaths(entity, options);
    if (!paths.length || paths.length > MAX_PATHS) return breakUnchanged('unsupported-target');
    const nearest = closestEntityPath(paths, target, options);
    if (!nearest) return breakUnchanged('invalid-point');
    const tolerance = operationTolerance(options.tolerance);
    let fragments;
    if (nearest.path.closed) {
        const opened = openClosedPathAt(nearest.path, nearest.location, options);
        fragments = opened ? [opened] : [];
    } else {
        const scalar = locationScalar(nearest.path, nearest.location);
        if (scalar <= tolerance || scalar >= 1 - tolerance) return breakUnchanged('endpoint');
        fragments = (splitPath(nearest.path, nearest.location, options) || []).filter(Boolean);
    }
    if (!fragments.length) return breakUnchanged('degenerate-break');
    const outputPaths = paths.flatMap((candidate, index) => index === nearest.pathIndex ? fragments : [candidate]);
    return breakResult(entity, outputPaths, [], 'break-at-point');
}

export function breakDrawingTarget(content, targetOrId, firstPoint, secondPoint, options = {}) {
    const target = editableTarget(content, targetOrId);
    if (!target) return drawingBreakUnchanged(content, 'not-editable');
    return applyBreakResult(content, target, breakDrawingEntity(target, firstPoint, secondPoint, options));
}

export function breakDrawingTargetAtPoint(content, targetOrId, point, options = {}) {
    const target = editableTarget(content, targetOrId);
    if (!target) return drawingBreakUnchanged(content, 'not-editable');
    return applyBreakResult(content, target, breakDrawingEntityAtPoint(target, point, options));
}

export function createBreakPreviewEntities(content, {
    targetId = null,
    firstPoint = null,
    secondPoint = null,
    point = null,
    atPoint = false,
    ...options
} = {}) {
    const target = editableTarget(content, targetId);
    if (!target) return [];
    const result = atPoint || point
        ? breakDrawingEntityAtPoint(target, point || firstPoint, options)
        : breakDrawingEntity(target, firstPoint, secondPoint, options);
    return result.changed ? result.fragments.map((entity, index) => ({
        ...entity,
        id: `break-preview-${target.id}-${index}`,
        previewMode: 'break',
    })) : [];
}

/**
 * Lengthens the endpoint nearest `pickPoint` by delta, percentage, total
 * length, or a dynamic point. Closed paths are intentionally rejected.
 */
export function lengthenDrawingEntity(entity, pickPoint, {
    mode = 'delta',
    value = 0,
    dynamicPoint = null,
    endpoint = null,
    ...options
} = {}) {
    const pick = finitePoint(pickPoint);
    const normalizedMode = normalizeLengthenMode(mode);
    if (!entity || !pick || !normalizedMode) return lengthenUnchanged('invalid-input');
    const paths = extractEntityPaths(entity, options);
    if (paths.length !== 1 || paths[0].closed) return lengthenUnchanged(paths.length === 1 ? 'closed-path' : 'unsupported-target');
    const path = paths[0];
    const selectedEndpoint = resolveEndpoint(path, pick, endpoint, options);
    if (!selectedEndpoint) return lengthenUnchanged('unsupported-endpoint');
    const currentLength = pathLength(path, options);
    if (!Number.isFinite(currentLength) || currentLength <= EPSILON) return lengthenUnchanged('invalid-length');

    if (normalizedMode === 'dynamic') {
        const dynamic = finitePoint(dynamicPoint ?? value);
        if (!dynamic) return lengthenUnchanged('invalid-dynamic-point');
        const dynamicPath = lengthenPathDynamically(path, selectedEndpoint, dynamic, options);
        if (!dynamicPath) return lengthenUnchanged('invalid-dynamic-point');
        const targetLength = pathLength(dynamicPath, options);
        if (!Number.isFinite(targetLength) || Math.abs(targetLength - currentLength) <= operationTolerance(options.tolerance)) {
            return lengthenUnchanged('no-op');
        }
        return lengthenResult(entity, dynamicPath, selectedEndpoint.endpoint, currentLength, targetLength, normalizedMode);
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return lengthenUnchanged('invalid-value');
    const targetLength = normalizedMode === 'delta'
        ? currentLength + numericValue
        : normalizedMode === 'percent'
            ? currentLength * numericValue / 100
            : numericValue;
    if (!Number.isFinite(targetLength) || targetLength <= operationTolerance(options.tolerance)
        || targetLength > MAX_COORDINATE) return lengthenUnchanged('invalid-target-length');
    if (Math.abs(targetLength - currentLength) <= operationTolerance(options.tolerance)) return lengthenUnchanged('no-op');
    const changedPath = lengthenPathToTotal(path, selectedEndpoint, targetLength, options);
    if (!changedPath) return lengthenUnchanged('unsupported-length');
    return lengthenResult(entity, changedPath, selectedEndpoint.endpoint, currentLength, targetLength, normalizedMode);
}

export function lengthenDrawingTarget(content, targetOrId, pickPoint, options = {}) {
    const target = editableTarget(content, targetOrId);
    if (!target) return drawingLengthenUnchanged(content, 'not-editable');
    const result = lengthenDrawingEntity(target, pickPoint, options);
    if (!result.changed) return drawingLengthenUnchanged(content, result.reason, result);
    const replacement = { ...result.entity, id: target.id, layerId: result.entity.layerId || target.layerId };
    const incompatible = replacement.type !== target.type;
    return {
        ...result,
        entity: replacement,
        replacements: [replacement],
        selectedIds: [target.id],
        content: {
            ...content,
            entities: content.entities.flatMap(entity => {
                if (entity.id === target.id) return [replacement];
                if (incompatible && entity.sourceId === target.id) return [];
                return [entity];
            }),
        },
    };
}

export function createLengthenPreviewEntities(content, {
    targetId = null,
    point = null,
    ...options
} = {}) {
    const target = editableTarget(content, targetId);
    if (!target || !point) return [];
    const result = lengthenDrawingEntity(target, point, options);
    return result.changed ? [{
        ...result.entity,
        id: `lengthen-preview-${target.id}`,
        previewMode: 'lengthen',
    }] : [];
}

function lengthenPathToTotal(path, selected, targetLength, options) {
    const currentLength = pathLength(path, options);
    if (targetLength < currentLength) {
        const retainedRatio = targetLength / currentLength;
        return selected.endpoint === 'end'
            ? pathSubpath(path, 0, retainedRatio, options)
            : pathSubpath(path, 1 - retainedRatio, 1, options);
    }
    const extra = targetLength - currentLength;
    const index = selected.endpoint === 'start' ? 0 : path.parts.length - 1;
    const curve = path.parts[index];
    const extension = lengthenTerminalCurve(curve, selected.endpoint, extra, options);
    if (!extension) return null;
    const parts = path.parts.map(part => ({ ...part }));
    if (extension.replacement) parts[index] = extension.replacement;
    if (extension.prepend) parts.unshift(extension.prepend);
    if (extension.append) parts.push(extension.append);
    const changed = normalizeCurvePath({ ...path, parts, closed: false }, options);
    if (!changed) return null;
    const actual = pathLength(changed, options);
    return Number.isFinite(actual) && Math.abs(actual - targetLength) <= Math.max(1e-6, targetLength * 1e-7)
        ? changed : null;
}

function lengthenTerminalCurve(curve, endpoint, extra, options) {
    const tangent = curveTangentAt(curve, endpoint === 'start' ? 0 : 1, options);
    const point = endpoint === 'start' ? getCurveStart(curve, options) : getCurveEnd(curve, options);
    if (!tangent || !point) return null;
    const outward = endpoint === 'start' ? scaleVector(tangent, -1) : tangent;
    if (curve.type === 'line') {
        const extended = addPoints(point, scaleVector(outward, extra));
        return {
            replacement: normalizeCurvePrimitive(endpoint === 'start'
                ? { ...curve, x1: extended.x, y1: extended.y }
                : { ...curve, x2: extended.x, y2: extended.y }, options),
        };
    }
    if (curve.type === 'arc') {
        const angleDelta = extra / curve.r;
        if (curveAngularSweep(curve) + angleDelta >= TAU - operationTolerance(options.tolerance)) return null;
        const direction = curve.counterClockwise === false ? -1 : 1;
        return {
            replacement: normalizeCurvePrimitive(endpoint === 'start'
                ? { ...curve, startAngle: curve.startAngle - direction * angleDelta }
                : { ...curve, endAngle: curve.endAngle + direction * angleDelta }, options),
        };
    }
    if (curve.type === 'ellipse' && !curve.fullEllipse) {
        const replacement = lengthenEllipseCurve(curve, endpoint, extra, options);
        return replacement ? { replacement } : null;
    }
    const extensionPoint = addPoints(point, scaleVector(outward, extra));
    const line = endpoint === 'start'
        ? { type: 'line', x1: extensionPoint.x, y1: extensionPoint.y, x2: point.x, y2: point.y }
        : { type: 'line', x1: point.x, y1: point.y, x2: extensionPoint.x, y2: extensionPoint.y };
    return endpoint === 'start' ? { prepend: line } : { append: line };
}

function lengthenEllipseCurve(curve, endpoint, extra, options) {
    const currentSweep = curveAngularSweep(curve);
    const maximumAngle = TAU - currentSweep - operationTolerance(options.tolerance);
    if (maximumAngle <= 0) return null;
    const direction = curve.counterClockwise === false ? -1 : 1;
    const currentLength = curveLength(curve, options);
    const candidateAt = angle => normalizeCurvePrimitive(endpoint === 'start'
        ? { ...curve, startAngle: curve.startAngle - direction * angle, fullEllipse: false }
        : { ...curve, endAngle: curve.endAngle + direction * angle, fullEllipse: false }, options);
    const maximum = candidateAt(maximumAngle);
    if (!maximum || curveLength(maximum, options) - currentLength < extra - 1e-6) return null;
    let low = 0;
    let high = maximumAngle;
    for (let iteration = 0; iteration < 52; iteration += 1) {
        const middle = (low + high) / 2;
        const candidate = candidateAt(middle);
        const gained = candidate ? curveLength(candidate, options) - currentLength : Infinity;
        if (gained < extra) low = middle;
        else high = middle;
    }
    return candidateAt((low + high) / 2);
}

function lengthenPathDynamically(path, selected, point, options) {
    const index = selected.endpoint === 'start' ? 0 : path.parts.length - 1;
    const curve = path.parts[index];
    let replacement;
    if (curve.type === 'line') {
        const fixed = selected.endpoint === 'start' ? getCurveEnd(curve) : getCurveStart(curve);
        const direction = selected.endpoint === 'start'
            ? normalizeVector(subtractPoints(getCurveStart(curve), fixed))
            : normalizeVector(subtractPoints(getCurveEnd(curve), fixed));
        if (!fixed || !direction) return null;
        const distance = dot(subtractPoints(point, fixed), direction);
        if (distance <= operationTolerance(options.tolerance)) return null;
        const projected = addPoints(fixed, scaleVector(direction, distance));
        replacement = normalizeCurvePrimitive(selected.endpoint === 'start'
            ? { ...curve, x1: projected.x, y1: projected.y }
            : { ...curve, x2: projected.x, y2: projected.y }, options);
    } else if (curve.type === 'arc') {
        const angle = Math.atan2(point.y - curve.cy, point.x - curve.cx);
        replacement = normalizeCurvePrimitive(selected.endpoint === 'start'
            ? { ...curve, startAngle: angle }
            : { ...curve, endAngle: angle }, options);
    } else if (curve.type === 'ellipse' && !curve.fullEllipse) {
        const angle = ellipsePointAngle(curve, point);
        replacement = normalizeCurvePrimitive(selected.endpoint === 'start'
            ? { ...curve, startAngle: angle, fullEllipse: false }
            : { ...curve, endAngle: angle, fullEllipse: false }, options);
    } else if (curve.type === 'spline') {
        const endpointIndex = selected.endpoint === 'start' ? 0 : 3;
        const handleIndex = selected.endpoint === 'start' ? 1 : 2;
        const delta = subtractPoints(point, curve.controlPoints[endpointIndex]);
        replacement = normalizeCurvePrimitive({
            ...curve,
            controlPoints: curve.controlPoints.map((control, controlIndex) => (
                [endpointIndex, handleIndex].includes(controlIndex) ? addPoints(control, delta) : { ...control }
            )),
        }, options);
    }
    if (!replacement) return null;
    return normalizeCurvePath({
        ...path,
        parts: path.parts.map((part, partIndex) => partIndex === index ? replacement : { ...part }),
    }, options);
}

function breakResult(source, paths, removedPaths, operation) {
    const fragments = paths.map(path => entityFromPath(source, path)).filter(Boolean);
    return {
        changed: true,
        status: operation,
        operation,
        fragments,
        paths,
        removedPaths,
        removedCurves: removedPaths.flatMap(path => path.parts.map(part => ({ ...part }))),
    };
}

function lengthenResult(source, path, endpoint, currentLength, targetLength, mode) {
    const entity = entityFromPath(source, path);
    return entity ? {
        changed: true,
        status: 'lengthened',
        entity,
        path,
        endpoint,
        mode,
        currentLength,
        targetLength,
        delta: targetLength - currentLength,
    } : lengthenUnchanged('invalid-result');
}

function applyBreakResult(content, target, result) {
    if (!result.changed) return drawingBreakUnchanged(content, result.reason, result);
    const replacements = result.fragments.map(fragment => ({
        ...fragment,
        id: createDrawingId(fragment.type || 'curve'),
        layerId: fragment.layerId || target.layerId,
    }));
    return {
        ...result,
        replacements,
        selectedIds: replacements.map(entity => entity.id),
        content: {
            ...content,
            entities: content.entities.flatMap(entity => {
                if (entity.id === target.id) return replacements;
                if (entity.sourceId === target.id) return [];
                return [entity];
            }),
        },
    };
}

function pathBetween(path, start, end, options) {
    if (path.parts.length === 1 && path.closed && ['circle', 'ellipse'].includes(path.parts[0].type)) {
        return closedPrimitiveIntervalPath(path.parts[0], start.t, end.t, options);
    }
    return pathSubpath(path, start, end, options);
}

function closedPrimitiveIntervalPath(curve, start, end, options) {
    const delta = positiveUnitDelta(start, end);
    if (delta <= operationTolerance(options.tolerance)) return null;
    const direction = curve.counterClockwise === false ? -1 : 1;
    let primitive;
    if (curve.type === 'circle') {
        const startAngle = direction > 0 ? TAU * start : -TAU * start;
        primitive = {
            ...curve,
            type: 'arc',
            startAngle,
            endAngle: startAngle + direction * TAU * delta,
            counterClockwise: direction > 0,
            fullCircle: false,
        };
    } else {
        const startAngle = (curve.startAngle || 0) + direction * TAU * start;
        primitive = {
            ...curve,
            startAngle,
            endAngle: startAngle + direction * TAU * delta,
            counterClockwise: direction > 0,
            fullEllipse: false,
        };
    }
    const normalized = normalizeCurvePrimitive(primitive, options);
    return normalized ? normalizeCurvePath({ type: 'path', parts: [normalized], closed: false }, options) : null;
}

function entityFromPath(source, path) {
    const normalized = normalizeCurvePath(path);
    if (!normalized) return null;
    const metadata = Object.fromEntries(Object.entries(source || {})
        .filter(([key]) => !GEOMETRY_KEYS.has(key) && key !== 'id'));
    if (normalized.parts.length === 1 && !normalized.closed) {
        return { ...metadata, ...stripPartMetadata(normalized.parts[0]) };
    }
    const allLines = normalized.parts.every(part => part.type === 'line');
    if (allLines && !(source.type === 'polyline' && Array.isArray(source.parts))) {
        const points = [getCurveStart(normalized.parts[0]), ...normalized.parts.map(getCurveEnd)];
        if (normalized.closed) points.pop();
        return { ...metadata, type: 'polyline', points, closed: normalized.closed };
    }
    return {
        ...metadata,
        type: 'polyline',
        parts: normalized.parts.map(stripPartMetadata),
        closed: normalized.closed,
    };
}

function stripPartMetadata(part) {
    return Object.fromEntries(Object.entries(part || {}).filter(([key]) => !PART_METADATA_KEYS.has(key)));
}

function closestEntityPath(paths, point, options) {
    let best = null;
    paths.forEach((path, pathIndex) => {
        const location = closestPointOnPath(path, point, options);
        if (location && (!best || location.distance < best.location.distance)) best = { path, pathIndex, location };
    });
    return best;
}

function resolveEndpoint(path, pick, requested, options) {
    const candidates = [
        { endpoint: 'start', point: getCurveStart(path.parts[0], options) },
        { endpoint: 'end', point: getCurveEnd(path.parts[path.parts.length - 1], options) },
    ].filter(candidate => candidate.point);
    if (['start', 'end'].includes(requested)) return candidates.find(candidate => candidate.endpoint === requested) || null;
    return candidates.sort((left, right) => pointDistance(left.point, pick) - pointDistance(right.point, pick))[0] || null;
}

function scalarPathLocation(path, scalar) {
    if (scalar <= 0) return { partIndex: 0, t: 0 };
    return { partIndex: path.parts.length - 1, t: 1 };
}

function locationScalar(path, location) {
    return (location.partIndex + location.t) / path.parts.length;
}

function editableTarget(content, targetOrId) {
    const target = typeof targetOrId === 'string'
        ? content?.entities?.find(entity => entity.id === targetOrId)
        : targetOrId;
    return target && content?.entities?.some(entity => entity.id === target.id) && canEditEntity(content, target)
        ? target : null;
}

function normalizeLengthenMode(mode) {
    const normalized = String(mode || '').trim().toLowerCase();
    if (['delta', 'd'].includes(normalized)) return 'delta';
    if (['percent', 'percentage', 'p'].includes(normalized)) return 'percent';
    if (['total', 't'].includes(normalized)) return 'total';
    if (['dynamic', 'dy'].includes(normalized)) return 'dynamic';
    return null;
}

function ellipsePointAngle(ellipse, point) {
    const radians = -(ellipse.rotation || 0) * Math.PI / 180;
    const delta = subtractPoints(point, { x: ellipse.cx, y: ellipse.cy });
    const local = {
        x: delta.x * Math.cos(radians) - delta.y * Math.sin(radians),
        y: delta.x * Math.sin(radians) + delta.y * Math.cos(radians),
    };
    return Math.atan2(local.y / ellipse.ry, local.x / ellipse.rx);
}

function curveAngularSweep(curve) {
    return Math.abs(curve.counterClockwise === false
        ? -positiveAngleDelta(curve.endAngle, curve.startAngle)
        : positiveAngleDelta(curve.startAngle, curve.endAngle));
}

function positiveAngleDelta(start, end) {
    const delta = (end - start) % TAU;
    return delta < 0 ? delta + TAU : delta;
}

function positiveUnitDelta(start, end) {
    const delta = (end - start) % 1;
    return delta < 0 ? delta + 1 : delta;
}

function cyclicDistance(first, second, closed) {
    const delta = Math.abs(first - second);
    return closed ? Math.min(delta, 1 - delta) : delta;
}

function operationTolerance(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.min(numeric, 1e-3) : 1e-8;
}

function finitePoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    return Number.isFinite(x) && Number.isFinite(y)
        && Math.max(Math.abs(x), Math.abs(y)) <= MAX_COORDINATE ? { x, y } : null;
}

function normalizeVector(vector) {
    const length = Math.hypot(vector.x, vector.y);
    return Number.isFinite(length) && length > EPSILON
        ? { x: vector.x / length, y: vector.y / length } : null;
}

function addPoints(first, second) {
    return { x: first.x + second.x, y: first.y + second.y };
}

function subtractPoints(first, second) {
    return { x: first.x - second.x, y: first.y - second.y };
}

function scaleVector(vector, scale) {
    return { x: vector.x * scale, y: vector.y * scale };
}

function dot(first, second) {
    return first.x * second.x + first.y * second.y;
}

function pointDistance(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

function breakUnchanged(reason) {
    return {
        changed: false,
        status: 'unchanged',
        reason,
        operation: null,
        fragments: [],
        paths: [],
        removedPaths: [],
        removedCurves: [],
    };
}

function lengthenUnchanged(reason) {
    return { changed: false, status: 'unchanged', reason, entity: null, path: null };
}

function drawingBreakUnchanged(content, reason, operationResult = {}) {
    return {
        ...operationResult,
        changed: false,
        content,
        replacements: [],
        selectedIds: [],
        reason,
    };
}

function drawingLengthenUnchanged(content, reason, operationResult = {}) {
    return {
        ...operationResult,
        changed: false,
        content,
        replacements: [],
        selectedIds: [],
        reason,
    };
}
