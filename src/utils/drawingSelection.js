import {
    arcEndPoint,
    arcMidpoint,
    arcStartPoint,
    createArcFromThreePoints,
    getRegularPolygonVertices,
    isFiniteBoundedCircle,
} from './drawingCurves.js';
import {
    getDimensionGeometry,
    getEntityBounds,
    getEntitySegments,
    getRectEntityCorners,
    pointDistance,
    rotatePoint,
} from './drawingGeometry.js';
import {
    getDrawingBlockReferenceBounds,
    getDrawingBlockReferenceInsertionPoint,
    moveDrawingBlockReferenceInsertion,
} from './drawingBlocks.js';
import { getHatchBoundaryEntities } from './drawingAdvancedEntities.js';
import { curvePointAt, normalizeCurvePrimitive } from './drawingCurveKernel.js';
import { DRAWING_QDIM_GRIP_IDS, isDrawingDimensionEntity } from './drawingDimensions.js';

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
    if (entity.type === 'blockReference') {
        const insertion = getDrawingBlockReferenceInsertionPoint(entity);
        return insertion ? [{ id: 'insertion', ...insertion }] : [];
    }
    if (entity.type === 'line') {
        return [
            { id: 'start', x: entity.x1, y: entity.y1 },
            { id: 'end', x: entity.x2, y: entity.y2 },
        ];
    }
    if (entity.type === 'spline') {
        const spline = normalizeCurvePrimitive(entity);
        return spline?.type === 'spline'
            ? spline.controlPoints.map((point, index) => ({ id: `control-${index}`, ...point }))
            : [];
    }
    if (entity.type === 'ellipse') {
        const ellipse = normalizeCurvePrimitive(entity);
        if (ellipse?.type !== 'ellipse') return [];
        const grips = [{ id: 'center', x: ellipse.cx, y: ellipse.cy }];
        if (ellipse.fullEllipse) {
            grips.push({ id: 'radius-x', ...ellipseLocalPoint(ellipse, ellipse.rx, 0) });
            grips.push({ id: 'radius-y', ...ellipseLocalPoint(ellipse, 0, ellipse.ry) });
        } else {
            grips.push({ id: 'start', ...curvePointAt(ellipse, 0) });
            grips.push({ id: 'end', ...curvePointAt(ellipse, 1) });
            grips.push({ id: 'midpoint', ...curvePointAt(ellipse, 0.5) });
        }
        return grips;
    }
    if (entity.type === 'hatch') {
        return getHatchBoundaryEntities(entity).flatMap((boundary, boundaryIndex) => (
            getEntityGrips(boundary).map(grip => ({ ...grip, id: `boundary-${boundaryIndex}:${grip.id}` }))
        ));
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
    if (entity.type === 'circle') return isFiniteBoundedCircle(entity) ? [
        { id: 'center', x: entity.cx, y: entity.cy },
        { id: 'radius', x: entity.cx + Math.abs(entity.r), y: entity.cy },
    ] : [];
    if (isDrawingDimensionEntity(entity)) {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return [];
        if (entity.type === 'linearDimension' && entity.seriesId) {
            const seriesIndex = Math.max(0, Math.trunc(Number(entity.seriesIndex) || 0));
            if (seriesIndex === 0 && geometry.label) return [
                { id: DRAWING_QDIM_GRIP_IDS.offset, ...geometry.label.point },
            ];
            if (entity.seriesMode === 'baseline' && seriesIndex === 1 && geometry.label) return [
                { id: DRAWING_QDIM_GRIP_IDS.spacing, ...geometry.label.point },
            ];
            return [];
        }
        if (geometry.kind === 'ordinate') return [
            { id: 'ordinate-origin', ...geometry.origin },
            { id: 'ordinate-feature', ...geometry.feature },
            { id: 'dimension-position', ...geometry.text },
        ];
        if (geometry.kind === 'centerMark') return [
            { id: 'center-mark-size', x: geometry.center.x + geometry.size, y: geometry.center.y },
        ];
        const grips = geometry.label
            ? [{ id: 'dimension-position', ...geometry.label.point }]
            : geometry.text ? [{ id: 'dimension-position', ...geometry.text }] : [];
        if (geometry.kind === 'radial' && geometry.mode === 'joggedRadius') {
            grips.push(
                { id: 'jog-center', ...geometry.jogCenter },
                { id: 'jog-point', ...geometry.jogPoint },
            );
        }
        return grips;
    }
    return [];
}

/**
 * Applies one grip edit. Rectangle corners keep their opposite corner fixed,
 * including when the dragged corner crosses it and produces negative extents.
 */
