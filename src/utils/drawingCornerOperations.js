import { canEditEntity, createDrawingId } from './drawingDocument.js';
import {
    closestPointOnCurve,
    curveTangentAt,
    extractEntityPaths,
    getCurveEnd,
    getCurveStart,
    normalizeCurvePath,
    normalizeCurvePrimitive,
} from './drawingCurveKernel.js';
import { drawingEntityDependsOn } from './drawingDimensions.js';

const TAU = Math.PI * 2;
const EPSILON = 1e-9;
const MAX_COORDINATE = 1e12;
const APPEARANCE_KEYS = ['color', 'lineWeight', 'lineWidth', 'lineType', 'transparency'];

export function filletPickedCurves(firstCurve, firstPick, secondCurve, secondPick, radius, options = {}) {
    const first = supportedFilletCurve(firstCurve);
    const second = supportedFilletCurve(secondCurve);
    const pick1 = finitePoint(firstPick);
    const pick2 = finitePoint(secondPick);
    const requestedRadius = finiteNonNegative(radius);
    if (!first || !second) return unchanged('unsupported-curve');
    if (!pick1 || !pick2 || requestedRadius === null) return unchanged('invalid-input');
    const tolerance = operationTolerance(options.tolerance);
    const lineBranches = resolvePickedLineBranches(first, pick1, second, pick2, tolerance);
    if (first.type === 'line' && second.type === 'line' && !lineBranches) {
        return unchanged(intersectInfiniteLines(lineSupport(first), lineSupport(second), tolerance)
            ? 'ambiguous-branch'
            : 'no-solution');
    }
    if (requestedRadius <= tolerance) {
        return cleanupPickedCurves(first, pick1, second, pick2, { ...options, tolerance, lineBranches });
    }

    const candidates = filletCenters(first, second, requestedRadius, tolerance)
        .map(center => buildFilletCandidate(first, pick1, second, pick2, center, requestedRadius, {
            ...options,
            tolerance,
            lineBranches,
        }))
        .filter(Boolean)
        .sort((left, right) => left.score - right.score);
    if (!candidates.length) return unchanged('no-solution');
    const best = candidates[0];
    const keepSources = Boolean(options.keepSources);
    return {
        changed: true,
        first: keepSources ? first : best.first,
        second: keepSources ? second : best.second,
        trimmedFirst: best.first,
        trimmedSecond: best.second,
        connector: best.connector,
        center: best.center,
        tangentPoints: best.tangentPoints,
        radius: requestedRadius,
        keptSources: keepSources,
    };
}

export function chamferPickedCurves(firstCurve, firstPick, secondCurve, secondPick, options = {}) {
    const first = normalizeCurvePrimitive(firstCurve);
    const second = normalizeCurvePrimitive(secondCurve);
    const pick1 = finitePoint(firstPick);
    const pick2 = finitePoint(secondPick);
    if (first?.type !== 'line' || second?.type !== 'line') return unchanged('unsupported-curve');
    if (!pick1 || !pick2) return unchanged('invalid-input');
    const tolerance = operationTolerance(options.tolerance);
    const intersection = intersectInfiniteLines(lineSupport(first), lineSupport(second), tolerance);
    if (!intersection) return unchanged('parallel');
    const firstBranch = pickedLineBranch(first, intersection, pick1, tolerance);
    const secondBranch = pickedLineBranch(second, intersection, pick2, tolerance);
    if (!firstBranch || !secondBranch) return unchanged('ambiguous-branch');
    const firstDirection = firstBranch.direction;
    const secondDirection = secondBranch.direction;
    const interiorAngle = Math.acos(clamp(dot(firstDirection, secondDirection), -1, 1));
    if (interiorAngle <= tolerance || Math.PI - interiorAngle <= tolerance) return unchanged('parallel');
    const distances = resolveChamferDistances(options, interiorAngle, tolerance);
    if (!distances) return unchanged('invalid-distance');
    const firstPoint = addPoints(intersection, scaleVector(firstDirection, distances.first));
    const secondPoint = addPoints(intersection, scaleVector(secondDirection, distances.second));
    if (!finiteBoundedPoint(firstPoint) || !finiteBoundedPoint(secondPoint)) return unchanged('bounds');
    const trimmedFirst = trimCurveToPoint(first, firstPoint, pick1, options, firstBranch);
    const trimmedSecond = trimCurveToPoint(second, secondPoint, pick2, options, secondBranch);
    if (!trimmedFirst || !trimmedSecond) return unchanged('outside-source');
    const connector = pointDistance(firstPoint, secondPoint) > tolerance
        ? withSourceAppearance({
            type: 'line',
            x1: firstPoint.x,
            y1: firstPoint.y,
            x2: secondPoint.x,
            y2: secondPoint.y,
        }, first)
        : null;
    const keepSources = Boolean(options.keepSources);
    if (keepSources && !connector) return unchanged('no-op');
    return {
        changed: true,
        first: keepSources ? first : trimmedFirst,
        second: keepSources ? second : trimmedSecond,
        trimmedFirst,
        trimmedSecond,
        connector,
        intersection,
        chamferPoints: [firstPoint, secondPoint],
        distances,
        keptSources: keepSources,
    };
}

