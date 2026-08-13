import { getEntitySegments, pointDistance } from './drawingPrimitives.js';
import { arcContainsAngle, arcMidpoint, arcStartPoint, arcEndPoint, pointAngle } from './drawingCurves.js';

const EPSILON = 1e-9;

export function baseSnapCandidates(entity, snaps) {
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        return entity.parts.flatMap(part => baseSnapCandidates(part, snaps)
            .map(candidate => ({ ...candidate, entityId: entity.id })));
    }
    const candidates = [];
    if (entity.type === 'arc') {
        const start = arcStartPoint(entity);
        const end = arcEndPoint(entity);
        const guideAngles = [Number(entity.startAngle) || 0, Number(entity.endAngle) || 0];
        if (snaps.endpoint) {
            candidates.push({ ...start, type: 'endpoint', entityId: entity.id, guideAngles });
            candidates.push({ ...end, type: 'endpoint', entityId: entity.id, guideAngles });
        }
        if (snaps.midpoint) {
            const midpoint = arcMidpoint(entity);
            candidates.push({ ...midpoint, type: 'midpoint', entityId: entity.id, guideAngles });
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
        const guideAngles = [Math.atan2(second.y - first.y, second.x - first.x)];
        [first, second].forEach(point => candidates.push({ ...point, type: 'endpoint', entityId: entity.id, guideAngles }));
    });
    if (snaps.midpoint) segments.forEach(([first, second]) => candidates.push({
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
        type: 'midpoint',
        entityId: entity.id,
        guideAngles: [Math.atan2(second.y - first.y, second.x - first.x)],
    }));
    if (snaps.center && entity.type === 'circle') candidates.push({ x: entity.cx, y: entity.cy, type: 'center', entityId: entity.id });
    return candidates;
}

export function nearestSnapCandidate(point, entity) {
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        return entity.parts.reduce((best, part) => {
            const candidate = nearestSnapCandidate(point, part);
            if (!candidate) return best;
            const normalized = { ...candidate, entityId: entity.id, distance: pointDistance(point, candidate) };
            return !best || normalized.distance < best.distance ? normalized : best;
        }, null);
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
            ? { ...radial, type: 'nearest', entityId: entity.id, guideAngles: [pointAngle({ x: entity.cx, y: entity.cy }, radial) + Math.PI / 2] }
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
        };
        const distance = pointDistance(point, candidate);
        return !best || distance < best.distance ? { ...candidate, distance } : best;
    }, null);
}
