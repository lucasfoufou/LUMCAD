import {
    curvePointAt,
    extractEntityPaths,
    normalizeCurvePrimitive,
} from './drawingCurveKernel.js';

const TAU = Math.PI * 2;
const EPSILON = 1e-9;
const MAX_COORDINATE = 1e12;
const DEFAULT_CURVE_SEGMENTS = 96;
const MAX_CURVE_SEGMENTS = 512;

export const DRAWING_ADVANCED_ENTITY_TYPES = Object.freeze(['ellipse', 'spline', 'hatch', 'region']);

export function normalizeAdvancedDrawingEntity(entity) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return entity;
    if (['ellipse', 'ellipseArc'].includes(entity.type)) return normalizeDrawingEllipse(entity);
    if (['spline', 'cubicSpline', 'cubicBezier', 'bezier'].includes(entity.type)) return normalizeDrawingSpline(entity);
    if (entity.type === 'hatch') return normalizeDrawingHatch(entity);
    if (entity.type === 'region') return normalizeDrawingRegion(entity);
    return entity;
}

export function normalizeDrawingEllipse(entity) {
    const hasAngularDomain = entity.startAngle !== undefined || entity.endAngle !== undefined;
    const {
        type: _type,
        radiusX: _radiusX,
        radiusY: _radiusY,
        majorRadius: _majorRadius,
        minorRadius: _minorRadius,
        ...properties
    } = entity;
    return {
        ...properties,
        type: 'ellipse',
        cx: finiteCoordinateOr(entity.cx, 0),
        cy: finiteCoordinateOr(entity.cy, 0),
        rx: Math.abs(finiteCoordinateOr(entity.rx ?? entity.radiusX ?? entity.majorRadius, 0)),
        ry: Math.abs(finiteCoordinateOr(entity.ry ?? entity.radiusY ?? entity.minorRadius, 0)),
        rotation: normalizeDegrees(entity.rotation),
        startAngle: normalizeRadians(entity.startAngle),
        endAngle: normalizeRadians(entity.endAngle),
        counterClockwise: entity.counterClockwise !== false,
        fullEllipse: entity.fullEllipse === true || !hasAngularDomain,
    };
}

export function normalizeDrawingSpline(entity) {
    const source = Array.isArray(entity.controlPoints)
        ? entity.controlPoints
        : [entity.p0, entity.p1, entity.p2, entity.p3];
    const controlPoints = source.length === 4
        ? source.map(point => normalizePoint(point)).filter(Boolean)
        : [];
    const { type: _type, p0: _p0, p1: _p1, p2: _p2, p3: _p3, ...properties } = entity;
    return {
        ...properties,
        type: 'spline',
        degree: 3,
        controlPoints: controlPoints.length === 4 ? controlPoints : [],
    };
}

export function normalizeDrawingHatch(entity) {
    const sourceBoundaries = Array.isArray(entity.boundaries)
        ? entity.boundaries
        : Array.isArray(entity.loops) ? entity.loops : [];
    const paths = extractEntityPaths({ type: 'hatch', boundaries: sourceBoundaries });
    const boundaries = paths.filter(path => path.closed).map(path => ({
        ...path,
        type: 'polyline',
        parts: path.parts.map(part => ({ ...part })),
        closed: true,
    }));
    const { loops: _loops, boundaries: _boundaries, boundaryPick, ...properties } = entity;
    return {
        ...properties,
        type: 'hatch',
        ...(Number.isFinite(boundaryPick?.x) && Number.isFinite(boundaryPick?.y)
            ? { boundaryPick: { x: boundaryPick.x, y: boundaryPick.y } } : {}),
        boundaries,
        pattern: normalizeDrawingHatchPattern(entity.pattern),
    };
}