export function blendPickedCurves(firstEntity, firstPick, secondEntity, secondPick, options = {}) {
    const first = pickedOpenEndpoint(firstEntity, firstPick);
    const second = pickedOpenEndpoint(secondEntity, secondPick);
    if (!first || !second) return unchanged('unsupported-endpoint');
    const chord = pointDistance(first.point, second.point);
    const tolerance = operationTolerance(options.tolerance);
    if (!Number.isFinite(chord) || chord <= tolerance) return unchanged('coincident-endpoints');
    const explicitHandle = Number(options.handleLength);
    const tension = Number.isFinite(Number(options.tension)) ? Number(options.tension) : 1 / 3;
    const handleLength = Number.isFinite(explicitHandle) && explicitHandle > tolerance
        ? explicitHandle
        : chord * tension;
    if (!Number.isFinite(handleLength) || handleLength <= tolerance || handleLength > MAX_COORDINATE) {
        return unchanged('invalid-handle');
    }
    const controlPoints = [
        { ...first.point },
        addPoints(first.point, scaleVector(first.outward, handleLength)),
        addPoints(second.point, scaleVector(second.outward, handleLength)),
        { ...second.point },
    ];
    if (controlPoints.some(point => !finiteBoundedPoint(point))) return unchanged('bounds');
    const spline = normalizeCurvePrimitive(withSourceAppearance({ type: 'spline', controlPoints }, firstEntity));
    if (!spline) return unchanged('invalid-spline');
    return {
        changed: true,
        connector: spline,
        firstEndpoint: first,
        secondEndpoint: second,
        handleLength,
    };
}

export function filletWholePath(entity, radius, options = {}) {
    return modifyWholePath(entity, (first, firstPick, second, secondPick) => filletPickedCurves(
        first,
        firstPick,
        second,
        secondPick,
        radius,
        { ...options, allowExtend: false, keepSources: false },
    ), 'fillet');
}

export function chamferWholePath(entity, options = {}) {
    return modifyWholePath(entity, (first, firstPick, second, secondPick) => chamferPickedCurves(
        first,
        firstPick,
        second,
        secondPick,
        { ...options, allowExtend: false, keepSources: false },
    ), 'chamfer');
}

export function filletDrawingEntities(content, firstId, firstPick, secondId, secondPick, radius, options = {}) {
    return applyPickedDrawingOperation(
        content,
        firstId,
        secondId,
        (first, second) => filletPickedCurves(first, firstPick, second, secondPick, radius, options),
        'fillet',
    );
}

export function chamferDrawingEntities(content, firstId, firstPick, secondId, secondPick, options = {}) {
    return applyPickedDrawingOperation(
        content,
        firstId,
        secondId,
        (first, second) => chamferPickedCurves(first, firstPick, second, secondPick, options),
        'chamfer',
    );
}

export function blendDrawingEntities(content, firstId, firstPick, secondId, secondPick, options = {}) {
    const first = editableEntity(content, firstId);
    const second = editableEntity(content, secondId);
    if (!first || !second) return drawingUnchanged(content, [firstId, secondId], 'not-editable');
    const result = blendPickedCurves(first, firstPick, second, secondPick, options);
    if (!result.changed) return drawingUnchanged(content, [firstId, secondId], result.reason);
    const connector = { ...result.connector, id: createDrawingId('spline') };
    return {
        changed: true,
        content: { ...content, entities: [...content.entities, connector] },
        selectedIds: [connector.id],
        entities: [connector],
        connector,
    };
}

