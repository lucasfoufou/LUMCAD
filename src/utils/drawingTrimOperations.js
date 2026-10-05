import { isDrawingLayerVisible } from './drawingLayers.js';
import { isDrawingObjectHidden } from './drawingObjectVisibility.js';
import { materializeDrawingBlockReference } from './drawingBlocks.js';
import { canEditEntity, createDrawingId } from './drawingDocument.js';
import {
    closestPointOnPath,
    curvePointAt,
    curveSubcurve,
    curveTangentAt,
    extractEntityPaths,
    getCurveEnd,
    getCurveStart,
    intersectCurves,
    intersectPaths,
    normalizeCurvePath,
    normalizeCurvePrimitive,
    pathSubpath,
} from './drawingCurveKernel.js';
import { getDrawingEntityDependencyIds } from './drawingDimensions.js';

const TAU = Math.PI * 2;
const EPSILON = 1e-9;
const MAX_COORDINATE = 1e12;
const MAX_TARGETS = 10_000;
const MAX_BOUNDARIES = 10_000;
const MAX_FENCE_POINTS = 4_096;
const GEOMETRY_KEYS = new Set([
    'type', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'radiusX', 'radiusY',
    'majorRadius', 'minorRadius', 'startAngle', 'endAngle', 'counterClockwise', 'fullCircle',
    'fullEllipse', 'controlPoints', 'degree', 'p0', 'p1', 'p2', 'p3', 'x', 'y', 'width',
    'height', 'rotation', 'sides', 'mode', 'points', 'parts', 'closed', 'cornerStyle',
    'cornerValue', 'fillet', 'chamfer',
]);
const PART_METADATA_KEYS = new Set([
    'id', 'layerId', 'color', 'lineWeight', 'lineWidth', 'lineType', 'transparency', 'locked',
    'sourceId', 'sourceIds', 'previewMode',
]);

export const DRAWING_TRIM_EXTEND_LIMITS = Object.freeze({
    maxTargets: MAX_TARGETS,
    maxBoundaries: MAX_BOUNDARIES,
    maxFencePoints: MAX_FENCE_POINTS,
    maxCoordinate: MAX_COORDINATE,
});

export function replaceTrimScope(scopeIds, affectedIds, replacementIds) {
    if (!scopeIds) return null;
    const affected = new Set(affectedIds || []);
    return [...scopeIds.filter(id => !affected.has(id)), ...(replacementIds || [])];
}

/** Pure trim of one entity. Boundary entities are supplied separately. */
export function trimDrawingEntity(entity, pointOrPoints, boundaries = [], options = {}) {
    const projection = normalizeProjection(options);
    const picks = normalizePickPoints(pointOrPoints);
    if (!projection || !entity || !picks.length) return trimUnchanged('invalid-input', projection);
    const extraction = drawingBoundaryExtractionOptions(options.content, options);
    const paths = extractEntityPaths(entity, extraction);
    if (!paths.length) return trimUnchanged('unsupported-target', projection);
    const boundaryRecords = createBoundaryPathRecords(boundaries, extraction, options);
    if (boundaryRecords.invalid) return trimUnchanged(boundaryRecords.reason, projection);

    const picksByPath = new Map();
    picks.forEach(point => {
        const nearest = closestEntityPath(paths, point, options);
        if (!nearest) return;
        const list = picksByPath.get(nearest.pathIndex) || [];
        list.push({ point, location: nearest.location });
        picksByPath.set(nearest.pathIndex, list);
    });
    if (!picksByPath.size) return trimUnchanged('invalid-pick', projection);

    const remainingPaths = [];
    const removedPaths = [];
    let truncated = false;
    let ambiguous = false;
    paths.forEach((path, pathIndex) => {
        const pathPicks = picksByPath.get(pathIndex);
        if (!pathPicks?.length) {
            remainingPaths.push(path);
            return;
        }
        const cuts = collectPathBoundaryCuts(path, boundaryRecords.records, options);
        truncated ||= cuts.truncated;
        ambiguous ||= cuts.ambiguous;
        if (cuts.truncated) return;
        const result = cuts.locations.length
            ? trimPathIntervals(path, pathPicks, cuts.locations, options)
            : options.removeUnbounded === false ? null : removePickedPathParts(path, pathPicks, options);
        if (!result?.changed) {
            remainingPaths.push(path);
            return;
        }
        remainingPaths.push(...result.remainingPaths);
        removedPaths.push(...result.removedPaths);
    });
    if (truncated) return trimUnchanged('safety-limit', projection, { truncated: true });
    if (!removedPaths.length) return trimUnchanged(ambiguous ? 'overlapping-boundary' : 'no-intersection', projection);
    const fragments = remainingPaths.map(path => entityFromPath(entity, path)).filter(Boolean);
    return {
        status: fragments.length ? 'trimmed' : 'removed',
        changed: true,
        fragments,
        remainingPaths,
        removedPaths,
        removedCurves: removedPaths.flatMap(path => path.parts.map(part => ({ ...part }))),
        removedSegments: pathChords(removedPaths),
        projection,
        truncated: false,
    };
}

export function trimDrawingTarget(content, targetOrId, point, options = {}) {
    const target = resolveEditableTarget(content, targetOrId);
    if (!target) return drawingTrimUnchanged(content, 'not-editable');
    const boundaries = visibleBoundaryEntities(content, options.boundaryIds, new Set([target.id]));
    const result = trimDrawingEntity(target, point, boundaries, { ...options, content });
    if (!result.changed) return drawingTrimUnchanged(content, result.reason, result);
    const replacements = result.fragments.map(fragment => ({
        ...fragment,
        id: createDrawingId(fragment.type || 'curve'),
        layerId: fragment.layerId || target.layerId,
    }));
    return {
        ...result,
        content: replaceDrawingTargets(content, new Map([[target.id, replacements]])),
        replacements,
        replacementIds: replacements.map(item => item.id),
        affectedIds: [target.id],
    };
}

