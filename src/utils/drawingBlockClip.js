import { normalizeDrawingClipPaths, drawingClipShapeFromPoints, transformDrawingClipShape, drawingClipShapeBounds, drawingClipShapeContainsPoint } from './drawingClipPaths.js';
import { normalizeImageClip, parseDrawingClipInput } from './drawingImageClip.js';
import { transformAffinePoint } from './drawingAffine.js';
import { drawingPolygonContainsPoint } from './drawingBoundaryDetection.js';
import { curvePointAt, curveSubcurve, extractEntityPaths, intersectCurves } from './drawingCurveKernel.js';
import { getRectEntityCorners } from './drawingPrimitives.js';
import { clipConstructionLine, isConstructionLine } from './drawingConstructionLines.js';

export function normalizeDrawingBlockClip(value) {
    if (value?.paths) {
        const paths = normalizeDrawingClipPaths(value.paths);
        return paths ? { enabled: value.enabled !== false, paths, rule: value.rule === 'evenodd' ? 'evenodd' : 'nonzero' } : null;
    }
    const points = value?.points;
    if (!Array.isArray(points) || points.length < 3 || points.length > 128
        || points.some(point => ![point?.x, point?.y].every(number => Number.isFinite(number) && Math.abs(number) <= 1e9))) return null;
    const bounds = polygonBounds(points);
    const width = bounds.maxX - bounds.minX; const height = bounds.maxY - bounds.minY;
    if (width <= 1e-9 || height <= 1e-9) return null;
    const unit = normalizeImageClip({ ...value, points: points.map(point => ({ x: (point.x - bounds.minX) / width, y: (point.y - bounds.minY) / height })) });
    return unit ? { enabled: unit.enabled, points: points.map(({ x, y }) => ({ x, y })) } : null;
}

export function parseDrawingBlockClipInput(input, current) {
    const result = parseDrawingClipInput(input, current, normalizeDrawingBlockClip);
    return result ? { blockClip: result.clip } : null;
}

export function drawingBlockClipPoints(reference, { world = false } = {}) {
    const clip = normalizeDrawingBlockClip(reference?.blockClip);
    return clip?.enabled && clip.points ? clip.points.map(point => world ? transformAffinePoint(point, reference.transform) : point) : null;
}

export function drawingBlockClipShape(reference, { world = false } = {}) {
    const clip = normalizeDrawingBlockClip(reference?.blockClip);
    if (!clip?.enabled) return null;
    const shape = clip.points ? { ...clip, ...drawingClipShapeFromPoints(clip.points) } : clip;
    return world ? transformDrawingClipShape(shape, reference.transform) : shape;
}

export function clippedDrawingBlockBounds(bounds, reference) {
    const shape = drawingBlockClipShape(reference);
    if (!shape || !bounds) return bounds;
    const clip = drawingClipShapeBounds(shape);
    if (!clip) return null;
    const result = { minX: Math.max(bounds.minX, clip.minX), minY: Math.max(bounds.minY, clip.minY), maxX: Math.min(bounds.maxX, clip.maxX), maxY: Math.min(bounds.maxY, clip.maxY) };
    return result.minX <= result.maxX && result.minY <= result.maxY ? result : null;
}

export function drawingClipContainsPoint(points, point) {
    if (drawingPolygonContainsPoint(points, point)) return true;
    return points.some((a, index) => {
        const b = points[(index + 1) % points.length];
        const dx = b.x - a.x; const dy = b.y - a.y;
        const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy);
        return t >= -1e-9 && t <= 1 + 1e-9 && Math.hypot(a.x + dx * t - point.x, a.y + dy * t - point.y) < 1e-8;
    });
}

/** Exact native intervals for snapping, with the existing bounded numerical kernel for cubics. */
export function clipDrawingSnapEntity(entity, points, budget = { checks: 100000 }) {
    const shape = Array.isArray(points) ? drawingClipShapeFromPoints(points) : points;
    if (isConstructionLine(entity)) {
        const segment = clipConstructionLine(entity, drawingClipShapeBounds(shape));
        if (!segment) return [];
        entity = { ...entity, type: 'line', x1: segment.start.x, y1: segment.start.y, x2: segment.end.x, y2: segment.end.y };
    }
    if (['text', 'image'].includes(entity.type)) entity = { ...entity, type: 'polyline', closed: true, points: getRectEntityCorners(entity) };
    const paths = extractEntityPaths(entity, { boundaryExtractor: item => item.boundaries });
    const edges = shape.paths.flatMap(path => path.parts);
    const result = [];
    for (const path of paths) for (const curve of path.parts) {
        const cuts = [0, 1];
        for (const edge of edges) {
            if (budget.checks-- <= 0) return [];
            const hits = intersectCurves(curve, edge, { maxIntersectionChecks: Math.max(1, Math.min(4096, budget.checks)), maxNumericSegments: 128 });
            budget.checks -= hits.checks || 0;
            if (hits.truncated) return [];
            cuts.push(...hits.points.map(hit => hit.leftT));
        }
        const sorted = [...new Set(cuts.map(value => Math.max(0, Math.min(1, value))))].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
            const start = sorted[i - 1]; const end = sorted[i];
            if (end - start < 1e-9 || !drawingClipShapeContainsPoint(shape, curvePointAt(curve, (start + end) / 2), budget)) continue;
            const part = curveSubcurve(curve, start, end);
            if (part) result.push({ ...part, id: entity.id, layerId: entity.layerId });
        }
    }
    return result;
}

function polygonBounds(points) {
    return { minX: Math.min(...points.map(point => point.x)), minY: Math.min(...points.map(point => point.y)), maxX: Math.max(...points.map(point => point.x)), maxY: Math.max(...points.map(point => point.y)) };
}
