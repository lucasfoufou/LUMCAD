import { getHatchBoundaryEntities } from './drawingAdvancedEntities.js';
import { createArcFromThreePoints } from './drawingCurves.js';
import { canEditEntity } from './drawingDocument.js';
import {
    curvePointAt,
    extractEntityPaths,
    getCurveEnd,
    getCurveStart,
    normalizeCurvePath,
    normalizeCurvePrimitive,
} from './drawingCurveKernel.js';
import { getRectEntityCorners, translateEntity } from './drawingGeometry.js';
import { getDrawingEntityDependencyIds } from './drawingDimensions.js';

const EPSILON = 1e-9;
const MAX_COORDINATE = 1e12;
const MAX_TARGETS = 10_000;
const PART_METADATA_KEYS = new Set([
    'id', 'layerId', 'color', 'lineWeight', 'lineWidth', 'lineType', 'transparency', 'locked',
    'sourceId', 'sourceIds', 'previewMode',
]);
const GEOMETRY_KEYS = new Set([
    'type', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'startAngle', 'endAngle',
    'counterClockwise', 'fullCircle', 'fullEllipse', 'controlPoints', 'degree', 'x', 'y', 'width',
    'height', 'rotation', 'sides', 'mode', 'points', 'parts', 'closed', 'cornerStyle', 'cornerValue',
    'fillet', 'chamfer',
]);

/**
 * Moves only defining points inside a rectangular crossing window. Entities
 * wholly inside move rigidly; partially crossed outlines retain native parts.
 */
export function stretchDrawingEntity(entity, selectionWindow, delta, options = {}) {
    const bounds = normalizeCrossingWindow(selectionWindow);
    const movement = finiteDelta(delta);
    if (!entity || !bounds || !movement) return stretchUnchanged('invalid-input');
    if (Math.hypot(movement.x, movement.y) <= operationTolerance(options.tolerance)) {
        return stretchUnchanged('no-op');
    }
    const controls = entityStretchControlPoints(entity, options);
    if (!controls.length) return stretchUnchanged('unsupported-target');
    const selected = controls.filter(point => pointInBounds(point, bounds));
    if (!selected.length) return stretchUnchanged('no-control-points');
    if (selected.length === controls.length) return stretchResult(entity, translateEntity(entity, movement.x, movement.y), true);
    const stretched = stretchEntityPartially(entity, bounds, movement, options);
    if (!stretched || stretched === entity) return stretchUnchanged('unsupported-partial-stretch');
    return stretchResult(entity, stretched, false);
}

/** Evaluates each requested source independently and preserves stable IDs. */
export function stretchDrawingEntities(content, {
    targetIds = null,
    window = null,
    selectionWindow = window,
    delta = null,
    basePoint = null,
    secondPoint = null,
    ...options
} = {}) {
    const movement = delta || (basePoint && secondPoint ? {
        x: secondPoint.x - basePoint.x,
        y: secondPoint.y - basePoint.y,
    } : null);
    const ids = targetIds === null || targetIds === undefined ? null : new Set(targetIds || []);
    if (ids?.size > MAX_TARGETS) return stretchBatchUnchanged(content, 'too-many-targets');
    const candidates = (content?.entities || []).filter(entity => (
        (!ids || ids.has(entity.id)) && canEditEntity(content, entity)
    ));
    if (candidates.length > MAX_TARGETS) return stretchBatchUnchanged(content, 'too-many-targets');
    const results = candidates.flatMap(entity => {
        const result = stretchDrawingEntity(entity, selectionWindow, movement, options);
        return result.changed ? [{ source: entity, ...result }] : [];
    });
    if (!results.length) return stretchBatchUnchanged(content, 'no-change');
    const replacements = new Map(results.map(result => [result.source.id, { ...result.entity, id: result.source.id }]));
    const incompatible = new Set(results
        .filter(result => result.source.type !== result.entity.type)
        .map(result => result.source.id));
    return {
        changed: true,
        changedCount: results.length,
        content: {
            ...content,
            entities: content.entities.flatMap(entity => {
                if (replacements.has(entity.id)) return [replacements.get(entity.id)];
                if (getDrawingEntityDependencyIds(entity).some(id => incompatible.has(id))) return [];
                return [entity];
            }),
        },
        results,
        entities: [...replacements.values()],
        affectedIds: [...replacements.keys()],
        selectedIds: [...replacements.keys()],
        delta: movement,
    };
}