/** Legacy preview result: endpoint chords for every removed native part. */
export function previewTrimDrawingTarget(content, targetOrId, point, options = {}) {
    const target = resolveEditableTarget(content, targetOrId);
    if (!target) return [];
    const boundaries = visibleBoundaryEntities(content, options.boundaryIds, new Set([target.id]));
    const result = trimDrawingEntity(target, point, boundaries, { ...options, content });
    return result.changed ? result.removedSegments : [];
}

export function previewTrimDrawingTargetEntities(content, targetOrId, point, options = {}) {
    const target = resolveEditableTarget(content, targetOrId);
    if (!target) return [];
    const boundaries = visibleBoundaryEntities(content, options.boundaryIds, new Set([target.id]));
    const result = trimDrawingEntity(target, point, boundaries, { ...options, content });
    return result.changed ? previewEntitiesFromPaths(target, result.removedPaths, 'trim') : [];
}

/** Plans from the original content, then applies every target replacement once. */
export function trimDrawingTargets(content, {
    targetIds = null,
    boundaryIds = null,
    picks = [],
    fence = null,
    ...options
} = {}) {
    const targets = editableTargets(content, targetIds);
    if (targets.invalid) return drawingBatchUnchanged(content, targets.reason);
    const pickMap = normalizePickMap(picks);
    if (fence) {
        getDrawingTrimFenceHits(content, fence, { ...options, targetIds: targets.entities.map(item => item.id) })
            .forEach(hit => pickMap.set(hit.entityId, [...(pickMap.get(hit.entityId) || []), ...hit.points]));
    }
    const allBoundaries = visibleBoundaryEntities(content, boundaryIds, new Set());
    if (allBoundaries.length > MAX_BOUNDARIES) return drawingBatchUnchanged(content, 'too-many-boundaries');
    const replacementMap = new Map();
    const results = [];
    targets.entities.forEach(target => {
        const targetPicks = pickMap.get(target.id);
        if (!targetPicks?.length) return;
        const result = trimDrawingEntity(
            target,
            targetPicks,
            allBoundaries.filter(boundary => boundary.id !== target.id),
            { ...options, content },
        );
        if (!result.changed) return;
        const replacements = result.fragments.map(fragment => ({
            ...fragment,
            id: createDrawingId(fragment.type || 'curve'),
            layerId: fragment.layerId || target.layerId,
        }));
        replacementMap.set(target.id, replacements);
        results.push({ targetId: target.id, replacements, ...result });
    });
    if (!results.length) return drawingBatchUnchanged(content, 'no-change');
    const affectedIds = results.map(result => result.targetId);
    const replacements = results.flatMap(result => result.replacements);
    return {
        changed: true,
        changedCount: results.length,
        content: replaceDrawingTargets(content, replacementMap),
        results,
        affectedIds,
        replacements,
        replacementIds: replacements.map(item => item.id),
        removedPaths: results.flatMap(result => result.removedPaths),
        removedSegments: results.flatMap(result => result.removedSegments),
    };
}

export function trimDrawingFence(content, fence, options = {}) {
    const legacyScope = options.scopeIds?.length ? options.scopeIds : null;
    const targetIds = Object.hasOwn(options, 'targetIds') ? options.targetIds : legacyScope;
    const boundaryIds = Object.hasOwn(options, 'boundaryIds') ? options.boundaryIds : legacyScope;
    return trimDrawingTargets(content, { ...options, targetIds, boundaryIds, fence });
}

export function previewTrimDrawingFence(content, fence, options = {}) {
    return planTrimFence(content, fence, options).results.flatMap(item => item.result.removedSegments);
}

export function previewTrimDrawingFenceEntities(content, fence, options = {}) {
    return planTrimFence(content, fence, options).results
        .flatMap(item => previewEntitiesFromPaths(item.target, item.result.removedPaths, 'trim'));
}

export function createTrimPreviewEntities(content, {
    fence = null,
    targetId = null,
    point = null,
    scopeIds = null,
    boundaryIds = scopeIds,
    targetIds = scopeIds,
    ...options
} = {}) {
    return fence
        ? previewTrimDrawingFenceEntities(content, fence, { ...options, targetIds, boundaryIds })
        : targetId && point
            ? previewTrimDrawingTargetEntities(content, targetId, point, { ...options, boundaryIds })
            : [];
}

export function getDrawingTrimFenceHits(content, fence, { targetIds = null, ...options } = {}) {
    const fencePath = normalizeFencePath(fence, options);
    const targets = editableTargets(content, targetIds);
    if (!fencePath || targets.invalid) return [];
    const extraction = drawingBoundaryExtractionOptions(content, options);
    const hits = [];
    targets.entities.forEach(target => {
        const candidates = [];
        extractEntityPaths(target, extraction).forEach(targetPath => {
            const result = intersectPaths(targetPath, fencePath, options);
            if (result.truncated) return;
            result.points.forEach(hit => candidates.push({
                point: hit.point,
                fencePartIndex: hit.rightPartIndex,
                fenceT: hit.rightT,
            }));
        });
        const unique = deduplicatePoints(candidates, operationTolerance(options.tolerance))
            .sort((left, right) => (left.fencePartIndex + left.fenceT) - (right.fencePartIndex + right.fenceT));
        if (unique.length) hits.push({
            entityId: target.id,
            point: unique[0].point,
            points: unique.map(hit => hit.point),
        });
    });
    return hits;
}

