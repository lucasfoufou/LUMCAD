import { duplicateGeometry } from './drawingCleanup.js';
import { getRectangleOutlinePoints, getRegularPolygonVertices } from './drawingCurves.js';
import { getRectEntityCorners } from './drawingPrimitives.js';
import { getHatchBoundaryEntities } from './drawingAdvancedEntities.js';
import { normalizeDrawingTextEntity } from './drawingText.js';

const keys = {
    line: ['x1', 'y1', 'x2', 'y2'], circle: ['cx', 'cy', 'r'],
    arc: ['cx', 'cy', 'r', 'startAngle', 'endAngle', 'counterClockwise', 'fullCircle'],
    ellipse: ['cx', 'cy', 'rx', 'ry', 'rotation', 'startAngle', 'endAngle', 'counterClockwise', 'fullEllipse'],
    spline: ['controlPoints', 'degree'], polyline: ['points', 'parts', 'closed'],
};
const metadata = new Set(['id', 'layerId', 'color', 'lineWeight', 'lineWidth', 'lineType', 'plotStyleName', 'transparency', 'locked']);
const placement = new Set(['x', 'y', 'width', 'height', 'rotation', 'affineFrame']);
const without = (value, omitted) => Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));

// Generated annotations/assemblies retain their semantic state. Only copied identities
// and entity appearance are omitted; dependency references and table/query values remain.
function exactShape(entity) {
    let remaining = 100000;
    const normalize = (value, depth = 0) => {
        if (--remaining < 0 || depth > 128) throw new Error('limit');
        if (Array.isArray(value)) return value.map(item => normalize(item, depth + 1));
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.keys(value).sort().filter(key => !value.type || !metadata.has(key))
            .map(key => [key, normalize(value[key], depth + 1)]));
    };
    try { return { type: entity.type, exact: JSON.stringify(normalize(entity)) }; }
    catch { return null; }
}

/** Geometry-only curves; text/image payloads retain content and resource identity. */
export function drawingDuplicateShape(entity) {
    if (entity.type === 'point') return { type: 'point', x: entity.x, y: entity.y };
    if (['rectangle', 'polygon'].includes(entity.type)) return { type: 'polyline', closed: true,
        points: entity.type === 'rectangle' ? getRectangleOutlinePoints(entity) : getRegularPolygonVertices(entity) };
    if (['text', 'image'].includes(entity.type)) {
        const source = entity.type === 'text' ? normalizeDrawingTextEntity(entity) : entity;
        return { type: entity.type, corners: getRectEntityCorners(source), payload: without(without(source, metadata), placement) };
    }
    if (['hatch', 'region'].includes(entity.type)) {
        if (entity.fillRule === 'nonzero') return exactShape(entity);
        const boundaries = getHatchBoundaryEntities(entity).map(drawingDuplicateShape);
        if (!boundaries.length || boundaries.some(boundary => !boundary)) return null;
        return { type: entity.type, fillRule: entity.fillRule || 'evenodd', boundaries };
    }
    if (!keys[entity.type] || entity.array || entity.linework || entity.table || entity.tolerance || entity.leader || entity.revisionSymbol || entity.wipeout) return exactShape(entity);
    const result = { type: entity.type };
    for (const key of keys[entity.type]) if (entity[key] !== undefined) result[key] = entity[key];
    if (result.parts) {
        result.parts = result.parts.map(drawingDuplicateShape);
        if (result.parts.some(part => !part)) return null;
    }
    return result;
}

const near = (a, b, tolerance) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
export function equalDrawingDuplicateShapes(a, b, tolerance, budget) {
    if (--budget.remaining < 0 || a.type !== b.type) return false;
    if (a.exact !== undefined || b.exact !== undefined) return a.exact !== undefined && a.exact === b.exact;
    if (a.type === 'point') return near(a, b, tolerance);
    if (['text', 'image'].includes(a.type)) return a.corners.every((point, index) => near(point, b.corners[index], tolerance))
        && duplicateGeometry(a.payload, b.payload, 0, budget);
    if (['hatch', 'region'].includes(a.type)) {
        if (a.fillRule !== b.fillRule || a.boundaries.length !== b.boundaries.length) return false;
        const unused = new Set(b.boundaries.map((_, index) => index));
        for (const boundary of a.boundaries) {
            let matched = null;
            for (const index of unused) {
                if (equalDrawingDuplicateShapes(boundary, b.boundaries[index], tolerance, budget)) { matched = index; break; }
                if (budget.remaining < 0) return false;
            }
            if (matched === null) return false;
            unused.delete(matched);
        }
        return true;
    }
    return duplicateGeometry(a, b, tolerance, budget);
}
