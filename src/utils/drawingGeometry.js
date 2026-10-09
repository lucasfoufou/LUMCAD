import { drawingPointBounds } from './drawingPoints.js';
import { drawingWorldToUcs, drawingUcsToWorld } from './drawingCoordinates.js';
import { isDrawingLayerVisible } from './drawingLayers.js';
import { getDrawingBlockReferenceBounds } from './drawingBlocks.js';
import { isDrawingObjectHidden } from './drawingObjectVisibility.js';
import { drawingDimensionPresentationPoints } from './drawingDimensionPresentation.js';
import { drawingSnapEntityEntries } from './drawingBlockSnapping.js';
import { createDrawingIndexCache, createDrawingSpatialIndex } from './drawingSpatialIndex.js';
import { getImageClipPoints } from './drawingImageClip.js';
const EPSILON = 1e-9;
const MAX_OFFSET_POLYLINE_POINTS = 4096;
const MAX_OFFSET_INTERSECTION_CHECKS = 250_000;
const MAX_OFFSET_COORDINATE = 1e12;
const MAX_OFFSET_MITER_RATIO = 1_000;
const CSS_MILLIMETRES_PER_PIXEL = 25.4 / 96;
const MAX_SNAP_INTERSECTION_ENTITIES = 256;
const MAX_SNAP_INTERSECTION_CHECKS = 16_384;
const MAX_SNAP_INTERSECTION_CANDIDATES = 2_048;

import { ellipseOffsetThroughParameters, offsetEllipseEntity } from './drawingEllipseOffset.js';
import { isConstructionLine, intersectConstructionLine } from './drawingConstructionLines.js';
import {
    arcContainsAngle,
    arcEndPoint,
    arcMidpoint,
    arcPoint,
    arcStartPoint,
    arcSweep,
    circleFromThreePoints,
    createArcFromStartCenterEnd,
    createArcFromStartEndRadius,
    createArcFromThreePoints,
    createTangentCircle,
    findTangentCircleCandidates,
    findThreeEntityTangentCircles,
    findThreeLineTangentCircles,
    getArcBounds,
    getArcPath,
    getArcPoints,
    getCircleViewportGeometry,
    getRectangleOutlinePath,
    getRectangleOutlinePoints,
    getRegularPolygonApothem,
    getRegularPolygonVertexRadius,
    getRegularPolygonVertices,
    isFiniteBoundedCircle,
    normalizePolygonMode,
    normalizePolygonSides,
    pointAngle,
    tangentRadiusAtPoint,
} from './drawingCurves.js';
import {
    getEntitySegments,
    getRectEntityCenter,
    getRectEntityCorners,
    pointDistance,
    rotatePoint,
    segmentsIntersect,
} from './drawingPrimitives.js';
import { baseSnapCandidates, nearestSnapCandidate } from './drawingSnapGeometry.js';
import { getAdvancedEntityBounds, getHatchBoundaryEntities } from './drawingAdvancedEntities.js';
import { extractEntityPaths, intersectPaths } from './drawingCurveKernel.js';
import {
    formatDrawingLength,
    getDimensionGeometry,
    isDrawingDimensionEntity,
} from './drawingDimensions.js';

export {
    getEntitySegments,
    getRectEntityCenter,
    getRectEntityCorners,
    mirrorEntity,
    mirrorPoint,
    pointDistance,
    rotateEntity,
    rotatePoint,
    scaleEntity,
    segmentsIntersect,
    translateEntity,
} from './drawingPrimitives.js';

export {
    arcContainsAngle,
    arcEndPoint,
    arcMidpoint,
    arcPoint,
    arcStartPoint,
    arcSweep,
    circleFromThreePoints,
    createArcFromStartCenterEnd,
    createArcFromStartEndRadius,
    createArcFromThreePoints,
    createTangentCircle,
    findTangentCircleCandidates,
    findThreeEntityTangentCircles,
    findThreeLineTangentCircles,
    getArcBounds,
    getArcPath,
    getArcPoints,
    getCircleViewportGeometry,
    getRectangleOutlinePath,
    getRectangleOutlinePoints,
    getRegularPolygonApothem,
    getRegularPolygonVertexRadius,
    getRegularPolygonVertices,
    isFiniteBoundedCircle,
    normalizePolygonMode,
    normalizePolygonSides,
    tangentRadiusAtPoint,
} from './drawingCurves.js';

export {
    DRAWING_DIMENSION_SERIES_MODES,
    DRAWING_DIMENSION_TOLERANCE_MODES,
    DRAWING_DIMENSION_TYPES,
    DRAWING_DIMENSION_UNITS,
    DRAWING_LINEAR_DIMENSION_MODES,
    DRAWING_RADIAL_DIMENSION_MODES,
    buildBaselineDimensions,
    buildChainDimensions,
    buildContinuedDimensions,
    buildLinearDimensionSeries,
    buildQuickDimensions,
    convertDrawingLength,
    drawingEntityDependsOn,
    formatDrawingAngle,
    formatDrawingDimensionLabel,
    formatDrawingDimensionMeasurement,
    formatDrawingLength,
    getAngularDimensionGeometry,
    getArcLengthDimensionGeometry,
    getCenterMarkGeometry,
    getDimensionGeometry,
    getDrawingEntityDependencyIds,
    getLinearDimensionGeometry,
    getOrdinateDimensionGeometry,
    getRadialDimensionGeometry,
    isDrawingDimensionEntity,
    normalizeDrawingDimension,
    normalizeDrawingDimensionFormat,
    remapDrawingEntityDependencies,
} from './drawingDimensions.js';

export function getViewBoxWorldUnitsPerPixel(viewBox, viewportSize) {
    const width = Math.max(1, Number(viewportSize?.width) || 0);
    const height = Math.max(1, Number(viewportSize?.height) || 0);
    return Math.max(viewBox.width / width, viewBox.height / height);
}

export function getScreenScaleRatio(worldUnitsPerPixel) {
    const unitsPerPixel = Number(worldUnitsPerPixel);
    if (!Number.isFinite(unitsPerPixel) || unitsPerPixel <= 0) return null;
    return unitsPerPixel * 1000 / CSS_MILLIMETRES_PER_PIXEL;
}

export function getWorldUnitsPerPixelForScaleRatio(scaleRatio) {
    const ratio = Number(scaleRatio);
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    return ratio * CSS_MILLIMETRES_PER_PIXEL / 1000;
}

export function getAdaptiveGridSpacing(baseSpacing, worldUnitsPerPixel, targetPixelSpacing = 20) {
    const base = Math.max(0.0001, Number(baseSpacing) || 0.5);
    const unitsPerPixel = Math.max(Number.EPSILON, Number(worldUnitsPerPixel) || 0);
    const requiredMultiple = Math.max(1, targetPixelSpacing * unitsPerPixel / base);
    const exponent = Math.floor(Math.log10(requiredMultiple));
    const power = 10 ** exponent;
    const normalized = requiredMultiple / power;
    const niceFactor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    const multiplier = Math.max(1, Math.round(niceFactor * power));
    const minorSpacing = base * multiplier;
    return { baseSpacing: base, multiplier, minorSpacing, majorSpacing: minorSpacing * 5 };
}

