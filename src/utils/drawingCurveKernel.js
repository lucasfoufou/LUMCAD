const TAU = Math.PI * 2;
const DEFAULT_EPSILON = 1e-9;

export const DRAWING_CURVE_KERNEL_LIMITS = Object.freeze({
    maxCoordinate: 1e12,
    maxParts: 4096,
    maxPaths: 1024,
    maxPolylinePoints: 4096,
    maxBoundaryDepth: 8,
    maxNumericSegments: 512,
    maxClosestSamples: 512,
    maxIntersectionChecks: 262_144,
    maxNewtonIterations: 10,
});

/**
 * Canonical primitives accepted by the kernel:
 *
 * - line: `x1`, `y1`, `x2`, `y2`
 * - arc: `cx`, `cy`, `r`, radian `startAngle` / `endAngle`, `counterClockwise`
 * - circle: `cx`, `cy`, `r`
 * - ellipse: `cx`, `cy`, `rx`, `ry`, degree `rotation`, optional radian
 *   `startAngle` / `endAngle` for an elliptical arc
 * - spline: one cubic Bezier span in `controlPoints` (four points)
 *
 * Unknown properties are retained so document operations can preserve layer and
 * appearance metadata while assigning their own persistent IDs.
 */
export function normalizeCurvePrimitive(curve, options = {}) {
    if (!curve || typeof curve !== 'object' || Array.isArray(curve)) return null;
    const limits = resolveLimits(options);
    const type = normalizeCurveType(curve.type);
    if (type === 'line') {
        const first = finitePoint({ x: curve.x1, y: curve.y1 }, limits);
        const second = finitePoint({ x: curve.x2, y: curve.y2 }, limits);
        if (!first || !second || pointDistance(first, second) <= limits.epsilon) return null;
        return { ...curve, type, x1: first.x, y1: first.y, x2: second.x, y2: second.y };
    }
    if (type === 'circle') {
        const center = finitePoint({ x: curve.cx, y: curve.cy }, limits);
        const radius = finitePositive(curve.r, limits.maxCoordinate);
        if (!center || !radius || coordinateMagnitude(center) + radius > limits.maxCoordinate) return null;
        return {
            ...curve,
            type,
            cx: center.x,
            cy: center.y,
            r: radius,
            counterClockwise: curve.counterClockwise !== false,
        };
    }
    if (type === 'arc') {
        const center = finitePoint({ x: curve.cx, y: curve.cy }, limits);
        const radius = finitePositive(curve.r, limits.maxCoordinate);
        const startAngle = finiteAngle(curve.startAngle);
        const endAngle = finiteAngle(curve.endAngle);
        if (!center || !radius || startAngle === null || endAngle === null
            || coordinateMagnitude(center) + radius > limits.maxCoordinate) return null;
        const normalized = {
            ...curve,
            type,
            cx: center.x,
            cy: center.y,
            r: radius,
            startAngle: normalizeAngle(startAngle),
            endAngle: normalizeAngle(endAngle),
            counterClockwise: curve.counterClockwise !== false,
            fullCircle: Boolean(curve.fullCircle),
        };
        return Math.abs(curveSweep(normalized)) > limits.epsilon ? normalized : null;
    }
    if (type === 'ellipse') {
        const center = finitePoint({ x: curve.cx, y: curve.cy }, limits);
        const radiusX = finitePositive(curve.rx ?? curve.radiusX ?? curve.majorRadius, limits.maxCoordinate);
        const radiusY = finitePositive(curve.ry ?? curve.radiusY ?? curve.minorRadius, limits.maxCoordinate);
        const rotation = finiteAngle(curve.rotation ?? 0);
        if (!center || !radiusX || !radiusY || rotation === null
            || coordinateMagnitude(center) + Math.max(radiusX, radiusY) > limits.maxCoordinate) return null;
        const hasAngularDomain = curve.startAngle !== undefined || curve.endAngle !== undefined;
        const startAngle = hasAngularDomain ? finiteAngle(curve.startAngle ?? 0) : 0;
        const endAngle = hasAngularDomain ? finiteAngle(curve.endAngle ?? 0) : 0;
        if (startAngle === null || endAngle === null) return null;
        const fullEllipse = Boolean(curve.fullEllipse) || !hasAngularDomain;
        const normalized = {
            ...curve,
            type,
            cx: center.x,
            cy: center.y,
            rx: radiusX,
            ry: radiusY,
            rotation: normalizeDegrees(rotation),
            startAngle: normalizeAngle(startAngle),
            endAngle: normalizeAngle(endAngle),
            counterClockwise: curve.counterClockwise !== false,
            fullEllipse,
        };
        return Math.abs(curveSweep(normalized)) > limits.epsilon ? normalized : null;
    }
    if (type === 'spline') {
        const sourcePoints = Array.isArray(curve.controlPoints)
            ? curve.controlPoints
            : [curve.p0, curve.p1, curve.p2, curve.p3];
        if (sourcePoints.length !== 4) return null;
        const controlPoints = sourcePoints.map(point => finitePoint(point, limits));
        if (controlPoints.some(point => !point)) return null;
        const bounds = pointBounds(controlPoints);
        if (!bounds || Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) <= limits.epsilon) return null;
        return { ...curve, type, degree: 3, controlPoints };
    }
    return null;
}

/** Strictly normalizes one connected, ordered path. */
export function normalizeCurvePath(path, options = {}) {
    if (!path || typeof path !== 'object' || !Array.isArray(path.parts)) return null;
    const limits = resolveLimits(options);
    if (!path.parts.length || path.parts.length > limits.maxParts) return null;
    const parts = [];
    for (const rawPart of path.parts) {
        let part = normalizeCurvePrimitive(rawPart, limits);
        if (!part) return null;
        if (parts.length) {
            const previousEnd = getCurveEnd(parts[parts.length - 1], limits);
            const currentStart = getCurveStart(part, limits);
            const currentEnd = getCurveEnd(part, limits);
            if (!pointsEqual(previousEnd, currentStart, limits.joinTolerance)) {
                if (!pointsEqual(previousEnd, currentEnd, limits.joinTolerance)) return null;
                part = reverseCurve(part, limits);
            }
        }
        parts.push(part);
    }
    if (parts.length > 1 && parts.some(curveIsClosed)) return null;
    const naturallyClosed = parts.length === 1 && curveIsClosed(parts[0]);
    const closed = naturallyClosed || Boolean(path.closed);
    if (closed && !pointsEqual(getCurveStart(parts[0]), getCurveEnd(parts[parts.length - 1]), limits.joinTolerance)) {
        return null;
    }
    return { ...path, type: 'path', parts, closed };
}

/**
 * Decomposes an entity into bounded, connected paths while preserving line,
 * circular, elliptical and cubic primitives. Disconnected `parts` become
 * separate paths instead of a fake branched polyline.
 */
export function extractEntityPaths(entity, options = {}) {
    const limits = resolveLimits(options);
    const state = { depth: 0, pathCount: 0, partCount: 0, seen: new Set() };
    const paths = extractEntityPathsInternal(entity, { ...options, limits }, state);
    if (!paths || paths.length > limits.maxPaths) return [];
    return paths;
}

export function createBoundaryExtractorRegistry(entries = {}) {
    const table = new Map();
    if (entries instanceof Map) {
        entries.forEach((extractor, type) => {
            if (typeof extractor === 'function') table.set(String(type), extractor);
        });
    } else {
        Object.entries(entries || {}).forEach(([type, extractor]) => {
            if (typeof extractor === 'function') table.set(type, extractor);
        });
    }
    return Object.freeze({
        has: type => table.has(String(type)),
        extract(entity, context) {
            return table.get(String(entity?.type))?.(entity, context);
        },
    });
}

export function getCurveStart(curve, options = {}) {
    const normalized = normalizeCurvePrimitive(curve, options);
    return normalized ? curvePointAtNormalized(normalized, 0) : null;
}

export function getCurveEnd(curve, options = {}) {
    const normalized = normalizeCurvePrimitive(curve, options);
    return normalized ? curvePointAtNormalized(normalized, 1) : null;
}

export function reverseCurve(curve, options = {}) {
    const normalized = normalizeCurvePrimitive(curve, options);
    if (!normalized) return null;
    if (normalized.type === 'line') return {
        ...normalized,
        x1: normalized.x2,
        y1: normalized.y2,
        x2: normalized.x1,
        y2: normalized.y1,
    };
    if (normalized.type === 'arc') return {
        ...normalized,
        startAngle: normalized.endAngle,
        endAngle: normalized.startAngle,
        counterClockwise: !normalized.counterClockwise,
    };
    if (normalized.type === 'circle') return {
        ...normalized,
        counterClockwise: !normalized.counterClockwise,
    };
    if (normalized.type === 'ellipse') return {
        ...normalized,
        startAngle: normalized.endAngle,
        endAngle: normalized.startAngle,
        counterClockwise: !normalized.counterClockwise,
    };
    return {
        ...normalized,
        controlPoints: [...normalized.controlPoints].reverse().map(point => ({ ...point })),
    };
}