/** Pure nearest-endpoint extension for lines, arcs and compatible open paths. */
export function extendDrawingEntity(entity, pickPoint, boundaries = [], options = {}) {
    const projection = normalizeProjection(options);
    const pick = finitePoint(pickPoint);
    if (!projection || !entity || !pick) return extendUnchanged('invalid-input', projection);
    const extraction = drawingBoundaryExtractionOptions(options.content, options);
    const paths = extractEntityPaths(entity, extraction);
    const nearest = closestOpenEndpoint(paths, pick, options);
    if (!nearest) return extendUnchanged('unsupported-open-endpoint', projection);
    const boundaryRecords = createBoundaryPathRecords(boundaries, extraction, options);
    if (boundaryRecords.invalid) return extendUnchanged(boundaryRecords.reason, projection);
    const candidates = extensionCandidates(nearest, boundaryRecords.records, options);
    if (candidates.truncated) return extendUnchanged('safety-limit', projection, { truncated: true });
    const candidate = candidates.items.sort((left, right) => left.distance - right.distance)[0];
    if (!candidate) return extendUnchanged('no-boundary', projection);
    const extendedCurve = extendTerminalCurve(nearest, candidate.point, options);
    if (!extendedCurve) return extendUnchanged('invalid-result', projection);
    const changedPath = normalizeCurvePath({
        ...nearest.path,
        parts: nearest.path.parts.map((part, index) => index === nearest.partIndex ? extendedCurve : { ...part }),
    }, options);
    if (!changedPath) return extendUnchanged('invalid-result', projection);
    const resultPaths = paths.map((path, index) => index === nearest.pathIndex ? changedPath : path);
    const fragments = resultPaths.map(path => entityFromPath(entity, path)).filter(Boolean);
    if (fragments.length !== 1) return extendUnchanged('multiple-paths', projection);
    return {
        status: 'extended',
        changed: true,
        entity: fragments[0],
        path: changedPath,
        endpoint: nearest.endpoint,
        boundaryId: candidate.boundaryId,
        boundaryPartIndex: candidate.boundaryPartIndex,
        point: candidate.point,
        distance: candidate.distance,
        extensionPath: extensionPathForResult(nearest, extendedCurve, options),
        projection,
        extendedEdges: usesExtendedEdges(options),
    };
}

export function extendDrawingTarget(content, targetOrId, point, options = {}) {
    const target = resolveEditableTarget(content, targetOrId);
    if (!target) return drawingExtendUnchanged(content, 'not-editable');
    const boundaries = visibleBoundaryEntities(content, options.boundaryIds, new Set([target.id]));
    const result = extendDrawingEntity(target, point, boundaries, { ...options, content });
    if (!result.changed) return drawingExtendUnchanged(content, result.reason, result);
    const replacement = { ...result.entity, id: target.id, layerId: result.entity.layerId || target.layerId };
    return {
        ...result,
        entity: replacement,
        replacements: [replacement],
        replacementIds: [replacement.id],
        affectedIds: [target.id],
        content: {
            ...content,
            entities: content.entities.map(item => item.id === target.id ? replacement : item),
        },
    };
}

export function previewExtendDrawingTarget(content, targetOrId, point, options = {}) {
    const target = resolveEditableTarget(content, targetOrId);
    if (!target) return [];
    const boundaries = visibleBoundaryEntities(content, options.boundaryIds, new Set([target.id]));
    const result = extendDrawingEntity(target, point, boundaries, { ...options, content });
    return result.changed && result.extensionPath
        ? previewEntitiesFromPaths(target, [result.extensionPath], 'extend')
        : [];
}

export function createExtendPreviewEntities(content, {
    targetId = null,
    point = null,
    boundaryIds = null,
    ...options
} = {}) {
    return targetId && point
        ? previewExtendDrawingTarget(content, targetId, point, { ...options, boundaryIds })
        : [];
}

export function extendDrawingTargets(content, {
    targetIds = null,
    boundaryIds = null,
    picks = [],
    ...options
} = {}) {
    const targets = editableTargets(content, targetIds);
    if (targets.invalid) return drawingBatchUnchanged(content, targets.reason);
    const pickMap = normalizePickMap(picks);
    const boundaries = visibleBoundaryEntities(content, boundaryIds, new Set());
    const results = [];
    targets.entities.forEach(target => {
        const point = pickMap.get(target.id)?.[0];
        if (!point) return;
        const result = extendDrawingEntity(
            target,
            point,
            boundaries.filter(boundary => boundary.id !== target.id),
            { ...options, content },
        );
        if (!result.changed) return;
        const replacement = { ...result.entity, id: target.id, layerId: result.entity.layerId || target.layerId };
        results.push({ targetId: target.id, replacement, ...result });
    });
    if (!results.length) return drawingBatchUnchanged(content, 'no-change');
    const byId = new Map(results.map(result => [result.targetId, result.replacement]));
    return {
        changed: true,
        changedCount: results.length,
        content: { ...content, entities: content.entities.map(item => byId.get(item.id) || item) },
        results,
        affectedIds: results.map(result => result.targetId),
        replacements: results.map(result => result.replacement),
        replacementIds: results.map(result => result.targetId),
    };
}

function planTrimFence(content, fence, options) {
    const legacyScope = options.scopeIds?.length ? options.scopeIds : null;
    const targetIds = Object.hasOwn(options, 'targetIds') ? options.targetIds : legacyScope;
    const boundaryIds = Object.hasOwn(options, 'boundaryIds') ? options.boundaryIds : legacyScope;
    const targets = editableTargets(content, targetIds);
    if (targets.invalid) return { results: [] };
    const hitMap = new Map(getDrawingTrimFenceHits(content, fence, { ...options, targetIds })
        .map(hit => [hit.entityId, hit.points]));
    const boundaries = visibleBoundaryEntities(content, boundaryIds, new Set());
    return {
        results: targets.entities.flatMap(target => {
            const points = hitMap.get(target.id);
            if (!points?.length) return [];
            const result = trimDrawingEntity(
                target,
                points,
                boundaries.filter(boundary => boundary.id !== target.id),
                { ...options, content },
            );
            return result.changed ? [{ target, result }] : [];
        }),
    };
}

