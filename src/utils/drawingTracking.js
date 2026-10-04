import { isConstructionLine, intersectConstructionLine } from './drawingConstructionLines.js';
import { getEntitySegments, pointDistance } from './drawingPrimitives.js';
import { snapDrawingPoint } from './drawingGeometry.js';
import {
    getPolarTrackingAngles,
    isOrthoTrackingEnabled,
    normalizeDrawingDraftingSettings,
    relationIsEnabled,
} from './drawingDraftingSettings.js';

const EPSILON = 1e-9;
const ACQUISITION_TYPES = new Set(['endpoint', 'midpoint', 'center', 'intersection']);
export const MAX_TRACKING_ANCHORS = 7;
export const MAX_TRACKING_GUIDES_PER_ANCHOR = 8;
export const MAX_ACTIVE_TRACKING_GUIDES = 48;
export const MAX_GUIDE_ENTITY_CHECKS = 20_000;
export const MAX_GUIDE_ENTITY_INTERSECTIONS = 64;
export const MAX_GUIDE_ENTITY_SEGMENT_CHECKS = 128;
export const MAX_TRACKING_INTERSECTION_CANDIDATES = 512;

export function constrainOrthogonalPoint(origin, point) {
    if (!origin || !point) return point;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return Math.abs(dx) >= Math.abs(dy)
        ? { x: origin.x + dx, y: origin.y, type: 'orthogonal' }
        : { x: origin.x, y: origin.y + dy, type: 'orthogonal' };
}

export function createTrackingAnchor(snap, settings = {}, { allowNearest = false } = {}) {
    if (!snap || (!ACQUISITION_TYPES.has(snap.type) && !(allowNearest && snap.type === 'nearest'))) return null;
    return buildTrackingAnchor(snap, settings);
}

export function createTemporaryTrackingAnchor(point, settings = {}) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const acquired = createTrackingAnchor(point, settings, { allowNearest: true });
    return {
        ...(acquired || buildTrackingAnchor({ ...point, type: 'temporary' }, settings)),
        temporary: true,
        sourceType: point.type || 'temporary',
    };
}

export function addTrackingAnchor(anchors, candidate, maximum = MAX_TRACKING_ANCHORS) {
    if (!candidate) return anchors || [];
    const current = Array.isArray(anchors) ? anchors : [];
    const duplicate = current.some(anchor => pointDistance(anchor, candidate) <= EPSILON);
    if (duplicate) return current;
    const limit = Math.max(1, Math.min(MAX_TRACKING_ANCHORS, Math.floor(Number(maximum) || MAX_TRACKING_ANCHORS)));
    return [...current, candidate].slice(-limit);
}

export function resolveDrawingSnap(point, content, threshold, {
    trackingAnchor = null,
    trackingAnchors = [],
    excludeIds = [],
    orthogonalOrigin = null,
    forceOrthogonal = false,
    temporaryOrtho = false,
} = {}) {
    const direct = snapDrawingPoint(point, content, threshold, { excludeIds });
    const settings = normalizeDrawingDraftingSettings(content.settings);
    const availableAnchors = normalizeAnchors(trackingAnchors, trackingAnchor);
    const anchors = settings.tracking ? availableAnchors : availableAnchors.filter(anchor => anchor.temporary);
    const orthoEnabled = Boolean(orthogonalOrigin) && (
        forceOrthogonal || isOrthoTrackingEnabled(settings, temporaryOrtho)
    );
    const polarAngles = !orthoEnabled && orthogonalOrigin && settings.polarTracking
        ? getPolarTrackingAngles(settings)
        : [];
    const tracked = anchors.length || orthoEnabled || polarAngles.length
        ? resolveTrackingPoint(point, content, threshold, anchors, excludeIds, orthoEnabled ? orthogonalOrigin : null, {
            polarOrigin: polarAngles.length ? orthogonalOrigin : null,
            polarAngles,
            intersectionGuideKind: orthoEnabled ? 'orthogonal' : null,
        })
        : null;
    if (orthoEnabled && orthogonalOrigin) {
        const directOnAxis = distanceToOrthogonalAxes(orthogonalOrigin, direct) <= threshold;
        if (tracked?.type === 'trackingIntersection' && tracked.guides?.some(guide => guide.kind === 'orthogonal')) return tracked;
        if (tracked?.type === 'orthogonal') return tracked;
        if (direct.type && directOnAxis && !['grid', 'nearest'].includes(direct.type)) return direct;
        return constrainOrthogonalPoint(orthogonalOrigin, point);
    }
    if (tracked?.type === 'trackingIntersection') return tracked;
    if (direct.type && !['grid', 'nearest'].includes(direct.type)) return direct;
    return tracked || direct;
}