export function clientPointToViewBox(point, rect, viewBox, preserveAspectRatio = 'xMidYMid meet') {
    const viewportWidth = Math.max(1, rect.width);
    const viewportHeight = Math.max(1, rect.height);
    const localX = point.clientX - rect.left;
    const localY = point.clientY - rect.top;

    if (preserveAspectRatio === 'none') {
        return {
            x: viewBox.x + localX / viewportWidth * viewBox.width,
            y: viewBox.y + localY / viewportHeight * viewBox.height,
        };
    }

    const scale = Math.min(viewportWidth / viewBox.width, viewportHeight / viewBox.height);
    const renderedWidth = viewBox.width * scale;
    const renderedHeight = viewBox.height * scale;
    const offsetX = (viewportWidth - renderedWidth) / 2;
    const offsetY = (viewportHeight - renderedHeight) / 2;
    return {
        x: viewBox.x + (localX - offsetX) / scale,
        y: viewBox.y + (localY - offsetY) / scale,
    };
}

export function resizeViewBoxForCanvas(viewBox, previousSize, nextSize) {
    if (!nextSize?.width || !nextSize?.height) return viewBox;
    const hasPreviousSize = previousSize?.width > 0 && previousSize?.height > 0;
    const unitsPerPixel = hasPreviousSize
        ? (viewBox.width / previousSize.width + viewBox.height / previousSize.height) / 2
        : getViewBoxWorldUnitsPerPixel(viewBox, nextSize);
    const width = unitsPerPixel * nextSize.width;
    const height = unitsPerPixel * nextSize.height;
    const centerX = viewBox.x + viewBox.width / 2;
    const centerY = viewBox.y + viewBox.height / 2;
    return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

export function getEntityBounds(entity, entityMap = new Map()) {
    if (entity?.type === 'point') return drawingPointBounds(entity);
    if (!entity) return null;
    if (entity.type === 'blockReference') return getDrawingBlockReferenceBounds(entity);
    if (['line', 'xline', 'ray'].includes(entity.type)) return boundsFromPoints([{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }]);
    if (entity.type === 'ellipse' || entity.type === 'spline') return getAdvancedEntityBounds(entity);
    if (['hatch', 'region'].includes(entity.type)) {
        return getHatchBoundaryEntities(entity)
            .map(boundary => getEntityBounds(boundary, entityMap))
            .filter(Boolean)
            .reduce(combineBounds, null);
    }
    if (entity.type === 'polyline') {
        if (Array.isArray(entity.parts)) {
            return entity.parts.map(part => getEntityBounds(part, entityMap)).filter(Boolean).reduce(combineBounds, null);
        }
        return boundsFromPoints(entity.points || []);
    }
    if (entity.type === 'rectangle') return boundsFromPoints(getRectangleOutlinePoints(entity));
    if (entity.type === 'polygon') return boundsFromPoints(getRegularPolygonVertices(entity));
    if (entity.type === 'arc') return isFiniteBoundedCircle(entity) ? getArcBounds(entity) : null;
    if (entity.type === 'image' || entity.type === 'text') return boundsFromPoints(entity.type === 'image'
        ? getImageClipPoints(entity, { world: true }) || getRectEntityCorners(entity) : getRectEntityCorners(entity));
    if (entity.type === 'circle') {
        if (!isFiniteBoundedCircle(entity)) return null;
        const radius = Math.abs(Number(entity.r) || 0);
        return normalizeBounds(entity.cx - radius, entity.cy - radius, entity.cx + radius, entity.cy + radius);
    }
    if (isDrawingDimensionEntity(entity)) {
        const geometry = getDimensionGeometry(entity, entityMap);
        return geometry ? boundsFromPoints(drawingDimensionPresentationPoints(geometry, entity)) : null;
    }
    return null;
}

function normalizeBounds(x1, y1, x2, y2) {
    return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
}

function boundsFromPoints(points) {
    if (!points?.length) return null;
    return points.reduce((bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxX: Math.max(bounds.maxX, point.x),
        maxY: Math.max(bounds.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function combineBounds(combined, bounds) {
    if (!combined) return { ...bounds };
    return {
        minX: Math.min(combined.minX, bounds.minX),
        minY: Math.min(combined.minY, bounds.minY),
        maxX: Math.max(combined.maxX, bounds.maxX),
        maxY: Math.max(combined.maxY, bounds.maxY),
    };
}

export function getDrawingBounds(content, { printableOnly = false } = {}) {
    const layers = new Map(content.layers.map(layer => [layer.id, layer]));
    const entityMap = new Map(content.entities.map(entity => [entity.id, entity]));
    const bounds = content.entities.reduce((combined, entity) => {
        const layer = layers.get(entity.layerId);
        if (isDrawingObjectHidden(content, entity.id) || !isDrawingLayerVisible(layer) || (printableOnly && layer.plot === false) || (printableOnly && entity.type === 'image' && !entity.includeInPdf)) return combined;
        const current = getEntityBounds(entity, entityMap);
        if (!current) return combined;
        if (!combined) return current;
        return {
            minX: Math.min(combined.minX, current.minX),
            minY: Math.min(combined.minY, current.minY),
            maxX: Math.max(combined.maxX, current.maxX),
            maxY: Math.max(combined.maxY, current.maxY),
        };
    }, null);
    return bounds || { minX: -5, minY: -3, maxX: 25, maxY: 17 };
}

export function fitViewBox(content, aspectRatio = 16 / 9, marginRatio = 0.12) {
    return fitDrawingBounds(getDrawingBounds(content), aspectRatio, marginRatio);
}

export function fitDrawingBounds(bounds, aspectRatio = 16 / 9, marginRatio = 0.12) {
    let width = Math.max(1, bounds.maxX - bounds.minX) * (1 + marginRatio * 2);
    let height = Math.max(1, bounds.maxY - bounds.minY) * (1 + marginRatio * 2);
    if (width / height > aspectRatio) height = width / aspectRatio;
    else width = height * aspectRatio;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

export function offsetEntity(entity, distance) {
    if (entity?.type === 'ellipse') return offsetEllipseEntity(entity, Number(distance));
    const signedDistance = Number(distance);
    if (!entity || !Number.isFinite(signedDistance) || Math.abs(signedDistance) > MAX_OFFSET_COORDINATE) return null;

    if (['line', 'xline', 'ray'].includes(entity.type)) {
        const first = finitePointFromEntity(entity, 'x1', 'y1');
        const second = finitePointFromEntity(entity, 'x2', 'y2');
        if (!first || !second) return null;
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const length = Math.hypot(dx, dy);
        if (length < EPSILON) return null;
        const ox = -dy / length * signedDistance;
        const oy = dx / length * signedDistance;
        const result = { ...entity, x1: first.x + ox, y1: first.y + oy, x2: second.x + ox, y2: second.y + oy };
        return finitePointFromEntity(result, 'x1', 'y1') && finitePointFromEntity(result, 'x2', 'y2') ? result : null;
    }
    if (entity.type === 'rectangle') {
        const geometry = getOffsetRectangleGeometry(entity);
        if (!geometry) return null;
        const width = geometry.bounds.maxX - geometry.bounds.minX + 2 * signedDistance;
        const height = geometry.bounds.maxY - geometry.bounds.minY + 2 * signedDistance;
        if (width <= EPSILON || height <= EPSILON) return null;
        const result = {
            ...entity,
            x: geometry.center.x - width / 2,
            y: geometry.center.y - height / 2,
            width,
            height,
            ...(geometry.cornerValue > EPSILON ? {
                cornerValue: Math.max(0, Math.min(geometry.cornerValue + signedDistance, Math.min(width, height) / 2)),
            } : {}),
        };
        return Number.isFinite(result.x) && Number.isFinite(result.y)
            && Number.isFinite(result.width) && Number.isFinite(result.height)
            ? result
            : null;
    }
    if (entity.type === 'circle') {
        const geometry = getOffsetCircleGeometry(entity);
        if (!geometry) return null;
        const radius = geometry.radius + signedDistance;
        if (radius <= EPSILON) return null;
        return Number.isFinite(radius) ? { ...entity, r: radius } : null;
    }
    if (entity.type === 'polygon') {
        const geometry = getOffsetPolygonGeometry(entity);
        if (!geometry) return null;
        const nextApothem = geometry.apothem + signedDistance;
        if (nextApothem <= EPSILON) return null;
        const radius = entity.mode === 'circumscribed'
            ? nextApothem
            : nextApothem / Math.max(EPSILON, Math.cos(Math.PI / geometry.sides));
        return Number.isFinite(radius) ? { ...entity, r: radius } : null;
    }
    if (entity.type === 'arc') {
        const geometry = getOffsetArcGeometry(entity);
        if (!geometry) return null;
        const radius = geometry.radius + signedDistance;
        if (radius <= EPSILON) return null;
        return Number.isFinite(radius) ? { ...entity, r: radius } : null;
    }
    if (entity.type === 'polyline') return offsetPolylineEntity(entity, signedDistance);
    return null;
}

/**
 * Derives the THROUGH-mode offset from a designated point.
 *
 * `distance` is always a positive perpendicular/radial distance. `side` is
 * the signed direction accepted by `offsetEntity`: +1 is the left side of a
 * line/polyline, or the outward side of a closed region/circle/arc; -1 is the
 * opposite side. The helper rejects points on the source, corner-ambiguous
 * points, and offsets that would collapse or self-intersect.
 */
export function getOffsetThroughParameters(entity, point) {
    if (!entity || !isFinitePoint(point)) return null;

    let parameters = null;
    if (entity.type === 'ellipse') parameters = ellipseOffsetThroughParameters(entity, point);
    if (['line', 'xline', 'ray'].includes(entity.type)) parameters = throughLineParameters(entity, point);
    if (entity.type === 'rectangle') parameters = throughRectangleParameters(entity, point);
    if (entity.type === 'polygon') parameters = throughPolygonParameters(entity, point);
    if (entity.type === 'circle') parameters = throughCircleParameters(entity, point);
    if (entity.type === 'arc') parameters = throughArcParameters(entity, point);
    if (entity.type === 'polyline') parameters = throughPolylineParameters(entity, point);
    if (!parameters || !Number.isFinite(parameters.distance) || parameters.distance <= EPSILON) return null;

    return offsetEntity(entity, parameters.distance * parameters.side) ? parameters : null;
}

/**
 * Builds an offset on the side designated by a point.
 * The distance is always treated as a magnitude; the point supplies the sign.
 */
export function offsetEntityTowardPoint(entity, distance, point) {
    if (entity?.type === 'ellipse') {
        const parameters = ellipseOffsetThroughParameters(entity, point, { requireNormal: false });
        return parameters ? offsetEllipseEntity(entity, Math.abs(Number(distance)) * parameters.side) : null;
    }
    const magnitude = Math.abs(Number(distance));
    if (!entity || !isFinitePoint(point) || !Number.isFinite(magnitude)
        || magnitude <= EPSILON || magnitude > MAX_OFFSET_COORDINATE) return null;

    if (['line', 'xline', 'ray'].includes(entity.type)) {
        const first = finitePointFromEntity(entity, 'x1', 'y1');
        const second = finitePointFromEntity(entity, 'x2', 'y2');
        if (!first || !second) return null;
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const length = Math.hypot(dx, dy);
        if (length <= EPSILON) return null;
        const signedSideDistance = (dx * (point.y - first.y) - dy * (point.x - first.x)) / length;
        if (Math.abs(signedSideDistance) <= EPSILON) return null;
        return offsetEntity(entity, signedSideDistance > 0 ? magnitude : -magnitude);
    }

    if (entity.type === 'rectangle') {
        const geometry = getOffsetRectangleGeometry(entity);
        if (!geometry) return null;
        const localPoint = rotatePoint(point, geometry.center, -geometry.rotation);
        const inside = localPoint.x > geometry.bounds.minX + EPSILON && localPoint.x < geometry.bounds.maxX - EPSILON
            && localPoint.y > geometry.bounds.minY + EPSILON && localPoint.y < geometry.bounds.maxY - EPSILON;
        const onBoundary = localPoint.x >= geometry.bounds.minX - EPSILON && localPoint.x <= geometry.bounds.maxX + EPSILON
            && localPoint.y >= geometry.bounds.minY - EPSILON && localPoint.y <= geometry.bounds.maxY + EPSILON
            && (Math.abs(localPoint.x - geometry.bounds.minX) <= EPSILON || Math.abs(localPoint.x - geometry.bounds.maxX) <= EPSILON
                || Math.abs(localPoint.y - geometry.bounds.minY) <= EPSILON || Math.abs(localPoint.y - geometry.bounds.maxY) <= EPSILON);
        if (onBoundary) return null;
        return offsetEntity(entity, inside ? -magnitude : magnitude);
    }

    if (entity.type === 'circle') {
        const geometry = getOffsetCircleGeometry(entity);
        if (!geometry) return null;
        const delta = pointDistance(point, geometry.center) - geometry.radius;
        if (Math.abs(delta) <= EPSILON) return null;
        return offsetEntity(entity, delta < 0 ? -magnitude : magnitude);
    }

    if (entity.type === 'polygon') {
        const geometry = getOffsetPolygonGeometry(entity);
        if (!geometry) return null;
        const vertices = getRegularPolygonVertices({ ...entity, cx: geometry.center.x, cy: geometry.center.y, r: geometry.radius });
        if (vertices.some((first, index) => (
            pointToSegmentDistance(point, first, vertices[(index + 1) % vertices.length]) <= EPSILON
        ))) return null;
        return offsetEntity(entity, pointIsInsidePolygon(point, vertices) ? -magnitude : magnitude);
    }

    if (entity.type === 'arc') {
        const geometry = getOffsetArcGeometry(entity);
        if (!geometry) return null;
        const delta = pointDistance(point, geometry.center) - geometry.radius;
        if (Math.abs(delta) <= EPSILON) return null;
        return offsetEntity(entity, delta < 0 ? -magnitude : magnitude);
    }

    if (entity.type === 'polyline') {
        const side = polylineSideForPoint(entity, point);
        return side ? offsetEntity(entity, magnitude * side) : null;
    }

    return null;
}

function isFiniteOffsetCoordinate(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && Math.abs(numeric) <= MAX_OFFSET_COORDINATE;
}

function isFinitePoint(point) {
    return Boolean(point) && isFiniteOffsetCoordinate(point.x) && isFiniteOffsetCoordinate(point.y);
}

function finitePointFromEntity(entity, xKey, yKey) {
    const point = { x: Number(entity?.[xKey]), y: Number(entity?.[yKey]) };
    return isFinitePoint(point) ? point : null;
}

function getOffsetRectangleGeometry(entity) {
    const x = Number(entity?.x);
    const y = Number(entity?.y);
    const width = Number(entity?.width);
    const height = Number(entity?.height);
    const rotation = entity?.rotation === undefined || entity?.rotation === null ? 0 : Number(entity.rotation);
    const cornerValue = entity?.cornerValue === undefined || entity?.cornerValue === null
        ? 0
        : Number(entity.cornerValue);
    if (![x, y, width, height, rotation, cornerValue].every(isFiniteOffsetCoordinate)
        || width === 0 || height === 0 || cornerValue < 0) return null;
    const bounds = normalizeBounds(x, y, x + width, y + height);
    const result = {
        bounds,
        center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
        rotation,
        cornerValue,
    };
    return isFinitePoint(result.center) ? result : null;
}

function getOffsetCircleGeometry(entity) {
    const cx = Number(entity?.cx);
    const cy = Number(entity?.cy);
    const radius = Math.abs(Number(entity?.r));
    if (![cx, cy, radius].every(isFiniteOffsetCoordinate) || radius <= EPSILON) return null;
    return { center: { x: cx, y: cy }, radius };
}

function getOffsetPolygonGeometry(entity) {
    const cx = Number(entity?.cx);
    const cy = Number(entity?.cy);
    const radius = Math.abs(Number(entity?.r));
    const rotation = entity?.rotation === undefined || entity?.rotation === null ? 0 : Number(entity.rotation);
    if (![cx, cy, radius, rotation].every(isFiniteOffsetCoordinate) || radius <= EPSILON) return null;
    const sides = normalizePolygonSides(entity.sides);
    const normalized = { ...entity, cx, cy, r: radius, rotation };
    const apothem = getRegularPolygonApothem(normalized);
    if (!Number.isFinite(apothem) || apothem <= EPSILON) return null;
    return { center: { x: cx, y: cy }, radius, rotation, sides, apothem };
}

function getOffsetArcGeometry(entity) {
    const cx = Number(entity?.cx);
    const cy = Number(entity?.cy);
    const radius = Math.abs(Number(entity?.r));
    const startAngle = entity?.startAngle === undefined || entity?.startAngle === null ? 0 : Number(entity.startAngle);
    const endAngle = entity?.endAngle === undefined || entity?.endAngle === null ? 0 : Number(entity.endAngle);
    if (![cx, cy, radius, startAngle, endAngle].every(isFiniteOffsetCoordinate) || radius <= EPSILON) return null;
    return { center: { x: cx, y: cy }, radius, startAngle, endAngle };
}

function normalizeOffsetPolyline(entity) {
    if (!entity || !Array.isArray(entity.points) || Array.isArray(entity.parts)
        || entity.points.length < 2 || entity.points.length > MAX_OFFSET_POLYLINE_POINTS) return null;
    const closed = Boolean(entity.closed);
    const points = [];
    for (let index = 0; index < entity.points.length; index += 1) {
        const point = entity.points[index];
        if (!isFinitePoint(point)) return null;
        const normalized = { x: Number(point.x), y: Number(point.y) };
        const isTrailingClosedDuplicate = closed
            && index === entity.points.length - 1
            && points.length >= 3
            && pointDistance(normalized, points[0]) <= EPSILON;
        if (isTrailingClosedDuplicate) continue;
        if (points.length && pointDistance(normalized, points[points.length - 1]) <= EPSILON) return null;
        points.push(normalized);
    }
    if ((closed && points.length < 3) || (!closed && points.length < 2)) return null;
    if (closed && pointDistance(points[0], points[points.length - 1]) <= EPSILON) return null;
    return { points, closed };
}

function offsetPolylineEntity(entity, distance) {
    const normalized = normalizeOffsetPolyline(entity);
    if (!normalized || polylineHasUnsafeIntersections(normalized.points, normalized.closed)) return null;
    const { points, closed } = normalized;
    const segmentCount = closed ? points.length : points.length - 1;
    if (segmentCount < 1 || segmentCount > MAX_OFFSET_POLYLINE_POINTS) return null;

    const segments = [];
    for (let index = 0; index < segmentCount; index += 1) {
        const first = points[index];
        const second = points[(index + 1) % points.length];
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length <= EPSILON) return null;
        const normal = { x: -dy / length * distance, y: dx / length * distance };
        const shiftedFirst = { x: first.x + normal.x, y: first.y + normal.y };
        const shiftedSecond = { x: second.x + normal.x, y: second.y + normal.y };
        if (!isFinitePoint(shiftedFirst) || !isFinitePoint(shiftedSecond)) return null;
        segments.push({
            first: shiftedFirst,
            second: shiftedSecond,
            direction: { x: dx / length, y: dy / length },
        });
    }

    const miterLimit = offsetPolylineMiterLimit(points, distance);
    const output = [];
    if (closed) {
        for (let index = 0; index < points.length; index += 1) {
            const previous = segments[(index + segmentCount - 1) % segmentCount];
            const next = segments[index];
            const joined = joinOffsetSegments(previous, next, points[index], miterLimit);
            if (!joined) return null;
            output.push(joined);
        }
    } else {
        output.push(segments[0].first);
        for (let index = 1; index < points.length - 1; index += 1) {
            const joined = joinOffsetSegments(segments[index - 1], segments[index], points[index], miterLimit);
            if (!joined) return null;
            output.push(joined);
        }
        output.push(segments[segmentCount - 1].second);
    }

    if (output.length > MAX_OFFSET_POLYLINE_POINTS || !validOffsetPolylineOutput(output, closed)) return null;
    return { ...entity, points: output };
}

function offsetPolylineMiterLimit(points, distance) {
    const bounds = points.reduce((result, point) => ({
        minX: Math.min(result.minX, point.x),
        minY: Math.min(result.minY, point.y),
        maxX: Math.max(result.maxX, point.x),
        maxY: Math.max(result.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const extent = Math.max(
        1,
        Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY),
        Math.abs(distance),
    );
    return Math.min(MAX_OFFSET_COORDINATE, extent * MAX_OFFSET_MITER_RATIO);
}

function joinOffsetSegments(previous, next, vertex, miterLimit) {
    const firstDirection = {
        x: previous.second.x - previous.first.x,
        y: previous.second.y - previous.first.y,
    };
    const secondDirection = {
        x: next.second.x - next.first.x,
        y: next.second.y - next.first.y,
    };
    const denominator = firstDirection.x * secondDirection.y - firstDirection.y * secondDirection.x;
    if (Math.abs(denominator) <= EPSILON) {
        const directionDot = previous.direction.x * next.direction.x + previous.direction.y * next.direction.y;
        if (directionDot <= EPSILON) return null;
        const straight = {
            x: (previous.second.x + next.first.x) / 2,
            y: (previous.second.y + next.first.y) / 2,
        };
        return isFinitePoint(straight) && pointDistance(straight, vertex) <= miterLimit ? straight : null;
    }

    const delta = { x: next.first.x - previous.first.x, y: next.first.y - previous.first.y };
    const parameter = (delta.x * secondDirection.y - delta.y * secondDirection.x) / denominator;
    if (!Number.isFinite(parameter)) return null;
    const intersection = {
        x: previous.first.x + parameter * firstDirection.x,
        y: previous.first.y + parameter * firstDirection.y,
    };
    return isFinitePoint(intersection) && pointDistance(intersection, vertex) <= miterLimit ? intersection : null;
}

function validOffsetPolylineOutput(points, closed) {
    if (!Array.isArray(points) || points.length < (closed ? 3 : 2)) return false;
    for (let index = 0; index < points.length; index += 1) {
        if (!isFinitePoint(points[index])) return false;
        const nextIndex = index + 1;
        if (nextIndex < points.length && pointDistance(points[index], points[nextIndex]) <= EPSILON) return false;
    }
    if (closed && pointDistance(points[0], points[points.length - 1]) <= EPSILON) return false;
    return !polylineHasUnsafeIntersections(points, closed);
}

function polylineHasUnsafeIntersections(points, closed) {
    const segmentCount = closed ? points.length : points.length - 1;
    let checks = 0;
    for (let firstIndex = 0; firstIndex < segmentCount; firstIndex += 1) {
        const first = [points[firstIndex], points[(firstIndex + 1) % points.length]];
        for (let secondIndex = firstIndex + 1; secondIndex < segmentCount; secondIndex += 1) {
            if (++checks > MAX_OFFSET_INTERSECTION_CHECKS) return true;
            if (polylineSegmentsAdjacent(firstIndex, secondIndex, segmentCount, closed)) continue;
            const second = [points[secondIndex], points[(secondIndex + 1) % points.length]];
            if (segmentsIntersect(first[0], first[1], second[0], second[1], EPSILON)) return true;
        }
    }
    return false;
}

function polylineSegmentsAdjacent(firstIndex, secondIndex, segmentCount, closed) {
    if (Math.abs(firstIndex - secondIndex) <= 1) return true;
    return closed && firstIndex === 0 && secondIndex === segmentCount - 1;
}

function throughLineParameters(entity, point) {
    const first = finitePointFromEntity(entity, 'x1', 'y1');
    const second = finitePointFromEntity(entity, 'x2', 'y2');
    if (!first || !second) return null;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= EPSILON) return null;
    const signed = (dx * (point.y - first.y) - dy * (point.x - first.x)) / length;
    if (!Number.isFinite(signed) || Math.abs(signed) <= EPSILON) return null;
    return { distance: Math.abs(signed), side: signed > 0 ? 1 : -1 };
}

function throughRectangleParameters(entity, point) {
    const geometry = getOffsetRectangleGeometry(entity);
    if (!geometry) return null;
    const local = rotatePoint(point, geometry.center, -geometry.rotation);
    const { minX, minY, maxX, maxY } = geometry.bounds;
    const inside = local.x > minX + EPSILON && local.x < maxX - EPSILON
        && local.y > minY + EPSILON && local.y < maxY - EPSILON;
    const candidates = [];
    const withinX = local.x >= minX - EPSILON && local.x <= maxX + EPSILON;
    const withinY = local.y >= minY - EPSILON && local.y <= maxY + EPSILON;
    if (inside || withinX) {
        candidates.push({ distance: Math.abs(local.y - minY) });
        candidates.push({ distance: Math.abs(local.y - maxY) });
    }
    if (inside || withinY) {
        candidates.push({ distance: Math.abs(local.x - minX) });
        candidates.push({ distance: Math.abs(local.x - maxX) });
    }
    const selected = chooseUniqueThroughCandidate(candidates);
    return selected ? { ...selected, side: inside ? -1 : 1 } : null;
}

function throughPolygonParameters(entity, point) {
    const geometry = getOffsetPolygonGeometry(entity);
    if (!geometry) return null;
    const vertices = getRegularPolygonVertices({ ...entity, cx: geometry.center.x, cy: geometry.center.y, r: geometry.radius });
    if (vertices.length < 3 || vertices.length > MAX_OFFSET_POLYLINE_POINTS) return null;
    const inside = pointIsInsidePolygon(point, vertices);
    const candidates = [];
    for (let index = 0; index < vertices.length; index += 1) {
        const first = vertices[index];
        const second = vertices[(index + 1) % vertices.length];
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length <= EPSILON) return null;
        const parameter = ((point.x - first.x) * dx + (point.y - first.y) * dy) / (length * length);
        const signed = (dx * (point.y - first.y) - dy * (point.x - first.x)) / length;
        if (Math.abs(signed) <= EPSILON && parameter >= -EPSILON && parameter <= 1 + EPSILON) return null;
        if (parameter >= -EPSILON && parameter <= 1 + EPSILON && Number.isFinite(signed)) {
            candidates.push({ distance: Math.abs(signed) });
        }
    }
    const selected = chooseUniqueThroughCandidate(candidates);
    return selected ? { ...selected, side: inside ? -1 : 1 } : null;
}

function throughCircleParameters(entity, point) {
    const geometry = getOffsetCircleGeometry(entity);
    if (!geometry) return null;
    const radialDistance = pointDistance(point, geometry.center);
    if (!Number.isFinite(radialDistance) || radialDistance <= EPSILON) return null;
    const signed = radialDistance - geometry.radius;
    if (Math.abs(signed) <= EPSILON) return null;
    return { distance: Math.abs(signed), side: signed > 0 ? 1 : -1 };
}

function throughArcParameters(entity, point) {
    const geometry = getOffsetArcGeometry(entity);
    if (!geometry) return null;
    const arc = { ...entity, cx: geometry.center.x, cy: geometry.center.y, r: geometry.radius };
    const radialDistance = pointDistance(point, geometry.center);
    const angle = pointAngle(geometry.center, point);
    if (!Number.isFinite(radialDistance) || radialDistance <= EPSILON
        || !Number.isFinite(angle) || Math.abs(arcSweep(arc)) <= EPSILON
        || !arcContainsAngle(arc, angle)) return null;
    const signed = radialDistance - geometry.radius;
    if (Math.abs(signed) <= EPSILON) return null;
    return { distance: Math.abs(signed), side: signed > 0 ? 1 : -1 };
}

function throughPolylineParameters(entity, point) {
    const normalized = normalizeOffsetPolyline(entity);
    if (!normalized || polylineHasUnsafeIntersections(normalized.points, normalized.closed)) return null;
    const { points, closed } = normalized;
    const segmentCount = closed ? points.length : points.length - 1;
    const candidates = [];
    for (let index = 0; index < segmentCount; index += 1) {
        const first = points[index];
        const second = points[(index + 1) % points.length];
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length <= EPSILON) return null;
        const parameter = ((point.x - first.x) * dx + (point.y - first.y) * dy) / (length * length);
        const signed = (dx * (point.y - first.y) - dy * (point.x - first.x)) / length;
        if (pointToSegmentDistance(point, first, second) <= EPSILON) return null;
        if (parameter > EPSILON && parameter < 1 - EPSILON && Math.abs(signed) > EPSILON) {
            candidates.push({ distance: Math.abs(signed), side: signed > 0 ? 1 : -1 });
        }
    }
    const selected = chooseUniqueThroughCandidate(candidates);
    return selected ? selected : null;
}

function chooseUniqueThroughCandidate(candidates) {
    const valid = candidates.filter(candidate => (
        Number.isFinite(candidate?.distance) && candidate.distance > EPSILON
    ));
    if (!valid.length) return null;
    const nearest = valid.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best, valid[0]);
    const tolerance = Math.max(EPSILON, Math.abs(nearest.distance) * 1e-9);
    const tied = valid.filter(candidate => Math.abs(candidate.distance - nearest.distance) <= tolerance);
    if (tied.length !== 1) return null;
    return {
        distance: nearest.distance,
        ...(nearest.side === undefined ? {} : { side: nearest.side }),
    };
}

function polylineSideForPoint(entity, point) {
    const normalized = normalizeOffsetPolyline(entity);
    if (!normalized || polylineHasUnsafeIntersections(normalized.points, normalized.closed)) return null;
    const { points, closed } = normalized;
    const segmentCount = closed ? points.length : points.length - 1;
    const candidates = [];
    for (let index = 0; index < segmentCount; index += 1) {
        const first = points[index];
        const second = points[(index + 1) % points.length];
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length <= EPSILON) return null;
        const distance = pointToSegmentDistance(point, first, second);
        const signed = (dx * (point.y - first.y) - dy * (point.x - first.x)) / length;
        if (!Number.isFinite(distance) || distance <= EPSILON || Math.abs(signed) <= EPSILON) return null;
        candidates.push({ distance, side: signed > 0 ? 1 : -1 });
    }
    const nearest = candidates.reduce((best, candidate) => (
        !best || candidate.distance < best.distance ? candidate : best
    ), null);
    if (!nearest) return null;
    const tolerance = Math.max(EPSILON, nearest.distance * 1e-9);
    const tied = candidates.filter(candidate => Math.abs(candidate.distance - nearest.distance) <= tolerance);
    return tied.every(candidate => candidate.side === nearest.side) ? nearest.side : null;
}

/**
 * Removes the portion of a line or rectangle perimeter designated by clickPoint.
 * Other lines, rectangle perimeters and circles can all act as cutting boundaries.
 * Returned fragments are plain line entities without ids, ready for persistence.
 */
export function trimEntityAtPoint(entity, clickPoint, boundaries = []) {
    if (!entity || !clickPoint) return { status: 'unsupported', fragments: [], removedSegments: [] };
    if (entity.type === 'circle') return { status: 'circle-unsupported', fragments: [], removedSegments: [] };
    if (entity.type === 'arc') return trimArcEntityAtPoint(entity, clickPoint, boundaries);
    if (entity.type !== 'line' && entity.type !== 'rectangle') return { status: 'unsupported', fragments: [], removedSegments: [] };

    const segments = getEntitySegments(entity);
    const targetIndex = entity.type === 'line' ? 0 : closestSegmentIndex(clickPoint, segments);
    const targetSegment = segments[targetIndex];
    const trimmed = trimSegmentAtPoint(targetSegment, clickPoint, boundaries);
    if (!trimmed) return { status: 'no-intersection', fragments: [], removedSegments: [] };

    const fragments = [];
    segments.forEach((segment, index) => {
        const remaining = index === targetIndex ? trimmed.fragments : [segment];
        remaining.forEach(([first, second]) => {
            if (pointDistance(first, second) > EPSILON) fragments.push(lineFragmentFromEntity(entity, first, second));
        });
    });
    return { status: 'trimmed', fragments, removedSegments: [trimmed.removedSegment] };
}

/** Removes a whole line, or only the closest side of a rectangle. */
export function removeUnboundedEntityPortion(entity, clickPoint) {
    if (entity?.type === 'line') return {
        status: 'removed',
        fragments: [],
        removedSegments: [[{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }]],
    };
    if (entity?.type === 'arc') return {
        status: 'removed',
        fragments: [],
        removedSegments: [[arcPoint(entity, entity.startAngle), arcPoint(entity, entity.endAngle)]],
    };
    if (entity?.type !== 'rectangle') return { status: 'unsupported', fragments: [], removedSegments: [] };
    const segments = getEntitySegments(entity);
    const targetIndex = closestSegmentIndex(clickPoint, segments);
    const fragments = segments
        .filter((_, index) => index !== targetIndex)
        .map(([first, second]) => lineFragmentFromEntity(entity, first, second));
    return { status: 'removed', fragments, removedSegments: [segments[targetIndex]] };
}

/** Returns each editable line/rectangle touched by a two-point trim fence. */
export function getTrimFenceHits(first, second, entities) {
    if (!first || !second || pointDistance(first, second) <= EPSILON) return [];
    return entities.flatMap(entity => {
        if (!['line', 'rectangle', 'arc'].includes(entity?.type)) return [];
        const intersections = getEntitySegments(entity).flatMap(([segmentFirst, segmentSecond]) => {
            const point = segmentIntersection(first, second, segmentFirst, segmentSecond);
            return point ? [point] : [];
        });
        if (!intersections.length) return [];
        return [{ entityId: entity.id, point: intersections[0] }];
    });
}

function trimSegmentAtPoint(segment, clickPoint, boundaries) {
    const [first, second] = segment;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const squaredLength = dx * dx + dy * dy;
    if (squaredLength <= EPSILON) return null;

    const intersectionParameters = boundaries
        .flatMap(boundary => segmentBoundaryIntersections(first, second, boundary))
        .map(point => ((point.x - first.x) * dx + (point.y - first.y) * dy) / squaredLength)
        .filter(value => value > EPSILON && value < 1 - EPSILON)
        .sort((left, right) => left - right)
        .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > EPSILON);
    if (!intersectionParameters.length) return null;

    const clickParameter = Math.max(0, Math.min(1, ((clickPoint.x - first.x) * dx + (clickPoint.y - first.y) * dy) / squaredLength));
    if (intersectionParameters.some(value => Math.abs(value - clickParameter) <= EPSILON)) return null;
    const left = [...intersectionParameters].reverse().find(value => value < clickParameter - EPSILON) ?? 0;
    const right = intersectionParameters.find(value => value > clickParameter + EPSILON) ?? 1;
    const pointAt = parameter => ({ x: first.x + dx * parameter, y: first.y + dy * parameter });
    const fragments = [];
    if (left > EPSILON) fragments.push([first, pointAt(left)]);
    if (right < 1 - EPSILON) fragments.push([pointAt(right), second]);
    return {
        fragments,
        removedSegment: [pointAt(left), pointAt(right)],
    };
}

function trimArcEntityAtPoint(entity, clickPoint, boundaries) {
    const sweep = arcSweep(entity);
    if (Math.abs(sweep) <= EPSILON || Math.abs(Number(entity.r) || 0) <= EPSILON) {
        return { status: 'unsupported', fragments: [], removedSegments: [] };
    }
    const intersections = boundaries
        .flatMap(boundary => arcBoundaryIntersections(entity, boundary))
        .map(point => arcParameter(entity, point))
        .filter(parameter => parameter > EPSILON && parameter < 1 - EPSILON)
        .sort((left, right) => left - right)
        .filter((parameter, index, values) => index === 0 || Math.abs(parameter - values[index - 1]) > EPSILON);
    if (!intersections.length) return { status: 'no-intersection', fragments: [], removedSegments: [] };

    const clickParameter = arcParameter(entity, clickPoint);
    if (intersections.some(parameter => Math.abs(parameter - clickParameter) <= EPSILON)) {
        return { status: 'no-intersection', fragments: [], removedSegments: [] };
    }
    const left = [...intersections].reverse().find(parameter => parameter < clickParameter - EPSILON) ?? 0;
    const right = intersections.find(parameter => parameter > clickParameter + EPSILON) ?? 1;
    const angleAt = parameter => (Number(entity.startAngle) || 0) + sweep * parameter;
    const fragments = [];
    if (left > EPSILON) fragments.push({
        ...entity,
        startAngle: angleAt(0),
        endAngle: angleAt(left),
    });
    if (right < 1 - EPSILON) fragments.push({
        ...entity,
        startAngle: angleAt(right),
        endAngle: angleAt(1),
    });
    return {
        status: 'trimmed',
        fragments,
        removedSegments: [[arcPoint(entity, angleAt(left)), arcPoint(entity, angleAt(right))]],
    };
}

function arcParameter(entity, point) {
    if (!point) return 0;
    const angle = pointAngle({ x: entity.cx, y: entity.cy }, point);
    const sweep = arcSweep(entity);
    if (!sweep) return 0;
    const delta = sweep > 0
        ? ((angle - entity.startAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
        : ((entity.startAngle - angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    return Math.max(0, Math.min(1, delta / Math.abs(sweep)));
}

function arcBoundaryIntersections(arc, boundary) {
    if (!boundary) return [];
    const points = boundary.type === 'circle' || boundary.type === 'arc'
        ? circleCircleIntersections(
            { cx: arc.cx, cy: arc.cy, r: Math.abs(arc.r) },
            { cx: boundary.cx, cy: boundary.cy, r: Math.abs(boundary.r) },
        )
        : getEntitySegments(boundary).flatMap(([first, second]) => segmentCircleIntersections(first, second, arc));
    return points.filter(point => (
        arcContainsAngle(arc, pointAngle({ x: arc.cx, y: arc.cy }, point))
        && (boundary.type !== 'arc' || arcContainsAngle(boundary, pointAngle({ x: boundary.cx, y: boundary.cy }, point)))
    ));
}

function segmentBoundaryIntersections(first, second, boundary) {
    if (!boundary) return [];
    if (boundary.type === 'circle') return segmentCircleIntersections(first, second, boundary);
    return getEntitySegments(boundary).flatMap(([boundaryFirst, boundarySecond]) => {
        const point = segmentIntersection(first, second, boundaryFirst, boundarySecond);
        return point ? [point] : [];
    });
}

function closestSegmentIndex(point, segments) {
    return segments.reduce((bestIndex, segment, index) => (
        pointToSegmentDistance(point, segment[0], segment[1]) < pointToSegmentDistance(point, segments[bestIndex][0], segments[bestIndex][1])
            ? index
            : bestIndex
    ), 0);
}

export function pointToSegmentDistance(point, first, second) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const squaredLength = dx * dx + dy * dy;
    if (squaredLength <= EPSILON) return pointDistance(point, first);
    const parameter = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / squaredLength));
    return pointDistance(point, { x: first.x + parameter * dx, y: first.y + parameter * dy });
}

function pointIsInsidePolygon(point, vertices) {
    let inside = false;
    for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
        const first = vertices[index];
        const second = vertices[previous];
        const crosses = (first.y > point.y) !== (second.y > point.y)
            && point.x < (second.x - first.x) * (point.y - first.y) / (second.y - first.y) + first.x;
        if (crosses) inside = !inside;
    }
    return inside;
}

function lineFragmentFromEntity(entity, first, second) {
    const {
        id: _id,
        type: _type,
        x: _x,
        y: _y,
        width: _width,
        height: _height,
        x1: _x1,
        y1: _y1,
        x2: _x2,
        y2: _y2,
        cx: _cx,
        cy: _cy,
        r: _r,
        rotation: _rotation,
        sourceId: _sourceId,
        sourceIds: _sourceIds,
        ...properties
    } = entity;
    return { ...properties, type: 'line', x1: first.x, y1: first.y, x2: second.x, y2: second.y };
}

export function selectionCenter(content, selectedIds) {
    const selected = new Set(selectedIds);
    const entityMap = new Map(content.entities.map(entity => [entity.id, entity]));
    const bounds = content.entities.filter(entity => selected.has(entity.id)).reduce((combined, entity) => {
        const current = getEntityBounds(entity, entityMap);
        if (!current) return combined;
        if (!combined) return current;
        return normalizeBounds(
            Math.min(combined.minX, current.minX), Math.min(combined.minY, current.minY),
            Math.max(combined.maxX, current.maxX), Math.max(combined.maxY, current.maxY),
        );
    }, null);
    return bounds ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } : { x: 0, y: 0 };
}

export function snapDrawingPoint(point, content, threshold, { excludeIds = [] } = {}) {
    const excluded = new Set(excludeIds);
    const snaps = content.settings?.snaps || {};
    const aperture = Number.isFinite(Number(threshold)) ? Math.max(0, Number(threshold)) : 0;
    const { entries, index } = snapIndexCache([content.entities, content.blocks, content.settings?.attributeDisplay], () => createSnapIndex(content));
    const layers = new Map(content.layers.map(layer => [layer.id, layer]));
    const visibleLayers = new Map();
    const layerVisible = layerId => {
        if (!visibleLayers.has(layerId)) visibleLayers.set(layerId, isDrawingLayerVisible(layers.get(layerId)));
        return visibleLayers.get(layerId);
    };
    const area = { minX: point.x - aperture, minY: point.y - aperture, maxX: point.x + aperture, maxY: point.y + aperture };
    const nearbyEntries = index.query(area)
        .map(position => entries[position])
        .filter(({ entity, layerIds }) => !excluded.has(entity.id) && !isDrawingObjectHidden(content, entity.id) && layerIds.every(layerVisible));
    const entities = nearbyEntries.map(entry => entry.entity);
    const entityBounds = new Map(nearbyEntries.map(entry => [entry.entity, entry.bounds]));
    const candidates = [];
    entities.forEach(entity => baseSnapCandidates(entity, snaps).forEach(candidate => {
        if (isFinitePoint(candidate) && pointDistance(point, candidate) <= aperture) candidates.push(candidate);
    }));
    if (snaps.nearest) entities.forEach(entity => {
        const candidate = nearestSnapCandidate(point, entity);
        if (candidate && isFinitePoint(candidate) && pointDistance(point, candidate) <= aperture) candidates.push(candidate);
    });
    if (snaps.intersection) candidates.push(...intersectionCandidates(entities, point, aperture, { area, entityBounds }));
    const priority = { intersection: 5, endpoint: 4, midpoint: 3, center: 2, nearest: 1 };
    const geometrySnap = candidates.reduce((best, candidate) => {
        const distance = pointDistance(point, candidate);
        const isCloser = !best || distance < best.distance - EPSILON;
        const winsTie = best && Math.abs(distance - best.distance) <= EPSILON
            && (priority[candidate.type] || 0) > (priority[best.type] || 0);
        return distance <= aperture && (isCloser || winsTie) ? { ...candidate, distance } : best;
    }, null);
    // A fine grid point is almost always mathematically closer than an object
    // snap. Object geometry therefore wins inside the acquisition aperture and
    // the grid remains the fallback, matching CAD behaviour.
    if (geometrySnap) return geometrySnap;
    if (snaps.grid) {
        const spacing = Math.max(0.0001, Number(content.settings?.gridSpacing) || 0.5);
        const local = drawingWorldToUcs(point, content.settings?.ucs);
        const grid = {
            ...drawingUcsToWorld({ x: Math.round(local.x / spacing) * spacing, y: Math.round(local.y / spacing) * spacing }, content.settings?.ucs),
            type: 'grid',
        };
        const distance = pointDistance(point, grid);
        if (distance <= aperture) return { ...grid, distance };
    }
    return { x: point.x, y: point.y, type: null, distance: Infinity };
}

function intersectionCandidates(entities, point, threshold, { area = null, entityBounds = new Map() } = {}) {
    const candidates = [];
    const nearby = entities
        .map((entity, index) => ({ entity, index, distance: distanceToSnappableEntity(point, entity) }))
        .filter(candidate => candidate.distance <= threshold + EPSILON)
        .sort((left, right) => left.distance - right.distance || left.index - right.index)
        .slice(0, MAX_SNAP_INTERSECTION_ENTITIES);
    let pairChecks = 0;
    outer: for (let leftIndex = 0; leftIndex < nearby.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < nearby.length; rightIndex += 1) {
            if (pairChecks >= MAX_SNAP_INTERSECTION_CHECKS
                || candidates.length >= MAX_SNAP_INTERSECTION_CANDIDATES) break outer;
            pairChecks += 1;
            const left = nearby[leftIndex].entity;
            const right = nearby[rightIndex].entity;
            // An accepted intersection lies in both bounds and within the aperture
            // box; skipping disjoint pairs still consumes the same check budget.
            if (area && !boundsShareArea(entityBounds.get(left), entityBounds.get(right), area)) continue;
            const intersections = intersectEntities(left, right);
            intersections.forEach(intersection => {
                if (candidates.length >= MAX_SNAP_INTERSECTION_CANDIDATES
                    || !isFinitePoint(intersection)
                    || pointDistance(point, intersection) > threshold) return;
                candidates.push({ ...intersection, type: 'intersection', entityIds: [left.id, right.id] });
            });
        }
    }
    return candidates;
}