export function createStretchPreviewEntities(content, operation, livePoint = null) {
    const movement = operation?.delta || (operation?.basePoint && (livePoint || operation.secondPoint) ? {
        x: (livePoint || operation.secondPoint).x - operation.basePoint.x,
        y: (livePoint || operation.secondPoint).y - operation.basePoint.y,
    } : null);
    const result = stretchDrawingEntities(content, {
        ...operation,
        window: operation?.window || operation?.selectionWindow,
        delta: movement,
    });
    return result.changed ? result.entities.map(entity => ({
        ...entity,
        id: `stretch-preview-${entity.id}`,
        previewMode: 'stretch',
    })) : [];
}

function stretchEntityPartially(entity, bounds, delta, options) {
    if (entity.type === 'line') return stretchLine(entity, bounds, delta, options);
    if (entity.type === 'arc') return stretchArc(entity, bounds, delta, options);
    if (entity.type === 'spline') return stretchSpline(entity, bounds, delta, options);
    if (entity.type === 'ellipse') return stretchEllipse(entity, bounds, delta, options);
    if (entity.type === 'circle') {
        return pointInBounds({ x: entity.cx, y: entity.cy }, bounds)
            ? translateEntity(entity, delta.x, delta.y) : null;
    }
    if (entity.type === 'polyline' && Array.isArray(entity.points)) {
        return {
            ...entity,
            points: entity.points.map(point => pointInBounds(point, bounds) ? addPoints(point, delta) : { ...point }),
        };
    }
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        return stretchMixedPathEntity(entity, bounds, delta, options);
    }
    if (entity.type === 'rectangle' || entity.type === 'polygon') {
        return stretchOutlineEntity(entity, bounds, delta, options);
    }
    if (entity.type === 'image' || entity.type === 'text') return stretchRectLike(entity, bounds, delta);
    if (entity.type === 'linearDimension' && entity.p1 && entity.p2) return {
        ...entity,
        p1: pointInBounds(entity.p1, bounds) ? addPoints(entity.p1, delta) : { ...entity.p1 },
        p2: pointInBounds(entity.p2, bounds) ? addPoints(entity.p2, delta) : { ...entity.p2 },
    };
    if (entity.type === 'blockReference') {
        const insertion = blockInsertionPoint(entity);
        return insertion && pointInBounds(insertion, bounds) ? translateEntity(entity, delta.x, delta.y) : null;
    }
    if (entity.type === 'hatch') {
        const boundaries = getHatchBoundaryEntities(entity);
        let changed = false;
        const stretched = boundaries.map(boundary => {
            const result = stretchDrawingEntity(boundary, bounds, delta, options);
            changed ||= result.changed;
            return result.changed ? result.entity : boundary;
        });
        return changed ? { ...entity, boundaries: stretched } : null;
    }
    return null;
}

function stretchLine(entity, bounds, delta, options) {
    const first = { x: entity.x1, y: entity.y1 };
    const second = { x: entity.x2, y: entity.y2 };
    const nextFirst = pointInBounds(first, bounds) ? addPoints(first, delta) : first;
    const nextSecond = pointInBounds(second, bounds) ? addPoints(second, delta) : second;
    return normalizeCurvePrimitive({
        ...entity,
        x1: nextFirst.x,
        y1: nextFirst.y,
        x2: nextSecond.x,
        y2: nextSecond.y,
    }, options);
}

function stretchArc(entity, bounds, delta, options) {
    const arc = normalizeCurvePrimitive(entity, options);
    if (arc?.type !== 'arc') return null;
    const center = { x: arc.cx, y: arc.cy };
    if (pointInBounds(center, bounds)) return translateEntity(entity, delta.x, delta.y);
    const points = [curvePointAt(arc, 0), curvePointAt(arc, 0.5), curvePointAt(arc, 1)];
    const moved = points.map(point => pointInBounds(point, bounds) ? addPoints(point, delta) : point);
    if (moved.every((point, index) => pointDistance(point, points[index]) <= EPSILON)) return null;
    const geometry = createArcFromThreePoints(moved[0], moved[1], moved[2]);
    return geometry ? normalizeCurvePrimitive({ ...entity, ...geometry }, options) : null;
}

function stretchSpline(entity, bounds, delta, options) {
    const spline = normalizeCurvePrimitive(entity, options);
    if (spline?.type !== 'spline') return null;
    return normalizeCurvePrimitive({
        ...entity,
        controlPoints: spline.controlPoints.map(point => pointInBounds(point, bounds) ? addPoints(point, delta) : point),
    }, options);
}