export function filletDrawingPath(content, entityId, radius, options = {}) {
    return applyWholePathDrawingOperation(
        content,
        entityId,
        entity => filletWholePath(entity, radius, options),
        'fillet',
        options,
    );
}

export function chamferDrawingPath(content, entityId, options = {}) {
    return applyWholePathDrawingOperation(
        content,
        entityId,
        entity => chamferWholePath(entity, options),
        'chamfer',
        options,
    );
}

export function createFilletPreviewEntities(firstCurve, firstPick, secondCurve, secondPick, radius, options = {}) {
    return previewPickedResult(
        filletPickedCurves(firstCurve, firstPick, secondCurve, secondPick, radius, options),
        'fillet',
    );
}

export function createChamferPreviewEntities(firstCurve, firstPick, secondCurve, secondPick, options = {}) {
    return previewPickedResult(
        chamferPickedCurves(firstCurve, firstPick, secondCurve, secondPick, options),
        'chamfer',
    );
}

export function createBlendPreviewEntities(firstEntity, firstPick, secondEntity, secondPick, options = {}) {
    const result = blendPickedCurves(firstEntity, firstPick, secondEntity, secondPick, options);
    return result.changed ? [{ ...result.connector, id: 'blend-preview', previewMode: 'blend' }] : [];
}

export function createFilletPathPreviewEntities(entity, radius, options = {}) {
    return previewWholePathResult(filletWholePath(entity, radius, options), 'fillet');
}

export function createChamferPathPreviewEntities(entity, options = {}) {
    return previewWholePathResult(chamferWholePath(entity, options), 'chamfer');
}

function buildFilletCandidate(first, firstPick, second, secondPick, center, radius, options) {
    const firstTangent = tangentPointForCenter(first, center, radius, firstPick, options.tolerance);
    const secondTangent = tangentPointForCenter(second, center, radius, secondPick, options.tolerance);
    if (!firstTangent || !secondTangent || pointDistance(firstTangent, secondTangent) <= options.tolerance) return null;
    if (options.lineBranches && (
        !pointFollowsLineBranch(firstTangent, options.lineBranches.first, options.tolerance)
        || !pointFollowsLineBranch(secondTangent, options.lineBranches.second, options.tolerance)
    )) return null;
    const trimmedFirst = trimCurveToPoint(
        first, firstTangent, firstPick, options, options.lineBranches?.first,
    );
    const trimmedSecond = trimCurveToPoint(
        second, secondTangent, secondPick, options, options.lineBranches?.second,
    );
    if (!trimmedFirst || !trimmedSecond) return null;
    const connector = filletArc(center, radius, firstTangent, secondTangent, first);
    if (!connector) return null;
    return {
        first: trimmedFirst,
        second: trimmedSecond,
        connector,
        center,
        tangentPoints: [firstTangent, secondTangent],
        score: pointDistance(firstTangent, firstPick) + pointDistance(secondTangent, secondPick),
    };
}

function cleanupPickedCurves(first, firstPick, second, secondPick, options) {
    const intersections = primitiveSupportIntersections(first, second, options.tolerance)
        .filter(finiteBoundedPoint)
        .sort((left, right) => (
            pointDistance(left, firstPick) + pointDistance(left, secondPick)
            - pointDistance(right, firstPick) - pointDistance(right, secondPick)
        ));
    for (const intersection of intersections) {
        const branches = options.lineBranches || resolvePickedLineBranches(
            first, firstPick, second, secondPick, options.tolerance, intersection,
        );
        if (first.type === 'line' && second.type === 'line' && !branches) continue;
        const trimmedFirst = trimCurveToPoint(first, intersection, firstPick, options, branches?.first);
        const trimmedSecond = trimCurveToPoint(second, intersection, secondPick, options, branches?.second);
        if (!trimmedFirst || !trimmedSecond) continue;
        if (options.keepSources) return unchanged('no-op');
        return {
            changed: true,
            first: trimmedFirst,
            second: trimmedSecond,
            trimmedFirst,
            trimmedSecond,
            connector: null,
            center: intersection,
            tangentPoints: [intersection, intersection],
            radius: 0,
            keptSources: false,
        };
    }
    return unchanged('no-intersection');
}