// Pointer moves query a cached index of the expanded snap geometry instead of
// re-expanding blocks and scanning every entity. Every snap result lies within
// the aperture, so entities whose geometry and base snap points stay outside
// the aperture box cannot contribute. The index depends on the immutable
// entity and block collections; layer visibility and hidden objects are
// applied per query.
const SNAP_EXPANSION_LIMIT = 200000;
const INDEXED_BASE_SNAPS = Object.freeze({ endpoint: true, midpoint: true, center: true, quadrant: true, node: true });
const snapIndexCache = createDrawingIndexCache();
// Expanded geometry and bounds per document entity, so rebuilding the index
// after an edit only expands the entities that changed.
const rootSnapEntries = new WeakMap();

function createSnapIndex(content) {
    const entries = [];
    for (const root of content.entities) {
        for (const entry of snapEntriesForRoot(content, root)) {
            if (entries.length >= SNAP_EXPANSION_LIMIT) break;
            entries.push(entry);
        }
    }
    return { entries, index: createDrawingSpatialIndex(entries, entry => entry.bounds) };
}

function snapEntriesForRoot(content, root) {
    const attributeDisplay = content.settings?.attributeDisplay;
    const cached = root && typeof root === 'object' ? rootSnapEntries.get(root) : null;
    if (cached && cached.blocks === content.blocks && cached.attributeDisplay === attributeDisplay) return cached.entries;
    const entries = drawingSnapEntityEntries(content, SNAP_EXPANSION_LIMIT, [root])
        .filter(entry => isSafeSnappingEntity(entry.entity))
        .map(entry => ({ ...entry, bounds: snapEntityBounds(entry.entity) }));
    if (root && typeof root === 'object') rootSnapEntries.set(root, { blocks: content.blocks, attributeDisplay, entries });
    return entries;
}