export function reversePath(path, options = {}) {
    const normalized = normalizeCurvePath(path, options);
    if (!normalized) return null;
    return {
        ...normalized,
        parts: [...normalized.parts].reverse().map(part => reverseCurve(part, options)),
    };
}

export function curvePointAt(curve, parameter, options = {}) {
    const normalized = normalizeCurvePrimitive(curve, options);
    const t = finiteUnitParameter(parameter);
    return normalized && t !== null ? curvePointAtNormalized(normalized, t) : null;
}

export function curveTangentAt(curve, parameter, options = {}) {
    const normalized = normalizeCurvePrimitive(curve, options);
    const t = finiteUnitParameter(parameter);
    if (!normalized || t === null) return null;
    return normalizeVector(curveDerivativeAtNormalized(normalized, t), resolveLimits(options).epsilon);
}

export function curveDerivativeAt(curve, parameter, options = {}) {
    const normalized = normalizeCurvePrimitive(curve, options);
    const t = finiteUnitParameter(parameter);
    return normalized && t !== null ? curveDerivativeAtNormalized(normalized, t) : null;
}

export function curveSecondDerivativeAt(curve, parameter, options = {}) {
    const normalized = normalizeCurvePrimitive(curve, options);
    const t = finiteUnitParameter(parameter);
    if (!normalized || t === null) return null;
    if (normalized.type === 'line') return { x: 0, y: 0 };
    if (['circle', 'arc', 'ellipse'].includes(normalized.type)) {
        const sweep = curveSweep(normalized);
        const angle = (normalized.type === 'circle' ? 0 : normalized.startAngle) + sweep * t;
        const local = {
            x: -Math.cos(angle) * (normalized.type === 'ellipse' ? normalized.rx : normalized.r) * sweep ** 2,
            y: -Math.sin(angle) * (normalized.type === 'ellipse' ? normalized.ry : normalized.r) * sweep ** 2,
        };
        return normalized.type === 'ellipse' ? rotateVector(local, normalized.rotation) : local;
    }
    const [first, second, third, fourth] = normalized.controlPoints;
    return {
        x: 6 * ((1 - t) * (third.x - 2 * second.x + first.x) + t * (fourth.x - 2 * third.x + second.x)),
        y: 6 * ((1 - t) * (third.y - 2 * second.y + first.y) + t * (fourth.y - 2 * third.y + second.y)),
    };
}

/** Intrinsic curvature vector: direction and magnitude survive path reversal. */
export function curveCurvatureVectorAt(curve, parameter, options = {}) {
    const first = curveDerivativeAt(curve, parameter, options);
    const second = curveSecondDerivativeAt(curve, parameter, options);
    if (!first || !second) return null;
    const speedSquared = first.x ** 2 + first.y ** 2;
    if (speedSquared <= resolveLimits(options).epsilon ** 2) return null;
    const projection = (first.x * second.x + first.y * second.y) / speedSquared;
    return { x: (second.x - first.x * projection) / speedSquared, y: (second.y - first.y * projection) / speedSquared };
}

export function curveLength(curve, options = {}) {
    const normalized = normalizeCurvePrimitive(curve, options);
    if (!normalized) return null;
    if (normalized.type === 'line') return pointDistance(getCurveStart(normalized), getCurveEnd(normalized));
    if (normalized.type === 'circle') return TAU * normalized.r;
    if (normalized.type === 'arc') return Math.abs(curveSweep(normalized)) * normalized.r;
    if (normalized.type === 'ellipse') return integrateEllipseLength(normalized, 1);
    const limits = resolveLimits(options);
    const segmentCount = numericIntegrationSegments(normalized, limits);
    return integrateSimpson(
        parameter => vectorLength(curveDerivativeAtNormalized(normalized, parameter)),
        0,
        1,
        segmentCount,
    );
}

export function curveLengthAtParameter(curve, parameter, options = {}) {
    const normalized = normalizeCurvePrimitive(curve, options);
    const t = finiteUnitParameter(parameter);
    if (!normalized || t === null) return null;
    if (['line', 'circle', 'arc'].includes(normalized.type)) return curveLength(normalized, options) * t;
    if (normalized.type === 'ellipse') return integrateEllipseLength(normalized, t);
    const limits = resolveLimits(options);
    return integrateSimpson(value => vectorLength(curveDerivativeAtNormalized(normalized, value)),
        0, t, numericIntegrationSegments(normalized, limits));
}

export function curveParameterAtLength(curve, distance, options = {}) {
    const normalized = normalizeCurvePrimitive(curve, options);
    const length = normalized && curveLength(normalized, options);
    if (!Number.isFinite(distance) || !length || distance < 0 || distance > length) return null;
    if (distance === 0) return 0;
    if (distance === length) return 1;
    if (['line', 'circle', 'arc'].includes(normalized.type)) return distance / length;
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 32; iteration += 1) {
        const middle = (low + high) / 2;
        if (curveLengthAtParameter(normalized, middle, options) < distance) low = middle;
        else high = middle;
    }
    return (low + high) / 2;
}

export function pathLength(path, options = {}) {
    const normalized = normalizeCurvePath(path, options);
    if (!normalized) return null;
    let total = 0;
    for (const part of normalized.parts) {
        const length = curveLength(part, options);
        if (!Number.isFinite(length)) return null;
        total += length;
    }
    return Number.isFinite(total) ? total : null;
}

/** Path parameter is normalized accumulated arc length, not part index. */
export function pathPointAt(path, parameter, options = {}) {
    const location = resolvePathLocation(path, parameter, options);
    return location ? curvePointAt(location.path.parts[location.partIndex], location.t, options) : null;
}

export function pathTangentAt(path, parameter, options = {}) {
    const location = resolvePathLocation(path, parameter, options);
    return location ? curveTangentAt(location.path.parts[location.partIndex], location.t, options) : null;
}

export function closestPointOnCurve(curve, point, options = {}) {
    const limits = resolveLimits(options);
    const normalized = normalizeCurvePrimitive(curve, limits);
    const target = finitePoint(point, limits);
    if (!normalized || !target) return null;
    let parameter;
    if (normalized.type === 'line') parameter = closestLineParameter(normalized, target);
    else if (normalized.type === 'circle') parameter = circularParameter(normalized, target, true);
    else if (normalized.type === 'arc') {
        const candidate = circularParameter(normalized, target, false);
        parameter = candidate === null
            ? closestEndpointParameter(normalized, target)
            : candidate;
    } else parameter = closestNumericParameter(normalized, target, limits);
    const closest = curvePointAtNormalized(normalized, parameter);
    const distance = pointDistance(closest, target);
    return { point: closest, t: parameter, distance, distanceSquared: distance * distance };
}

export function curveParameterAtPoint(curve, point, options = {}) {
    return closestPointOnCurve(curve, point, options)?.t ?? null;
}

export function closestPointOnPath(path, point, options = {}) {
    const normalized = normalizeCurvePath(path, options);
    const lengths = normalized?.parts.map(part => curveLength(part, options));
    const total = lengths?.reduce((sum, length) => sum + length, 0);
    if (!normalized || !Number.isFinite(total) || total <= 0) return null;
    let prefix = 0;
    let best = null;
    normalized.parts.forEach((part, partIndex) => {
        const candidate = closestPointOnCurve(part, point, options);
        if (candidate && (!best || candidate.distance < best.distance)) {
            best = {
                ...candidate,
                partIndex,
                pathT: (prefix + curveLengthAtParameter(part, candidate.t, options)) / total,
            };
        }
        prefix += lengths[partIndex];
    });
    return best;
}

export function curveSubcurve(curve, startParameter, endParameter, options = {}) {
    const normalized = normalizeCurvePrimitive(curve, options);
    const start = finiteUnitParameter(startParameter);
    const end = finiteUnitParameter(endParameter);
    const epsilon = resolveLimits(options).epsilon;
    if (!normalized || start === null || end === null || Math.abs(end - start) <= epsilon) return null;
    if (start > end) {
        const forward = curveSubcurve(normalized, end, start, options);
        return forward ? reverseCurve(forward, options) : null;
    }
    if (start <= epsilon && end >= 1 - epsilon) return cloneCurve(normalized);
    if (normalized.type === 'line') {
        const first = curvePointAtNormalized(normalized, start);
        const second = curvePointAtNormalized(normalized, end);
        return { ...normalized, x1: first.x, y1: first.y, x2: second.x, y2: second.y };
    }
    if (normalized.type === 'circle' || normalized.type === 'arc') {
        const baseAngle = normalized.type === 'circle' ? 0 : normalized.startAngle;
        const sweep = curveSweep(normalized);
        return {
            ...normalized,
            type: 'arc',
            startAngle: normalizeAngle(baseAngle + sweep * start),
            endAngle: normalizeAngle(baseAngle + sweep * end),
            counterClockwise: sweep > 0,
            fullCircle: false,
        };
    }
    if (normalized.type === 'ellipse') {
        const sweep = curveSweep(normalized);
        return {
            ...normalized,
            startAngle: normalizeAngle(normalized.startAngle + sweep * start),
            endAngle: normalizeAngle(normalized.startAngle + sweep * end),
            counterClockwise: sweep > 0,
            fullEllipse: false,
        };
    }
    return splineSubcurve(normalized, start, end);
}