function trimPathIntervals(path, picks, rawCuts, options) {
    const tolerance = operationTolerance(options.tolerance);
    const cuts = normalizeCutLocations(path, rawCuts, tolerance);
    if ((!path.closed && !cuts.length) || (path.closed && cuts.length < 2)) return null;
    const selected = new Set();
    picks.forEach(pick => {
        const scalar = locationScalar(path, pick.location);
        if (cuts.some(cut => cyclicScalarDistance(cut.scalar, scalar, path.closed) <= tolerance)) return;
        if (!path.closed) selected.add(cuts.filter(cut => cut.scalar < scalar).length);
        else {
            let index = cuts.findLastIndex(cut => cut.scalar < scalar);
            if (index < 0) index = cuts.length - 1;
            selected.add(index);
        }
    });
    if (!selected.size) return null;
    if (!path.closed) {
        const endpoints = [pathLocation(path, 0, 0), ...cuts, pathLocation(path, path.parts.length - 1, 1)];
        return pathIntervalGroups(path, endpoints, selected, false, options);
    }
    return pathIntervalGroups(path, cuts, selected, true, options);
}

function pathIntervalGroups(path, endpoints, selected, closed, options) {
    const intervalCount = closed ? endpoints.length : endpoints.length - 1;
    const removedGroups = groupedIntervals(intervalCount, index => selected.has(index), closed);
    const keptGroups = groupedIntervals(intervalCount, index => !selected.has(index), closed);
    const createPath = group => {
        const start = endpoints[group.start];
        const end = endpoints[(group.end + 1) % endpoints.length];
        return pathBetween(path, start, end, { ...options, fullLoop: group.count === intervalCount });
    };
    const removedPaths = removedGroups.map(createPath).filter(Boolean);
    const remainingPaths = keptGroups.map(createPath).filter(Boolean);
    return { changed: removedPaths.length > 0, removedPaths, remainingPaths };
}

function removePickedPathParts(path, picks, options) {
    const selected = new Set(picks.map(pick => pick.location.partIndex));
    if (!selected.size) return null;
    const count = path.parts.length;
    const removedPaths = [...selected].sort((left, right) => left - right).flatMap(index => {
        const part = path.parts[index];
        const normalized = part && normalizeCurvePath({ type: 'path', parts: [{ ...part }], closed: false }, options);
        return normalized ? [normalized] : [];
    });
    const remainingPaths = groupedIntervals(count, index => !selected.has(index), path.closed).flatMap(group => {
        const parts = Array.from({ length: group.count }, (_, offset) => ({
            ...path.parts[(group.start + offset) % count],
        }));
        const normalized = normalizeCurvePath({ type: 'path', parts, closed: false }, options);
        return normalized ? [normalized] : [];
    });
    return { changed: removedPaths.length > 0, removedPaths, remainingPaths };
}

function collectPathBoundaryCuts(path, records, options) {
    const locations = [];
    let truncated = false;
    let ambiguous = false;
    records.forEach(record => {
        const result = intersectPaths(path, record.path, options);
        truncated ||= result.truncated;
        ambiguous ||= result.overlaps.length > 0;
        result.points.forEach(hit => locations.push(pathLocation(path, hit.leftPartIndex, hit.leftT, hit.point)));
    });
    return { locations, truncated, ambiguous };
}

function createBoundaryPathRecords(boundaries, extraction, options) {
    if (!Array.isArray(boundaries) || boundaries.length > MAX_BOUNDARIES) {
        return { invalid: true, reason: 'too-many-boundaries', records: [] };
    }
    const records = [];
    for (const boundary of boundaries) {
        for (const path of extractEntityPaths(boundary, extraction)) {
            const paths = usesExtendedEdges(options) ? virtuallyExtendedBoundaryPaths(path, options) : [path];
            paths.forEach((prepared, pathIndex) => records.push({
                boundaryId: boundary.id || null,
                path: prepared,
                pathIndex,
            }));
            if (records.length > MAX_BOUNDARIES) {
                return { invalid: true, reason: 'too-many-boundaries', records: [] };
            }
        }
    }
    return { invalid: false, records };
}

function virtuallyExtendedBoundaryPaths(path, options) {
    return path.parts.flatMap(part => {
        let extended = null;
        if (part.type === 'line') extended = extendLineAcrossKernelBounds(part);
        else if (part.type === 'arc') extended = {
            ...part,
            type: 'circle',
            counterClockwise: part.counterClockwise !== false,
        };
        else if (part.type === 'ellipse' && !part.fullEllipse) extended = {
            ...part,
            startAngle: 0,
            endAngle: 0,
            fullEllipse: true,
        };
        const normalized = extended && normalizeCurvePrimitive(extended, options);
        const prepared = normalized && normalizeCurvePath({
            type: 'path',
            parts: [normalized],
            closed: normalized.type === 'circle' || Boolean(normalized.fullEllipse),
        }, options);
        if (prepared) return [prepared];
        const original = normalizeCurvePath({ type: 'path', parts: [{ ...part }], closed: false }, options);
        return original ? [original] : [];
    });
}

