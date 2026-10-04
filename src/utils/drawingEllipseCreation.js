import { normalizeCurvePrimitive } from './drawingCurveKernel.js';

const EPSILON = 1e-9;
export const ELLIPSE_CREATION_MODES = Object.freeze(['axis', 'center', 'axisArc', 'centerArc']);

export function ellipseCreationPointCount(mode) {
    return mode === 'axisArc' || mode === 'centerArc' ? 5 : 3;
}

/** Axis endpoint (or centre), axis endpoint, perpendicular radius, arc start/end. */
export function buildEllipseCreationEntity(points, layerId, mode = 'axis', options = {}, id = 'draft') {
    if (!ELLIPSE_CREATION_MODES.includes(mode) || !Array.isArray(points)
        || points.length < ellipseCreationPointCount(mode)
        || points.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) return null;
    const [first, second, third] = points;
    const centered = mode === 'center' || mode === 'centerArc';
    const cx = centered ? first.x : first.x / 2 + second.x / 2;
    const cy = centered ? first.y : first.y / 2 + second.y / 2;
    const dx = second.x - cx;
    const dy = second.y - cy;
    const rx = Math.hypot(dx, dy);
    if (rx <= EPSILON) return null;
    const ry = Math.abs((-dy * (third.x - cx) + dx * (third.y - cy)) / rx);
    const ellipse = normalizeCurvePrimitive({
        id, type: 'ellipse', layerId, cx, cy, rx, ry,
        rotation: Math.atan2(dy, dx) * 180 / Math.PI,
        fullEllipse: true, counterClockwise: options.counterClockwise !== false,
    });
    if (!ellipse || ellipseCreationPointCount(mode) === 3) return ellipse;
    const angle = point => {
        const x = point.x - cx;
        const y = point.y - cy;
        if (Math.hypot(x, y) <= EPSILON) return null;
        return Math.atan2((-dy * x + dx * y) / rx / ry, (dx * x + dy * y) / rx / rx);
    };
    const startAngle = angle(points[3]);
    const endAngle = angle(points[4]);
    if (startAngle === null || endAngle === null) return null;
    return normalizeCurvePrimitive({ ...ellipse, fullEllipse: false, startAngle, endAngle });
}

export function buildEllipseCreationPreview(points, layerId, mode = 'axis', options = {}, id = 'draft') {
    if (points.length >= ellipseCreationPointCount(mode)) return buildEllipseCreationEntity(points, layerId, mode, options, id);
    if (points.length >= 3) return buildEllipseCreationEntity(points.slice(0, 3), layerId, mode.startsWith('center') ? 'center' : 'axis', options, id);
    if (points.length === 2) return { id, type: 'line', layerId, x1: points[0].x, y1: points[0].y, x2: points[1].x, y2: points[1].y };
    return null;
}
