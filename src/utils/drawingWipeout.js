import { normalizeImageClip } from './drawingImageClip.js';
import { buildHatchBoundaries } from './drawingHatches.js';

export function isDrawingWipeout(entity) {
    return entity?.type === 'polyline' && entity.closed === true && Array.isArray(entity.points) && Boolean(entity.wipeout);
}

export function createDrawingWipeout(points, layerId, id, frame = true) {
    if (!Array.isArray(points)) return null;
    const vertices = points.map(point => ({ x: point?.x, y: point?.y }));
    if (vertices.length > 3 && vertices[0].x === vertices.at(-1).x && vertices[0].y === vertices.at(-1).y) vertices.pop();
    if (vertices.length < 3 || vertices.length > 128 || vertices.some(point => ![point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e12))) return null;
    const xs = vertices.map(point => point.x); const ys = vertices.map(point => point.y);
    const minX = Math.min(...xs); const minY = Math.min(...ys);
    const width = Math.max(...xs) - minX; const height = Math.max(...ys) - minY;
    if (!(width > 1e-8 && height > 1e-8) || !normalizeImageClip({ points: vertices.map(point => ({ x: (point.x - minX) / width, y: (point.y - minY) / height })) })) return null;
    return { id, type: 'polyline', layerId, points: vertices, closed: true, wipeout: { frame: frame !== false } };
}

export function drawingWipeoutFromSources(sources, layerId, id) {
    const boundaries = buildHatchBoundaries(sources);
    if (boundaries?.length !== 1 || boundaries[0].parts.some(part => part.type !== 'line')) return null;
    return createDrawingWipeout(boundaries[0].parts.map(part => ({ x: part.x1, y: part.y1 })), layerId, id);
}