function extensionCandidates(nearest, records, options) {
    const support = extensionSupportCurve(nearest);
    if (!support) return { items: [], truncated: false };
    const items = [];
    let truncated = false;
    records.forEach(record => record.path.parts.forEach((part, boundaryPartIndex) => {
        const result = intersectCurves(support.curve, part, options);
        truncated ||= result.truncated;
        result.points.forEach(hit => {
            const distance = extensionDistance(nearest, hit.point, support);
            if (!Number.isFinite(distance) || distance <= operationTolerance(options.tolerance)) return;
            items.push({
                point: hit.point,
                distance,
                boundaryId: record.boundaryId,
                boundaryPartIndex,
            });
        });
    }));
    return {
        items: deduplicateExtensionCandidates(items, operationTolerance(options.tolerance)),
        truncated,
    };
}

function extensionSupportCurve(nearest) {
    const curve = nearest.path.parts[nearest.partIndex];
    if (curve.type === 'line') {
        const maximum = forwardDistanceToBounds(nearest.point, nearest.outward);
        if (!Number.isFinite(maximum) || maximum <= EPSILON) return null;
        return {
            type: 'line',
            maximum,
            curve: {
                type: 'line',
                x1: nearest.point.x,
                y1: nearest.point.y,
                x2: nearest.point.x + nearest.outward.x * maximum,
                y2: nearest.point.y + nearest.outward.y * maximum,
            },
        };
    }
    if (curve.type === 'arc') return {
        type: 'arc',
        curve: { type: 'circle', cx: curve.cx, cy: curve.cy, r: curve.r, counterClockwise: true },
    };
    if (curve.type === 'ellipse' && !curve.fullEllipse) return {
        type: 'ellipse',
        curve: { ...curve, startAngle: 0, endAngle: 0, fullEllipse: true },
    };
    return null;
}

function extensionDistance(nearest, point, support) {
    if (support.type === 'line') {
        const delta = subtractPoints(point, nearest.point);
        const forward = dot(delta, nearest.outward);
        const lateral = Math.abs(cross(delta, nearest.outward));
        return forward <= support.maximum + EPSILON
            && lateral <= Math.max(EPSILON, Math.abs(forward) * 1e-8) ? forward : null;
    }
    const curve = nearest.path.parts[nearest.partIndex];
    const endpointAngle = curveParameterAngle(curve, nearest.endpoint === 'start' ? 0 : 1);
    const pointAngle = curve.type === 'arc'
        ? Math.atan2(point.y - curve.cy, point.x - curve.cx)
        : ellipsePointAngle(curve, point);
    const traversal = curve.counterClockwise === false ? -1 : 1;
    const outward = nearest.endpoint === 'start' ? -traversal : traversal;
    const delta = outward > 0
        ? positiveAngleDelta(endpointAngle, pointAngle)
        : positiveAngleDelta(pointAngle, endpointAngle);
    if (delta <= EPSILON || delta >= TAU - curveAngularSweep(curve) - EPSILON) return null;
    return curve.type === 'arc' ? delta * curve.r : delta * Math.max(curve.rx, curve.ry);
}

function extendTerminalCurve(nearest, point, options) {
    const curve = nearest.path.parts[nearest.partIndex];
    if (curve.type === 'line') return normalizeCurvePrimitive(nearest.endpoint === 'start'
        ? { ...curve, x1: point.x, y1: point.y }
        : { ...curve, x2: point.x, y2: point.y }, options);
    if (curve.type === 'arc') {
        const angle = Math.atan2(point.y - curve.cy, point.x - curve.cx);
        return normalizeCurvePrimitive({
            ...curve,
            ...(nearest.endpoint === 'start' ? { startAngle: angle } : { endAngle: angle }),
        }, options);
    }
    if (curve.type === 'ellipse') {
        const angle = ellipsePointAngle(curve, point);
        return normalizeCurvePrimitive({
            ...curve,
            ...(nearest.endpoint === 'start' ? { startAngle: angle } : { endAngle: angle }),
            fullEllipse: false,
        }, options);
    }
    return null;
}

function extensionPathForResult(nearest, extendedCurve, options) {
    const source = nearest.path.parts[nearest.partIndex];
    let extension = null;
    if (source.type === 'line') {
        extension = nearest.endpoint === 'start'
            ? { ...source, x1: extendedCurve.x1, y1: extendedCurve.y1, x2: source.x1, y2: source.y1 }
            : { ...source, x1: source.x2, y1: source.y2, x2: extendedCurve.x2, y2: extendedCurve.y2 };
    } else {
        const originalPoint = nearest.endpoint === 'start' ? getCurveStart(source) : getCurveEnd(source);
        const originalT = curveParameterForExtendedCurve(extendedCurve, originalPoint);
        if (originalT !== null) extension = nearest.endpoint === 'start'
            ? curveSubcurve(extendedCurve, 0, originalT, options)
            : curveSubcurve(extendedCurve, originalT, 1, options);
    }
    return extension ? normalizeCurvePath({ type: 'path', parts: [extension], closed: false }, options) : null;
}

function curveParameterForExtendedCurve(curve, point) {
    if (!['arc', 'ellipse'].includes(curve.type)) return null;
    const angle = curve.type === 'arc'
        ? Math.atan2(point.y - curve.cy, point.x - curve.cx)
        : ellipsePointAngle(curve, point);
    const sweep = curveAngularSignedSweep(curve);
    const delta = sweep > 0
        ? positiveAngleDelta(curve.startAngle, angle)
        : positiveAngleDelta(angle, curve.startAngle);
    return Math.max(0, Math.min(1, delta / Math.abs(sweep)));
}