/** Returns `[before, after]`; either side is null at an endpoint. */
export function splitCurve(curve, parameter, options = {}) {
    const normalized = normalizeCurvePrimitive(curve, options);
    const t = finiteUnitParameter(parameter);
    const epsilon = resolveLimits(options).epsilon;
    if (!normalized || t === null) return null;
    if (t <= epsilon) return [null, cloneCurve(normalized)];
    if (t >= 1 - epsilon) return [cloneCurve(normalized), null];
    return [curveSubcurve(normalized, 0, t, options), curveSubcurve(normalized, t, 1, options)];
}

export function splitPath(path, location, options = {}) {
    const resolved = resolvePathLocation(path, location, options);
    if (!resolved || resolved.path.closed) return null;
    const start = { partIndex: 0, t: 0 };
    const end = { partIndex: resolved.path.parts.length - 1, t: 1 };
    return [
        pathSubpath(resolved.path, start, resolved, options),
        pathSubpath(resolved.path, resolved, end, options),
    ];
}

export function openClosedPathAt(path, location, options = {}) {
    const resolved = resolvePathLocation(path, location, options);
    if (!resolved?.path.closed) return null;
    const { path: normalized, partIndex, t } = resolved;
    const parts = [];
    const cutPart = normalized.parts[partIndex];
    if (normalized.parts.length === 1 && curveIsClosed(cutPart)
        && (t <= resolveLimits(options).epsilon || t >= 1 - resolveLimits(options).epsilon)) {
        appendCurve(parts, curveSubcurve(cutPart, 0, 0.5, options));
        appendCurve(parts, curveSubcurve(cutPart, 0.5, 1, options));
        return normalizeCurvePath({ type: 'path', parts, closed: false }, options);
    }
    appendCurve(parts, curveSubcurve(cutPart, t, 1, options));
    for (let offset = 1; offset < normalized.parts.length; offset += 1) {
        parts.push(cloneCurve(normalized.parts[(partIndex + offset) % normalized.parts.length]));
    }
    appendCurve(parts, curveSubcurve(normalized.parts[partIndex], 0, t, options));
    return normalizeCurvePath({ type: 'path', parts, closed: false }, options);
}

export function pathSubpath(path, startLocation, endLocation, options = {}) {
    const start = resolvePathLocation(path, startLocation, options);
    const end = resolvePathLocation(path, endLocation, options);
    if (!start || !end || start.path.parts.length !== end.path.parts.length) return null;
    const normalized = start.path;
    const startOrder = start.partIndex + start.t;
    const endOrder = end.partIndex + end.t;
    if (!normalized.closed && startOrder > endOrder) {
        const forward = pathSubpath(normalized, end, start, options);
        return forward ? reversePath(forward, options) : null;
    }
    if (normalized.closed && nearlyEqual(startOrder, endOrder, resolveLimits(options).epsilon)) {
        return options.fullLoop ? openClosedPathAt(normalized, start, options) : null;
    }
    const parts = [];
    if (!normalized.closed || startOrder < endOrder) {
        collectPathInterval(parts, normalized, start, end, options);
    } else {
        collectPathInterval(parts, normalized, start, {
            partIndex: normalized.parts.length - 1,
            t: 1,
        }, options);
        collectPathInterval(parts, normalized, { partIndex: 0, t: 0 }, end, options);
    }
    return parts.length ? normalizeCurvePath({ type: 'path', parts, closed: false }, options) : null;
}

/**
 * Computes intersections between two primitives. Exact analytic branches are
 * used for line/line, line/circle-or-arc, circle-or-arc/circle-or-arc and
 * line/ellipse. Other pairs use deterministic bounded subdivision followed by
 * Newton refinement.
 */
export function intersectCurves(leftCurve, rightCurve, options = {}) {
    const limits = resolveLimits(options);
    const left = normalizeCurvePrimitive(leftCurve, limits);
    const right = normalizeCurvePrimitive(rightCurve, limits);
    if (!left || !right) return emptyIntersectionResult();

    let result;
    if (left.type === 'line' && right.type === 'line') {
        result = intersectLines(left, right, limits);
    } else if (left.type === 'line' && isCircularCurve(right)) {
        result = intersectLineCircular(left, right, limits);
    } else if (right.type === 'line' && isCircularCurve(left)) {
        result = swapIntersectionResult(intersectLineCircular(right, left, limits));
    } else if (isCircularCurve(left) && isCircularCurve(right)) {
        result = intersectCircularCurves(left, right, limits);
    } else if (left.type === 'line' && right.type === 'ellipse') {
        result = intersectLineEllipse(left, right, limits);
    } else if (right.type === 'line' && left.type === 'ellipse') {
        result = swapIntersectionResult(intersectLineEllipse(right, left, limits));
    } else {
        result = intersectCurvesNumerically(left, right, limits);
    }
    return finalizeIntersectionResult(result, left, right, limits);
}

export function intersectPaths(leftPath, rightPath, options = {}) {
    const limits = resolveLimits(options);
    const left = normalizeCurvePath(leftPath, limits);
    const right = normalizeCurvePath(rightPath, limits);
    if (!left || !right) return emptyIntersectionResult();
    const result = emptyIntersectionResult();
    let checks = 0;
    outer: for (let leftIndex = 0; leftIndex < left.parts.length; leftIndex += 1) {
        for (let rightIndex = 0; rightIndex < right.parts.length; rightIndex += 1) {
            if (checks >= limits.maxIntersectionChecks) {
                result.truncated = true;
                break outer;
            }
            const current = intersectCurves(left.parts[leftIndex], right.parts[rightIndex], {
                ...limits,
                maxIntersectionChecks: Math.max(1, limits.maxIntersectionChecks - checks),
            });
            checks += Math.max(1, current.checks || 0);
            current.points.forEach(intersection => result.points.push({
                ...intersection,
                leftPartIndex: leftIndex,
                rightPartIndex: rightIndex,
            }));
            current.overlaps.forEach(overlap => result.overlaps.push({
                ...overlap,
                leftPartIndex: leftIndex,
                rightPartIndex: rightIndex,
            }));
            result.truncated ||= current.truncated;
            if (checks >= limits.maxIntersectionChecks) {
                result.truncated ||= leftIndex < left.parts.length - 1 || rightIndex < right.parts.length - 1;
                break outer;
            }
        }
    }
    result.checks = checks;
    result.points = deduplicateIntersectionPoints(result.points, limits.intersectionTolerance);
    return result;
}

function extractEntityPathsInternal(entity, options, state) {
    const { limits } = options;
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)
        || state.depth > limits.maxBoundaryDepth || state.pathCount >= limits.maxPaths) return [];
    if (state.seen.has(entity)) return [];
    state.seen.add(entity);
    const nextState = { ...state, depth: state.depth + 1, seen: new Set(state.seen) };

    if (entity.type === 'path') {
        const path = normalizeCurvePath(entity, limits);
        return path && acceptPaths([path], state, limits) ? [path] : [];
    }
    const primitive = normalizeCurvePrimitive(entity, limits);
    if (primitive) {
        const path = normalizeCurvePath({
            type: 'path',
            parts: [primitive],
            closed: curveIsClosed(primitive),
        }, limits);
        return path && acceptPaths([path], state, limits) ? [path] : [];
    }
    if (entity.type === 'rectangle') {
        const path = rectanglePath(entity, limits);
        return path && acceptPaths([path], state, limits) ? [path] : [];
    }
    if (entity.type === 'polygon') {
        const path = polygonPath(entity, limits);
        return path && acceptPaths([path], state, limits) ? [path] : [];
    }
    if (entity.type === 'polyline' && Array.isArray(entity.points)) {
        const path = pointPolylinePath(entity, limits);
        return path && acceptPaths([path], state, limits) ? [path] : [];
    }
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        const paths = mixedPartPaths(entity, options, nextState);
        return acceptPaths(paths, state, limits) ? paths : [];
    }

    const extracted = invokeBoundaryExtractor(entity, options, nextState);
    if (extracted === undefined && ['block', 'hatch', 'region'].includes(entity.type) && Array.isArray(entity.boundaries)) {
        return extractBoundaryResult(entity.boundaries, options, nextState);
    }
    return extractBoundaryResult(extracted, options, nextState);
}

function acceptPaths(paths, state, limits) {
    const partCount = paths.reduce((count, path) => count + path.parts.length, 0);
    if (state.pathCount + paths.length > limits.maxPaths || state.partCount + partCount > limits.maxParts) return false;
    state.pathCount += paths.length;
    state.partCount += partCount;
    return true;
}

