import { canEditEntity, createDrawingId, getLayer } from './drawingDocument.js';
import { isDrawingLayerVisible } from './drawingLayers.js';

export const MAX_SKETCH_POINTS = 8192;
const validPoint = point => point && [point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e12);

export function beginDrawingSketch(point, increment = 0.01, mode = 'polyline') {
    if (!validPoint(point) || !Number.isFinite(increment) || increment < 1e-6 || increment > 1e6 || !['polyline', 'lines'].includes(mode)) return null;
    return { points: [{ ...point }], last: { ...point }, remaining: increment, increment, mode, overflow: false };
}

/** Resample travelled pointer distance, independent of event frequency and zoom. */
export function appendDrawingSketch(sketch, point) {
    if (!sketch || sketch.overflow || !validPoint(point)) return sketch;
    const dx = point.x - sketch.last.x; const dy = point.y - sketch.last.y;
    const length = Math.hypot(dx, dy);
    if (!length) return sketch;
    const count = length + sketch.increment * 1e-10 >= sketch.remaining ? Math.floor((length - sketch.remaining) / sketch.increment + 1e-10) + 1 : 0;
    if (sketch.points.length + count > MAX_SKETCH_POINTS) return { ...sketch, overflow: true };
    const points = [...sketch.points];
    for (let index = 0; index < count; index += 1) {
        const ratio = Math.min(1, (sketch.remaining + index * sketch.increment) / length);
        points.push({ x: sketch.last.x + dx * ratio, y: sketch.last.y + dy * ratio });
    }
    return { ...sketch, points, last: { ...point }, remaining: Math.max(1e-12, sketch.remaining + count * sketch.increment - length) };
}

export function drawingSketchEntities(sketch, layerId, ids = false) {
    if (!sketch || sketch.overflow) return [];
    const points = [...sketch.points];
    if (Math.hypot(points.at(-1).x - sketch.last.x, points.at(-1).y - sketch.last.y) > 1e-9) points.push({ ...sketch.last });
    if (points.length < 2 || points.length > MAX_SKETCH_POINTS) return [];
    if (sketch.mode === 'polyline') return [{ id: ids ? createDrawingId('sketch') : 'sketch-preview', type: 'polyline', layerId, points, closed: false }];
    return points.slice(1).map((point, index) => ({ id: ids ? createDrawingId('sketch') : `sketch-preview-${index}`, type: 'line', layerId,
        x1: points[index].x, y1: points[index].y, x2: point.x, y2: point.y }));
}

export function commitDrawingSketch(content, sketch) {
    const layer = getLayer(content, content.activeLayerId);
    if (!isDrawingLayerVisible(layer) || !canEditEntity(content, { layerId: layer.id })) return { error: 'layer' };
    const entities = drawingSketchEntities(sketch, layer.id, true);
    if (!entities.length) return { error: sketch?.overflow ? 'limit' : 'empty' };
    return { content: { ...content, entities: [...content.entities, ...entities] }, selectedIds: entities.map(entity => entity.id) };
}