function snapEntityBounds(entity) {
    if (isConstructionLine(entity)) return null;
    const bounds = getEntityBounds(entity);
    if (!bounds) return null;
    return baseSnapCandidates(entity, INDEXED_BASE_SNAPS)
        .filter(isFinitePoint)
        .reduce((combined, candidate) => combineBounds(combined, { minX: candidate.x, minY: candidate.y, maxX: candidate.x, maxY: candidate.y }), bounds);
}

function boundsShareArea(left, right, area) {
    if (!left || !right) return true;
    return Math.max(left.minX, right.minX, area.minX) <= Math.min(left.maxX, right.maxX, area.maxX)
        && Math.max(left.minY, right.minY, area.minY) <= Math.min(left.maxY, right.maxY, area.maxY);
}

function isSafeSnappingEntity(entity) {
    if (entity?.type === 'circle') return isFiniteBoundedCircle(entity);
    if (entity?.type === 'arc') {
        return isFiniteBoundedCircle(entity)
            && Number.isFinite(Number(entity.startAngle)) && Number.isFinite(Number(entity.endAngle));
    }
    return Boolean(entity);
}

function distanceToSnappableEntity(point, entity) {
    if (entity.type === 'circle') {
        return Math.abs(Math.hypot(point.x - entity.cx, point.y - entity.cy) - Math.abs(entity.r));
    }
    const candidate = nearestSnapCandidate(point, entity);
    return candidate && isFinitePoint(candidate) ? pointDistance(point, candidate) : Infinity;
}

