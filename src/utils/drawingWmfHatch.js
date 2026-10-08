import { getEntityBounds } from './drawingGeometry.js';
import { createDrawingLinearStrokeFill } from './drawingStrokeGeometry.js';
import { extractEntityPaths } from './drawingCurveKernel.js';
import { sampleDrawingBoundaryPath } from './drawingBoundaryDetection.js';
import { drawingClipShapeFromPoints } from './drawingClipPaths.js';

export function drawingWmfHatchClipPaths(entities) {
    return entities.flatMap(entity => extractEntityPaths(entity)).map(path => {
        if (path.parts.every(part => ['line', 'spline'].includes(part.type))) return path;
        const points = sampleDrawingBoundaryPath(path);
        if (!points || points.length < 3) throw new Error('wmfGeometry');
        return drawingClipShapeFromPoints(points).paths[0];
    });
}

/** Vector approximation of the six device hatch patterns, in physical device units. */
export function createDrawingWmfHatch(paths, style, color, { dpi = 96, maxLines = 4096 } = {}) {
    if (!Number.isInteger(style) || style < 0 || style > 5 || !Number.isFinite(dpi) || dpi <= 0
        || !Number.isSafeInteger(maxLines) || maxLines < 1) throw new Error('wmfInvalid');
    const bounds = paths.map(getEntityBounds);
    if (!bounds.length || bounds.some(bound => !bound || !Object.values(bound).every(Number.isFinite))) throw new Error('wmfGeometry');
    const minX = Math.min(...bounds.map(bound => bound.minX)); const minY = Math.min(...bounds.map(bound => bound.minY));
    const maxX = Math.max(...bounds.map(bound => bound.maxX)); const maxY = Math.max(...bounds.map(bound => bound.maxY));
    const corners = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
    const angles = [[0], [90], [45], [-45], [0, 90], [45, -45]][style];
    const pixel = .0254 / dpi; const lines = [];
    for (const degrees of angles) {
        const angle = degrees * Math.PI / 180; const dx = Math.cos(angle); const dy = Math.sin(angle);
        const nx = -dy; const ny = dx;
        const normals = corners.map(([x, y]) => x * nx + y * ny);
        const tangents = corners.map(([x, y]) => x * dx + y * dy);
        const spacing = pixel * 8 / (Math.abs(degrees) === 45 ? Math.SQRT2 : 1);
        const first = Math.ceil((Math.min(...normals) - pixel) / spacing);
        const last = Math.floor((Math.max(...normals) + pixel) / spacing);
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first + 1 > maxLines - lines.length) throw new Error('wmfLimit');
        const start = Math.min(...tangents) - pixel; const end = Math.max(...tangents) + pixel;
        for (let index = first; index <= last; index++) {
            const offset = index * spacing;
            lines.push({ type: 'line', x1: nx * offset + dx * start, y1: ny * offset + dy * start,
                x2: nx * offset + dx * end, y2: ny * offset + dy * end });
        }
    }
    return lines.length ? createDrawingLinearStrokeFill(lines, pixel, color, { endCap: 'flat', maxSegments: maxLines }) : null;
}
