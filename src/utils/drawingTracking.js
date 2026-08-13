import { getEntitySegments, pointDistance } from './drawingPrimitives.js';
import { snapDrawingPoint } from './drawingGeometry.js';

const EPSILON = 1e-9;
const ACQUISITION_TYPES = new Set(['endpoint', 'midpoint', 'center', 'intersection']);

export function constrainOrthogonalPoint(origin, point) {
    if (!origin || !point) return point;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return Math.abs(dx) >= Math.abs(dy)
        ? { x: origin.x + dx, y: origin.y, type: 'orthogonal' }
        : { x: origin.x, y: origin.y + dy, type: 'orthogonal' };
}

export function createTrackingAnchor(snap) {
    if (!snap || !ACQUISITION_TYPES.has(snap.type)) return null;
    const angles = uniqueAngles([0, Math.PI / 2, ...(snap.guideAngles || [])]);
    return { x: snap.x, y: snap.y, angles, sourceType: snap.type, sourceEntityId: snap.entityId || null };
}

export function addTrackingAnchor(anchors, candidate, maximum = 4) {
    if (!candidate) return anchors || [];
    const current = Array.isArray(anchors) ? anchors : [];
    const duplicate = current.some(anchor => pointDistance(anchor, candidate) <= EPSILON);
    if (duplicate) return current;
    return [...current, candidate].slice(-maximum);
}

export function resolveDrawingSnap(point, content, threshold, {
    trackingAnchor = null,
    trackingAnchors = [],
    excludeIds = [],
    orthogonalOrigin = null,
    forceOrthogonal = false,
} = {}) {
    const direct = snapDrawingPoint(point, content, threshold, { excludeIds });
    const anchors = normalizeAnchors(trackingAnchors, trackingAnchor);
    const tracked = content.settings?.tracking
        ? resolveTrackingPoint(point, content, threshold, anchors, excludeIds, forceOrthogonal ? orthogonalOrigin : null)
        : forceOrthogonal && orthogonalOrigin
            ? resolveTrackingPoint(point, content, threshold, [], excludeIds, orthogonalOrigin)
        : null;
    if (forceOrthogonal && orthogonalOrigin) {
        const directOnAxis = distanceToOrthogonalAxes(orthogonalOrigin, direct) <= threshold;
        if (tracked?.type === 'trackingIntersection') return tracked;
        if (direct.type && directOnAxis && !['grid', 'nearest'].includes(direct.type)) return direct;
        return tracked || constrainOrthogonalPoint(orthogonalOrigin, point);
    }
    if (tracked?.type === 'trackingIntersection') return tracked;
    if (direct.type && !['grid', 'nearest'].includes(direct.type)) return direct;
    return tracked || direct;
}

export function resolveTrackingPoint(point, content, threshold, anchors, excludeIds = [], orthogonalOrigin = null) {
    if (!point) return null;
    const normalizedAnchors = normalizeAnchors(anchors);
    const guides = normalizedAnchors.flatMap((anchor, anchorIndex) => anchor.angles.map(angle => ({
        anchor,
        angle,
        anchorIndex,
        kind: 'tracking',
    })));
    if (orthogonalOrigin) {
        guides.push(
            { anchor: orthogonalOrigin, angle: 0, anchorIndex: -1, kind: 'orthogonal' },
            { anchor: orthogonalOrigin, angle: Math.PI / 2, anchorIndex: -1, kind: 'orthogonal' },
        );
    }
    if (!guides.length) return null;
    const excluded = new Set(excludeIds);
    const visibleLayers = new Set(content.layers.filter(layer => layer.visible).map(layer => layer.id));
    const entities = content.entities.filter(entity => visibleLayers.has(entity.layerId) && !excluded.has(entity.id));
    const guideIntersections = guides.flatMap((first, index) => guides.slice(index + 1).flatMap(second => {
        if (first.anchorIndex === second.anchorIndex) return [];
        const intersection = guideGuideIntersection(first, second);
        return intersection ? [{
            ...intersection,
            type: 'trackingIntersection',
            guides: [first, second],
            guide: first,
            distance: pointDistance(point, intersection),
        }] : [];
    }));
    const guideIntersection = closestWithin(guideIntersections, threshold);
    if (guideIntersection) return guideIntersection;
    if (content.settings?.snaps?.nearest) {
        const intersections = guides.flatMap(guide => entities.flatMap(entity => (
            guideEntityIntersections(guide.anchor, guide.angle, entity).map(candidate => ({
                ...candidate,
                type: 'trackingIntersection',
                entityId: entity.id,
                guide,
                guides: [guide],
                distance: pointDistance(point, candidate),
            }))
        )));
        const intersection = closestWithin(intersections, threshold);
        if (intersection) return intersection;
    }
    const projections = guides.map(guide => {
        const direction = { x: Math.cos(guide.angle), y: Math.sin(guide.angle) };
        const parameter = (point.x - guide.anchor.x) * direction.x + (point.y - guide.anchor.y) * direction.y;
        const projected = { x: guide.anchor.x + direction.x * parameter, y: guide.anchor.y + direction.y * parameter };
        return {
            ...projected,
            type: guide.kind === 'orthogonal' ? 'orthogonal' : 'tracking',
            guide,
            guides: [guide],
            distance: pointDistance(point, projected),
        };
    });
    return closestWithin(projections, threshold);
}