function intersectEntities(left, right) {
    if (isConstructionLine(left)) return intersectConstructionLine(left, right);
    if (isConstructionLine(right)) return intersectConstructionLine(right, left);
    const exact = intersectEntityPaths(left, right);
    if (exact) return exact;
    const leftParts = geometryParts(left);
    const rightParts = geometryParts(right);
    return leftParts.flatMap(leftPart => rightParts.flatMap(rightPart => intersectPrimitiveEntities(leftPart, rightPart)));
}

// Entities are immutable between history commits, so their normalized curve
// paths can be reused by every snap query that tests them for intersections.
const intersectionPathCache = new WeakMap();

function cachedEntityPaths(entity) {
    if (!entity || typeof entity !== 'object') return extractEntityPaths(entity);
    if (!intersectionPathCache.has(entity)) intersectionPathCache.set(entity, extractEntityPaths(entity));
    return intersectionPathCache.get(entity);
}

function intersectEntityPaths(left, right) {
    const leftPaths = cachedEntityPaths(left);
    const rightPaths = cachedEntityPaths(right);
    if (!leftPaths.length || !rightPaths.length) return null;
    return leftPaths.flatMap(leftPath => rightPaths.flatMap(rightPath => (
        intersectPaths(leftPath, rightPath).points.map(intersection => intersection.point)
    )));
}