function closestOpenEndpoint(paths, pick, options) {
    let best = null;
    paths.forEach((path, pathIndex) => {
        if (path.closed) return;
        [
            { endpoint: 'start', partIndex: 0, t: 0 },
            { endpoint: 'end', partIndex: path.parts.length - 1, t: 1 },
        ].forEach(candidate => {
            const curve = path.parts[candidate.partIndex];
            if (!['line', 'arc', 'ellipse'].includes(curve.type) || (curve.type === 'ellipse' && curve.fullEllipse)) return;
            const point = candidate.t === 0 ? getCurveStart(curve, options) : getCurveEnd(curve, options);
            const tangent = curveTangentAt(curve, candidate.t, options);
            if (!point || !tangent) return;
            const distance = pointDistance(point, pick);
            const outward = candidate.endpoint === 'start'
                ? { x: -tangent.x, y: -tangent.y }
                : tangent;
            if (!best || distance < best.pickDistance) best = {
                ...candidate,
                path,
                pathIndex,
                point,
                outward,
                pickDistance: distance,
            };
        });
    });
    return best;
}

function normalizeFencePath(fence, options) {
    const source = Array.isArray(fence)
        ? fence
        : Array.isArray(fence?.points) ? fence.points
            : Array.isArray(fence?.samples) ? fence.samples
                : fence?.first && fence?.second ? [fence.first, fence.second] : [];
    if (source.length < 2 || source.length > MAX_FENCE_POINTS) return null;
    const points = [];
    for (const candidate of source) {
        const point = finitePoint(candidate);
        if (!point) return null;
        if (!points.length || pointDistance(points[points.length - 1], point) > operationTolerance(options.tolerance)) {
            points.push(point);
        }
    }
    if (points.length < 2) return null;
    return normalizeCurvePath({
        type: 'path',
        closed: false,
        parts: points.slice(1).map((point, index) => ({
            type: 'line',
            x1: points[index].x,
            y1: points[index].y,
            x2: point.x,
            y2: point.y,
        })),
    }, options);
}

function drawingBoundaryExtractionOptions(content, options) {
    const entityMap = new Map((content?.entities || []).map(entity => [entity.id, entity]));
    return {
        ...options,
        boundaryExtractor(entity) {
            if (entity?.type === 'blockReference' && content) return materializeDrawingBlockReference(
                entity,
                content.blocks || [],
                { recursive: true, maxDepth: 8 },
            );
            if (!['hatch', 'region'].includes(entity?.type)) return undefined;
            if (Array.isArray(entity.boundaries)) return entity.boundaries;
            if (Array.isArray(entity.loops)) return entity.loops.map(loop => loop?.points || loop?.boundary || loop);
            if (Array.isArray(entity.boundaryIds)) return entity.boundaryIds.map(id => entityMap.get(id)).filter(Boolean);
            if (Array.isArray(entity.points)) return entity.points;
            return undefined;
        },
    };
}

function visibleBoundaryEntities(content, boundaryIds, excludeIds) {
    const visibleLayers = new Set((content?.layers || []).filter(layer => isDrawingLayerVisible(layer)).map(layer => layer.id));
    const explicit = boundaryIds !== null && boundaryIds !== undefined;
    const allowed = explicit ? new Set(Array.isArray(boundaryIds) ? boundaryIds : []) : null;
    return (content?.entities || []).filter(entity => (
        !excludeIds.has(entity.id) && !isDrawingObjectHidden(content, entity.id)
        && (!allowed || allowed.has(entity.id))
        && (!visibleLayers.size || visibleLayers.has(entity.layerId))
    )).slice(0, MAX_BOUNDARIES + 1);
}

function editableTargets(content, targetIds) {
    const explicit = targetIds !== null && targetIds !== undefined;
    const allowed = explicit ? new Set(Array.isArray(targetIds) ? targetIds : []) : null;
    if (allowed?.size > MAX_TARGETS) return { invalid: true, reason: 'too-many-targets', entities: [] };
    const entities = (content?.entities || []).filter(entity => (
        (!allowed || allowed.has(entity.id)) && canEditEntity(content, entity)
    ));
    return entities.length > MAX_TARGETS
        ? { invalid: true, reason: 'too-many-targets', entities: [] }
        : { invalid: false, entities };
}

function resolveEditableTarget(content, targetOrId) {
    const target = typeof targetOrId === 'string'
        ? content?.entities?.find(item => item.id === targetOrId)
        : targetOrId;
    return target && content?.entities?.some(item => item.id === target.id) && canEditEntity(content, target)
        ? target : null;
}

function replaceDrawingTargets(content, replacementMap) {
    const affected = new Set(replacementMap.keys());
    return {
        ...content,
        entities: content.entities.flatMap(entity => {
            if (affected.has(entity.id)) return replacementMap.get(entity.id);
            if (getDrawingEntityDependencyIds(entity).some(id => affected.has(id))) return [];
            return [entity];
        }),
    };
}

function entityFromPath(source, path) {
    const normalized = normalizeCurvePath(path);
    if (!normalized) return null;
    const metadata = sourceMetadata(source);
    if (normalized.parts.length === 1 && !normalized.closed) {
        return { ...metadata, ...stripPartMetadata(normalized.parts[0]) };
    }
    const allLines = normalized.parts.every(part => part.type === 'line');
    if (allLines && !(source.type === 'polyline' && Array.isArray(source.parts))) {
        const points = [getCurveStart(normalized.parts[0]), ...normalized.parts.map(part => getCurveEnd(part))];
        if (normalized.closed) points.pop();
        return { ...metadata, type: 'polyline', points, closed: normalized.closed };
    }
    return {
        ...metadata,
        type: 'polyline',
        parts: normalized.parts.map(stripPartMetadata),
        closed: normalized.closed,
    };
}

function sourceMetadata(source) {
    return Object.fromEntries(Object.entries(source || {}).filter(([key]) => !GEOMETRY_KEYS.has(key) && key !== 'id'));
}