export function normalizeDrawingHatchPattern(pattern) {
    const source = typeof pattern === 'string' ? { name: pattern } : (pattern || {});
    const rawName = typeof source.name === 'string' ? source.name.trim() : '';
    const name = rawName.toLowerCase() === 'solid' || !rawName ? 'solid' : rawName;
    return {
        ...source,
        name,
        ...(name === 'gradient' || name === 'radial' ? { endColor: /^#[0-9a-f]{6}$/i.test(source.endColor || '') ? source.endColor : '#ffffff' } : {}),
        angle: normalizeDegrees(source.angle),
        scale: finitePositiveOr(source.scale, 1),
        spacing: finitePositiveOr(source.spacing, 1),
        origin: normalizePoint(source.origin) || { x: 0, y: 0 },
    };
}

export function getHatchBoundaryEntities(entity) {
    if (!['hatch', 'region'].includes(entity?.type)) return [];
    return normalizeDrawingHatch(entity).boundaries;
}

export function normalizeDrawingRegion(entity) {
    const { pattern, sourceIds, boundaryPick, ...normalized } = normalizeDrawingHatch(entity);
    return { ...normalized, type: 'region' };
}

export function getAdvancedEntityBounds(entity) {
    const normalized = normalizeCurvePrimitive(entity);
    if (!normalized) return null;
    if (normalized.type === 'ellipse') return ellipseBounds(normalized);
    if (normalized.type === 'spline') return splineBounds(normalized);
    return null;
}

export function getAdvancedEntitySegments(entity, options = {}) {
    const points = sampleAdvancedCurvePoints(entity, options);
    return points.slice(0, -1).map((point, index) => [point, points[index + 1]]);
}

export function sampleAdvancedCurvePoints(entity, options = {}) {
    const normalized = normalizeCurvePrimitive(entity);
    if (!normalized || !['ellipse', 'spline'].includes(normalized.type)) return [];
    const requested = Math.round(Number(options.segments) || DEFAULT_CURVE_SEGMENTS);
    const maximum = Math.max(8, Math.min(MAX_CURVE_SEGMENTS, requested));
    const sweepRatio = normalized.type === 'ellipse' && !normalized.fullEllipse
        ? Math.max(1 / 16, Math.abs(ellipseSweep(normalized)) / TAU)
        : 1;
    const count = Math.max(8, Math.ceil(maximum * sweepRatio));
    return Array.from({ length: count + 1 }, (_, index) => curvePointAt(normalized, index / count));
}

export function transformAdvancedCurveAffine(entity, matrix, { fallbackToPolyline = true } = {}) {
    if (!entity || !finiteAffineMatrix(matrix)) return entity;
    const normalized = normalizeCurvePrimitive(entity);
    if (!normalized || !['ellipse', 'spline'].includes(normalized.type)) return entity;
    if (normalized.type === 'spline') return {
        ...normalized,
        controlPoints: normalized.controlPoints.map(point => transformPointAffine(point, matrix)),
    };
    const transformed = transformEllipseAffine(normalized, matrix);
    if (transformed || !fallbackToPolyline) return transformed;
    return advancedCurveAsTransformedPolyline(normalized, matrix);
}

export function transformEllipseAffine(entity, matrix) {
    const ellipse = normalizeCurvePrimitive(entity);
    if (ellipse?.type !== 'ellipse' || !finiteAffineMatrix(matrix)) return null;
    const rotation = ellipse.rotation * Math.PI / 180;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const firstAxis = { x: cosine * ellipse.rx, y: sine * ellipse.rx };
    const secondAxis = { x: -sine * ellipse.ry, y: cosine * ellipse.ry };
    const first = transformVectorAffine(firstAxis, matrix);
    const second = transformVectorAffine(secondAxis, matrix);
    const covariance = {
        xx: first.x ** 2 + second.x ** 2,
        xy: first.x * first.y + second.x * second.y,
        yy: first.y ** 2 + second.y ** 2,
    };
    const trace = covariance.xx + covariance.yy;
    const discriminant = Math.hypot(covariance.xx - covariance.yy, covariance.xy * 2);
    const majorSquared = Math.max(0, (trace + discriminant) / 2);
    const minorSquared = Math.max(0, (trace - discriminant) / 2);
    if (majorSquared <= EPSILON ** 2 || minorSquared <= EPSILON ** 2) return null;
    let rx = Math.sqrt(majorSquared);
    let ry = Math.sqrt(minorSquared);
    let firstDirection;
    if (discriminant <= EPSILON * Math.max(1, trace)) {
        firstDirection = normalizeVector(first) || { x: 1, y: 0 };
    } else {
        firstDirection = normalizeVector({ x: covariance.xy, y: majorSquared - covariance.xx })
            || normalizeVector({ x: majorSquared - covariance.yy, y: covariance.xy });
    }
    if (!firstDirection) return null;
    // Keep axis identity when lengths cross after scaling. With shear the
    // transformed first axis chooses the closest principal direction.
    const perpendicular = { x: -firstDirection.y, y: firstDirection.x };
    if (Math.abs(dot(first, perpendicular)) > Math.abs(dot(first, firstDirection))) {
        firstDirection = perpendicular;
        [rx, ry] = [ry, rx];
    }
    if (dot(first, firstDirection) < 0) firstDirection = { x: -firstDirection.x, y: -firstDirection.y };
    const secondDirection = { x: -firstDirection.y, y: firstDirection.x };
    const center = transformPointAffine({ x: ellipse.cx, y: ellipse.cy }, matrix);
    const parameterForPoint = point => {
        const offset = { x: point.x - center.x, y: point.y - center.y };
        return normalizeRadians(Math.atan2(
            dot(offset, secondDirection) / ry,
            dot(offset, firstDirection) / rx,
        ));
    };
    const start = transformPointAffine(curvePointAt(ellipse, 0), matrix);
    const end = transformPointAffine(curvePointAt(ellipse, 1), matrix);
    const reflected = affineDeterminant(matrix) < 0;
    return {
        ...ellipse,
        cx: center.x,
        cy: center.y,
        rx,
        ry,
        rotation: normalizeDegrees(Math.atan2(firstDirection.y, firstDirection.x) * 180 / Math.PI),
        startAngle: parameterForPoint(start),
        endAngle: parameterForPoint(end),
        counterClockwise: reflected ? ellipse.counterClockwise === false : ellipse.counterClockwise !== false,
    };
}

export function transformHatchPatternAffine(pattern, matrix) {
    const normalized = normalizeDrawingHatchPattern(pattern);
    if (!finiteAffineMatrix(matrix)) return normalized;
    const angle = normalized.angle * Math.PI / 180;
    const direction = transformVectorAffine({ x: Math.cos(angle), y: Math.sin(angle) }, matrix);
    const normal = transformVectorAffine({ x: -Math.sin(angle), y: Math.cos(angle) }, matrix);
    const areaScale = Math.sqrt(Math.abs(affineDeterminant(matrix)));
    return {
        ...normalized,
        angle: vectorLength(direction) > EPSILON
            ? normalizeDegrees(Math.atan2(direction.y, direction.x) * 180 / Math.PI)
            : normalized.angle,
        scale: areaScale > EPSILON ? normalized.scale * areaScale : normalized.scale,
        spacing: vectorLength(normal) > EPSILON ? normalized.spacing * vectorLength(normal) : normalized.spacing,
        origin: transformPointAffine(normalized.origin, matrix),
    };
}

export function transformPointAffine(point, matrix) {
    return {
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f,
    };
}

function advancedCurveAsTransformedPolyline(entity, matrix) {
    const points = sampleAdvancedCurvePoints(entity).map(point => transformPointAffine(point, matrix));
    const {
        cx: _cx, cy: _cy, rx: _rx, ry: _ry, rotation: _rotation,
        startAngle: _startAngle, endAngle: _endAngle, counterClockwise: _counterClockwise,
        fullEllipse: _fullEllipse, controlPoints: _controlPoints, degree: _degree,
        ...properties
    } = entity;
    return {
        ...properties,
        type: 'polyline',
        points: entity.type === 'ellipse' && entity.fullEllipse ? points.slice(0, -1) : points,
        closed: entity.type === 'ellipse' && entity.fullEllipse,
    };
}

function ellipseBounds(ellipse) {
    const candidates = [ellipse.startAngle, ellipse.endAngle];
    const rotation = ellipse.rotation * Math.PI / 180;
    const xExtremum = Math.atan2(-ellipse.ry * Math.sin(rotation), ellipse.rx * Math.cos(rotation));
    const yExtremum = Math.atan2(ellipse.ry * Math.cos(rotation), ellipse.rx * Math.sin(rotation));
    [xExtremum, xExtremum + Math.PI, yExtremum, yExtremum + Math.PI].forEach(angle => {
        if (ellipse.fullEllipse || ellipseContainsParameter(ellipse, angle)) candidates.push(angle);
    });
    const points = candidates.map(angle => ellipsePointAtAngle(ellipse, angle));
    return boundsFromPoints(points);
}

function splineBounds(spline) {
    const parameters = new Set([0, 1]);
    for (const key of ['x', 'y']) {
        const [first, second, third, fourth] = spline.controlPoints.map(point => point[key]);
        const a = -first + 3 * second - 3 * third + fourth;
        const b = 3 * first - 6 * second + 3 * third;
        const c = -3 * first + 3 * second;
        quadraticRoots(3 * a, 2 * b, c).forEach(value => {
            if (value > EPSILON && value < 1 - EPSILON) parameters.add(value);
        });
    }
    return boundsFromPoints([...parameters].map(parameter => curvePointAt(spline, parameter)));
}

function ellipsePointAtAngle(ellipse, angle) {
    const rotation = ellipse.rotation * Math.PI / 180;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const x = Math.cos(angle) * ellipse.rx;
    const y = Math.sin(angle) * ellipse.ry;
    return { x: ellipse.cx + x * cosine - y * sine, y: ellipse.cy + x * sine + y * cosine };
}

function ellipseContainsParameter(ellipse, angle) {
    const delta = ellipse.counterClockwise === false
        ? positiveAngleDelta(angle, ellipse.startAngle)
        : positiveAngleDelta(ellipse.startAngle, angle);
    return delta <= Math.abs(ellipseSweep(ellipse)) + EPSILON;
}

function ellipseSweep(ellipse) {
    if (ellipse.fullEllipse) return ellipse.counterClockwise === false ? -TAU : TAU;
    return ellipse.counterClockwise === false
        ? -positiveAngleDelta(ellipse.endAngle, ellipse.startAngle)
        : positiveAngleDelta(ellipse.startAngle, ellipse.endAngle);
}

function quadraticRoots(a, b, c) {
    if (Math.abs(a) <= EPSILON) return Math.abs(b) <= EPSILON ? [] : [-c / b];
    const discriminant = b ** 2 - 4 * a * c;
    if (discriminant < -EPSILON) return [];
    if (Math.abs(discriminant) <= EPSILON) return [-b / (2 * a)];
    const root = Math.sqrt(discriminant);
    return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}

function boundsFromPoints(points) {
    const finite = points.filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
    if (!finite.length) return null;
    return finite.reduce((bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxX: Math.max(bounds.maxX, point.x),
        maxY: Math.max(bounds.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function finiteAffineMatrix(matrix) {
    return Boolean(matrix) && ['a', 'b', 'c', 'd', 'e', 'f'].every(key => Number.isFinite(Number(matrix[key])));
}

function affineDeterminant(matrix) {
    return matrix.a * matrix.d - matrix.b * matrix.c;
}

function transformVectorAffine(vector, matrix) {
    return { x: matrix.a * vector.x + matrix.c * vector.y, y: matrix.b * vector.x + matrix.d * vector.y };
}

function normalizeVector(vector) {
    const length = vectorLength(vector);
    return length > EPSILON ? { x: vector.x / length, y: vector.y / length } : null;
}

function vectorLength(vector) {
    return Math.hypot(vector.x, vector.y);
}

function dot(first, second) {
    return first.x * second.x + first.y * second.y;
}

function normalizePoint(point) {
    const x = finiteCoordinate(point?.x);
    const y = finiteCoordinate(point?.y);
    return x === null || y === null ? null : { x, y };
}

function finiteCoordinate(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && Math.abs(numeric) <= MAX_COORDINATE ? numeric : null;
}

function finiteCoordinateOr(value, fallback) {
    return finiteCoordinate(value) ?? fallback;
}

function finitePositiveOr(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > EPSILON && numeric <= MAX_COORDINATE ? numeric : fallback;
}

function normalizeDegrees(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    const normalized = numeric % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

function normalizeRadians(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    const normalized = numeric % TAU;
    return normalized < 0 ? normalized + TAU : normalized;
}

function positiveAngleDelta(start, end) {
    const normalized = (end - start) % TAU;
    return normalized < 0 ? normalized + TAU : normalized;
}