export function editEntityGrip(entity, gripId, point, source = null) {
    if (!entity || !point) return entity;
    if (entity.type === 'blockReference') {
        return gripId === 'insertion' ? moveDrawingBlockReferenceInsertion(entity, point) : entity;
    }
    if (entity.type === 'line') {
        if (gripId === 'start') return { ...entity, x1: point.x, y1: point.y };
        if (gripId === 'end') return { ...entity, x2: point.x, y2: point.y };
        return entity;
    }
    if (entity.type === 'spline' && gripId.startsWith('control-')) {
        const index = Number.parseInt(gripId.slice('control-'.length), 10);
        const spline = normalizeCurvePrimitive(entity);
        if (spline?.type !== 'spline' || !Number.isInteger(index) || !spline.controlPoints[index]) return entity;
        return {
            ...entity,
            degree: 3,
            controlPoints: spline.controlPoints.map((current, currentIndex) => (
                currentIndex === index ? { x: point.x, y: point.y } : current
            )),
        };
    }
    if (entity.type === 'ellipse') {
        const ellipse = normalizeCurvePrimitive(entity);
        if (ellipse?.type !== 'ellipse') return entity;
        if (gripId === 'center') return { ...entity, cx: point.x, cy: point.y };
        const local = ellipseWorldToLocal(ellipse, point);
        if (gripId === 'radius-x' && Math.abs(local.x) > EPSILON) return { ...entity, rx: Math.abs(local.x) };
        if (gripId === 'radius-y' && Math.abs(local.y) > EPSILON) return { ...entity, ry: Math.abs(local.y) };
        if (gripId === 'start' || gripId === 'end') {
            const angle = Math.atan2(local.y / ellipse.ry, local.x / ellipse.rx);
            return gripId === 'start' ? { ...entity, startAngle: angle } : { ...entity, endAngle: angle };
        }
        return entity;
    }
    if (entity.type === 'hatch' && gripId.startsWith('boundary-')) {
        const match = /^boundary-(\d+):(.+)$/.exec(gripId);
        const boundaryIndex = Number.parseInt(match?.[1], 10);
        const boundaries = getHatchBoundaryEntities(entity);
        if (!match || !Number.isInteger(boundaryIndex) || !boundaries[boundaryIndex]) return entity;
        return {
            ...entity,
            boundaries: boundaries.map((boundary, index) => (
                index === boundaryIndex ? editEntityGrip(boundary, match[2], point) : boundary
            )),
        };
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
        if (gripId === 'center') {
            const candidate = { ...entity, cx: point.x, cy: point.y };
            return isFiniteBoundedCircle(candidate) ? candidate : entity;
        }
        if (gripId === 'radius') {
            const radius = Math.hypot(point.x - entity.cx, point.y - entity.cy);
            const candidate = { ...entity, r: radius };
            return radius > EPSILON && isFiniteBoundedCircle(candidate) ? candidate : entity;
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
        const normal = { x: -Math.sin(geometry.angle), y: Math.cos(geometry.angle) };
        const offset = (point.x - geometry.sourceFirst.x) * normal.x + (point.y - geometry.sourceFirst.y) * normal.y;
        return geometry.mode === 'aligned' && !entity.linePoint
            ? { ...entity, offset }
            : { ...entity, linePoint: { x: point.x, y: point.y }, offset };
    }
    if (entity.type === 'radialDimension') {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return entity;
        if (gripId === 'jog-center') return { ...entity, jogCenter: { x: point.x, y: point.y } };
        if (gripId === 'jog-point') return { ...entity, jogPoint: { x: point.x, y: point.y } };
        if (gripId !== 'dimension-position') return entity;
        const dx = point.x - geometry.center.x;
        const dy = point.y - geometry.center.y;
        const distance = Math.hypot(dx, dy);
        const radius = pointDistance(geometry.center, geometry.edge);
        if (distance <= EPSILON || radius <= EPSILON) return entity;
        return {
            ...entity,
            angle: Math.atan2(dy, dx),
            leaderScale: Math.max(1.05, distance / radius),
        };
    }
    if (gripId === 'dimension-position' && entity.type === 'angularDimension') {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return entity;
        const radius = pointDistance(geometry.vertex, point);
        return radius > EPSILON ? { ...entity, radius } : entity;
    }
    if (gripId === 'dimension-position' && entity.type === 'arcLengthDimension') {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return entity;
        const radius = pointDistance(geometry.center, point);
        const currentOffset = Number.isFinite(Number(entity.offset)) ? Number(entity.offset) : 0.6;
        const sourceRadius = geometry.radius - currentOffset;
        return radius > EPSILON ? { ...entity, offset: radius - sourceRadius } : entity;
    }
    if (entity.type === 'ordinateDimension') {
        if (gripId === 'ordinate-origin') return { ...entity, origin: { x: point.x, y: point.y } };
        if (gripId === 'ordinate-feature') return { ...entity, featurePoint: { x: point.x, y: point.y } };
        if (gripId === 'dimension-position') return { ...entity, leaderPoint: { x: point.x, y: point.y } };
    }
    if (gripId === 'center-mark-size' && entity.type === 'centerMark') {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return entity;
        const size = pointDistance(geometry.center, point) - geometry.extension;
        return size > EPSILON ? { ...entity, size } : entity;
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
    if (entity.type === 'blockReference') {
        return boundsContainBounds(bounds, getDrawingBlockReferenceBounds(entity));
    }
    if (entity.type === 'line') {
        return pointIsInBounds({ x: entity.x1, y: entity.y1 }, bounds)
            && pointIsInBounds({ x: entity.x2, y: entity.y2 }, bounds);
    }
    if (['ellipse', 'spline', 'hatch'].includes(entity.type)) {
        return boundsContainBounds(bounds, getEntityBounds(entity, entityMap));
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
        if (!isFiniteBoundedCircle(entity)) return false;
        const radius = Math.abs(entity.r);
        return entity.cx - radius >= bounds.minX - EPSILON
            && entity.cx + radius <= bounds.maxX + EPSILON
            && entity.cy - radius >= bounds.minY - EPSILON
            && entity.cy + radius <= bounds.maxY + EPSILON;
    }
    const segments = dimensionSegments(entity, entityMap);
    return segments.length > 0 && segments.every(([first, second]) => (
        pointIsInBounds(first, bounds) && pointIsInBounds(second, bounds)
    ));
}

function entityCrossesBounds(entity, bounds, entityMap) {
    if (entity.type === 'blockReference') {
        return boundsOverlap(getDrawingBlockReferenceBounds(entity), bounds);
    }
    if (entity.type === 'line') {
        return segmentIntersectsBounds(
            { x: entity.x1, y: entity.y1 },
            { x: entity.x2, y: entity.y2 },
            bounds,
        );
    }
    if (entity.type === 'ellipse' || entity.type === 'spline') {
        return getEntitySegments(entity).some(segment => segmentIntersectsBounds(segment[0], segment[1], bounds));
    }
    if (entity.type === 'hatch') {
        const boundaries = getHatchBoundaryEntities(entity);
        if (boundaries.some(boundary => entityCrossesBounds(boundary, bounds, entityMap))) return true;
        if (entity.pattern?.name !== 'solid') return false;
        const corners = boundsCorners(bounds);
        const segments = boundaries.map(boundary => getEntitySegments(boundary));
        return corners.some(point => pointIsInsideHatch(point, segments));
    }
    if (entity.type === 'polyline') {
        if (Array.isArray(entity.parts)) return entity.parts.some(part => entityCrossesBounds(part, bounds, entityMap));
        return getEntitySegments(entity).some(segment => segmentIntersectsBounds(segment[0], segment[1], bounds));
    }
    if (['rectangle', 'polygon', 'arc'].includes(entity.type)) return getEntitySegments(entity).some(segment => segmentIntersectsBounds(segment[0], segment[1], bounds));
    if (entity.type === 'image' || entity.type === 'text') return boundsOverlap(getEntityBounds(entity, entityMap), bounds);
    if (entity.type === 'circle') return isFiniteBoundedCircle(entity) && circleIntersectsBounds(entity, bounds);
    return dimensionSegments(entity, entityMap)
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

function dimensionSegments(entity, sources) {
    const geometry = getDimensionGeometry(entity, sources);
    if (!geometry) return [];
    const lines = geometry.lines.map(line => [line.start, line.end]);
    const arcs = geometry.arcs.flatMap(arc => {
        let sweep = (arc.endAngle - arc.startAngle) % (Math.PI * 2);
        if (arc.counterClockwise && sweep < 0) sweep += Math.PI * 2;
        if (!arc.counterClockwise && sweep > 0) sweep -= Math.PI * 2;
        const count = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
        const points = Array.from({ length: count + 1 }, (_, index) => {
            const angle = arc.startAngle + sweep * index / count;
            return {
                x: arc.center.x + Math.cos(angle) * arc.radius,
                y: arc.center.y + Math.sin(angle) * arc.radius,
            };
        });
        return points.slice(0, -1).map((point, index) => [point, points[index + 1]]);
    });
    return [...lines, ...arcs];
}

function ellipseLocalPoint(ellipse, x, y) {
    const angle = ellipse.rotation * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return {
        x: ellipse.cx + x * cosine - y * sine,
        y: ellipse.cy + x * sine + y * cosine,
    };
}

function ellipseWorldToLocal(ellipse, point) {
    const angle = -ellipse.rotation * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const dx = point.x - ellipse.cx;
    const dy = point.y - ellipse.cy;
    return { x: dx * cosine - dy * sine, y: dx * sine + dy * cosine };
}

function boundsCorners(bounds) {
    return [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
    ];
}

function pointIsInsideHatch(point, boundarySegments) {
    let inside = false;
    for (const segments of boundarySegments) {
        for (const [first, second] of segments) {
            if (pointIsOnSegment(point, first, second)) return true;
            const crossesRay = (first.y > point.y) !== (second.y > point.y)
                && point.x < (second.x - first.x) * (point.y - first.y) / (second.y - first.y) + first.x;
            if (crossesRay) inside = !inside;
        }
    }
    return inside;
}

function normalizeBounds(x1, y1, x2, y2) {
    return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
}

function normalizeDegrees(value) {
    const normalized = (Number(value) || 0) % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}