export function resolveTrackingPoint(
    point,
    content,
    threshold,
    anchors,
    excludeIds = [],
    orthogonalOrigin = null,
    { polarOrigin = null, polarAngles = [], intersectionGuideKind = null } = {},
) {
    if (!point) return null;
    const normalizedAnchors = normalizeAnchors(anchors);
    const anchorGuides = normalizedAnchors.flatMap((anchor, anchorIndex) => selectTrackingGuidesNearPoint(
        anchorDirections(anchor).map(direction => ({
            anchor,
            angle: direction.angle,
            anchorIndex,
            kind: 'tracking',
            relation: direction.relation || null,
        })),
        point,
        threshold,
        MAX_TRACKING_GUIDES_PER_ANCHOR,
    ));
    const referenceGuides = [];
    if (orthogonalOrigin) {
        referenceGuides.push(
            { anchor: orthogonalOrigin, angle: 0, anchorIndex: -1, kind: 'orthogonal' },
            { anchor: orthogonalOrigin, angle: Math.PI / 2, anchorIndex: -1, kind: 'orthogonal' },
        );
    } else if (polarOrigin) {
        referenceGuides.push(...uniqueAngles(polarAngles).map(angle => ({
            anchor: polarOrigin,
            angle,
            anchorIndex: -1,
            kind: 'polar',
        })));
    }
    const guides = selectTrackingGuidesNearPoint(
        [...anchorGuides, ...referenceGuides],
        point,
        threshold,
        MAX_ACTIVE_TRACKING_GUIDES,
    );
    if (!guides.length) return null;
    const excluded = new Set(excludeIds);
    const visibleLayers = new Set(content.layers.filter(layer => layer.visible).map(layer => layer.id));
    const entities = content.entities.filter(entity => visibleLayers.has(entity.layerId) && !excluded.has(entity.id));
    const guideIntersections = [];
    guides.forEach((first, index) => guides.slice(index + 1).forEach(second => {
        if (first.anchorIndex === second.anchorIndex) return;
        if (intersectionGuideKind && first.kind !== intersectionGuideKind && second.kind !== intersectionGuideKind) return;
        const intersection = guideGuideIntersection(first, second);
        if (intersection) guideIntersections.push({
            ...intersection,
            type: 'trackingIntersection',
            guides: [first, second],
            guide: first,
            distance: pointDistance(point, intersection),
        });
    }));
    const guideIntersection = closestWithin(guideIntersections, threshold);
    if (guideIntersection) return guideIntersection;
    if (content.settings?.snaps?.nearest) {
        const intersections = [];
        let checks = 0;
        const entityGuides = intersectionGuideKind
            ? guides.filter(guide => guide.kind === intersectionGuideKind)
            : guides;
        for (const guide of entityGuides) {
            for (const entity of entities) {
                if (checks >= MAX_GUIDE_ENTITY_CHECKS
                    || intersections.length >= MAX_TRACKING_INTERSECTION_CANDIDATES) break;
                checks += 1;
                for (const candidate of guideEntityIntersections(guide.anchor, guide.angle, entity)) {
                    intersections.push({
                        ...candidate,
                        type: 'trackingIntersection',
                        entityId: entity.id,
                        guide,
                        guides: [guide],
                        distance: pointDistance(point, candidate),
                    });
                    if (intersections.length >= MAX_TRACKING_INTERSECTION_CANDIDATES) break;
                }
            }
            if (checks >= MAX_GUIDE_ENTITY_CHECKS
                || intersections.length >= MAX_TRACKING_INTERSECTION_CANDIDATES) break;
        }
        const intersection = closestWithin(intersections, threshold);
        if (intersection) return intersection;
    }
    const projections = guides.map(guide => {
        const direction = { x: Math.cos(guide.angle), y: Math.sin(guide.angle) };
        const parameter = (point.x - guide.anchor.x) * direction.x + (point.y - guide.anchor.y) * direction.y;
        const projected = { x: guide.anchor.x + direction.x * parameter, y: guide.anchor.y + direction.y * parameter };
        return {
            ...projected,
            type: trackingTypeForGuide(guide),
            guide,
            guides: [guide],
            distance: pointDistance(point, projected),
        };
    });
    return closestWithin(projections, threshold);
}

