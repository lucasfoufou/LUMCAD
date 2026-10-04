import { extractEntityPaths, intersectCurves } from './drawingCurveKernel.js';

const EPSILON = 1e-9;

export function isConstructionLine(entity) {
    return entity?.type === 'xline' || entity?.type === 'ray';
}

// The second point defines direction, never an endpoint. Parameters are metres
// from the origin, so tolerance is independent of the picked direction length.
export function constructionLineGeometry(entity) {
    if (!isConstructionLine(entity)
        || ![entity.x1, entity.y1, entity.x2, entity.y2].every(Number.isFinite)) return null;
    const dx = entity.x2 - entity.x1;
    const dy = entity.y2 - entity.y1;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= EPSILON) return null;
    return {
        origin: { x: entity.x1, y: entity.y1 },
        direction: { x: dx / length, y: dy / length },
        minimum: entity.type === 'ray' ? 0 : -Infinity,
    };
}

export function closestPointOnConstructionLine(entity, point) {
    const geometry = constructionLineGeometry(entity);
    if (!geometry || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    const { origin, direction, minimum } = geometry;
    const parameter = Math.max(minimum, (point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y);
    const closest = pointAt(geometry, parameter);
    return { point: closest, parameter, distance: Math.hypot(point.x - closest.x, point.y - closest.y) };
}

/** Clip the mathematical entity to a finite rectangle, without a world-size cap. */
export function clipConstructionLine(entity, bounds) {
    const geometry = constructionLineGeometry(entity);
    if (!geometry || !bounds
        || ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
        || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) return null;
    let first = geometry.minimum;
    let last = Infinity;
    for (const [axis, low, high] of [['x', bounds.minX, bounds.maxX], ['y', bounds.minY, bounds.maxY]]) {
        const origin = geometry.origin[axis];
        const direction = geometry.direction[axis];
        if (direction === 0) {
            if (origin < low || origin > high) return null;
            continue;
        }
        const a = (low - origin) / direction;
        const b = (high - origin) / direction;
        first = Math.max(first, Math.min(a, b));
        last = Math.min(last, Math.max(a, b));
        if (first > last) return null;
    }
    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
    return { start: pointAt(geometry, first), end: pointAt(geometry, last) };
}

export function constructionLineViewportSegment(entity, viewBox) {
    if (!viewBox) return null;
    return clipConstructionLine(entity, {
        minX: viewBox.x, minY: viewBox.y,
        maxX: viewBox.x + viewBox.width, maxY: viewBox.y + viewBox.height,
    });
}

export function intersectConstructionLine(entity, other) {
    const geometry = constructionLineGeometry(entity);
    if (!geometry || !other) return [];
    if (isConstructionLine(other)) {
        const target = constructionLineGeometry(other);
        if (!target) return [];
        const denominator = cross(geometry.direction, target.direction);
        if (Math.abs(denominator) <= Number.EPSILON * 8) return [];
        const delta = { x: target.origin.x - geometry.origin.x, y: target.origin.y - geometry.origin.y };
        const first = cross(delta, target.direction) / denominator;
        const second = cross(delta, geometry.direction) / denominator;
        if (first < geometry.minimum - EPSILON || second < target.minimum - EPSILON) return [];
        const point = pointAt(geometry, first);
        return Number.isFinite(point.x) && Number.isFinite(point.y) ? [point] : [];
    }
    // A bounded primitive's conservative hull contains every intersection.
    // Clipping to that hull lets the existing exact curve kernel do the work.
    const points = extractEntityPaths(other).flatMap(path => path.parts.flatMap(curve => {
        const bounds = primitiveHull(curve);
        const segment = bounds && clipConstructionLine(entity, bounds);
        if (!segment) return [];
        return intersectCurves({
            type: 'line', x1: segment.start.x, y1: segment.start.y,
            x2: segment.end.x, y2: segment.end.y,
        }, curve).points.map(intersection => intersection.point);
    }));
    return points.filter((point, index) => points.findIndex(candidate => (
        Math.hypot(candidate.x - point.x, candidate.y - point.y) <= EPSILON
    )) === index);
}

function primitiveHull(curve) {
    let points;
    if (curve.type === 'line') points = [{ x: curve.x1, y: curve.y1 }, { x: curve.x2, y: curve.y2 }];
    else if (curve.type === 'spline') points = curve.controlPoints;
    else if (['circle', 'arc', 'ellipse'].includes(curve.type)) {
        const radius = curve.type === 'ellipse' ? Math.max(curve.rx, curve.ry) : Math.abs(curve.r);
        points = [{ x: curve.cx - radius, y: curve.cy - radius }, { x: curve.cx + radius, y: curve.cy + radius }];
    }
    if (!points?.length) return null;
    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    const padding = Math.max(1e-6, (maxX - minX + maxY - minY) * 1e-9);
    return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}

function pointAt({ origin, direction }, parameter) {
    return { x: origin.x + direction.x * parameter, y: origin.y + direction.y * parameter };
}

function cross(first, second) {
    return first.x * second.y - first.y * second.x;
}