function supportedFilletCurve(curve) {
    const normalized = normalizeCurvePrimitive(curve);
    return ['line', 'arc'].includes(normalized?.type) ? normalized : null;
}

function filletCenters(first, second, radius, tolerance) {
    const firstSupports = offsetSupports(first, radius, tolerance);
    const secondSupports = offsetSupports(second, radius, tolerance);
    const centers = [];
    firstSupports.forEach(left => secondSupports.forEach(right => {
        intersectSupports(left, right, tolerance).forEach(center => {
            if (!finiteBoundedPoint(center)) return;
            if (!centers.some(current => pointDistance(current, center) <= tolerance)) centers.push(center);
        });
    }));
    return centers;
}

function offsetSupports(curve, radius, tolerance) {
    if (curve.type === 'line') {
        const support = lineSupport(curve);
        if (!support) return [];
        const normal = { x: -support.direction.y, y: support.direction.x };
        return [-1, 1].map(side => ({
            ...support,
            point: addPoints(support.point, scaleVector(normal, radius * side)),
        }));
    }
    const supports = [curve.r + radius, Math.abs(curve.r - radius)]
        .filter(value => Number.isFinite(value) && value > tolerance)
        .map(value => ({ kind: 'circle', center: { x: curve.cx, y: curve.cy }, radius: value }));
    return supports.filter((support, index) => supports.findIndex(candidate => (
        Math.abs(candidate.radius - support.radius) <= tolerance
    )) === index);
}

function primitiveSupportIntersections(first, second, tolerance) {
    return intersectSupports(primitiveSupport(first), primitiveSupport(second), tolerance);
}

function primitiveSupport(curve) {
    return curve.type === 'line'
        ? lineSupport(curve)
        : { kind: 'circle', center: { x: curve.cx, y: curve.cy }, radius: curve.r };
}

function lineSupport(line) {
    const point = { x: line.x1, y: line.y1 };
    const direction = normalizeVector({ x: line.x2 - line.x1, y: line.y2 - line.y1 });
    return direction ? { kind: 'line', point, direction } : null;
}

function intersectSupports(first, second, tolerance) {
    if (!first || !second) return [];
    if (first.kind === 'line' && second.kind === 'line') {
        const point = intersectInfiniteLines(first, second, tolerance);
        return point ? [point] : [];
    }
    if (first.kind === 'line' && second.kind === 'circle') return intersectInfiniteLineCircle(first, second, tolerance);
    if (first.kind === 'circle' && second.kind === 'line') return intersectInfiniteLineCircle(second, first, tolerance);
    return intersectCircles(first, second, tolerance);
}

function intersectInfiniteLines(first, second, tolerance) {
    const denominator = cross(first.direction, second.direction);
    if (Math.abs(denominator) <= tolerance) return null;
    const offset = subtractPoints(second.point, first.point);
    return addPoints(first.point, scaleVector(first.direction, cross(offset, second.direction) / denominator));
}

function intersectInfiniteLineCircle(line, circle, tolerance) {
    const offset = subtractPoints(line.point, circle.center);
    const b = 2 * dot(offset, line.direction);
    const c = dot(offset, offset) - circle.radius ** 2;
    const discriminant = b ** 2 - 4 * c;
    if (discriminant < -tolerance * Math.max(1, b ** 2, Math.abs(4 * c))) return [];
    const root = Math.sqrt(Math.max(0, discriminant));
    const parameters = [(-b - root) / 2, (-b + root) / 2];
    return parameters
        .filter((value, index) => index === 0 || Math.abs(value - parameters[0]) > tolerance)
        .map(value => addPoints(line.point, scaleVector(line.direction, value)));
}

function intersectCircles(first, second, tolerance) {
    const delta = subtractPoints(second.center, first.center);
    const distance = vectorLength(delta);
    if (distance <= tolerance
        || distance > first.radius + second.radius + tolerance
        || distance < Math.abs(first.radius - second.radius) - tolerance) return [];
    const along = (first.radius ** 2 - second.radius ** 2 + distance ** 2) / (2 * distance);
    const heightSquared = first.radius ** 2 - along ** 2;
    if (heightSquared < -tolerance * Math.max(1, first.radius ** 2)) return [];
    const unit = scaleVector(delta, 1 / distance);
    const base = addPoints(first.center, scaleVector(unit, along));
    const height = Math.sqrt(Math.max(0, heightSquared));
    const perpendicular = { x: -unit.y * height, y: unit.x * height };
    const points = [addPoints(base, perpendicular)];
    if (height > tolerance) points.push(subtractPoints(base, perpendicular));
    return points;
}