export function selectTrackingGuidesNearPoint(guides, point, threshold, maximum = MAX_ACTIVE_TRACKING_GUIDES) {
    const aperture = Math.max(0, Number(threshold) || 0);
    const limit = Math.max(1, Math.min(MAX_ACTIVE_TRACKING_GUIDES, Math.floor(Number(maximum) || MAX_ACTIVE_TRACKING_GUIDES)));
    return (Array.isArray(guides) ? guides : [])
        .map((guide, index) => ({ guide, index, distance: distanceToGuide(point, guide) }))
        .filter(candidate => candidate.distance <= aperture + EPSILON)
        .sort((left, right) => left.distance - right.distance || left.index - right.index)
        .slice(0, limit)
        .map(candidate => candidate.guide);
}

function buildTrackingAnchor(snap, settings) {
    const drafting = normalizeDrawingDraftingSettings(settings);
    const sourceDirections = Array.isArray(snap.trackingDirections)
        ? snap.trackingDirections
            .filter(direction => Number.isFinite(direction?.angle) && relationIsEnabled(drafting, direction.relation))
            .map(direction => ({ angle: direction.angle, relation: direction.relation || null }))
        : (snap.guideAngles || [])
            .filter(Number.isFinite)
            .map(angle => ({ angle, relation: 'parallel' }))
            .filter(direction => relationIsEnabled(drafting, direction.relation));
    const polarDirections = drafting.polarTracking
        ? getPolarTrackingAngles(drafting).map(angle => ({ angle, relation: null }))
        : [{ angle: 0, relation: null }, { angle: Math.PI / 2, relation: null }];
    const directions = uniqueDirections([...sourceDirections, ...polarDirections]);
    return {
        x: Number(snap.x),
        y: Number(snap.y),
        angles: directions.map(direction => direction.angle),
        directions,
        sourceType: snap.type,
        sourceEntityId: snap.entityId || null,
    };
}

function anchorDirections(anchor) {
    if (Array.isArray(anchor?.directions)) return uniqueDirections(anchor.directions);
    return uniqueAngles(anchor?.angles || []).map(angle => ({ angle, relation: null }));
}

