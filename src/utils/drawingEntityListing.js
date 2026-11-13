// Readable LIST entries: type, layer name, measures and key points of each
// object, so the Measurements panel never has to show raw identifiers first.
// Points stay in world coordinates; the panel formats them through the UCS
// helpers (formatDrawingCursorPosition).
import { measureDrawingEntity } from './drawingInquiry.js';

// Key points shown for each kind of object, in reading order.
function entityKeyPoints(entity) {
    const point = (key, x, y) => (Number.isFinite(x) && Number.isFinite(y) ? [{ key, x, y }] : []);
    switch (entity?.type) {
    case 'line':
        return [...point('start', entity.x1, entity.y1), ...point('end', entity.x2, entity.y2)];
    case 'xline':
    case 'ray':
        return point('start', entity.x1, entity.y1);
    case 'circle':
    case 'arc':
        return point('center', entity.cx, entity.cy);
    case 'ellipse':
        return point('center', entity.cx, entity.cy);
    case 'blockReference':
        return point('insertion', entity.transform?.e ?? 0, entity.transform?.f ?? 0);
    case 'polyline':
        return Array.isArray(entity.points) && entity.points.length ? point('start', entity.points[0].x, entity.points[0].y) : [];
    default:
        return point('position', entity?.x, entity?.y);
    }
}

/** Summary of one listed object; lengths and areas in metres, points in world coordinates. */
export function describeDrawingEntityForList(entity, { layers = [], blocks = [] } = {}) {
    if (!entity) return null;
    const layer = layers.find(candidate => candidate.id === entity.layerId);
    const block = entity.type === 'blockReference' ? blocks.find(candidate => candidate.id === entity.blockId) : null;
    let measures = null;
    try { measures = measureDrawingEntity(entity); } catch { measures = null; }
    const values = {};
    if (Number.isFinite(measures?.perimeter)) values[Number.isFinite(measures?.area) ? 'perimeter' : 'length'] = measures.perimeter;
    if (Number.isFinite(measures?.area)) values.area = measures.area;
    if (Number.isFinite(measures?.radius)) values.radius = measures.radius;
    return {
        id: entity.id,
        type: entity.type,
        layerName: layer?.name ?? null,
        blockName: block?.name ?? null,
        values,
        points: entityKeyPoints(entity),
    };
}