function tangentPointForCenter(curve, center, radius, pick, tolerance) {
    if (curve.type === 'line') {
        const support = lineSupport(curve);
        const parameter = dot(subtractPoints(center, support.point), support.direction);
        const point = addPoints(support.point, scaleVector(support.direction, parameter));
        return Math.abs(pointDistance(center, point) - radius) <= tolerance * Math.max(1, radius)
            ? point
            : null;
    }
    const direction = normalizeVector({ x: center.x - curve.cx, y: center.y - curve.cy }, tolerance);
    if (!direction) return null;
    const candidates = [
        { x: curve.cx + direction.x * curve.r, y: curve.cy + direction.y * curve.r },
        { x: curve.cx - direction.x * curve.r, y: curve.cy - direction.y * curve.r },
    ].filter(point => Math.abs(pointDistance(center, point) - radius) <= tolerance * Math.max(1, radius, curve.r));
    return candidates.sort((left, right) => pointDistance(left, pick) - pointDistance(right, pick))[0] || null;
}

function trimCurveToPoint(curve, point, pick, options, lineBranch = null) {
    const tolerance = operationTolerance(options.tolerance);
    const allowExtend = options.allowExtend !== false;
    if (curve.type === 'line') {
        if (lineBranch) return trimLineToBranch(curve, point, lineBranch, allowExtend, tolerance);
        const tangentT = rawLineParameter(curve, point);
        const pickT = rawLineParameter(curve, pick);
        if (!Number.isFinite(tangentT) || !Number.isFinite(pickT)) return null;
        if (!allowExtend && (tangentT < -tolerance || tangentT > 1 + tolerance)) return null;
        const keepStart = Math.abs(pickT - tangentT) > tolerance
            ? pickT < tangentT
            : pointDistance(pick, { x: curve.x1, y: curve.y1 }) <= pointDistance(pick, { x: curve.x2, y: curve.y2 });
        return normalizeCurvePrimitive(keepStart
            ? { ...curve, x2: point.x, y2: point.y }
            : { ...curve, x1: point.x, y1: point.y });
    }
    const tangent = closestPointOnCurve(curve, point);
    const picked = closestPointOnCurve(curve, pick);
    if (!tangent || !picked) return null;
    const onCurve = tangent.distance <= tolerance * Math.max(1, curve.r);
    if (!allowExtend && !onCurve) return null;
    const start = getCurveStart(curve);
    const end = getCurveEnd(curve);
    let keepStart;
    if (onCurve && picked.t <= tolerance && tangent.t > tolerance) keepStart = false;
    else if (onCurve && picked.t >= 1 - tolerance && tangent.t < 1 - tolerance) keepStart = true;
    else if (onCurve && Math.abs(picked.t - tangent.t) > tolerance) keepStart = picked.t < tangent.t;
    else keepStart = pointDistance(point, end) <= pointDistance(point, start);
    const angle = Math.atan2(point.y - curve.cy, point.x - curve.cx);
    return normalizeCurvePrimitive(keepStart
        ? { ...curve, endAngle: angle, fullCircle: false }
        : { ...curve, startAngle: angle, fullCircle: false });
}

function filletArc(center, radius, first, second, source) {
    const startAngle = Math.atan2(first.y - center.y, first.x - center.x);
    const endAngle = Math.atan2(second.y - center.y, second.x - center.x);
    const counterClockwiseSweep = positiveAngleDelta(startAngle, endAngle);
    const counterClockwise = counterClockwiseSweep <= Math.PI;
    return normalizeCurvePrimitive(withSourceAppearance({
        type: 'arc',
        cx: center.x,
        cy: center.y,
        r: radius,
        startAngle,
        endAngle,
        counterClockwise,
    }, source));
}