function invokeBoundaryExtractor(entity, options, state) {
    const context = Object.freeze({
        depth: state.depth,
        limits: options.limits,
        extract: candidate => extractEntityPathsInternal(candidate, options, state),
    });
    if (typeof options.boundaryExtractor === 'function') {
        const extracted = options.boundaryExtractor(entity, context);
        if (extracted !== undefined) return extracted;
    }
    const registry = options.boundaryExtractors;
    if (registry?.extract && typeof registry.extract === 'function') return registry.extract(entity, context);
    if (registry instanceof Map) return registry.get(entity.type)?.(entity, context);
    if (typeof registry?.[entity.type] === 'function') return registry[entity.type](entity, context);
    return undefined;
}

function extractBoundaryResult(result, options, state) {
    if (result === undefined || result === null) return [];
    const candidates = Array.isArray(result) && result.every(isPointLike) ? [result] : Array.isArray(result) ? result : [result];
    if (candidates.length > options.limits.maxPaths) return [];
    const paths = [];
    for (const candidate of candidates) {
        if (Array.isArray(candidate) && candidate.every(isPointLike)) {
            const path = pointPolylinePath({ type: 'polyline', points: candidate, closed: true }, options.limits);
            if (path) paths.push(path);
        } else {
            paths.push(...extractEntityPathsInternal(candidate, options, state));
        }
        if (paths.length > options.limits.maxPaths) return [];
    }
    return paths;
}

function mixedPartPaths(entity, options, state) {
    const { limits } = options;
    if (!entity.parts.length || entity.parts.length > limits.maxParts) return [];
    const atomicPaths = [];
    for (const part of entity.parts) {
        const extracted = extractEntityPathsInternal(part, options, state);
        if (!extracted.length) return [];
        atomicPaths.push(...extracted);
        if (atomicPaths.length > limits.maxPaths) return [];
    }
    const paths = [];
    let current = null;
    for (const candidate of atomicPaths) {
        if (candidate.closed) {
            if (current) paths.push(current);
            paths.push(candidate);
            current = null;
            continue;
        }
        if (!current) {
            current = { type: 'path', parts: candidate.parts.map(cloneCurve), closed: false };
            continue;
        }
        const end = getCurveEnd(current.parts[current.parts.length - 1]);
        let next = candidate;
        if (!pointsEqual(end, getCurveStart(next.parts[0]), limits.joinTolerance)) {
            if (pointsEqual(end, getCurveEnd(next.parts[next.parts.length - 1]), limits.joinTolerance)) {
                next = reversePath(next, limits);
            } else {
                paths.push(normalizeCurvePath(current, limits));
                current = { type: 'path', parts: candidate.parts.map(cloneCurve), closed: false };
                continue;
            }
        }
        current.parts.push(...next.parts.map(cloneCurve));
    }
    if (current) paths.push(normalizeCurvePath(current, limits));
    const valid = paths.filter(Boolean);
    if (entity.closed) {
        if (valid.length !== 1) return [];
        const closed = normalizeCurvePath({ ...valid[0], closed: true }, limits);
        return closed ? [closed] : [];
    }
    return valid;
}

function pointPolylinePath(entity, limits) {
    if (!entity.points.length || entity.points.length > limits.maxPolylinePoints) return null;
    const points = entity.points.map(point => finitePoint(point, limits));
    if (points.some(point => !point)) return null;
    const closed = Boolean(entity.closed);
    const cleaned = [];
    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const trailingClosure = closed && index === points.length - 1 && cleaned.length > 2
            && pointsEqual(cleaned[0], point, limits.joinTolerance);
        if (trailingClosure) continue;
        if (cleaned.length && pointsEqual(cleaned[cleaned.length - 1], point, limits.epsilon)) return null;
        cleaned.push(point);
    }
    if ((!closed && cleaned.length < 2) || (closed && cleaned.length < 3)) return null;
    const parts = cleaned.slice(0, -1).map((point, index) => lineFromPoints(point, cleaned[index + 1]));
    if (closed) parts.push(lineFromPoints(cleaned[cleaned.length - 1], cleaned[0]));
    return normalizeCurvePath({ type: 'path', parts, closed }, limits);
}

function rectanglePath(entity, limits) {
    const x = finiteCoordinate(entity.x, limits);
    const y = finiteCoordinate(entity.y, limits);
    const width = finiteCoordinate(entity.width, limits);
    const height = finiteCoordinate(entity.height, limits);
    const rotation = finiteAngle(entity.rotation ?? 0);
    if (x === null || y === null || width === null || height === null || rotation === null
        || Math.abs(width) <= limits.epsilon || Math.abs(height) <= limits.epsilon) return null;
    const minX = Math.min(x, x + width);
    const maxX = Math.max(x, x + width);
    const minY = Math.min(y, y + height);
    const maxY = Math.max(y, y + height);
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const style = ['chamfer', 'fillet'].includes(entity.cornerStyle)
        ? entity.cornerStyle
        : Number(entity.fillet) > 0 ? 'fillet' : Number(entity.chamfer) > 0 ? 'chamfer' : 'square';
    const requested = Math.max(0, Number(entity.cornerValue ?? entity.fillet ?? entity.chamfer) || 0);
    const corner = Math.min(requested, (maxX - minX) / 2, (maxY - minY) / 2);
    let parts;
    if (style === 'fillet' && corner > limits.epsilon) {
        parts = roundedRectangleParts(minX, minY, maxX, maxY, corner);
    } else {
        const corners = [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
        ];
        const points = style === 'chamfer' && corner > limits.epsilon
            ? corners.flatMap((point, index) => [
                moveToward(point, corners[(index + corners.length - 1) % corners.length], corner),
                moveToward(point, corners[(index + 1) % corners.length], corner),
            ])
            : corners;
        parts = points.map((point, index) => lineFromPoints(point, points[(index + 1) % points.length]));
    }
    if (rotation) parts = parts.map(part => rotateCurve(part, center, rotation, limits));
    return normalizeCurvePath({ type: 'path', parts, closed: true }, limits);
}

function roundedRectangleParts(minX, minY, maxX, maxY, radius) {
    return [
        lineFromPoints({ x: minX + radius, y: minY }, { x: maxX - radius, y: minY }),
        circularArc({ x: maxX - radius, y: minY + radius }, radius, -Math.PI / 2, 0),
        lineFromPoints({ x: maxX, y: minY + radius }, { x: maxX, y: maxY - radius }),
        circularArc({ x: maxX - radius, y: maxY - radius }, radius, 0, Math.PI / 2),
        lineFromPoints({ x: maxX - radius, y: maxY }, { x: minX + radius, y: maxY }),
        circularArc({ x: minX + radius, y: maxY - radius }, radius, Math.PI / 2, Math.PI),
        lineFromPoints({ x: minX, y: maxY - radius }, { x: minX, y: minY + radius }),
        circularArc({ x: minX + radius, y: minY + radius }, radius, Math.PI, Math.PI * 1.5),
    ];
}

function polygonPath(entity, limits) {
    const center = finitePoint({ x: entity.cx, y: entity.cy }, limits);
    const storedRadius = finitePositive(entity.r, limits.maxCoordinate);
    const sides = Math.round(Number(entity.sides));
    const rotation = finiteAngle(entity.rotation ?? 0);
    if (!center || !storedRadius || rotation === null || !Number.isInteger(sides) || sides < 3
        || sides > limits.maxPolylinePoints) return null;
    const radius = entity.mode === 'circumscribed'
        ? storedRadius / Math.max(limits.epsilon, Math.cos(Math.PI / sides))
        : storedRadius;
    if (coordinateMagnitude(center) + radius > limits.maxCoordinate) return null;
    const rotationRadians = rotation * Math.PI / 180;
    const points = Array.from({ length: sides }, (_, index) => ({
        x: center.x + Math.cos(rotationRadians - Math.PI / 2 + index * TAU / sides) * radius,
        y: center.y + Math.sin(rotationRadians - Math.PI / 2 + index * TAU / sides) * radius,
    }));
    const parts = points.map((point, index) => lineFromPoints(point, points[(index + 1) % sides]));
    return normalizeCurvePath({ type: 'path', parts, closed: true }, limits);
}

function curvePointAtNormalized(curve, t) {
    if (curve.type === 'line') return {
        x: lerp(curve.x1, curve.x2, t),
        y: lerp(curve.y1, curve.y2, t),
    };
    if (curve.type === 'circle' || curve.type === 'arc') {
        const start = curve.type === 'circle' ? 0 : curve.startAngle;
        const angle = start + curveSweep(curve) * t;
        return { x: curve.cx + Math.cos(angle) * curve.r, y: curve.cy + Math.sin(angle) * curve.r };
    }
    if (curve.type === 'ellipse') {
        const angle = curve.startAngle + curveSweep(curve) * t;
        const local = { x: Math.cos(angle) * curve.rx, y: Math.sin(angle) * curve.ry };
        return rotateVectorAndTranslate(local, { x: curve.cx, y: curve.cy }, curve.rotation);
    }
    const [first, second, third, fourth] = curve.controlPoints;
    const inverse = 1 - t;
    return {
        x: inverse ** 3 * first.x + 3 * inverse ** 2 * t * second.x
            + 3 * inverse * t ** 2 * third.x + t ** 3 * fourth.x,
        y: inverse ** 3 * first.y + 3 * inverse ** 2 * t * second.y
            + 3 * inverse * t ** 2 * third.y + t ** 3 * fourth.y,
    };
}

