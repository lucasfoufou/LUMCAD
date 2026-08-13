import {
    arcEndPoint,
    arcMidpoint,
    arcStartPoint,
    createArcFromThreePoints,
    getRegularPolygonVertices,
} from './drawingCurves.js';
import {
    getDimensionGeometry,
    getEntityBounds,
    getEntitySegments,
    getRectEntityCorners,
    pointDistance,
    rotatePoint,
} from './drawingGeometry.js';

const EPSILON = 1e-9;

/**
 * Describes the editor's directional selection window. Moving left-to-right
 * creates the blue crossing window; moving right-to-left creates the green
 * containment window.
 */
export function createSelectionWindow(first, current) {
    return {
        ...normalizeBounds(first.x, first.y, current.x, current.y),
        mode: current.x >= first.x ? 'crossing' : 'window',
    };
}

/**
 * Tests actual drawing geometry against a selection window. In crossing mode
 * this deliberately avoids relying on bounding boxes for lines and circles.
 */
export function entityMatchesSelectionWindow(entity, selectionWindow, entityMap = new Map()) {
    if (!entity || !selectionWindow) return false;
    const bounds = normalizeBounds(
        selectionWindow.minX,
        selectionWindow.minY,
        selectionWindow.maxX,
        selectionWindow.maxY,
    );
    if (selectionWindow.mode === 'window') return entityIsContainedByBounds(entity, bounds, entityMap);
    return entityCrossesBounds(entity, bounds, entityMap);
}

/**
 * Control points exposed by the selection tool. Rectangle grips are based on
 * normalized corners so negatively drawn rectangles behave identically.
 */
export function getEntityGrips(entity, source = null) {
    if (!entity) return [];
    if (entity.type === 'line') {
        return [
            { id: 'start', x: entity.x1, y: entity.y1 },
            { id: 'end', x: entity.x2, y: entity.y2 },
        ];
    }
    if (entity.type === 'polyline') {
        if (Array.isArray(entity.parts)) return entity.parts.flatMap((part, partIndex) => (
            getEntityGrips(part).map(grip => ({ ...grip, id: `part-${partIndex}:${grip.id}` }))
        ));
        return (entity.points || []).map((point, index) => ({ id: `vertex-${index}`, ...point }));
    }
    if (entity.type === 'polygon') return [
        { id: 'center', x: entity.cx, y: entity.cy },
        ...getRegularPolygonVertices(entity).map((point, index) => ({ id: `vertex-${index}`, ...point })),
    ];
    if (entity.type === 'arc') return [
        { id: 'start', ...arcStartPoint(entity) },
        { id: 'end', ...arcEndPoint(entity) },
        { id: 'center', x: entity.cx, y: entity.cy },
        { id: 'midpoint', ...arcMidpoint(entity) },
    ];
    if (['rectangle', 'image', 'text'].includes(entity.type)) {
        const ids = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
        return getRectEntityCorners(entity).map((point, index) => ({ id: ids[index], ...point }));
    }
    if (entity.type === 'circle') return [
        { id: 'center', x: entity.cx, y: entity.cy },
        { id: 'radius', x: entity.cx + Math.abs(entity.r), y: entity.cy },
    ];
    if (entity.type === 'linearDimension' || entity.type === 'radialDimension') {
        const geometry = getDimensionGeometry(entity, source);
        return geometry ? [{ id: 'dimension-position', x: geometry.text.x, y: geometry.text.y }] : [];
    }
    return [];
}

/**
 * Applies one grip edit. Rectangle corners keep their opposite corner fixed,
 * including when the dragged corner crosses it and produces negative extents.
 */