function resolveChamferDistances(options, interiorAngle, tolerance) {
    const first = finiteNonNegative(options.distance1 ?? options.distance ?? 0);
    if (first === null) return null;
    if (options.angle !== undefined || options.angleDegrees !== undefined) {
        const angleDegrees = Number(options.angleDegrees ?? options.angle);
        if (!Number.isFinite(angleDegrees)) return null;
        const angle = angleDegrees * Math.PI / 180;
        if (angle <= tolerance || angle >= Math.PI - tolerance) return null;
        const denominator = Math.sin(interiorAngle + angle);
        if (Math.abs(denominator) <= tolerance) return null;
        const second = first * Math.sin(angle) / denominator;
        return Number.isFinite(second) && second >= 0 ? { first, second, angleDegrees } : null;
    }
    const second = finiteNonNegative(options.distance2 ?? first);
    return second === null ? null : { first, second, angleDegrees: null };
}

function resolvePickedLineBranches(first, firstPick, second, secondPick, tolerance, knownIntersection = null) {
    if (first.type !== 'line' || second.type !== 'line') return null;
    const intersection = knownIntersection
        || intersectInfiniteLines(lineSupport(first), lineSupport(second), tolerance);
    if (!intersection) return null;
    const firstBranch = pickedLineBranch(first, intersection, firstPick, tolerance);
    const secondBranch = pickedLineBranch(second, intersection, secondPick, tolerance);
    return firstBranch && secondBranch ? { first: firstBranch, second: secondBranch, intersection } : null;
}

function pickedLineBranch(line, intersection, pick, tolerance) {
    const support = lineSupport(line);
    if (!support) return null;
    const pickedDistance = dot(subtractPoints(pick, intersection), support.direction);
    const startDistance = dot(subtractPoints({ x: line.x1, y: line.y1 }, intersection), support.direction);
    const endDistance = dot(subtractPoints({ x: line.x2, y: line.y2 }, intersection), support.direction);
    let sign = Math.abs(pickedDistance) > tolerance ? Math.sign(pickedDistance) : 0;
    if (!sign) {
        const positiveExtent = Math.max(0, startDistance, endDistance);
        const negativeExtent = Math.max(0, -startDistance, -endDistance);
        if (positiveExtent > tolerance && negativeExtent > tolerance) return null;
        if (positiveExtent <= tolerance && negativeExtent <= tolerance) return null;
        sign = positiveExtent > negativeExtent ? 1 : -1;
    }
    return {
        origin: { ...intersection },
        direction: scaleVector(support.direction, sign),
    };
}

function pointFollowsLineBranch(point, branch, tolerance) {
    return dot(subtractPoints(point, branch.origin), branch.direction) >= -tolerance;
}

function trimLineToBranch(line, point, branch, allowExtend, tolerance) {
    if (!pointFollowsLineBranch(point, branch, tolerance)) return null;
    const tangentParameter = rawLineParameter(line, point);
    if (!allowExtend && (tangentParameter < -tolerance || tangentParameter > 1 + tolerance)) return null;
    const start = { x: line.x1, y: line.y1 };
    const end = { x: line.x2, y: line.y2 };
    const startDistance = dot(subtractPoints(start, branch.origin), branch.direction);
    const endDistance = dot(subtractPoints(end, branch.origin), branch.direction);
    const tangentDistance = dot(subtractPoints(point, branch.origin), branch.direction);
    const keepStart = startDistance >= endDistance;
    const retainedEnd = keepStart ? start : end;
    const retainedDistance = Math.max(startDistance, endDistance);
    if (retainedDistance <= tolerance || tangentDistance >= retainedDistance - tolerance
        || pointDistance(point, retainedEnd) <= tolerance) return null;
    return normalizeCurvePrimitive(keepStart
        ? { ...line, x2: point.x, y2: point.y }
        : { ...line, x1: point.x, y1: point.y });
}