function curveDerivativeAtNormalized(curve, t) {
    if (curve.type === 'line') return { x: curve.x2 - curve.x1, y: curve.y2 - curve.y1 };
    if (curve.type === 'circle' || curve.type === 'arc') {
        const sweep = curveSweep(curve);
        const start = curve.type === 'circle' ? 0 : curve.startAngle;
        const angle = start + sweep * t;
        return { x: -Math.sin(angle) * curve.r * sweep, y: Math.cos(angle) * curve.r * sweep };
    }
    if (curve.type === 'ellipse') {
        const sweep = curveSweep(curve);
        const angle = curve.startAngle + sweep * t;
        const local = { x: -Math.sin(angle) * curve.rx * sweep, y: Math.cos(angle) * curve.ry * sweep };
        return rotateVector(local, curve.rotation);
    }
    const [first, second, third, fourth] = curve.controlPoints;
    const inverse = 1 - t;
    return {
        x: 3 * inverse ** 2 * (second.x - first.x)
            + 6 * inverse * t * (third.x - second.x)
            + 3 * t ** 2 * (fourth.x - third.x),
        y: 3 * inverse ** 2 * (second.y - first.y)
            + 6 * inverse * t * (third.y - second.y)
            + 3 * t ** 2 * (fourth.y - third.y),
    };
}

function intersectLines(left, right, limits) {
    const a = { x: left.x1, y: left.y1 };
    const b = { x: left.x2, y: left.y2 };
    const c = { x: right.x1, y: right.y1 };
    const d = { x: right.x2, y: right.y2 };
    const r = subtractPoints(b, a);
    const s = subtractPoints(d, c);
    const denominator = cross(r, s);
    const offset = subtractPoints(c, a);
    const scale = Math.max(1, vectorLength(r), vectorLength(s));
    const crossTolerance = limits.intersectionTolerance * scale;
    if (Math.abs(denominator) > crossTolerance) {
        const leftT = cross(offset, s) / denominator;
        const rightT = cross(offset, r) / denominator;
        if (!withinUnit(leftT, limits.intersectionTolerance) || !withinUnit(rightT, limits.intersectionTolerance)) {
            return emptyIntersectionResult(1);
        }
        return intersectionPointResult(
            curvePointAtNormalized(left, clampUnit(leftT)),
            clampUnit(leftT),
            clampUnit(rightT),
        );
    }
    if (Math.abs(cross(offset, r)) > crossTolerance) return emptyIntersectionResult(1);
    const squared = dot(r, r);
    if (squared <= limits.epsilon ** 2) return emptyIntersectionResult(1);
    const t0 = dot(subtractPoints(c, a), r) / squared;
    const t1 = dot(subtractPoints(d, a), r) / squared;
    const leftStart = Math.max(0, Math.min(t0, t1));
    const leftEnd = Math.min(1, Math.max(t0, t1));
    if (leftEnd < leftStart - limits.intersectionTolerance) return emptyIntersectionResult(1);
    const rightParameter = point => closestLineParameter(right, point);
    if (Math.abs(leftEnd - leftStart) <= limits.intersectionTolerance) {
        const point = curvePointAtNormalized(left, clampUnit((leftStart + leftEnd) / 2));
        return intersectionPointResult(point, clampUnit(leftStart), rightParameter(point));
    }
    const first = curvePointAtNormalized(left, leftStart);
    const second = curvePointAtNormalized(left, leftEnd);
    return {
        points: [],
        overlaps: [{
            leftRange: [leftStart, leftEnd],
            rightRange: [rightParameter(first), rightParameter(second)],
            points: [first, second],
            coincident: true,
        }],
        truncated: false,
        checks: 1,
    };
}

function intersectLineCircular(line, circular, limits) {
    const first = { x: line.x1, y: line.y1 };
    const direction = { x: line.x2 - line.x1, y: line.y2 - line.y1 };
    const relative = { x: first.x - circular.cx, y: first.y - circular.cy };
    const aa = dot(direction, direction);
    const bb = 2 * dot(relative, direction);
    const cc = dot(relative, relative) - circular.r ** 2;
    const discriminant = bb ** 2 - 4 * aa * cc;
    const scale = Math.max(1, Math.abs(bb ** 2), Math.abs(4 * aa * cc));
    if (discriminant < -limits.intersectionTolerance * scale) return emptyIntersectionResult(1);
    const root = Math.sqrt(Math.max(0, discriminant));
    const raw = [(-bb - root) / (2 * aa), (-bb + root) / (2 * aa)];
    const points = [];
    raw.forEach(lineT => {
        if (!withinUnit(lineT, limits.intersectionTolerance)) return;
        const point = curvePointAtNormalized(line, clampUnit(lineT));
        const circularT = circularParameterForPoint(circular, point, limits.intersectionTolerance);
        if (circularT === null) return;
        points.push({ point, leftT: clampUnit(lineT), rightT: circularT });
    });
    return { points, overlaps: [], truncated: false, checks: 1 };
}

function intersectCircularCurves(left, right, limits) {
    const delta = { x: right.cx - left.cx, y: right.cy - left.cy };
    const distance = vectorLength(delta);
    const sameCenter = distance <= limits.intersectionTolerance;
    const sameRadius = Math.abs(left.r - right.r) <= limits.intersectionTolerance;
    if (sameCenter && sameRadius) return coincidentCircularIntersections(left, right, limits);
    if (distance <= limits.epsilon
        || distance > left.r + right.r + limits.intersectionTolerance
        || distance < Math.abs(left.r - right.r) - limits.intersectionTolerance) return emptyIntersectionResult(1);
    const along = (left.r ** 2 - right.r ** 2 + distance ** 2) / (2 * distance);
    const heightSquared = left.r ** 2 - along ** 2;
    if (heightSquared < -limits.intersectionTolerance * Math.max(1, left.r ** 2)) return emptyIntersectionResult(1);
    const height = Math.sqrt(Math.max(0, heightSquared));
    const unit = { x: delta.x / distance, y: delta.y / distance };
    const base = { x: left.cx + unit.x * along, y: left.cy + unit.y * along };
    const perpendicular = { x: -unit.y * height, y: unit.x * height };
    const candidates = [addPoints(base, perpendicular)];
    if (height > limits.intersectionTolerance) candidates.push(subtractPoints(base, perpendicular));
    const points = [];
    candidates.forEach(point => {
        const leftT = circularParameterForPoint(left, point, limits.intersectionTolerance);
        const rightT = circularParameterForPoint(right, point, limits.intersectionTolerance);
        if (leftT !== null && rightT !== null) points.push({ point, leftT, rightT });
    });
    return { points, overlaps: [], truncated: false, checks: 1 };
}

function coincidentCircularIntersections(left, right, limits) {
    if (curveIsClosed(left) && curveIsClosed(right)) {
        return {
            points: [],
            overlaps: [{
                leftRange: [0, 1],
                rightRange: [0, 1],
                points: [getCurveStart(left), getCurveStart(left)],
                coincident: true,
                closed: true,
            }],
            truncated: false,
            checks: 1,
        };
    }
    const breakpoints = [0, 1];
    [getCurveStart(right), getCurveEnd(right)].forEach(point => {
        const parameter = circularParameterForPoint(left, point, limits.intersectionTolerance);
        if (parameter !== null) breakpoints.push(parameter);
    });
    const sorted = uniqueNumbers(breakpoints.map(clampUnit), limits.intersectionTolerance).sort((a, b) => a - b);
    const overlaps = [];
    for (let index = 0; index < sorted.length - 1; index += 1) {
        const start = sorted[index];
        const end = sorted[index + 1];
        if (end - start <= limits.intersectionTolerance) continue;
        const midpoint = curvePointAtNormalized(left, (start + end) / 2);
        if (circularParameterForPoint(right, midpoint, limits.intersectionTolerance) === null) continue;
        const first = curvePointAtNormalized(left, start);
        const second = curvePointAtNormalized(left, end);
        const rightStart = circularParameterForPoint(right, first, limits.intersectionTolerance);
        const rightEnd = circularParameterForPoint(right, second, limits.intersectionTolerance);
        if (rightStart === null || rightEnd === null) continue;
        overlaps.push({
            leftRange: [start, end],
            rightRange: [rightStart, rightEnd],
            points: [first, second],
            coincident: true,
        });
    }
    const endpointPoints = [];
    [getCurveStart(left), getCurveEnd(left), getCurveStart(right), getCurveEnd(right)].forEach(point => {
        const leftT = circularParameterForPoint(left, point, limits.intersectionTolerance);
        const rightT = circularParameterForPoint(right, point, limits.intersectionTolerance);
        if (leftT !== null && rightT !== null) endpointPoints.push({ point, leftT, rightT });
    });
    return { points: endpointPoints, overlaps, truncated: false, checks: 1 };
}