function stretchEllipse(entity, bounds, delta, options) {
    const ellipse = normalizeCurvePrimitive(entity, options);
    if (ellipse?.type !== 'ellipse') return null;
    const center = { x: ellipse.cx, y: ellipse.cy };
    if (pointInBounds(center, bounds)) return translateEntity(entity, delta.x, delta.y);
    if (ellipse.fullEllipse) return null;
    const start = curvePointAt(ellipse, 0);
    const end = curvePointAt(ellipse, 1);
    let changed = false;
    const updates = {};
    if (pointInBounds(start, bounds)) {
        updates.startAngle = ellipsePointAngle(ellipse, addPoints(start, delta));
        changed = true;
    }
    if (pointInBounds(end, bounds)) {
        updates.endAngle = ellipsePointAngle(ellipse, addPoints(end, delta));
        changed = true;
    }
    return changed ? normalizeCurvePrimitive({ ...entity, ...updates, fullEllipse: false }, options) : null;
}

function stretchMixedPathEntity(entity, bounds, delta, options) {
    const paths = extractEntityPaths(entity, options);
    if (paths.length !== 1) return null;
    let changed = false;
    const parts = paths[0].parts.map(part => {
        const result = stretchDrawingEntity(part, bounds, delta, options);
        changed ||= result.changed;
        return result.changed ? stripPartMetadata(result.entity) : stripPartMetadata(part);
    });
    if (!changed) return null;
    const path = normalizeCurvePath({ type: 'path', parts, closed: paths[0].closed }, options);
    return path ? entityFromPath(entity, path) : null;
}

function stretchOutlineEntity(entity, bounds, delta, options) {
    const paths = extractEntityPaths(entity, options);
    if (paths.length !== 1) return null;
    const sourcePath = paths[0];
    let changed = false;
    const parts = sourcePath.parts.map(part => {
        const result = stretchDrawingEntity(part, bounds, delta, options);
        changed ||= result.changed;
        return result.changed ? stripPartMetadata(result.entity) : stripPartMetadata(part);
    });
    if (!changed) return null;
    const path = normalizeCurvePath({ type: 'path', parts, closed: sourcePath.closed }, options);
    return path ? entityFromPath(entity, path) : null;
}

function stretchRectLike(entity, bounds, delta) {
    const corners = getRectEntityCorners(entity);
    const moved = corners.map(point => pointInBounds(point, bounds) ? addPoints(point, delta) : point);
    const minX = Math.min(...moved.map(point => point.x));
    const minY = Math.min(...moved.map(point => point.y));
    const maxX = Math.max(...moved.map(point => point.x));
    const maxY = Math.max(...moved.map(point => point.y));
    if (maxX - minX <= EPSILON || maxY - minY <= EPSILON) return null;
    return { ...entity, x: minX, y: minY, width: maxX - minX, height: maxY - minY, rotation: 0 };
}

function entityStretchControlPoints(entity, options) {
    if (entity.type === 'blockReference') return [blockInsertionPoint(entity)].filter(Boolean);
    if (entity.type === 'line') return [{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }].filter(finitePoint);
    if (entity.type === 'circle') return [{ x: entity.cx, y: entity.cy }].filter(finitePoint);
    if (entity.type === 'arc') {
        const arc = normalizeCurvePrimitive(entity, options);
        return arc ? [
            { x: arc.cx, y: arc.cy }, curvePointAt(arc, 0), curvePointAt(arc, 0.5), curvePointAt(arc, 1),
        ] : [];
    }
    if (entity.type === 'ellipse') {
        const ellipse = normalizeCurvePrimitive(entity, options);
        if (!ellipse) return [];
        return ellipse.fullEllipse
            ? [{ x: ellipse.cx, y: ellipse.cy }]
            : [{ x: ellipse.cx, y: ellipse.cy }, curvePointAt(ellipse, 0), curvePointAt(ellipse, 1)];
    }
    if (entity.type === 'spline') {
        return normalizeCurvePrimitive(entity, options)?.controlPoints || [];
    }
    if (entity.type === 'polyline' && Array.isArray(entity.points)) return entity.points.map(finitePoint).filter(Boolean);
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        return entity.parts.flatMap(part => entityStretchControlPoints(part, options));
    }
    if (entity.type === 'rectangle' || entity.type === 'image' || entity.type === 'text') {
        return getRectEntityCorners(entity).map(finitePoint).filter(Boolean);
    }
    if (entity.type === 'polygon') {
        return extractEntityPaths(entity, options).flatMap(path => path.parts.map(getCurveStart)).filter(Boolean);
    }
    if (entity.type === 'linearDimension' && entity.p1 && entity.p2) return [entity.p1, entity.p2].map(finitePoint).filter(Boolean);
    if (entity.type === 'radialDimension') return [];
    if (entity.type === 'hatch') {
        return getHatchBoundaryEntities(entity).flatMap(boundary => entityStretchControlPoints(boundary, options));
    }
    return [];
}

