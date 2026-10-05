import { normalizeCurvePath, getCurveStart, intersectCurves } from './drawingCurveKernel.js';
import { sampleDrawingBoundaryPath } from './drawingBoundaryDetection.js';
import { transformAffinePoint } from './drawingAffine.js';
import { getAdvancedEntityBounds } from './drawingAdvancedEntities.js';

const samples = new WeakMap();

export function normalizeDrawingClipPaths(value) {
    if (!Array.isArray(value) || !value.length || value.length > 1024) return null;
    let count = 0;
    const paths = [];
    for (const path of value) {
        if (!Array.isArray(path?.parts) || (count += path.parts.length) > 4096) return null;
        const parts = path.parts.map(part => part?.type === 'line'
            ? { type: 'line', x1: part.x1, y1: part.y1, x2: part.x2, y2: part.y2 }
            : part?.type === 'spline' && Array.isArray(part.controlPoints) && part.controlPoints.length === 4
                ? { type: 'spline', controlPoints: part.controlPoints.map(point => ({ x: point?.x, y: point?.y })) } : null);
        if (parts.some(part => !part)) return null;
        const normalized = normalizeCurvePath({ parts, closed: true }, { maxCoordinate: 1e9, epsilon: 1e-12, joinTolerance: 1e-10 });
        if (!normalized) return null;
        paths.push({ parts: normalized.parts, closed: true });
    }
    return paths;
}

export function drawingClipShapeFromPoints(points) {
    return { points, rule: 'nonzero', paths: [{ closed: true, parts: points.map((point, index) => {
        const next = points[(index + 1) % points.length];
        return { type: 'line', x1: point.x, y1: point.y, x2: next.x, y2: next.y };
    }) }] };
}

export function transformDrawingClipShape(shape, matrix) {
    return { ...shape, ...(shape.points ? { points: shape.points.map(point => transformAffinePoint(point, matrix)) } : {}),
        paths: shape.paths.map(path => ({ ...path, parts: path.parts.map(part => {
            if (part.type === 'spline') return { ...part, controlPoints: part.controlPoints.map(point => transformAffinePoint(point, matrix)) };
            const first = transformAffinePoint({ x: part.x1, y: part.y1 }, matrix);
            const last = transformAffinePoint({ x: part.x2, y: part.y2 }, matrix);
            return { type: 'line', x1: first.x, y1: first.y, x2: last.x, y2: last.y };
        }) })) };
}

export function drawingClipShapeBounds(shape) {
    let result = null;
    for (const path of shape.paths) for (const part of path.parts) {
        const bounds = part.type === 'line'
            ? { minX: Math.min(part.x1, part.x2), minY: Math.min(part.y1, part.y2), maxX: Math.max(part.x1, part.x2), maxY: Math.max(part.y1, part.y2) }
            : getAdvancedEntityBounds(part);
        if (bounds) result = result ? { minX: Math.min(result.minX, bounds.minX), minY: Math.min(result.minY, bounds.minY),
            maxX: Math.max(result.maxX, bounds.maxX), maxY: Math.max(result.maxY, bounds.maxY) } : bounds;
    }
    return result;
}

export function drawingClipShapePolygons(shape) {
    if (samples.has(shape)) return samples.get(shape);
    const polygons = []; let count = 0;
    for (const path of shape.paths) {
        const polygon = shape.points || sampleDrawingBoundaryPath(path);
        if (!polygon || (count += polygon.length) > 100000) { samples.set(shape, []); return []; }
        polygons.push(polygon);
    }
    samples.set(shape, polygons); return polygons;
}

export function drawingClipShapeContainsPoint(shape, point, budget = { checks: 1000000 }) {
    let winding = 0;
    for (const polygon of drawingClipShapePolygons(shape)) for (let index = 0; index < polygon.length; index++) {
        if (--budget.checks < 0) return false;
        const a = polygon[index]; const b = polygon[(index + 1) % polygon.length];
        const cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
        if (Math.abs(cross) <= 1e-10 * Math.max(1e-9, Math.hypot(b.x - a.x, b.y - a.y))
            && point.x >= Math.min(a.x, b.x) - 1e-10 && point.x <= Math.max(a.x, b.x) + 1e-10
            && point.y >= Math.min(a.y, b.y) - 1e-10 && point.y <= Math.max(a.y, b.y) + 1e-10) return true;
        if (a.y <= point.y && b.y > point.y && cross > 0) winding++;
        else if (a.y > point.y && b.y <= point.y && cross < 0) winding--;
    }
    return shape.rule === 'evenodd' ? Math.abs(winding) % 2 === 1 : winding !== 0;
}


export function drawingClipShapeIntersectsBounds(shape, bounds, budget = { checks: 100000 }) {
    const corners = [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }];
    if (corners.some(point => drawingClipShapeContainsPoint(shape, point, budget))) return true;
    const rectangle = drawingClipShapeFromPoints(corners).paths[0].parts;
    for (const path of shape.paths) for (const curve of path.parts) {
        const point = getCurveStart(curve);
        if (point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY) return true;
        for (const edge of rectangle) {
            if (--budget.checks < 0) return false;
            const hits = intersectCurves(curve, edge, { maxIntersectionChecks: Math.max(1, Math.min(4096, budget.checks)), maxNumericSegments: 256 });
            budget.checks -= hits.checks || 0;
            if (hits.truncated) { budget.checks = -1; return false; }
            if (hits.points.length) return true;
        }
    }
    return false;
}