export function editEntityGrip(entity, gripId, point, source = null) {
    if (!entity || !point) return entity;
    if (entity.type === 'line') {
        if (gripId === 'start') return { ...entity, x1: point.x, y1: point.y };
        if (gripId === 'end') return { ...entity, x2: point.x, y2: point.y };
        return entity;
    }
    if (entity.type === 'polyline' && Array.isArray(entity.parts) && gripId.startsWith('part-')) {
        const match = /^part-(\d+):(.+)$/.exec(gripId);
        const partIndex = Number.parseInt(match?.[1], 10);
        if (!match || !Number.isInteger(partIndex) || !entity.parts[partIndex]) return entity;
        return {
            ...entity,
            parts: entity.parts.map((part, index) => index === partIndex ? editEntityGrip(part, match[2], point) : part),
        };
    }
    if (entity.type === 'polyline' && gripId.startsWith('vertex-')) {
        const index = Number.parseInt(gripId.slice('vertex-'.length), 10);
        if (!Number.isInteger(index) || !entity.points?.[index]) return entity;
        return { ...entity, points: entity.points.map((current, currentIndex) => currentIndex === index ? { x: point.x, y: point.y } : current) };
    }
    if (entity.type === 'circle') {
        if (gripId === 'center') return { ...entity, cx: point.x, cy: point.y };
        if (gripId === 'radius') {
            const radius = Math.hypot(point.x - entity.cx, point.y - entity.cy);
            return radius > EPSILON ? { ...entity, r: radius } : entity;
        }
        return entity;
    }
    if (entity.type === 'polygon') {
        if (gripId === 'center') return { ...entity, cx: point.x, cy: point.y };
        if (!gripId.startsWith('vertex-')) return entity;
        const index = Number.parseInt(gripId.slice('vertex-'.length), 10);
        const sides = Math.max(3, Math.round(Number(entity.sides) || 6));
        const radius = Math.hypot(point.x - entity.cx, point.y - entity.cy);
        if (!Number.isInteger(index) || index < 0 || index >= sides || radius <= EPSILON) return entity;
        const apothem = entity.mode === 'circumscribed' ? radius * Math.cos(Math.PI / sides) : radius;
        return {
            ...entity,
            r: apothem,
            rotation: normalizeDegrees(Math.atan2(point.y - entity.cy, point.x - entity.cx) * 180 / Math.PI + 90 - index * 360 / sides),
        };
    }
    if (entity.type === 'arc') {
        if (gripId === 'center') return { ...entity, cx: point.x, cy: point.y };
        const angle = Math.atan2(point.y - entity.cy, point.x - entity.cx);
        if (gripId === 'start') return { ...entity, startAngle: angle };
        if (gripId === 'end') return { ...entity, endAngle: angle };
        if (gripId === 'midpoint') {
            const geometry = createArcFromThreePoints(arcStartPoint(entity), point, arcEndPoint(entity));
            return geometry ? { ...entity, ...geometry } : entity;
        }
        return entity;
    }
    if (gripId === 'dimension-position' && entity.type === 'linearDimension') {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return entity;
        const dx = geometry.sourceSecond.x - geometry.sourceFirst.x;
        const dy = geometry.sourceSecond.y - geometry.sourceFirst.y;
        const length = Math.hypot(dx, dy);
        if (length <= EPSILON) return entity;
        const normal = { x: -dy / length, y: dx / length };
        const offset = (point.x - geometry.sourceFirst.x) * normal.x + (point.y - geometry.sourceFirst.y) * normal.y;
        return { ...entity, offset };
    }
    if (gripId === 'dimension-position' && entity.type === 'radialDimension' && ['circle', 'arc'].includes(source?.type)) {
        const dx = point.x - source.cx;
        const dy = point.y - source.cy;
        const distance = Math.hypot(dx, dy);
        if (distance <= EPSILON || Math.abs(source.r) <= EPSILON) return entity;
        return {
            ...entity,
            angle: Math.atan2(dy, dx),
            leaderScale: Math.max(1.05, distance / Math.abs(source.r)),
        };
    }
    if (!['rectangle', 'image', 'text'].includes(entity.type)) return entity;

    const grips = getEntityGrips(entity);
    const gripIndex = grips.findIndex(grip => grip.id === gripId);
    if (gripIndex < 0) return entity;
    const opposite = grips[(gripIndex + 2) % 4];
    const rotation = Number(entity.rotation) || 0;
    const localPoint = rotatePoint(point, opposite, -rotation);
    const delta = { x: localPoint.x - opposite.x, y: localPoint.y - opposite.y };
    const localCenter = { x: opposite.x + delta.x / 2, y: opposite.y + delta.y / 2 };
    const center = rotatePoint(localCenter, opposite, rotation);
    const width = Math.abs(delta.x);
    const height = Math.abs(delta.y);
    return { ...entity, x: center.x - width / 2, y: center.y - height / 2, width, height };
}

/** Keeps a dragged line endpoint on the line's original infinite axis. */
export function constrainLineGripPoint(entity, gripId, point) {
    if (entity?.type !== 'line' || !['start', 'end'].includes(gripId) || !point) return point;
    const fixed = gripId === 'start'
        ? { x: entity.x2, y: entity.y2 }
        : { x: entity.x1, y: entity.y1 };
    const moving = gripId === 'start'
        ? { x: entity.x1, y: entity.y1 }
        : { x: entity.x2, y: entity.y2 };
    const dx = moving.x - fixed.x;
    const dy = moving.y - fixed.y;
    const squaredLength = dx * dx + dy * dy;
    if (squaredLength <= EPSILON) return point;
    const factor = ((point.x - fixed.x) * dx + (point.y - fixed.y) * dy) / squaredLength;
    return { ...point, x: fixed.x + dx * factor, y: fixed.y + dy * factor };
}

function entityIsContainedByBounds(entity, bounds, entityMap) {
    if (entity.type === 'line') {
        return pointIsInBounds({ x: entity.x1, y: entity.y1 }, bounds)
            && pointIsInBounds({ x: entity.x2, y: entity.y2 }, bounds);
    }
    if (entity.type === 'polyline') {
        if (Array.isArray(entity.parts)) return entity.parts.every(part => entityIsContainedByBounds(part, bounds, entityMap));
        return (entity.points || []).every(point => pointIsInBounds(point, bounds));
    }
    if (entity.type === 'rectangle' || entity.type === 'image' || entity.type === 'text') {
        return boundsContainBounds(bounds, getEntityBounds(entity, entityMap));
    }
    if (entity.type === 'polygon' || entity.type === 'arc') {
        return getEntitySegments(entity).every(([first, second]) => (
            pointIsInBounds(first, bounds) && pointIsInBounds(second, bounds)
        ));
    }
    if (entity.type === 'circle') {
        const radius = Math.abs(entity.r);
        return entity.cx - radius >= bounds.minX - EPSILON
            && entity.cx + radius <= bounds.maxX + EPSILON
            && entity.cy - radius >= bounds.minY - EPSILON
            && entity.cy + radius <= bounds.maxY + EPSILON;
    }
    const segments = dimensionSegments(entity, entityMap.get(entity.sourceId));
    return segments.length > 0 && segments.every(([first, second]) => (
        pointIsInBounds(first, bounds) && pointIsInBounds(second, bounds)
    ));
}

