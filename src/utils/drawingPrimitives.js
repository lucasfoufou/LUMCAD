const EPSILON = 1e-9;

import {
    arcEndPoint,
    arcStartPoint,
    arcSweep,
    getArcPoints,
    getRectangleOutlinePoints,
    getRegularPolygonVertices,
    normalizeRadians,
} from './drawingCurves.js';
import {
    mirrorAffineMatrix,
    rotationAffineMatrix,
    scaleAffineMatrix,
    transformDrawingBlockReference,
    translationAffineMatrix,
} from './drawingBlocks.js';
import {
    getAdvancedEntitySegments,
    getHatchBoundaryEntities,
    transformAdvancedCurveAffine,
    transformHatchPatternAffine,
} from './drawingAdvancedEntities.js';
import { isDrawingDimensionEntity } from './drawingDimensions.js';

export const DEFAULT_TRANSFORM_OPTIONS = Object.freeze({
    curveSegments: 96,
    maxCurvePoints: 256,
});

export const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function segmentsIntersect(first, second, third, fourth, tolerance = EPSILON) {
    const cross = (a, b, point) => (
        (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
    );
    const scale = Math.max(1, pointDistance(first, second), pointDistance(third, fourth));
    const crossTolerance = Math.max(EPSILON, tolerance) * scale;
    const onSegment = (point, start, end) => (
        Math.abs(cross(start, end, point)) <= crossTolerance
        && point.x >= Math.min(start.x, end.x) - tolerance
        && point.x <= Math.max(start.x, end.x) + tolerance
        && point.y >= Math.min(start.y, end.y) - tolerance
        && point.y <= Math.max(start.y, end.y) + tolerance
    );
    const firstThird = cross(first, second, third);
    const firstFourth = cross(first, second, fourth);
    const thirdFirst = cross(third, fourth, first);
    const thirdSecond = cross(third, fourth, second);
    const oppositeSides = (left, right) => (
        (left > crossTolerance && right < -crossTolerance)
        || (left < -crossTolerance && right > crossTolerance)
    );
    if (oppositeSides(firstThird, firstFourth) && oppositeSides(thirdFirst, thirdSecond)) return true;
    return onSegment(third, first, second) || onSegment(fourth, first, second)
        || onSegment(first, third, fourth) || onSegment(second, third, fourth);
}

export function rotatePoint(point, origin, angleDegrees) {
    const radians = angleDegrees * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return {
        x: origin.x + dx * cosine - dy * sine,
        y: origin.y + dx * sine + dy * cosine,
    };
}

export function mirrorPoint(point, axisFirst, axisSecond) {
    if (!point || !axisFirst || !axisSecond) return point;
    const dx = axisSecond.x - axisFirst.x;
    const dy = axisSecond.y - axisFirst.y;
    const squaredLength = dx * dx + dy * dy;
    if (squaredLength <= EPSILON) return point;
    const parameter = ((point.x - axisFirst.x) * dx + (point.y - axisFirst.y) * dy) / squaredLength;
    const projection = { x: axisFirst.x + parameter * dx, y: axisFirst.y + parameter * dy };
    return { x: projection.x * 2 - point.x, y: projection.y * 2 - point.y };
}

export function getRectEntityCenter(entity) {
    return { x: entity.x + entity.width / 2, y: entity.y + entity.height / 2 };
}

export function getRectEntityCorners(entity) {
    const minX = Math.min(entity.x, entity.x + entity.width);
    const minY = Math.min(entity.y, entity.y + entity.height);
    const maxX = Math.max(entity.x, entity.x + entity.width);
    const maxY = Math.max(entity.y, entity.y + entity.height);
    const center = getRectEntityCenter(entity);
    const corners = [
        { x: minX, y: minY }, { x: maxX, y: minY },
        { x: maxX, y: maxY }, { x: minX, y: maxY },
    ];
    const rotation = Number(entity.rotation) || 0;
    return rotation ? corners.map(point => rotatePoint(point, center, rotation)) : corners;
}

export function getEntitySegments(entity) {
    if (entity?.type === 'line') return [[{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }]];
    if (entity?.type === 'ellipse' || entity?.type === 'spline') return getAdvancedEntitySegments(entity);
    if (entity?.type === 'hatch') return getHatchBoundaryEntities(entity).flatMap(getEntitySegments);
    if (entity?.type === 'arc') {
        const points = getArcPoints(entity);
        return points.slice(0, -1).map((point, index) => [point, points[index + 1]]);
    }
    if (entity?.type === 'polygon') {
        const points = getRegularPolygonVertices(entity);
        return points.map((point, index) => [point, points[(index + 1) % points.length]]);
    }
    if (entity?.type === 'polyline') {
        if (Array.isArray(entity.parts)) return entity.parts.flatMap(getEntitySegments);
        const points = Array.isArray(entity.points) ? entity.points : [];
        const segments = points.slice(0, -1).map((point, index) => [point, points[index + 1]]);
        if (entity.closed && points.length > 2) segments.push([points[points.length - 1], points[0]]);
        return segments;
    }
    if (!['rectangle', 'image', 'text'].includes(entity?.type)) return [];
    const points = entity.type === 'rectangle' ? getRectangleOutlinePoints(entity) : getRectEntityCorners(entity);
    return points.map((point, index) => [point, points[(index + 1) % points.length]]);
}

/**
 * Applies an axis-aligned scale around an origin to a point.
 *
 * The small transform object accepted by the entity API is deliberately
 * framework-independent so it can also be used by import/export and MCP
 * callers without depending on React or SVG state.
 */
export function transformPoint(point, {
    origin = { x: 0, y: 0 },
    scaleX = 1,
    scaleY = scaleX,
} = {}) {
    if (!point || !isFinitePoint(point) || !isFinitePoint(origin)
        || !Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return point;
    return {
        x: origin.x + (point.x - origin.x) * scaleX,
        y: origin.y + (point.y - origin.y) * scaleY,
    };
}

export function normalizeScaleTransform(transform = {}, origin = { x: 0, y: 0 }, options = {}) {
    const source = typeof transform === 'number' ? { factor: transform } : (transform || {});
    const scaleX = Number(source.scaleX ?? source.x ?? source.factorX ?? source.factor ?? 1);
    const scaleY = Number(source.scaleY ?? source.y ?? source.factorY ?? source.factor ?? scaleX);
    const resolvedOrigin = source.origin || origin || { x: 0, y: 0 };
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || !isFinitePoint(resolvedOrigin)) return null;
    const maxCurvePoints = normalizeCurvePointLimit(
        source.maxCurvePoints ?? options.maxCurvePoints ?? DEFAULT_TRANSFORM_OPTIONS.maxCurvePoints,
    );
    const curveSegments = normalizeCurvePointLimit(
        source.curveSegments ?? options.curveSegments ?? DEFAULT_TRANSFORM_OPTIONS.curveSegments,
    );
    return {
        origin: { x: Number(resolvedOrigin.x), y: Number(resolvedOrigin.y) },
        scaleX,
        scaleY,
        curveSegments: Math.min(curveSegments, maxCurvePoints),
        maxCurvePoints,
    };
}

export function isSimilarityScale(scaleX, scaleY, tolerance = EPSILON) {
    const first = Number(scaleX);
    const second = Number(scaleY);
    return Number.isFinite(first) && Number.isFinite(second)
        && Math.abs(Math.abs(first) - Math.abs(second)) <= Math.max(EPSILON, tolerance);
}

export function transformedVectorLength(vector, scaleX, scaleY) {
    if (!vector || !Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return null;
    return Math.hypot(vector.x * scaleX, vector.y * scaleY);
}

export function scaleEntity(entity, factorOrTransform = 1, origin = { x: 0, y: 0 }, options = {}) {
    const transform = normalizeScaleTransform(factorOrTransform, origin, options);
    return transform ? transformEntity(entity, transform) : entity;
}

/**
 * Safely scales an entity, preserving native geometry where an affine scale
 * can still be represented by that entity type. Circles, arcs and regular
 * polygons become bounded polylines when X/Y scaling would otherwise turn
 * their native geometry into an ellipse or another non-native curve.
 */
export function transformEntity(entity, transform = {}, options = {}) {
    if (!entity) return entity;
    const resolved = normalizeScaleTransform(transform, undefined, options);
    if (!resolved) return entity;
    const { origin, scaleX, scaleY } = resolved;
    const point = value => transformPoint(value, resolved);
    const similarity = isSimilarityScale(scaleX, scaleY);

    if (entity.type === 'blockReference') {
        return transformDrawingBlockReference(entity, scaleAffineMatrix(scaleX, scaleY, origin));
    }

    if (entity.type === 'ellipse' || entity.type === 'spline') {
        return transformAdvancedCurveAffine(entity, scaleAffineMatrix(scaleX, scaleY, origin));
    }

    if (entity.type === 'hatch') {
        const matrix = scaleAffineMatrix(scaleX, scaleY, origin);
        return transformHatchEntity(entity, matrix, boundary => transformEntity(boundary, resolved));
    }

    if (entity.type === 'line') {
        return {
            ...entity,
            x1: point({ x: entity.x1, y: entity.y1 }).x,
            y1: point({ x: entity.x1, y: entity.y1 }).y,
            x2: point({ x: entity.x2, y: entity.y2 }).x,
            y2: point({ x: entity.x2, y: entity.y2 }).y,
        };
    }

    if (entity.type === 'circle') {
        if (similarity) {
            const center = point({ x: entity.cx, y: entity.cy });
            return { ...entity, cx: center.x, cy: center.y, r: Math.abs(Number(entity.r) || 0) * Math.abs(scaleX) };
        }
        return curveAsPolyline(entity, sampleCirclePoints(entity, resolved), point, true);
    }

    if (entity.type === 'arc') {
        if (similarity) return scaleNativeArc(entity, resolved);
        return curveAsPolyline(entity, sampleArcPoints(entity, resolved), point, Boolean(entity.fullCircle));
    }

    if (entity.type === 'polygon') {
        if (similarity) {
            const center = point({ x: entity.cx, y: entity.cy });
            const scale = Math.abs(scaleX);
            return {
                ...entity,
                cx: center.x,
                cy: center.y,
                r: Math.abs(Number(entity.r) || 0) * scale,
                rotation: normalizeAngle((Number(entity.rotation) || 0) + (scaleX * scaleY < 0 ? 0 : scaleX < 0 ? 180 : 0)),
            };
        }
        return polylineFromPoints(entity, getRegularPolygonVertices(entity).map(point), true);
    }

    if (entity.type === 'rectangle') {
        if (isNativeRectangleScale(entity, resolved)) return scaleNativeRectLike(entity, resolved);
        return polylineFromPoints(entity, getRectangleOutlinePoints(entity).map(point), true);
    }

    if (entity.type === 'image' || entity.type === 'text') return scaleRectLike(entity, resolved);

    if (entity.type === 'polyline') {
        return {
            ...entity,
            ...(Array.isArray(entity.parts)
                ? { parts: entity.parts.map(part => transformEntity(part, resolved)) }
                : { points: (entity.points || []).map(point) }),
        };
    }

    if (entity.type === 'linearDimension') return scaleLinearDimension(entity, resolved);
    if (entity.type === 'radialDimension') return scaleRadialDimension(entity, resolved);
    if (isDrawingDimensionEntity(entity)) return scaleDrawingDimension(entity, resolved);
    return entity;
}

export function translateEntity(entity, dx, dy) {
    if (entity.type === 'blockReference') {
        return transformDrawingBlockReference(entity, translationAffineMatrix(dx, dy));
    }
    if (entity.type === 'ellipse' || entity.type === 'spline') {
        return transformAdvancedCurveAffine(entity, translationAffineMatrix(dx, dy));
    }
    if (entity.type === 'hatch') {
        const matrix = translationAffineMatrix(dx, dy);
        return transformHatchEntity(entity, matrix, boundary => translateEntity(boundary, dx, dy));
    }
    if (entity.type === 'line') return { ...entity, x1: entity.x1 + dx, y1: entity.y1 + dy, x2: entity.x2 + dx, y2: entity.y2 + dy };
    if (entity.type === 'rectangle' || entity.type === 'image' || entity.type === 'text') return { ...entity, x: entity.x + dx, y: entity.y + dy };
    if (entity.type === 'circle') return { ...entity, cx: entity.cx + dx, cy: entity.cy + dy };
    if (entity.type === 'polygon' || entity.type === 'arc') return { ...entity, cx: entity.cx + dx, cy: entity.cy + dy };
    if (entity.type === 'polyline') return {
        ...entity,
        ...(Array.isArray(entity.parts)
            ? { parts: entity.parts.map(part => translateEntity(part, dx, dy)) }
            : { points: (entity.points || []).map(point => ({ x: point.x + dx, y: point.y + dy })) }),
    };
    if (isDrawingDimensionEntity(entity)) {
        return transformDimensionPointFields(entity, point => ({ x: point.x + dx, y: point.y + dy }));
    }
    return entity;
}

export function rotateEntity(entity, angleInput, origin) {
    const angleDegrees = angleInputToDegrees(angleInput);
    if (!entity || !origin || !Number.isFinite(angleDegrees)) return entity;
    if (entity.type === 'blockReference') {
        return transformDrawingBlockReference(entity, rotationAffineMatrix(angleDegrees, origin));
    }
    if (entity.type === 'ellipse' || entity.type === 'spline') {
        return transformAdvancedCurveAffine(entity, rotationAffineMatrix(angleDegrees, origin));
    }
    if (entity.type === 'hatch') {
        const matrix = rotationAffineMatrix(angleDegrees, origin);
        return transformHatchEntity(entity, matrix, boundary => rotateEntity(boundary, angleDegrees, origin));
    }
    if (entity.type === 'line') {
        const first = rotatePoint({ x: entity.x1, y: entity.y1 }, origin, angleDegrees);
        const second = rotatePoint({ x: entity.x2, y: entity.y2 }, origin, angleDegrees);
        return { ...entity, x1: first.x, y1: first.y, x2: second.x, y2: second.y };
    }
    if (entity.type === 'rectangle' || entity.type === 'image' || entity.type === 'text') {
        const center = rotatePoint(getRectEntityCenter(entity), origin, angleDegrees);
        return {
            ...entity,
            x: center.x - entity.width / 2,
            y: center.y - entity.height / 2,
            rotation: normalizeAngle((Number(entity.rotation) || 0) + angleDegrees),
        };
    }
    if (entity.type === 'circle') {
        const center = rotatePoint({ x: entity.cx, y: entity.cy }, origin, angleDegrees);
        return { ...entity, cx: center.x, cy: center.y };
    }
    if (entity.type === 'polygon') {
        const center = rotatePoint({ x: entity.cx, y: entity.cy }, origin, angleDegrees);
        return { ...entity, cx: center.x, cy: center.y, rotation: normalizeAngle((Number(entity.rotation) || 0) + angleDegrees) };
    }
    if (entity.type === 'arc') {
        const center = rotatePoint({ x: entity.cx, y: entity.cy }, origin, angleDegrees);
        const radians = angleDegrees * Math.PI / 180;
        return {
            ...entity,
            cx: center.x,
            cy: center.y,
            startAngle: normalizeRadians((Number(entity.startAngle) || 0) + radians),
            endAngle: normalizeRadians((Number(entity.endAngle) || 0) + radians),
        };
    }
    if (entity.type === 'polyline') return {
        ...entity,
        ...(Array.isArray(entity.parts)
            ? { parts: entity.parts.map(part => rotateEntity(part, angleDegrees, origin)) }
            : { points: (entity.points || []).map(point => rotatePoint(point, origin, angleDegrees)) }),
    };
    if (isDrawingDimensionEntity(entity)) {
        const radians = angleDegrees * Math.PI / 180;
        const rotated = transformDimensionPointFields(entity, point => rotatePoint(point, origin, angleDegrees));
        return transformDimensionAngles(rotated, angle => angle + radians);
    }
    return entity;
}

export function mirrorEntity(entity, axisFirst, axisSecond, options = {}) {
    if (!entity || !axisFirst || !axisSecond || pointDistance(axisFirst, axisSecond) <= EPSILON) return entity;
    const mirrorTextGlyphs = options.mirrorTextGlyphs ?? options.mirrorText ?? true;
    if (entity.type === 'blockReference') {
        return transformDrawingBlockReference(entity, mirrorAffineMatrix(axisFirst, axisSecond));
    }
    if (entity.type === 'ellipse' || entity.type === 'spline') {
        return transformAdvancedCurveAffine(entity, mirrorAffineMatrix(axisFirst, axisSecond));
    }
    if (entity.type === 'hatch') {
        const matrix = mirrorAffineMatrix(axisFirst, axisSecond);
        return transformHatchEntity(
            entity,
            matrix,
            boundary => mirrorEntity(boundary, axisFirst, axisSecond, options),
        );
    }
    if (entity.type === 'line') {
        const first = mirrorPoint({ x: entity.x1, y: entity.y1 }, axisFirst, axisSecond);
        const second = mirrorPoint({ x: entity.x2, y: entity.y2 }, axisFirst, axisSecond);
        return { ...entity, x1: first.x, y1: first.y, x2: second.x, y2: second.y };
    }
    if (entity.type === 'polyline') return {
        ...entity,
        ...(Array.isArray(entity.parts)
            ? { parts: entity.parts.map(part => mirrorEntity(part, axisFirst, axisSecond, options)) }
            : { points: (entity.points || []).map(point => mirrorPoint(point, axisFirst, axisSecond)) }),
    };
    if (entity.type === 'rectangle' || entity.type === 'image' || entity.type === 'text') {
        const center = mirrorPoint(getRectEntityCenter(entity), axisFirst, axisSecond);
        const axisAngle = Math.atan2(axisSecond.y - axisFirst.y, axisSecond.x - axisFirst.x) * 180 / Math.PI;
        return {
            ...entity,
            x: center.x - entity.width / 2,
            y: center.y - entity.height / 2,
            rotation: normalizeAngle(axisAngle * 2 - (Number(entity.rotation) || 0)),
            ...(entity.type === 'image' ? { mirrored: !entity.mirrored } : {}),
            ...(entity.type === 'text'
                ? { mirrored: mirrorTextGlyphs ? !entity.mirrored : Boolean(entity.mirrored) }
                : {}),
        };
    }
    if (entity.type === 'circle') {
        const center = mirrorPoint({ x: entity.cx, y: entity.cy }, axisFirst, axisSecond);
        return { ...entity, cx: center.x, cy: center.y };
    }
    if (entity.type === 'polygon') {
        const center = mirrorPoint({ x: entity.cx, y: entity.cy }, axisFirst, axisSecond);
        const axisAngle = Math.atan2(axisSecond.y - axisFirst.y, axisSecond.x - axisFirst.x) * 180 / Math.PI;
        return { ...entity, cx: center.x, cy: center.y, rotation: normalizeAngle(axisAngle * 2 - (Number(entity.rotation) || 0)) };
    }
    if (entity.type === 'arc') {
        const start = mirrorPoint(arcStartPoint(entity), axisFirst, axisSecond);
        const end = mirrorPoint(arcEndPoint(entity), axisFirst, axisSecond);
        const center = mirrorPoint({ x: entity.cx, y: entity.cy }, axisFirst, axisSecond);
        return {
            ...entity,
            cx: center.x,
            cy: center.y,
            startAngle: normalizeRadians(Math.atan2(start.y - center.y, start.x - center.x)),
            endAngle: normalizeRadians(Math.atan2(end.y - center.y, end.x - center.x)),
            counterClockwise: entity.counterClockwise === false,
        };
    }
    if (isDrawingDimensionEntity(entity)) {
        const axisAngle = Math.atan2(axisSecond.y - axisFirst.y, axisSecond.x - axisFirst.x);
        const mirrored = transformDimensionPointFields(
            entity,
            point => mirrorPoint(point, axisFirst, axisSecond),
        );
        const angled = transformDimensionAngles(mirrored, angle => axisAngle * 2 - angle);
        return {
            ...angled,
            ...(entity.type === 'linearDimension'
                ? { offset: -(Number.isFinite(entity.offset) ? entity.offset : 0.6) }
                : {}),
            ...(entity.type === 'angularDimension'
                ? { counterClockwise: entity.counterClockwise === false }
                : {}),
        };
    }
    return entity;
}

export function symmetricConstructionTransform(entityOrEntities, axisFirst, axisSecond, options = {}) {
    const source = Array.isArray(entityOrEntities) ? entityOrEntities : [entityOrEntities];
    const mirrored = source.map(entity => mirrorEntity(entity, axisFirst, axisSecond, options));
    return {
        source: Array.isArray(entityOrEntities) ? source : source[0],
        mirrored: Array.isArray(entityOrEntities) ? mirrored : mirrored[0],
        result: Array.isArray(entityOrEntities) ? mirrored : mirrored[0],
        pair: Array.isArray(entityOrEntities) ? [...source, ...mirrored] : [source[0], mirrored[0]],
        axis: { first: axisFirst, second: axisSecond },
    };
}

export const createSymmetricConstruction = symmetricConstructionTransform;

function transformHatchEntity(entity, matrix, transformBoundary) {
    return {
        ...entity,
        boundaries: getHatchBoundaryEntities(entity).map(transformBoundary),
        pattern: transformHatchPatternAffine(entity.pattern, matrix),
    };
}

function scaleNativeArc(entity, transform) {
    const center = transformPoint({ x: entity.cx, y: entity.cy }, transform);
    const start = transformPoint(arcStartPoint(entity), transform);
    const end = transformPoint(arcEndPoint(entity), transform);
    const reflected = transform.scaleX * transform.scaleY < 0;
    return {
        ...entity,
        cx: center.x,
        cy: center.y,
        r: Math.abs(Number(entity.r) || 0) * Math.abs(transform.scaleX),
        startAngle: normalizeRadians(Math.atan2(start.y - center.y, start.x - center.x)),
        endAngle: normalizeRadians(Math.atan2(end.y - center.y, end.x - center.x)),
        counterClockwise: reflected ? entity.counterClockwise === false : entity.counterClockwise !== false,
    };
}

function curveAsPolyline(entity, sourcePoints, transformPointFn, closed) {
    const { cx: _cx, cy: _cy, r: _r, startAngle: _startAngle, endAngle: _endAngle,
        counterClockwise: _counterClockwise, fullCircle: _fullCircle, ...properties } = entity;
    return {
        ...properties,
        type: 'polyline',
        points: sourcePoints.map(transformPointFn),
        closed: Boolean(closed),
    };
}

function polylineFromPoints(entity, points, closed) {
    const {
        x: _x, y: _y, width: _width, height: _height,
        cx: _cx, cy: _cy, r: _r, rotation: _rotation,
        cornerStyle: _cornerStyle, cornerValue: _cornerValue,
        sides: _sides, mode: _mode,
        ...properties
    } = entity;
    return { ...properties, type: 'polyline', points, closed: Boolean(closed) };
}

function sampleCirclePoints(entity, transform) {
    const count = boundedCurvePointCount(Math.PI * 2, entity.r, transform, 8);
    const center = { x: Number(entity.cx) || 0, y: Number(entity.cy) || 0 };
    const radius = Math.abs(Number(entity.r) || 0);
    return Array.from({ length: count }, (_, index) => ({
        x: center.x + Math.cos(index * Math.PI * 2 / count) * radius,
        y: center.y + Math.sin(index * Math.PI * 2 / count) * radius,
    }));
}

function sampleArcPoints(entity, transform) {
    const sweep = arcSweep(entity);
    if (!Number.isFinite(sweep) || Math.abs(sweep) <= EPSILON) return [arcStartPoint(entity)];
    const count = boundedCurvePointCount(Math.abs(sweep), entity.r, transform, 2);
    const start = Number(entity.startAngle) || 0;
    return Array.from({ length: count + 1 }, (_, index) => {
        const angle = start + sweep * index / count;
        const radius = Math.abs(Number(entity.r) || 0);
        return {
            x: (Number(entity.cx) || 0) + Math.cos(angle) * radius,
            y: (Number(entity.cy) || 0) + Math.sin(angle) * radius,
        };
    });
}

function boundedCurvePointCount(sweep, radius, transform, minimum) {
    const maximum = transform.maxCurvePoints;
    const angularBudget = Math.ceil(Math.abs(sweep) / (Math.PI * 2) * transform.curveSegments);
    const geometricBudget = Math.ceil(Math.abs(sweep) * Math.max(1, Math.abs(Number(radius) || 0)) / 0.08);
    return Math.max(minimum, Math.min(maximum, angularBudget, geometricBudget || maximum));
}

function isNativeRectangleScale(entity, transform) {
    const rotation = Number(entity.rotation) || 0;
    const styledCorners = entity.cornerStyle === 'chamfer' || entity.cornerStyle === 'fillet'
        || Number(entity.chamfer) > EPSILON || Number(entity.fillet) > EPSILON;
    if (styledCorners && !isSimilarityScale(transform.scaleX, transform.scaleY)) return false;
    return isSimilarityScale(transform.scaleX, transform.scaleY) || isAxisAlignedAngle(rotation);
}

function scaleNativeRectLike(entity, transform) {
    const center = transformPoint(getRectEntityCenter(entity), transform);
    const rotation = (Number(entity.rotation) || 0) * Math.PI / 180;
    const widthVector = { x: Math.cos(rotation) * Math.abs(Number(entity.width) || 0), y: Math.sin(rotation) * Math.abs(Number(entity.width) || 0) };
    const heightVector = { x: -Math.sin(rotation) * Math.abs(Number(entity.height) || 0), y: Math.cos(rotation) * Math.abs(Number(entity.height) || 0) };
    const transformedWidthVector = { x: widthVector.x * transform.scaleX, y: widthVector.y * transform.scaleY };
    const transformedHeightVector = { x: heightVector.x * transform.scaleX, y: heightVector.y * transform.scaleY };
    const width = Math.hypot(transformedWidthVector.x, transformedWidthVector.y);
    const height = Math.hypot(transformedHeightVector.x, transformedHeightVector.y);
    const nextRotation = width > EPSILON
        ? Math.atan2(transformedWidthVector.y, transformedWidthVector.x) * 180 / Math.PI
        : Number(entity.rotation) || 0;
    const thicknessScale = scaleThickness(transform);
    return {
        ...entity,
        x: center.x - width / 2,
        y: center.y - height / 2,
        width,
        height,
        rotation: normalizeAngle(nextRotation),
        ...(entity.cornerValue ? { cornerValue: Math.abs(entity.cornerValue) * (isSimilarityScale(transform.scaleX, transform.scaleY) ? Math.abs(transform.scaleX) : 1) } : {}),
        ...(entity.lineWidth ? { lineWidth: Math.abs(entity.lineWidth) * thicknessScale } : {}),
        ...(entity.type === 'text' ? {
            fontSize: Math.abs(Number(entity.fontSize) || 0.35) * transformedVectorLength({ x: -Math.sin(rotation), y: Math.cos(rotation) }, transform.scaleX, transform.scaleY),
            ...(transform.scaleX * transform.scaleY < 0 ? { mirrored: !entity.mirrored } : {}),
        } : {}),
        ...(entity.type === 'image' && transform.scaleX * transform.scaleY < 0 ? { mirrored: !entity.mirrored } : {}),
    };
}

function scaleRectLike(entity, transform) {
    const sourceCorners = getRectEntityCorners(entity);
    const corners = sourceCorners.map(point => transformPoint(point, transform));
    const bounds = boundsFromPoints(corners);
    const rotation = Number(entity.rotation) || 0;
    const verticalScale = transformedVectorLength(
        { x: -Math.sin(rotation * Math.PI / 180), y: Math.cos(rotation * Math.PI / 180) },
        transform.scaleX,
        transform.scaleY,
    );
    return {
        ...entity,
        x: bounds.minX,
        y: bounds.minY,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
        rotation: 0,
        ...(entity.lineWidth ? { lineWidth: Math.abs(entity.lineWidth) * scaleThickness(transform) } : {}),
        ...(entity.type === 'text' ? {
            fontSize: Math.abs(Number(entity.fontSize) || 0.35) * verticalScale,
            ...(transform.scaleX * transform.scaleY < 0 ? { mirrored: !entity.mirrored } : {}),
        } : {}),
        ...(entity.type === 'image' && transform.scaleX * transform.scaleY < 0 ? { mirrored: !entity.mirrored } : {}),
    };
}

function scaleLinearDimension(entity, transform) {
    const next = transformDimensionPointFields(entity, point => transformPoint(point, transform));
    if (entity.p1 && entity.p2 && isFinitePoint(entity.p1) && isFinitePoint(entity.p2)) {
        const first = transformPoint(entity.p1, transform);
        const second = transformPoint(entity.p2, transform);
        const dx = entity.p2.x - entity.p1.x;
        const dy = entity.p2.y - entity.p1.y;
        const length = Math.hypot(dx, dy);
        if (length > EPSILON) {
            const offset = Number.isFinite(Number(entity.offset)) ? Number(entity.offset) : 0.6;
            const normal = { x: -dy / length, y: dx / length };
            const offsetPoint = transformPoint({ x: entity.p1.x + normal.x * offset, y: entity.p1.y + normal.y * offset }, transform);
            const transformedLength = Math.hypot(second.x - first.x, second.y - first.y);
            next.offset = transformedLength > EPSILON
                ? ((second.x - first.x) * (offsetPoint.y - first.y) - (second.y - first.y) * (offsetPoint.x - first.x)) / transformedLength
                : offset;
        }
    } else if (Number.isFinite(Number(entity.offset))) {
        next.offset = Number(entity.offset) * scaleThickness(transform);
    }
    scaleDimensionDistanceFields(next, entity, transform, ['radius', 'jogSize', 'size', 'extension', 'textSize']);
    return transformDimensionAnglesForScale(next, transform);
}

function scaleRadialDimension(entity, transform) {
    const next = transformDimensionPointFields(entity, point => transformPoint(point, transform));
    scaleDimensionDistanceFields(next, entity, transform, ['jogSize', 'textSize']);
    const angled = transformDimensionAnglesForScale(next, transform);
    return {
        ...angled,
        ...(Number.isFinite(Number(entity.leaderScale))
            ? { leaderScale: Number(entity.leaderScale) * scaleThickness(transform) }
            : {}),
    };
}

function scaleDrawingDimension(entity, transform) {
    const next = transformDimensionPointFields(entity, point => transformPoint(point, transform));
    scaleDimensionDistanceFields(next, entity, transform, [
        'offset', 'radius', 'jogSize', 'size', 'extension', 'textSize',
    ]);
    const angled = transformDimensionAnglesForScale(next, transform);
    if (entity.type === 'angularDimension' && transform.scaleX * transform.scaleY < 0) {
        angled.counterClockwise = entity.counterClockwise === false;
    }
    return angled;
}

function transformDimensionPointFields(entity, transformPointFn) {
    const next = { ...entity };
    [
        'p1',
        'p2',
        'linePoint',
        'vertex',
        'ray1Point',
        'ray2Point',
        'jogCenter',
        'jogPoint',
        'origin',
        'featurePoint',
        'leaderPoint',
    ].forEach(property => {
        if (isFinitePoint(entity[property])) next[property] = transformPointFn(entity[property]);
    });
    if (Array.isArray(entity.sourcePickPoints)) {
        next.sourcePickPoints = entity.sourcePickPoints.map(point => (
            isFinitePoint(point) ? transformPointFn(point) : point
        ));
    }
    return next;
}

function transformDimensionAngles(entity, transformAngle) {
    const next = { ...entity };
    ['angle', 'dimensionAngle'].forEach(property => {
        if (Number.isFinite(Number(entity[property]))) next[property] = transformAngle(Number(entity[property]));
    });
    return next;
}

function transformDimensionAnglesForScale(entity, transform) {
    return transformDimensionAngles(entity, angle => {
        const direction = transformPoint({ x: Math.cos(angle), y: Math.sin(angle) }, {
            origin: { x: 0, y: 0 },
            scaleX: transform.scaleX,
            scaleY: transform.scaleY,
        });
        return Math.atan2(direction.y, direction.x);
    });
}

function scaleDimensionDistanceFields(next, source, transform, properties) {
    const factor = scaleThickness(transform);
    properties.forEach(property => {
        if (Number.isFinite(Number(source[property]))) next[property] = Number(source[property]) * factor;
    });
}

function scaleThickness(transform) {
    return Math.sqrt(Math.abs(transform.scaleX * transform.scaleY));
}

function boundsFromPoints(points) {
    return points.reduce((bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxX: Math.max(bounds.maxX, point.x),
        maxY: Math.max(bounds.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function isAxisAlignedAngle(angle) {
    const normalized = ((Number(angle) || 0) % 90 + 90) % 90;
    return normalized <= EPSILON || 90 - normalized <= EPSILON;
}

function isFinitePoint(point) {
    return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
}

function normalizeCurvePointLimit(value) {
    return Math.max(4, Math.min(512, Math.round(Number(value) || DEFAULT_TRANSFORM_OPTIONS.maxCurvePoints)));
}

function angleInputToDegrees(input) {
    if (Number.isFinite(Number(input))) return Number(input);
    if (!input || typeof input !== 'object') return NaN;
    if (Number.isFinite(Number(input.degrees))) return Number(input.degrees);
    const value = Number(input.value ?? input.angle);
    if (!Number.isFinite(value)) return NaN;
    const unit = String(input.unit || 'degrees').toLowerCase();
    const radians = unit.startsWith('rad') ? value : unit.startsWith('grad') || unit === 'gon'
        ? value * Math.PI / 200
        : value * Math.PI / 180;
    const directed = String(input.direction || '').toLowerCase().startsWith('clock') ? -radians : radians;
    return directed * 180 / Math.PI;
}

function normalizeAngle(angle) {
    const normalized = angle % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}
