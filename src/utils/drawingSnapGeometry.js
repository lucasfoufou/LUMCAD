import { getEntitySegments, pointDistance } from './drawingPrimitives.js';
import { arcContainsAngle, arcMidpoint, arcStartPoint, arcEndPoint, pointAngle } from './drawingCurves.js';
import { getHatchBoundaryEntities } from './drawingAdvancedEntities.js';
import {
    closestPointOnCurve,
    curvePointAt,
    curveTangentAt,
    normalizeCurvePrimitive,
} from './drawingCurveKernel.js';

const EPSILON = 1e-9;

export function baseSnapCandidates(entity, snaps) {
    if (entity.type === 'hatch') {
        return getHatchBoundaryEntities(entity).flatMap(boundary => baseSnapCandidates(boundary, snaps)
            .map(candidate => ({ ...candidate, entityId: entity.id })));
    }
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        return entity.parts.flatMap(part => baseSnapCandidates(part, snaps)
            .map(candidate => ({ ...candidate, entityId: entity.id })));
    }
    const candidates = [];
    if (entity.type === 'ellipse' || entity.type === 'spline') {
        const curve = normalizeCurvePrimitive(entity);
        if (!curve) return candidates;
        const appendCurvePoint = (parameter, type) => {
            const point = curvePointAt(curve, parameter);
            const tangent = curveTangentAt(curve, parameter);
            if (!point || !tangent) return;
            const tangentAngle = Math.atan2(tangent.y, tangent.x);
            candidates.push({
                ...point,
                type,
                entityId: entity.id,
                guideAngles: [tangentAngle],
                trackingDirections: genericCurveTrackingDirections(tangentAngle),
            });
        };
        if (snaps.endpoint && (curve.type === 'spline' || !curve.fullEllipse)) {
            appendCurvePoint(0, 'endpoint');
            appendCurvePoint(1, 'endpoint');
        }
        if (snaps.midpoint) appendCurvePoint(0.5, 'midpoint');
        if (snaps.center && curve.type === 'ellipse') {
            candidates.push({ x: curve.cx, y: curve.cy, type: 'center', entityId: entity.id });
        }
        return candidates;
    }
    if (entity.type === 'arc') {
        const start = arcStartPoint(entity);
        const end = arcEndPoint(entity);
        const startAngle = Number(entity.startAngle) || 0;
        const endAngle = Number(entity.endAngle) || 0;
        if (snaps.endpoint) {
            candidates.push({
                ...start,
                type: 'endpoint',
                entityId: entity.id,
                trackingDirections: curveTrackingDirections(startAngle),
            });
            candidates.push({
                ...end,
                type: 'endpoint',
                entityId: entity.id,
                trackingDirections: curveTrackingDirections(endAngle),
            });
        }
        if (snaps.midpoint) {
            const midpoint = arcMidpoint(entity);
            const midpointAngle = pointAngle({ x: entity.cx, y: entity.cy }, midpoint);
            candidates.push({
                ...midpoint,
                type: 'midpoint',
                entityId: entity.id,
                trackingDirections: curveTrackingDirections(midpointAngle),
            });
        }
        if (snaps.center) {
            candidates.push({ x: entity.cx, y: entity.cy, type: 'center', entityId: entity.id });
        }
        return candidates;
    }
    if (entity.type === 'polygon' && snaps.center) {
        candidates.push({ x: entity.cx, y: entity.cy, type: 'center', entityId: entity.id });
    }
    const segments = getEntitySegments(entity);
    if (snaps.endpoint) segments.forEach(([first, second]) => {
        const angle = Math.atan2(second.y - first.y, second.x - first.x);
        [first, second].forEach(point => candidates.push({
            ...point,
            type: 'endpoint',
            entityId: entity.id,
            guideAngles: [angle],
            trackingDirections: lineTrackingDirections(angle),
        }));
    });
    if (snaps.midpoint) segments.forEach(([first, second]) => candidates.push({
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
        type: 'midpoint',
        entityId: entity.id,
        guideAngles: [Math.atan2(second.y - first.y, second.x - first.x)],
        trackingDirections: lineTrackingDirections(Math.atan2(second.y - first.y, second.x - first.x)),
    }));
    if (snaps.center && entity.type === 'circle') candidates.push({ x: entity.cx, y: entity.cy, type: 'center', entityId: entity.id });
    return candidates;
}