function guideGuideIntersection(first, second) {
    const firstDirection = { x: Math.cos(first.angle), y: Math.sin(first.angle) };
    const secondDirection = { x: Math.cos(second.angle), y: Math.sin(second.angle) };
    const denominator = cross(firstDirection, secondDirection);
    if (Math.abs(denominator) <= EPSILON) return null;
    const delta = { x: second.anchor.x - first.anchor.x, y: second.anchor.y - first.anchor.y };
    const parameter = cross(delta, secondDirection) / denominator;
    return {
        x: first.anchor.x + firstDirection.x * parameter,
        y: first.anchor.y + firstDirection.y * parameter,
    };
}

function guideEntityIntersections(anchor, angle, entity) {
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        return entity.parts.flatMap(part => guideEntityIntersections(anchor, angle, part));
    }
    if (entity.type === 'circle') return guideCircleIntersections(anchor, direction, entity);
    return getEntitySegments(entity).flatMap(([first, second]) => {
        const intersection = guideSegmentIntersection(anchor, direction, first, second);
        return intersection ? [intersection] : [];
    });
}

function guideSegmentIntersection(anchor, direction, first, second) {
    const segment = { x: second.x - first.x, y: second.y - first.y };
    const denominator = cross(direction, segment);
    if (Math.abs(denominator) <= EPSILON) return null;
    const delta = { x: first.x - anchor.x, y: first.y - anchor.y };
    const segmentParameter = cross(delta, direction) / denominator;
    if (segmentParameter < -EPSILON || segmentParameter > 1 + EPSILON) return null;
    const guideParameter = cross(delta, segment) / denominator;
    return { x: anchor.x + direction.x * guideParameter, y: anchor.y + direction.y * guideParameter };
}

function guideCircleIntersections(anchor, direction, circle) {
    const delta = { x: anchor.x - circle.cx, y: anchor.y - circle.cy };
    const linear = 2 * (delta.x * direction.x + delta.y * direction.y);
    const constant = delta.x ** 2 + delta.y ** 2 - circle.r ** 2;
    const discriminant = linear ** 2 - 4 * constant;
    if (discriminant < -EPSILON) return [];
    const root = Math.sqrt(Math.max(0, discriminant));
    return [(-linear - root) / 2, (-linear + root) / 2]
        .filter((value, index, values) => index === 0 || Math.abs(value - values[0]) > EPSILON)
        .map(parameter => ({ x: anchor.x + direction.x * parameter, y: anchor.y + direction.y * parameter }));
}

function uniqueAngles(angles) {
    return angles.reduce((result, angle) => {
        const normalized = ((Number(angle) || 0) % Math.PI + Math.PI) % Math.PI;
        if (!result.some(value => Math.abs(value - normalized) <= 1e-6)) result.push(normalized);
        return result;
    }, []);
}

function normalizeAnchors(anchors, legacyAnchor = null) {
    const values = Array.isArray(anchors) ? anchors : anchors ? [anchors] : [];
    return legacyAnchor && !values.includes(legacyAnchor) ? [...values, legacyAnchor] : values;
}

function distanceToOrthogonalAxes(origin, point) {
    if (!origin || !point) return Infinity;
    return Math.min(Math.abs(point.x - origin.x), Math.abs(point.y - origin.y));
}

function closestWithin(candidates, threshold) {
    return candidates.reduce((best, candidate) => (
        candidate.distance <= threshold && (!best || candidate.distance < best.distance) ? candidate : best
    ), null);
}

function cross(left, right) {
    return left.x * right.y - left.y * right.x;
}