function modifyWholePath(entity, modifyCorner, operation) {
    const paths = extractEntityPaths(entity);
    if (paths.length !== 1) return unchanged(paths.length ? 'multiple-paths' : 'unsupported-path');
    const path = paths[0];
    const originalPartCount = path.parts.length;
    const cornerCount = path.closed ? originalPartCount : originalPartCount - 1;
    if (cornerCount < 1) return unchanged('no-corners');
    const parts = path.parts.map(part => ({ ...part }));
    const connectors = new Map();
    for (let index = 0; index < cornerCount; index += 1) {
        const nextIndex = (index + 1) % originalPartCount;
        const firstPick = getCurveStart(parts[index]);
        const secondPick = getCurveEnd(parts[nextIndex]);
        const result = modifyCorner(parts[index], firstPick, parts[nextIndex], secondPick);
        if (!result.changed) return unchanged(`corner-${index + 1}:${result.reason}`);
        parts[index] = result.trimmedFirst || result.first;
        parts[nextIndex] = result.trimmedSecond || result.second;
        if (result.connector) connectors.set(index, result.connector);
    }
    const outputParts = [];
    parts.forEach((part, index) => {
        outputParts.push(stripPartAppearance(part));
        const connector = connectors.get(index);
        if (connector) outputParts.push(stripPartAppearance(connector));
    });
    const normalized = normalizeCurvePath({ type: 'path', parts: outputParts, closed: path.closed });
    if (!normalized) return unchanged('invalid-result');
    return {
        changed: true,
        entity: pathEntityFromSource(entity, normalized),
        cornerCount,
        connectorCount: connectors.size,
        operation,
    };
}

function pickedOpenEndpoint(entity, pick) {
    const target = finitePoint(pick);
    if (!target) return null;
    const paths = extractEntityPaths(entity).filter(path => !path.closed);
    let best = null;
    paths.forEach(path => {
        const firstCurve = path.parts[0];
        const lastCurve = path.parts[path.parts.length - 1];
        const candidates = [
            {
                path,
                end: 'start',
                point: getCurveStart(firstCurve),
                tangent: curveTangentAt(firstCurve, 0),
                length: pathSourceLength(path),
            },
            {
                path,
                end: 'end',
                point: getCurveEnd(lastCurve),
                tangent: curveTangentAt(lastCurve, 1),
                length: pathSourceLength(path),
            },
        ];
        candidates.forEach(candidate => {
            if (!candidate.point || !candidate.tangent) return;
            const distance = pointDistance(candidate.point, target);
            const outward = candidate.end === 'start'
                ? scaleVector(candidate.tangent, -1)
                : candidate.tangent;
            if (!best || distance < best.distance) best = { ...candidate, outward, distance };
        });
    });
    return best;
}

function pathSourceLength(path) {
    return path.parts.reduce((sum, part) => {
        const start = getCurveStart(part);
        const end = getCurveEnd(part);
        return sum + (start && end ? pointDistance(start, end) : 0);
    }, 0);
}

function applyPickedDrawingOperation(content, firstId, secondId, perform, prefix) {
    if (!firstId || !secondId || firstId === secondId) {
        return drawingUnchanged(content, [firstId, secondId].filter(Boolean), 'distinct-sources');
    }
    const first = editableEntity(content, firstId);
    const second = editableEntity(content, secondId);
    if (!first || !second) return drawingUnchanged(content, [firstId, secondId], 'not-editable');
    const result = perform(first, second);
    if (!result.changed) return drawingUnchanged(content, [firstId, secondId], result.reason);
    const connector = result.connector ? { ...result.connector, id: createDrawingId(prefix) } : null;
    const entities = content.entities.map(entity => {
        if (result.keptSources) return entity;
        if (entity.id === firstId) return { ...result.first, id: firstId };
        if (entity.id === secondId) return { ...result.second, id: secondId };
        return entity;
    });
    if (connector) entities.push(connector);
    const selectedIds = result.keptSources
        ? connector ? [connector.id] : []
        : [firstId, secondId, ...(connector ? [connector.id] : [])];
    return {
        changed: true,
        content: { ...content, entities },
        selectedIds,
        entities: entities.filter(entity => selectedIds.includes(entity.id)),
        connector,
        operationResult: result,
    };
}

function applyWholePathDrawingOperation(content, entityId, perform, prefix, options) {
    const source = editableEntity(content, entityId);
    if (!source) return drawingUnchanged(content, [entityId], 'not-editable');
    const result = perform(source);
    if (!result.changed) return drawingUnchanged(content, [entityId], result.reason);
    if (options.keepSources) {
        const copy = { ...result.entity, id: createDrawingId(`${prefix}-path`) };
        return {
            changed: true,
            content: { ...content, entities: [...content.entities, copy] },
            selectedIds: [copy.id],
            entities: [copy],
            entity: copy,
            operationResult: result,
        };
    }
    const incompatible = source.type !== result.entity.type;
    const entities = content.entities.flatMap(entity => {
        if (entity.id === entityId) return [{ ...result.entity, id: entityId }];
        if (incompatible && drawingEntityDependsOn(entity, entityId)) return [];
        return [entity];
    });
    const replacement = entities.find(entity => entity.id === entityId);
    return {
        changed: true,
        content: { ...content, entities },
        selectedIds: [entityId],
        entities: [replacement],
        entity: replacement,
        operationResult: result,
    };
}