function intersectLineEllipse(line, ellipse, limits) {
    const first = ellipseLocalPoint({ x: line.x1, y: line.y1 }, ellipse);
    const second = ellipseLocalPoint({ x: line.x2, y: line.y2 }, ellipse);
    const direction = subtractPoints(second, first);
    const aa = direction.x ** 2 / ellipse.rx ** 2 + direction.y ** 2 / ellipse.ry ** 2;
    const bb = 2 * (first.x * direction.x / ellipse.rx ** 2 + first.y * direction.y / ellipse.ry ** 2);
    const cc = first.x ** 2 / ellipse.rx ** 2 + first.y ** 2 / ellipse.ry ** 2 - 1;
    const discriminant = bb ** 2 - 4 * aa * cc;
    const scale = Math.max(1, Math.abs(bb ** 2), Math.abs(4 * aa * cc));
    if (discriminant < -limits.intersectionTolerance * scale) return emptyIntersectionResult(1);
    const root = Math.sqrt(Math.max(0, discriminant));
    const raw = [(-bb - root) / (2 * aa), (-bb + root) / (2 * aa)];
    const points = [];
    raw.forEach(lineT => {
        if (!withinUnit(lineT, limits.intersectionTolerance)) return;
        const point = curvePointAtNormalized(line, clampUnit(lineT));
        const ellipseT = ellipseParameterForPoint(ellipse, point, limits.intersectionTolerance);
        if (ellipseT !== null) points.push({ point, leftT: clampUnit(lineT), rightT: ellipseT });
    });
    return { points, overlaps: [], truncated: false, checks: 1 };
}

function intersectCurvesNumerically(left, right, limits) {
    const leftSegments = sampleCurveForIntersection(left, limits);
    const rightSegments = sampleCurveForIntersection(right, limits);
    const result = emptyIntersectionResult();
    let checks = 0;
    outer: for (const leftSegment of leftSegments) {
        for (const rightSegment of rightSegments) {
            if (checks >= limits.maxIntersectionChecks) {
                result.truncated = true;
                break outer;
            }
            if (!boundsOverlap(leftSegment.bounds, rightSegment.bounds, limits.intersectionTolerance)) continue;
            checks += 1;
            const seed = segmentIntersectionParameters(
                leftSegment.first,
                leftSegment.second,
                rightSegment.first,
                rightSegment.second,
                limits,
            );
            if (!seed) continue;
            const initialLeft = lerp(leftSegment.t0, leftSegment.t1, seed.leftT);
            const initialRight = lerp(rightSegment.t0, rightSegment.t1, seed.rightT);
            const refined = refineCurveIntersection(
                left,
                right,
                initialLeft,
                initialRight,
                [leftSegment.t0, leftSegment.t1],
                [rightSegment.t0, rightSegment.t1],
                limits,
            );
            if (refined) result.points.push(refined);
        }
    }
    result.checks = checks;
    return result;
}

function refineCurveIntersection(left, right, leftSeed, rightSeed, leftRange, rightRange, limits) {
    let leftT = leftSeed;
    let rightT = rightSeed;
    for (let iteration = 0; iteration < limits.maxNewtonIterations; iteration += 1) {
        const leftPoint = curvePointAtNormalized(left, leftT);
        const rightPoint = curvePointAtNormalized(right, rightT);
        const error = subtractPoints(leftPoint, rightPoint);
        if (vectorLength(error) <= limits.intersectionTolerance) break;
        const leftDerivative = curveDerivativeAtNormalized(left, leftT);
        const rightDerivative = curveDerivativeAtNormalized(right, rightT);
        const determinant = cross(leftDerivative, rightDerivative);
        if (Math.abs(determinant) <= limits.epsilon) break;
        const deltaLeft = cross(error, rightDerivative) / determinant;
        const deltaRight = cross(error, leftDerivative) / determinant;
        leftT = clamp(leftT - deltaLeft, leftRange[0], leftRange[1]);
        rightT = clamp(rightT - deltaRight, rightRange[0], rightRange[1]);
    }
    const leftPoint = curvePointAtNormalized(left, leftT);
    const rightPoint = curvePointAtNormalized(right, rightT);
    if (pointDistance(leftPoint, rightPoint) > limits.numericTolerance) return null;
    return {
        point: midpoint(leftPoint, rightPoint),
        leftT: clampUnit(leftT),
        rightT: clampUnit(rightT),
    };
}

function finalizeIntersectionResult(result, left, right, limits) {
    const points = deduplicateIntersectionPoints(result.points, limits.intersectionTolerance).map(intersection => {
        const leftTangent = curveTangentAt(left, intersection.leftT, limits);
        const rightTangent = curveTangentAt(right, intersection.rightT, limits);
        return {
            ...intersection,
            tangent: Boolean(leftTangent && rightTangent
                && Math.abs(cross(leftTangent, rightTangent)) <= limits.tangentTolerance),
        };
    });
    return { ...result, points };
}

function sampleCurveForIntersection(curve, limits) {
    const count = numericSamplingSegments(curve, limits);
    const segments = [];
    let first = curvePointAtNormalized(curve, 0);
    for (let index = 1; index <= count; index += 1) {
        const t0 = (index - 1) / count;
        const t1 = index / count;
        const second = curvePointAtNormalized(curve, t1);
        segments.push({ first, second, t0, t1, bounds: segmentBounds(first, second) });
        first = second;
    }
    return segments;
}

function closestLineParameter(line, point) {
    const first = { x: line.x1, y: line.y1 };
    const direction = { x: line.x2 - line.x1, y: line.y2 - line.y1 };
    return clampUnit(dot(subtractPoints(point, first), direction) / dot(direction, direction));
}

function closestEndpointParameter(curve, point) {
    return pointDistance(curvePointAtNormalized(curve, 0), point)
        <= pointDistance(curvePointAtNormalized(curve, 1), point) ? 0 : 1;
}

function closestNumericParameter(curve, point, limits) {
    const samples = Math.min(limits.maxClosestSamples, Math.max(16, numericSamplingSegments(curve, limits)));
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let index = 0; index <= samples; index += 1) {
        const t = index / samples;
        const distance = squaredPointDistance(curvePointAtNormalized(curve, t), point);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    }
    let lower = Math.max(0, (bestIndex - 1) / samples);
    let upper = Math.min(1, (bestIndex + 1) / samples);
    const golden = (Math.sqrt(5) - 1) / 2;
    let left = upper - (upper - lower) * golden;
    let right = lower + (upper - lower) * golden;
    let leftDistance = squaredPointDistance(curvePointAtNormalized(curve, left), point);
    let rightDistance = squaredPointDistance(curvePointAtNormalized(curve, right), point);
    for (let iteration = 0; iteration < 32; iteration += 1) {
        if (leftDistance <= rightDistance) {
            upper = right;
            right = left;
            rightDistance = leftDistance;
            left = upper - (upper - lower) * golden;
            leftDistance = squaredPointDistance(curvePointAtNormalized(curve, left), point);
        } else {
            lower = left;
            left = right;
            leftDistance = rightDistance;
            right = lower + (upper - lower) * golden;
            rightDistance = squaredPointDistance(curvePointAtNormalized(curve, right), point);
        }
    }
    return clampUnit((lower + upper) / 2);
}

function circularParameter(curve, point, unrestricted) {
    const angle = Math.atan2(point.y - curve.cy, point.x - curve.cx);
    if (curve.type === 'circle') return circleParameterFromAngle(curve, angle);
    const parameter = circularParameterForAngle(curve, angle, DEFAULT_EPSILON);
    return unrestricted ? (parameter ?? circleParameterFromAngle(curve, angle)) : parameter;
}

function circularParameterForPoint(curve, point, tolerance) {
    const radialDistance = Math.hypot(point.x - curve.cx, point.y - curve.cy);
    if (Math.abs(radialDistance - curve.r) > tolerance * Math.max(1, curve.r)) return null;
    const angle = Math.atan2(point.y - curve.cy, point.x - curve.cx);
    return curve.type === 'circle'
        ? circleParameterFromAngle(curve, angle)
        : circularParameterForAngle(curve, angle, tolerance);
}

function circularParameterForAngle(curve, angle, tolerance) {
    const sweep = curveSweep(curve);
    const delta = sweep > 0
        ? positiveAngleDelta(curve.startAngle, angle)
        : positiveAngleDelta(angle, curve.startAngle);
    if (delta > Math.abs(sweep) + tolerance) return null;
    return clampUnit(delta / Math.abs(sweep));
}

function circleParameterFromAngle(curve, angle) {
    const direction = curve.counterClockwise === false ? -1 : 1;
    const delta = direction > 0 ? positiveAngleDelta(0, angle) : positiveAngleDelta(angle, 0);
    return clampUnit(delta / TAU);
}