function uniqueDirections(directions) {
    return directions.reduce((result, direction) => {
        const angle = normalizeAngle(direction?.angle);
        if (angle === null) return result;
        if (!result.some(value => angularDistance(value.angle, angle) <= 1e-6)) {
            result.push({ angle, relation: direction?.relation || null });
        }
        return result;
    }, []);
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

function guideEntityIntersections(anchor, angle, entity, budget = { remaining: MAX_GUIDE_ENTITY_SEGMENT_CHECKS }) {
    if (isConstructionLine(entity)) {
        if (budget.remaining <= 0) return [];
        budget.remaining -= 1;
        return intersectConstructionLine(entity, { type: 'xline', x1: anchor.x, y1: anchor.y, x2: anchor.x + Math.cos(angle), y2: anchor.y + Math.sin(angle) });
    }
    if (budget.remaining <= 0) return [];
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        const intersections = [];
        for (const part of entity.parts) {
            intersections.push(...guideEntityIntersections(anchor, angle, part, budget));
            if (budget.remaining <= 0 || intersections.length >= MAX_GUIDE_ENTITY_INTERSECTIONS) break;
        }
        return intersections.slice(0, MAX_GUIDE_ENTITY_INTERSECTIONS);
    }
    if (entity.type === 'polyline' && Array.isArray(entity.points)) {
        const intersections = [];
        for (let index = 0; index + 1 < entity.points.length; index += 1) {
            if (budget.remaining <= 0 || intersections.length >= MAX_GUIDE_ENTITY_INTERSECTIONS) break;
            budget.remaining -= 1;
            const intersection = guideSegmentIntersection(
                anchor,
                direction,
                entity.points[index],
                entity.points[index + 1],
            );
            if (intersection) intersections.push(intersection);
        }
        if (entity.closed && entity.points.length > 2 && budget.remaining > 0
            && intersections.length < MAX_GUIDE_ENTITY_INTERSECTIONS) {
            budget.remaining -= 1;
            const intersection = guideSegmentIntersection(
                anchor,
                direction,
                entity.points[entity.points.length - 1],
                entity.points[0],
            );
            if (intersection) intersections.push(intersection);
        }
        return intersections;
    }
    if (entity.type === 'circle') {
        budget.remaining -= 1;
        return guideCircleIntersections(anchor, direction, entity);
    }
    const intersections = [];
    for (const [first, second] of getEntitySegments(entity)) {
        if (budget.remaining <= 0) break;
        budget.remaining -= 1;
        const intersection = guideSegmentIntersection(anchor, direction, first, second);
        if (intersection) intersections.push(intersection);
        if (intersections.length >= MAX_GUIDE_ENTITY_INTERSECTIONS) break;
    }
    return intersections;
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
        const normalized = normalizeAngle(angle);
        if (normalized !== null && !result.some(value => angularDistance(value, normalized) <= 1e-6)) result.push(normalized);
        return result;
    }, []);
}

function normalizeAngle(angle) {
    const numeric = Number(angle);
    return Number.isFinite(numeric) ? ((numeric % Math.PI) + Math.PI) % Math.PI : null;
}

function angularDistance(first, second) {
    const delta = Math.abs(first - second) % Math.PI;
    return Math.min(delta, Math.PI - delta);
}

function normalizeAnchors(anchors, legacyAnchor = null) {
    const values = Array.isArray(anchors) ? anchors : anchors ? [anchors] : [];
    return legacyAnchor && !values.includes(legacyAnchor) ? [...values, legacyAnchor] : values;
}

function distanceToOrthogonalAxes(origin, point) {
    if (!origin || !point) return Infinity;
    return Math.min(Math.abs(point.x - origin.x), Math.abs(point.y - origin.y));
}

function distanceToGuide(point, guide) {
    if (!point || !guide?.anchor || !Number.isFinite(guide.angle)) return Infinity;
    const direction = { x: Math.cos(guide.angle), y: Math.sin(guide.angle) };
    return Math.abs((point.x - guide.anchor.x) * direction.y - (point.y - guide.anchor.y) * direction.x);
}

function closestWithin(candidates, threshold) {
    return candidates.reduce((best, candidate) => (
        candidate.distance <= threshold && (!best || candidate.distance < best.distance) ? candidate : best
    ), null);
}

function trackingTypeForGuide(guide) {
    if (guide.kind === 'orthogonal') return 'orthogonal';
    if (guide.kind === 'polar') return 'polar';
    if (guide.relation === 'parallel') return 'parallelTracking';
    if (guide.relation === 'perpendicular') return 'perpendicularTracking';
    if (guide.relation === 'tangent') return 'tangentTracking';
    return 'tracking';
}

function cross(left, right) {
    return left.x * right.y - left.y * right.x;
}