function geometryParts(entity) {
    if (entity?.type === 'polyline' && Array.isArray(entity.parts)) return entity.parts.flatMap(geometryParts);
    return entity ? [entity] : [];
}

function intersectPrimitiveEntities(left, right) {
    const leftSegments = getEntitySegments(left);
    const rightSegments = getEntitySegments(right);
    const points = [];
    leftSegments.forEach(a => rightSegments.forEach(b => {
        const point = segmentIntersection(a[0], a[1], b[0], b[1]);
        if (point) points.push(point);
    }));
    if (left.type === 'circle' && right.type === 'circle') points.push(...circleCircleIntersections(left, right));
    if (left.type === 'circle') rightSegments.forEach(segment => points.push(...segmentCircleIntersections(segment[0], segment[1], left)));
    if (right.type === 'circle') leftSegments.forEach(segment => points.push(...segmentCircleIntersections(segment[0], segment[1], right)));
    return points;
}

function segmentIntersection(a, b, c, d) {
    const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
    if (Math.abs(denominator) < EPSILON) return null;
    const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / denominator;
    const u = -((a.x - b.x) * (a.y - c.y) - (a.y - b.y) * (a.x - c.x)) / denominator;
    if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function segmentCircleIntersections(a, b, circle) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const fx = a.x - circle.cx;
    const fy = a.y - circle.cy;
    const aa = dx * dx + dy * dy;
    const bb = 2 * (fx * dx + fy * dy);
    const cc = fx * fx + fy * fy - circle.r * circle.r;
    const discriminant = bb * bb - 4 * aa * cc;
    if (aa < EPSILON || discriminant < -EPSILON) return [];
    const root = Math.sqrt(Math.max(0, discriminant));
    return [(-bb - root) / (2 * aa), (-bb + root) / (2 * aa)]
        .filter((value, index, all) => value >= -EPSILON && value <= 1 + EPSILON && (index === 0 || Math.abs(value - all[0]) > EPSILON))
        .map(value => ({ x: a.x + value * dx, y: a.y + value * dy }));
}

function circleCircleIntersections(a, b) {
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const distance = Math.hypot(dx, dy);
    if (distance < EPSILON || distance > a.r + b.r + EPSILON || distance < Math.abs(a.r - b.r) - EPSILON) return [];
    const along = (a.r * a.r - b.r * b.r + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, a.r * a.r - along * along));
    const base = { x: a.cx + along * dx / distance, y: a.cy + along * dy / distance };
    const offset = { x: -dy * height / distance, y: dx * height / distance };
    const first = { x: base.x + offset.x, y: base.y + offset.y };
    if (height < EPSILON) return [first];
    return [first, { x: base.x - offset.x, y: base.y - offset.y }];
}