function stripPartMetadata(part) {
    return Object.fromEntries(Object.entries(part || {}).filter(([key]) => !PART_METADATA_KEYS.has(key)));
}

function previewEntitiesFromPaths(source, paths, mode) {
    return (paths || []).flatMap((path, index) => {
        const entity = path && entityFromPath(source, path);
        return entity ? [{
            ...entity,
            id: `${mode}-preview-${source.id || 'entity'}-${index}`,
            previewMode: mode,
        }] : [];
    });
}

function pathChords(paths) {
    return paths.flatMap(path => path.parts.flatMap(part => {
        const first = getCurveStart(part);
        const second = getCurveEnd(part);
        return first && second ? [[first, second]] : [];
    }));
}

function closestEntityPath(paths, point, options) {
    let best = null;
    paths.forEach((path, pathIndex) => {
        const location = closestPointOnPath(path, point, options);
        if (location && (!best || location.distance < best.location.distance)) best = { path, pathIndex, location };
    });
    return best;
}

function normalizeCutLocations(path, rawCuts, tolerance) {
    const cuts = rawCuts.map(cut => ({ ...cut, scalar: locationScalar(path, cut) }))
        .map(cut => path.closed && (cut.scalar >= 1 - tolerance || cut.scalar <= tolerance)
            ? { ...cut, scalar: 0 } : cut)
        .filter(cut => path.closed || (cut.scalar > tolerance && cut.scalar < 1 - tolerance))
        .sort((left, right) => left.scalar - right.scalar);
    return cuts.filter((cut, index) => index === 0
        || Math.abs(cut.scalar - cuts[index - 1].scalar) > tolerance
        || pointDistance(cut.point, cuts[index - 1].point) > tolerance);
}

function pathLocation(path, partIndex, t, point = null) {
    return {
        partIndex,
        t,
        point: point || curvePointAt(path.parts[partIndex], t),
        scalar: (partIndex + t) / path.parts.length,
    };
}

function locationScalar(path, location) {
    return (location.partIndex + location.t) / path.parts.length;
}

function pathBetween(path, start, end, options) {
    if (options.fullLoop) return normalizeCurvePath({ ...path, closed: false }, options);
    if (path.parts.length === 1 && path.closed && ['circle', 'ellipse'].includes(path.parts[0].type)) {
        return closedPrimitiveIntervalPath(path.parts[0], start.t, end.t, options);
    }
    return pathSubpath(path, start, end, options);
}

function closedPrimitiveIntervalPath(curve, start, end, options) {
    const direction = curve.counterClockwise === false ? -1 : 1;
    const delta = positiveUnitDelta(start, end);
    if (delta <= operationTolerance(options.tolerance)) return null;
    let primitive;
    if (curve.type === 'circle') {
        const startAngle = direction > 0 ? TAU * start : -TAU * start;
        primitive = {
            ...curve,
            type: 'arc',
            startAngle,
            endAngle: startAngle + direction * TAU * delta,
            counterClockwise: direction > 0,
            fullCircle: false,
        };
    } else {
        const startAngle = (curve.startAngle || 0) + direction * TAU * start;
        primitive = {
            ...curve,
            startAngle,
            endAngle: startAngle + direction * TAU * delta,
            counterClockwise: direction > 0,
            fullEllipse: false,
        };
    }
    const normalized = normalizeCurvePrimitive(primitive, options);
    return normalized ? normalizeCurvePath({ type: 'path', parts: [normalized], closed: false }, options) : null;
}

function groupedIntervals(count, predicate, closed) {
    if (count <= 0) return [];
    const matching = Array.from({ length: count }, (_, index) => predicate(index));
    if (!matching.some(Boolean)) return [];
    if (matching.every(Boolean)) return [{ start: 0, end: count - 1, count }];
    const groups = [];
    if (!closed) {
        let start = null;
        matching.forEach((value, index) => {
            if (value && start === null) start = index;
            if (start !== null && (!value || index === count - 1)) {
                const end = value && index === count - 1 ? index : index - 1;
                groups.push({ start, end, count: end - start + 1 });
                start = null;
            }
        });
        return groups;
    }
    const pivot = matching.findIndex(value => !value);
    let start = null;
    for (let offset = 1; offset <= count; offset += 1) {
        const index = (pivot + offset) % count;
        if (matching[index] && start === null) start = index;
        if (start !== null && !matching[(index + 1) % count]) {
            const groupCount = (index - start + count) % count + 1;
            groups.push({ start, end: index, count: groupCount });
            start = null;
        }
    }
    return groups;
}

function extendLineAcrossKernelBounds(line) {
    const first = { x: line.x1, y: line.y1 };
    const direction = normalizeVector({ x: line.x2 - line.x1, y: line.y2 - line.y1 });
    if (!direction) return null;
    const margin = MAX_COORDINATE * (1 - 1e-12);
    let minimum = -Infinity;
    let maximum = Infinity;
    ['x', 'y'].forEach(axis => {
        if (Math.abs(direction[axis]) <= EPSILON) return;
        const low = (-margin - first[axis]) / direction[axis];
        const high = (margin - first[axis]) / direction[axis];
        minimum = Math.max(minimum, Math.min(low, high));
        maximum = Math.min(maximum, Math.max(low, high));
    });
    if (!Number.isFinite(minimum)) minimum = -margin;
    if (!Number.isFinite(maximum)) maximum = margin;
    if (maximum - minimum <= EPSILON) return null;
    return {
        ...line,
        x1: first.x + direction.x * minimum,
        y1: first.y + direction.y * minimum,
        x2: first.x + direction.x * maximum,
        y2: first.y + direction.y * maximum,
    };
}