function ellipseParameterForPoint(ellipse, point, tolerance) {
    const local = ellipseLocalPoint(point, ellipse);
    const equation = local.x ** 2 / ellipse.rx ** 2 + local.y ** 2 / ellipse.ry ** 2;
    if (Math.abs(equation - 1) > tolerance * 8) return null;
    const angle = Math.atan2(local.y / ellipse.ry, local.x / ellipse.rx);
    if (ellipse.fullEllipse) {
        const direction = ellipse.counterClockwise === false ? -1 : 1;
        const delta = direction > 0
            ? positiveAngleDelta(ellipse.startAngle, angle)
            : positiveAngleDelta(angle, ellipse.startAngle);
        return clampUnit(delta / TAU);
    }
    const sweep = curveSweep(ellipse);
    const delta = sweep > 0
        ? positiveAngleDelta(ellipse.startAngle, angle)
        : positiveAngleDelta(angle, ellipse.startAngle);
    return delta <= Math.abs(sweep) + tolerance ? clampUnit(delta / Math.abs(sweep)) : null;
}

function resolvePathLocation(path, location, options) {
    const normalized = normalizeCurvePath(path, options);
    if (!normalized) return null;
    if (location && typeof location === 'object' && Number.isInteger(location.partIndex)) {
        const t = finiteUnitParameter(location.t);
        if (t === null || location.partIndex < 0 || location.partIndex >= normalized.parts.length) return null;
        return { path: normalized, partIndex: location.partIndex, t };
    }
    const pathT = finiteUnitParameter(location);
    if (pathT === null) return null;
    const lengths = normalized.parts.map(part => curveLength(part, options));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (!Number.isFinite(total) || total <= 0) return null;
    if (pathT >= 1) return { path: normalized, partIndex: normalized.parts.length - 1, t: 1 };
    const target = total * pathT;
    let prefix = 0;
    for (let partIndex = 0; partIndex < lengths.length; partIndex += 1) {
        if (target <= prefix + lengths[partIndex] || partIndex === lengths.length - 1) {
            return {
                path: normalized,
                partIndex,
                t: curveParameterAtLength(normalized.parts[partIndex], Math.max(0, Math.min(lengths[partIndex], target - prefix)), options),
            };
        }
        prefix += lengths[partIndex];
    }
    return null;
}

function collectPathInterval(output, path, start, end, options) {
    if (start.partIndex === end.partIndex) {
        appendCurve(output, curveSubcurve(path.parts[start.partIndex], start.t, end.t, options));
        return;
    }
    appendCurve(output, curveSubcurve(path.parts[start.partIndex], start.t, 1, options));
    for (let index = start.partIndex + 1; index < end.partIndex; index += 1) {
        output.push(cloneCurve(path.parts[index]));
    }
    appendCurve(output, curveSubcurve(path.parts[end.partIndex], 0, end.t, options));
}

function appendCurve(parts, curve) {
    if (curve) parts.push(curve);
}

function splineSubcurve(spline, start, end) {
    const [leftAtEnd] = splitSplineControlPoints(spline.controlPoints, end);
    const relativeStart = end > 0 ? start / end : 0;
    const [, segment] = splitSplineControlPoints(leftAtEnd, relativeStart);
    return { ...spline, controlPoints: segment };
}

function splitSplineControlPoints(points, parameter) {
    const [first, second, third, fourth] = points;
    const firstSecond = interpolatePoint(first, second, parameter);
    const secondThird = interpolatePoint(second, third, parameter);
    const thirdFourth = interpolatePoint(third, fourth, parameter);
    const firstMiddle = interpolatePoint(firstSecond, secondThird, parameter);
    const secondMiddle = interpolatePoint(secondThird, thirdFourth, parameter);
    const center = interpolatePoint(firstMiddle, secondMiddle, parameter);
    return [
        [first, firstSecond, firstMiddle, center].map(point => ({ ...point })),
        [center, secondMiddle, thirdFourth, fourth].map(point => ({ ...point })),
    ];
}

function numericIntegrationSegments(curve, limits) {
    const base = curve.type === 'spline' ? 128 : Math.ceil(Math.abs(curveSweep(curve)) / TAU * 256);
    const bounded = Math.min(limits.maxNumericSegments, Math.max(16, base));
    return bounded % 2 ? Math.max(2, bounded - 1) : bounded;
}

function numericSamplingSegments(curve, limits) {
    if (curve.type === 'line') return 1;
    if (curve.type === 'circle' || curve.type === 'arc') {
        return Math.min(limits.maxNumericSegments, Math.max(16, Math.ceil(Math.abs(curveSweep(curve)) / TAU * 128)));
    }
    if (curve.type === 'ellipse') {
        const eccentricityFactor = Math.sqrt(Math.max(curve.rx, curve.ry) / Math.min(curve.rx, curve.ry));
        return Math.min(limits.maxNumericSegments, Math.max(32, Math.ceil(
            Math.abs(curveSweep(curve)) / TAU * 192 * Math.min(4, eccentricityFactor),
        )));
    }
    const polygonLength = controlPolygonLength(curve.controlPoints);
    const chordLength = pointDistance(curve.controlPoints[0], curve.controlPoints[3]);
    const curvatureFactor = Math.max(1, polygonLength / Math.max(DEFAULT_EPSILON, chordLength));
    return Math.min(limits.maxNumericSegments, Math.max(32, Math.ceil(96 * Math.min(4, curvatureFactor))));
}

// Fixed sampling loses accuracy near the tips of eccentric ellipses. Subdivide
// by integration error, sharing endpoint evaluations and bounding the work.
function integrateEllipseLength(ellipse, end) {
    if (end === 0) return 0;
    const evaluate = parameter => vectorLength(curveDerivativeAtNormalized(ellipse, parameter));
    const tolerance = Math.max(1e-11, Math.max(ellipse.rx, ellipse.ry) * Math.abs(curveSweep(ellipse)) * end * 1e-11);
    let evaluations = 3;
    const integrate = (a, b, fa, fm, fb, estimate, error, depth) => {
        const middle = (a + b) / 2;
        const leftMiddle = evaluate((a + middle) / 2);
        const rightMiddle = evaluate((middle + b) / 2);
        evaluations += 2;
        const left = (middle - a) * (fa + 4 * leftMiddle + fm) / 6;
        const right = (b - middle) * (fm + 4 * rightMiddle + fb) / 6;
        const delta = left + right - estimate;
        if (Math.abs(delta) <= 15 * error || depth >= 24 || evaluations >= 16384) return left + right + delta / 15;
        return integrate(a, middle, fa, leftMiddle, fm, left, error / 2, depth + 1)
            + integrate(middle, b, fm, rightMiddle, fb, right, error / 2, depth + 1);
    };
    const first = evaluate(0);
    const middle = evaluate(end / 2);
    const last = evaluate(end);
    return integrate(0, end, first, middle, last, end * (first + 4 * middle + last) / 6, tolerance, 0);
}

function integrateSimpson(evaluate, start, end, rawSegments) {
    const segments = Math.max(2, Math.ceil(rawSegments / 2) * 2);
    const step = (end - start) / segments;
    let sum = evaluate(start) + evaluate(end);
    for (let index = 1; index < segments; index += 1) {
        sum += evaluate(start + step * index) * (index % 2 ? 4 : 2);
    }
    return sum * step / 3;
}

function rotateCurve(curve, origin, angleDegrees, limits) {
    const normalized = normalizeCurvePrimitive(curve, limits);
    if (!normalized) return null;
    if (normalized.type === 'line') {
        const first = rotatePoint({ x: normalized.x1, y: normalized.y1 }, origin, angleDegrees);
        const second = rotatePoint({ x: normalized.x2, y: normalized.y2 }, origin, angleDegrees);
        return { ...normalized, x1: first.x, y1: first.y, x2: second.x, y2: second.y };
    }
    if (normalized.type === 'circle') {
        const center = rotatePoint({ x: normalized.cx, y: normalized.cy }, origin, angleDegrees);
        return { ...normalized, cx: center.x, cy: center.y };
    }
    if (normalized.type === 'arc') {
        const center = rotatePoint({ x: normalized.cx, y: normalized.cy }, origin, angleDegrees);
        const radians = angleDegrees * Math.PI / 180;
        return {
            ...normalized,
            cx: center.x,
            cy: center.y,
            startAngle: normalizeAngle(normalized.startAngle + radians),
            endAngle: normalizeAngle(normalized.endAngle + radians),
        };
    }
    if (normalized.type === 'ellipse') {
        const center = rotatePoint({ x: normalized.cx, y: normalized.cy }, origin, angleDegrees);
        return { ...normalized, cx: center.x, cy: center.y, rotation: normalizeDegrees(normalized.rotation + angleDegrees) };
    }
    return {
        ...normalized,
        controlPoints: normalized.controlPoints.map(point => rotatePoint(point, origin, angleDegrees)),
    };
}