export function nearestSnapCandidate(point, entity) {
    if (entity.type === 'hatch') {
        return getHatchBoundaryEntities(entity).reduce((best, boundary) => {
            const candidate = nearestSnapCandidate(point, boundary);
            if (!candidate) return best;
            const normalized = { ...candidate, entityId: entity.id, distance: pointDistance(point, candidate) };
            return !best || normalized.distance < best.distance ? normalized : best;
        }, null);
    }
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        return entity.parts.reduce((best, part) => {
            const candidate = nearestSnapCandidate(point, part);
            if (!candidate) return best;
            const normalized = { ...candidate, entityId: entity.id, distance: pointDistance(point, candidate) };
            return !best || normalized.distance < best.distance ? normalized : best;
        }, null);
    }
    if (entity.type === 'ellipse' || entity.type === 'spline') {
        const closest = closestPointOnCurve(entity, point);
        const tangent = closest ? curveTangentAt(entity, closest.t) : null;
        if (!closest || !tangent) return null;
        const tangentAngle = Math.atan2(tangent.y, tangent.x);
        return {
            ...closest.point,
            type: 'nearest',
            entityId: entity.id,
            distance: closest.distance,
            guideAngles: [tangentAngle],
            trackingDirections: genericCurveTrackingDirections(tangentAngle),
        };
    }
    if (entity.type === 'circle') {
        const dx = point.x - entity.cx;
        const dy = point.y - entity.cy;
        const length = Math.hypot(dx, dy);
        if (length <= EPSILON) return null;
        const radialAngle = Math.atan2(dy, dx);
        return {
            x: entity.cx + dx / length * Math.abs(entity.r),
            y: entity.cy + dy / length * Math.abs(entity.r),
            type: 'nearest',
            entityId: entity.id,
            guideAngles: [radialAngle + Math.PI / 2],
            trackingDirections: curveTrackingDirections(radialAngle),
        };
    }
    if (entity.type === 'arc') {
        const dx = point.x - entity.cx;
        const dy = point.y - entity.cy;
        const length = Math.hypot(dx, dy);
        const radial = length > EPSILON
            ? { x: entity.cx + dx / length * Math.abs(entity.r), y: entity.cy + dy / length * Math.abs(entity.r) }
            : null;
        const radialCandidate = radial && arcContainsAngle(entity, pointAngle({ x: entity.cx, y: entity.cy }, radial))
            ? {
                ...radial,
                type: 'nearest',
                entityId: entity.id,
                guideAngles: [pointAngle({ x: entity.cx, y: entity.cy }, radial) + Math.PI / 2],
                trackingDirections: curveTrackingDirections(pointAngle({ x: entity.cx, y: entity.cy }, radial)),
            }
            : null;
        const endpoints = [arcStartPoint(entity), arcEndPoint(entity)].map(candidate => ({
            ...candidate,
            type: 'nearest',
            entityId: entity.id,
            distance: pointDistance(point, candidate),
        }));
        return [radialCandidate, ...endpoints].filter(Boolean).reduce((best, candidate) => (
            !best || pointDistance(point, candidate) < pointDistance(point, best) ? candidate : best
        ), null);
    }
    return getEntitySegments(entity).reduce((best, [first, second]) => {
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const squaredLength = dx * dx + dy * dy;
        if (squaredLength <= EPSILON) return best;
        const parameter = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / squaredLength));
        const candidate = {
            x: first.x + parameter * dx,
            y: first.y + parameter * dy,
            type: 'nearest',
            entityId: entity.id,
            guideAngles: [Math.atan2(dy, dx)],
            trackingDirections: lineTrackingDirections(Math.atan2(dy, dx)),
        };
        const distance = pointDistance(point, candidate);
        return !best || distance < best.distance ? { ...candidate, distance } : best;
    }, null);
}

function lineTrackingDirections(angle) {
    return [
        { angle, relation: 'parallel' },
        { angle: angle + Math.PI / 2, relation: 'perpendicular' },
    ];
}

function curveTrackingDirections(radialAngle) {
    return [
        { angle: radialAngle + Math.PI / 2, relation: 'tangent' },
        { angle: radialAngle, relation: 'perpendicular' },
    ];
}

function genericCurveTrackingDirections(tangentAngle) {
    return [
        { angle: tangentAngle, relation: 'tangent' },
        { angle: tangentAngle + Math.PI / 2, relation: 'perpendicular' },
    ];
}