function forwardDistanceToBounds(point, direction) {
    const margin = MAX_COORDINATE * (1 - 1e-12);
    const distances = [];
    if (direction.x > EPSILON) distances.push((margin - point.x) / direction.x);
    if (direction.x < -EPSILON) distances.push((-margin - point.x) / direction.x);
    if (direction.y > EPSILON) distances.push((margin - point.y) / direction.y);
    if (direction.y < -EPSILON) distances.push((-margin - point.y) / direction.y);
    return Math.min(...distances.filter(value => Number.isFinite(value) && value > 0));
}

function ellipsePointAngle(ellipse, point) {
    const radians = -(ellipse.rotation || 0) * Math.PI / 180;
    const delta = subtractPoints(point, { x: ellipse.cx, y: ellipse.cy });
    const local = {
        x: delta.x * Math.cos(radians) - delta.y * Math.sin(radians),
        y: delta.x * Math.sin(radians) + delta.y * Math.cos(radians),
    };
    return Math.atan2(local.y / ellipse.ry, local.x / ellipse.rx);
}

function curveParameterAngle(curve, parameter) {
    return curve.startAngle + curveAngularSignedSweep(curve) * parameter;
}

function curveAngularSweep(curve) {
    return Math.abs(curveAngularSignedSweep(curve));
}

function curveAngularSignedSweep(curve) {
    return curve.counterClockwise === false
        ? -positiveAngleDelta(curve.endAngle, curve.startAngle)
        : positiveAngleDelta(curve.startAngle, curve.endAngle);
}

function normalizePickPoints(value) {
    const source = Array.isArray(value) ? value : [value];
    if (source.length > MAX_FENCE_POINTS) return [];
    return source.map(finitePoint).filter(Boolean);
}

function normalizePickMap(picks) {
    const map = new Map();
    if (picks instanceof Map) {
        picks.forEach((value, id) => map.set(id, normalizePickPoints(value)));
        return map;
    }
    if (picks && !Array.isArray(picks) && typeof picks === 'object') {
        Object.entries(picks).forEach(([id, value]) => map.set(id, normalizePickPoints(value)));
        return map;
    }
    (Array.isArray(picks) ? picks : []).slice(0, MAX_TARGETS).forEach(pick => {
        const id = pick?.targetId ?? pick?.entityId ?? pick?.id;
        const point = finitePoint(pick?.point ?? pick);
        if (!id || !point) return;
        map.set(id, [...(map.get(id) || []), point]);
    });
    return map;
}

function normalizeProjection(options) {
    const value = options.projection ?? options.project ?? '2d';
    if (value === true) return '2d';
    if (value === false || value === 'none') return 'none';
    return String(value).toLowerCase() === '2d' ? '2d' : null;
}

function usesExtendedEdges(options) {
    return Boolean(options.extendEdges ?? options.extendedEdges ?? options.edgeMode === 'extend');
}

function deduplicatePoints(points, tolerance) {
    return points.filter((candidate, index) => !points.slice(0, index)
        .some(previous => pointDistance(previous.point, candidate.point) <= tolerance));
}

function deduplicateExtensionCandidates(candidates, tolerance) {
    return candidates.filter((candidate, index) => !candidates.slice(0, index)
        .some(previous => pointDistance(previous.point, candidate.point) <= tolerance));
}

function cyclicScalarDistance(first, second, closed) {
    const distance = Math.abs(first - second);
    return closed ? Math.min(distance, 1 - distance) : distance;
}

function positiveUnitDelta(start, end) {
    const delta = (end - start) % 1;
    return delta < 0 ? delta + 1 : delta;
}

function positiveAngleDelta(start, end) {
    const delta = (end - start) % TAU;
    return delta < 0 ? delta + TAU : delta;
}

function operationTolerance(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.min(1e-3, numeric) : 1e-8;
}

function finitePoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    return Number.isFinite(x) && Number.isFinite(y)
        && Math.max(Math.abs(x), Math.abs(y)) <= MAX_COORDINATE ? { x, y } : null;
}

function normalizeVector(vector) {
    const length = Math.hypot(vector.x, vector.y);
    return Number.isFinite(length) && length > EPSILON
        ? { x: vector.x / length, y: vector.y / length } : null;
}

function subtractPoints(first, second) {
    return { x: first.x - second.x, y: first.y - second.y };
}

function dot(first, second) {
    return first.x * second.x + first.y * second.y;
}

function cross(first, second) {
    return first.x * second.y - first.y * second.x;
}

function pointDistance(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

function trimUnchanged(reason, projection = '2d', extra = {}) {
    return {
        status: reason === 'no-intersection' ? 'no-intersection' : 'unsupported',
        changed: false,
        reason,
        fragments: [],
        remainingPaths: [],
        removedPaths: [],
        removedCurves: [],
        removedSegments: [],
        projection,
        ...extra,
    };
}

function extendUnchanged(reason, projection = '2d', extra = {}) {
    return { status: 'unchanged', changed: false, reason, projection, extensionPath: null, ...extra };
}

function drawingTrimUnchanged(content, reason, operationResult = {}) {
    return {
        ...operationResult,
        status: operationResult.status || 'unchanged',
        content,
        replacements: [],
        replacementIds: [],
        affectedIds: [],
        changed: false,
        reason,
    };
}

function drawingExtendUnchanged(content, reason, operationResult = {}) {
    return {
        ...operationResult,
        content,
        replacements: [],
        replacementIds: [],
        affectedIds: [],
        changed: false,
        reason,
    };
}

function drawingBatchUnchanged(content, reason) {
    return {
        changed: false,
        changedCount: 0,
        content,
        results: [],
        affectedIds: [],
        replacements: [],
        replacementIds: [],
        removedPaths: [],
        removedSegments: [],
        reason,
    };
}