function segmentIntersectionParameters(first, second, third, fourth, limits) {
    const left = subtractPoints(second, first);
    const right = subtractPoints(fourth, third);
    const denominator = cross(left, right);
    if (Math.abs(denominator) <= limits.epsilon) return null;
    const offset = subtractPoints(third, first);
    const leftT = cross(offset, right) / denominator;
    const rightT = cross(offset, left) / denominator;
    return withinUnit(leftT, limits.intersectionTolerance) && withinUnit(rightT, limits.intersectionTolerance)
        ? { leftT: clampUnit(leftT), rightT: clampUnit(rightT) }
        : null;
}

function swapIntersectionResult(result) {
    return {
        points: result.points.map(intersection => ({
            ...intersection,
            leftT: intersection.rightT,
            rightT: intersection.leftT,
        })),
        overlaps: result.overlaps.map(overlap => ({
            ...overlap,
            leftRange: overlap.rightRange,
            rightRange: overlap.leftRange,
        })),
        truncated: result.truncated,
        checks: result.checks,
    };
}

function emptyIntersectionResult(checks = 0) {
    return { points: [], overlaps: [], truncated: false, checks };
}

function intersectionPointResult(point, leftT, rightT) {
    return { points: [{ point, leftT, rightT }], overlaps: [], truncated: false, checks: 1 };
}

function deduplicateIntersectionPoints(points, tolerance) {
    const unique = [];
    points.forEach(candidate => {
        const duplicate = unique.find(existing => pointDistance(existing.point, candidate.point) <= tolerance);
        if (!duplicate) unique.push(candidate);
    });
    return unique;
}

function resolveLimits(options = {}) {
    if (options?._curveKernelLimits === true) return options;
    const source = options?.limits || options || {};
    const epsilon = positiveBound(source.epsilon, DEFAULT_EPSILON, 1e-3);
    return {
        ...DRAWING_CURVE_KERNEL_LIMITS,
        ...Object.fromEntries(Object.entries(DRAWING_CURVE_KERNEL_LIMITS).map(([key, fallback]) => [
            key,
            boundedInteger(source[key], fallback),
        ])),
        epsilon,
        joinTolerance: positiveBound(source.joinTolerance, Math.max(1e-7, epsilon * 10), 1),
        intersectionTolerance: positiveBound(source.intersectionTolerance, Math.max(1e-8, epsilon * 10), 1),
        numericTolerance: positiveBound(source.numericTolerance, 1e-6, 1),
        tangentTolerance: positiveBound(source.tangentTolerance, 1e-7, 1),
        _curveKernelLimits: true,
    };
}

function boundedInteger(value, fallback) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? Math.min(numeric, fallback) : fallback;
}

function positiveBound(value, fallback, maximum) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.min(numeric, maximum) : fallback;
}

function normalizeCurveType(value) {
    const type = String(value || '').trim();
    if (type === 'ellipseArc') return 'ellipse';
    if (['cubicSpline', 'cubicBezier', 'bezier'].includes(type)) return 'spline';
    return ['line', 'arc', 'circle', 'ellipse', 'spline'].includes(type) ? type : null;
}

function finiteCoordinate(value, limits) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && Math.abs(numeric) <= limits.maxCoordinate ? numeric : null;
}

function finitePoint(point, limits) {
    if (!point || typeof point !== 'object') return null;
    const x = finiteCoordinate(point.x, limits);
    const y = finiteCoordinate(point.y, limits);
    return x === null || y === null ? null : { x, y };
}

function finitePositive(value, maximum) {
    const numeric = Math.abs(Number(value));
    return Number.isFinite(numeric) && numeric > DEFAULT_EPSILON && numeric <= maximum ? numeric : null;
}

function finiteAngle(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && Math.abs(numeric) <= 1e15 ? numeric : null;
}

function finiteUnitParameter(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : null;
}

function isPointLike(value) {
    return Boolean(value) && typeof value === 'object' && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y));
}

function curveSweep(curve) {
    if (curve.type === 'circle') return curve.counterClockwise === false ? -TAU : TAU;
    if (curve.type === 'ellipse' && curve.fullEllipse) return curve.counterClockwise === false ? -TAU : TAU;
    if (curve.type === 'arc' && curve.fullCircle) return curve.counterClockwise === false ? -TAU : TAU;
    return curve.counterClockwise === false
        ? -positiveAngleDelta(curve.endAngle, curve.startAngle)
        : positiveAngleDelta(curve.startAngle, curve.endAngle);
}

function curveIsClosed(curve) {
    return curve?.type === 'circle'
        || (curve?.type === 'arc' && Boolean(curve.fullCircle))
        || (curve?.type === 'ellipse' && Boolean(curve.fullEllipse));
}

function isCircularCurve(curve) {
    return curve?.type === 'circle' || curve?.type === 'arc';
}

function lineFromPoints(first, second) {
    return { type: 'line', x1: first.x, y1: first.y, x2: second.x, y2: second.y };
}

function circularArc(center, radius, startAngle, endAngle) {
    return {
        type: 'arc',
        cx: center.x,
        cy: center.y,
        r: radius,
        startAngle,
        endAngle,
        counterClockwise: true,
    };
}

function cloneCurve(curve) {
    if (!curve) return null;
    if (curve.type === 'spline') return {
        ...curve,
        controlPoints: curve.controlPoints.map(point => ({ ...point })),
    };
    return { ...curve };
}

function rotatePoint(point, origin, angleDegrees) {
    const radians = angleDegrees * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const delta = subtractPoints(point, origin);
    return {
        x: origin.x + delta.x * cosine - delta.y * sine,
        y: origin.y + delta.x * sine + delta.y * cosine,
    };
}

function rotateVector(vector, angleDegrees) {
    const radians = angleDegrees * Math.PI / 180;
    return {
        x: vector.x * Math.cos(radians) - vector.y * Math.sin(radians),
        y: vector.x * Math.sin(radians) + vector.y * Math.cos(radians),
    };
}

function rotateVectorAndTranslate(vector, center, angleDegrees) {
    return addPoints(center, rotateVector(vector, angleDegrees));
}

function ellipseLocalPoint(point, ellipse) {
    return rotateVector(subtractPoints(point, { x: ellipse.cx, y: ellipse.cy }), -ellipse.rotation);
}

function normalizeVector(vector, epsilon) {
    const length = vectorLength(vector);
    return length > epsilon ? { x: vector.x / length, y: vector.y / length } : null;
}

function interpolatePoint(first, second, parameter) {
    return { x: lerp(first.x, second.x, parameter), y: lerp(first.y, second.y, parameter) };
}

function midpoint(first, second) {
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function moveToward(first, second, distance) {
    const length = pointDistance(first, second);
    const ratio = length > 0 ? Math.min(1, distance / length) : 0;
    return interpolatePoint(first, second, ratio);
}

function addPoints(first, second) {
    return { x: first.x + second.x, y: first.y + second.y };
}

function subtractPoints(first, second) {
    return { x: first.x - second.x, y: first.y - second.y };
}

function dot(first, second) {
    return first.x * second.x + first.y * second.y;
}

function cross(first, second) {
    return first.x * second.y - first.y * second.x;
}

function vectorLength(vector) {
    return Math.hypot(vector.x, vector.y);
}

function pointDistance(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

function squaredPointDistance(first, second) {
    return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function coordinateMagnitude(point) {
    return Math.max(Math.abs(point.x), Math.abs(point.y));
}

function controlPolygonLength(points) {
    return points.slice(1).reduce((total, point, index) => total + pointDistance(points[index], point), 0);
}

function pointBounds(points) {
    if (!points.length) return null;
    return points.reduce((bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxX: Math.max(bounds.maxX, point.x),
        maxY: Math.max(bounds.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function segmentBounds(first, second) {
    return {
        minX: Math.min(first.x, second.x),
        minY: Math.min(first.y, second.y),
        maxX: Math.max(first.x, second.x),
        maxY: Math.max(first.y, second.y),
    };
}

function boundsOverlap(left, right, tolerance) {
    return left.maxX >= right.minX - tolerance && left.minX <= right.maxX + tolerance
        && left.maxY >= right.minY - tolerance && left.minY <= right.maxY + tolerance;
}

function pointsEqual(first, second, tolerance = DEFAULT_EPSILON) {
    return Boolean(first && second) && pointDistance(first, second) <= tolerance;
}

function positiveAngleDelta(start, end) {
    const delta = (end - start) % TAU;
    return delta < 0 ? delta + TAU : delta;
}

function normalizeAngle(angle) {
    const normalized = angle % TAU;
    return normalized < 0 ? normalized + TAU : normalized;
}

function normalizeDegrees(angle) {
    const normalized = angle % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

function withinUnit(value, tolerance) {
    return value >= -tolerance && value <= 1 + tolerance;
}

function clampUnit(value) {
    return clamp(value, 0, 1);
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function lerp(start, end, parameter) {
    return start + (end - start) * parameter;
}

function nearlyEqual(first, second, tolerance) {
    return Math.abs(first - second) <= tolerance;
}

function uniqueNumbers(values, tolerance) {
    return values.filter((value, index) => !values.slice(0, index).some(previous => Math.abs(value - previous) <= tolerance));
}