function entityFromPath(source, path) {
    const normalized = normalizeCurvePath(path);
    if (!normalized) return null;
    const metadata = Object.fromEntries(Object.entries(source || {})
        .filter(([key]) => !GEOMETRY_KEYS.has(key) && key !== 'id'));
    if (normalized.parts.length === 1 && !normalized.closed) {
        return { ...metadata, ...stripPartMetadata(normalized.parts[0]) };
    }
    const allLines = normalized.parts.every(part => part.type === 'line');
    if (allLines && !(source.type === 'polyline' && Array.isArray(source.parts))) {
        const points = [getCurveStart(normalized.parts[0]), ...normalized.parts.map(getCurveEnd)];
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

function stripPartMetadata(part) {
    return Object.fromEntries(Object.entries(part || {}).filter(([key]) => !PART_METADATA_KEYS.has(key)));
}

function normalizeCrossingWindow(value) {
    if (!value || (value.mode && value.mode !== 'crossing')) return null;
    const first = value.first || value.start;
    const second = value.second || value.end || value.current;
    const raw = first && second ? {
        minX: Math.min(first.x, second.x),
        minY: Math.min(first.y, second.y),
        maxX: Math.max(first.x, second.x),
        maxY: Math.max(first.y, second.y),
    } : value;
    const numbers = [raw.minX, raw.minY, raw.maxX, raw.maxY].map(Number);
    if (!numbers.every(Number.isFinite) || numbers.some(number => Math.abs(number) > MAX_COORDINATE)) return null;
    const [firstX, firstY, secondX, secondY] = numbers;
    const minX = Math.min(firstX, secondX);
    const minY = Math.min(firstY, secondY);
    const maxX = Math.max(firstX, secondX);
    const maxY = Math.max(firstY, secondY);
    if (maxX - minX <= EPSILON || maxY - minY <= EPSILON) return null;
    return {
        minX,
        minY,
        maxX,
        maxY,
        mode: 'crossing',
    };
}

function finiteDelta(delta) {
    const x = Number(delta?.x);
    const y = Number(delta?.y);
    return Number.isFinite(x) && Number.isFinite(y)
        && Math.max(Math.abs(x), Math.abs(y)) <= MAX_COORDINATE ? { x, y } : null;
}

function finitePoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    return Number.isFinite(x) && Number.isFinite(y)
        && Math.max(Math.abs(x), Math.abs(y)) <= MAX_COORDINATE ? { x, y } : null;
}

function blockInsertionPoint(entity) {
    const transform = entity?.transform;
    if (Number.isFinite(transform?.e) && Number.isFinite(transform?.f)) return { x: transform.e, y: transform.f };
    return finitePoint(entity?.insertionPoint) || (Number.isFinite(entity?.x) && Number.isFinite(entity?.y)
        ? { x: entity.x, y: entity.y } : null);
}

function pointInBounds(point, bounds) {
    return Boolean(point) && point.x >= bounds.minX - EPSILON && point.x <= bounds.maxX + EPSILON
        && point.y >= bounds.minY - EPSILON && point.y <= bounds.maxY + EPSILON;
}

function ellipsePointAngle(ellipse, point) {
    const radians = -(ellipse.rotation || 0) * Math.PI / 180;
    const delta = { x: point.x - ellipse.cx, y: point.y - ellipse.cy };
    const local = {
        x: delta.x * Math.cos(radians) - delta.y * Math.sin(radians),
        y: delta.x * Math.sin(radians) + delta.y * Math.cos(radians),
    };
    return Math.atan2(local.y / ellipse.ry, local.x / ellipse.rx);
}

function addPoints(first, second) {
    return { x: first.x + second.x, y: first.y + second.y };
}

function pointDistance(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

function operationTolerance(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.min(numeric, 1e-3) : 1e-8;
}

function stretchResult(source, entity, rigid) {
    return entity ? {
        changed: true,
        status: 'stretched',
        entity,
        sourceType: source.type,
        rigid,
    } : stretchUnchanged('invalid-result');
}

function stretchUnchanged(reason) {
    return { changed: false, status: 'unchanged', entity: null, reason, rigid: false };
}

function stretchBatchUnchanged(content, reason) {
    return {
        changed: false,
        changedCount: 0,
        content,
        results: [],
        entities: [],
        affectedIds: [],
        selectedIds: [],
        reason,
    };
}