function previewPickedResult(result, mode) {
    if (!result.changed) return [];
    const preview = [];
    if (!result.keptSources) {
        preview.push({ ...result.first, id: `${mode}-preview-first`, previewMode: mode });
        preview.push({ ...result.second, id: `${mode}-preview-second`, previewMode: mode });
    }
    if (result.connector) preview.push({ ...result.connector, id: `${mode}-preview-connector`, previewMode: mode });
    return preview;
}

function previewWholePathResult(result, mode) {
    return result.changed ? [{ ...result.entity, id: `${mode}-path-preview`, previewMode: mode }] : [];
}

function pathEntityFromSource(source, path) {
    const {
        type: _type,
        x1: _x1, y1: _y1, x2: _x2, y2: _y2,
        cx: _cx, cy: _cy, r: _r,
        startAngle: _startAngle, endAngle: _endAngle, counterClockwise: _counterClockwise,
        fullCircle: _fullCircle, controlPoints: _controlPoints, degree: _degree,
        x: _x, y: _y, width: _width, height: _height, rotation: _rotation,
        sides: _sides, mode: _mode, points: _points, parts: _parts, closed: _closed,
        cornerStyle: _cornerStyle, cornerValue: _cornerValue, fillet: _fillet, chamfer: _chamfer,
        ...metadata
    } = source;
    return {
        ...metadata,
        type: 'polyline',
        parts: path.parts.map(stripPartAppearance),
        closed: path.closed,
    };
}

function stripPartAppearance(part) {
    const {
        id: _id,
        layerId: _layerId,
        color: _color,
        lineWeight: _lineWeight,
        lineWidth: _lineWidth,
        lineType: _lineType,
        transparency: _transparency,
        locked: _locked,
        sourceId: _sourceId,
        sourceIds: _sourceIds,
        previewMode: _previewMode,
        ...geometry
    } = part;
    return geometry;
}

function withSourceAppearance(entity, source) {
    const appearance = {};
    if (source?.layerId) appearance.layerId = source.layerId;
    APPEARANCE_KEYS.forEach(key => {
        if (Object.hasOwn(source || {}, key)) appearance[key] = source[key];
    });
    return { ...entity, ...appearance };
}

function editableEntity(content, entityId) {
    const entity = content?.entities?.find(candidate => candidate.id === entityId);
    return entity && canEditEntity(content, entity) ? entity : null;
}

function rawLineParameter(line, point) {
    const direction = { x: line.x2 - line.x1, y: line.y2 - line.y1 };
    const squaredLength = dot(direction, direction);
    if (squaredLength <= EPSILON ** 2) return null;
    return dot({ x: point.x - line.x1, y: point.y - line.y1 }, direction) / squaredLength;
}

function positiveAngleDelta(start, end) {
    const value = (end - start) % TAU;
    return value < 0 ? value + TAU : value;
}

function operationTolerance(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : EPSILON;
}

function finiteNonNegative(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= MAX_COORDINATE ? numeric : null;
}

function finitePoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y)
        ? { x: Number(point.x), y: Number(point.y) }
        : null;
}

function finiteBoundedPoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y)
        && Math.max(Math.abs(point.x), Math.abs(point.y)) <= MAX_COORDINATE;
}

function normalizeVector(vector, tolerance = EPSILON) {
    const length = vectorLength(vector);
    return Number.isFinite(length) && length > tolerance
        ? { x: vector.x / length, y: vector.y / length }
        : null;
}

function vectorLength(vector) {
    return Math.hypot(vector.x, vector.y);
}

function pointDistance(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
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

function cross(first, second) {
    return first.x * second.y - first.y * second.x;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function unchanged(reason) {
    return { changed: false, reason };
}

function drawingUnchanged(content, selectedIds, reason) {
    return { changed: false, content, selectedIds, entities: [], reason };
}