function entityCrossesBounds(entity, bounds, entityMap) {
    if (entity.type === 'line') {
        return segmentIntersectsBounds(
            { x: entity.x1, y: entity.y1 },
            { x: entity.x2, y: entity.y2 },
            bounds,
        );
    }
    if (entity.type === 'polyline') {
        if (Array.isArray(entity.parts)) return entity.parts.some(part => entityCrossesBounds(part, bounds, entityMap));
        return getEntitySegments(entity).some(segment => segmentIntersectsBounds(segment[0], segment[1], bounds));
    }
    if (['rectangle', 'polygon', 'arc'].includes(entity.type)) return getEntitySegments(entity).some(segment => segmentIntersectsBounds(segment[0], segment[1], bounds));
    if (entity.type === 'image' || entity.type === 'text') return boundsOverlap(getEntityBounds(entity, entityMap), bounds);
    if (entity.type === 'circle') return circleIntersectsBounds(entity, bounds);
    return dimensionSegments(entity, entityMap.get(entity.sourceId))
        .some(segment => segmentIntersectsBounds(segment[0], segment[1], bounds));
}

function pointIsInBounds(point, bounds) {
    return point.x >= bounds.minX - EPSILON && point.x <= bounds.maxX + EPSILON
        && point.y >= bounds.minY - EPSILON && point.y <= bounds.maxY + EPSILON;
}

function boundsContainBounds(container, candidate) {
    return Boolean(candidate)
        && candidate.minX >= container.minX - EPSILON && candidate.maxX <= container.maxX + EPSILON
        && candidate.minY >= container.minY - EPSILON && candidate.maxY <= container.maxY + EPSILON;
}

function boundsOverlap(left, right) {
    return Boolean(left && right)
        && left.maxX >= right.minX - EPSILON && left.minX <= right.maxX + EPSILON
        && left.maxY >= right.minY - EPSILON && left.minY <= right.maxY + EPSILON;
}

function segmentIntersectsBounds(first, second, bounds) {
    if (pointIsInBounds(first, bounds) || pointIsInBounds(second, bounds)) return true;
    const corners = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
    ];
    return corners.some((corner, index) => segmentsIntersect(first, second, corner, corners[(index + 1) % corners.length]));
}

function segmentsIntersect(a, b, c, d) {
    const cross = (first, second, third) => (
        (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
    );
    const abC = cross(a, b, c);
    const abD = cross(a, b, d);
    const cdA = cross(c, d, a);
    const cdB = cross(c, d, b);
    if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
        && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
    return (Math.abs(abC) <= EPSILON && pointIsOnSegment(c, a, b))
        || (Math.abs(abD) <= EPSILON && pointIsOnSegment(d, a, b))
        || (Math.abs(cdA) <= EPSILON && pointIsOnSegment(a, c, d))
        || (Math.abs(cdB) <= EPSILON && pointIsOnSegment(b, c, d));
}

function pointIsOnSegment(point, first, second) {
    return point.x >= Math.min(first.x, second.x) - EPSILON && point.x <= Math.max(first.x, second.x) + EPSILON
        && point.y >= Math.min(first.y, second.y) - EPSILON && point.y <= Math.max(first.y, second.y) + EPSILON;
}

function circleIntersectsBounds(circle, bounds) {
    const radius = Math.abs(circle.r);
    const center = { x: circle.cx, y: circle.cy };
    const closest = {
        x: Math.max(bounds.minX, Math.min(circle.cx, bounds.maxX)),
        y: Math.max(bounds.minY, Math.min(circle.cy, bounds.maxY)),
    };
    const corners = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
    ];
    const nearestDistance = pointDistance(center, closest);
    const farthestDistance = Math.max(...corners.map(point => pointDistance(center, point)));
    return nearestDistance <= radius + EPSILON && farthestDistance >= radius - EPSILON;
}

function dimensionSegments(entity, source) {
    const geometry = getDimensionGeometry(entity, source);
    if (!geometry) return [];
    if (geometry.kind === 'linear') {
        return [
            [geometry.sourceFirst, geometry.first],
            [geometry.first, geometry.second],
            [geometry.sourceSecond, geometry.second],
        ];
    }
    return [[geometry.center, geometry.text]];
}

function normalizeBounds(x1, y1, x2, y2) {
    return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
}

function normalizeDegrees(value) {
    const normalized = (Number(value) || 0) % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}
