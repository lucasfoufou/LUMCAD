import { framedDrawingPoint } from './drawingAffineFrame.js';
const EPSILON = 1e-10;
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) < EPSILON
    && p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON
    && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;

export function normalizeImageClip(value) {
    if (!Array.isArray(value?.points) || value.points.length < 3 || value.points.length > 128) return null;
    const points = value.points.map(point => ({ x: point?.x, y: point?.y }));
    if (points.some(point => ![point.x, point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))) return null;
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i]; const b = points[(i + 1) % points.length];
        if (Math.hypot(a.x - b.x, a.y - b.y) < EPSILON) return null;
        const previous = points[(i + points.length - 1) % points.length];
        if (Math.abs(cross(previous, a, b)) < EPSILON
            && (a.x - previous.x) * (b.x - a.x) + (a.y - previous.y) * (b.y - a.y) < 0) return null;
        area += a.x * b.y - b.x * a.y;
        for (let j = i + 1; j < points.length; j += 1) {
            if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
            const c = points[j]; const d = points[(j + 1) % points.length];
            if (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
                || (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)) return null;
        }
    }
    return Math.abs(area) > EPSILON ? { enabled: value.enabled !== false, points } : null;
}

export function parseImageClipInput(input, current) {
    const tokens = String(input || '').trim().toUpperCase().split(/\s+/);
    if (tokens.length === 1 && tokens[0] === 'DELETE') return { imageClip: undefined };
    if (tokens.length === 1 && ['ON', 'OFF'].includes(tokens[0])) {
        const clip = normalizeImageClip(current);
        return clip ? { imageClip: { ...clip, enabled: tokens[0] === 'ON' } } : null;
    }
    const values = tokens.slice(1).map(Number);
    let points;
    if (tokens[0] === 'RECT' && values.length === 4) {
        const [x1, y1, x2, y2] = values;
        points = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
    } else if (tokens[0] === 'POLYGON' && values.length >= 6 && values.length % 2 === 0) {
        points = Array.from({ length: values.length / 2 }, (_, index) => ({ x: values[index * 2], y: values[index * 2 + 1] }));
    }
    const clip = normalizeImageClip({ points });
    return clip ? { imageClip: clip } : null;
}

/** Clip coordinates are fractions of the unrotated image rectangle. */
export function getImageClipPoints(entity, { world = false } = {}) {
    const clip = normalizeImageClip(entity?.imageClip);
    if (!clip?.enabled) return null;
    const x = Math.min(entity.x, entity.x + entity.width); const y = Math.min(entity.y, entity.y + entity.height);
    const width = Math.abs(entity.width); const height = Math.abs(entity.height);
    const angle = (Number(entity.rotation) || 0) * Math.PI / 180;
    const cosine = Math.cos(angle); const sine = Math.sin(angle);
    return clip.points.map(point => {
        const dx = (point.x - 0.5) * width; const dy = (point.y - 0.5) * height * (world && entity.mirrored ? -1 : 1);
        return world ? framedDrawingPoint(entity, { x: x + width / 2 + dx * cosine - dy * sine, y: y + height / 2 + dx * sine + dy * cosine })
            : { x: x + point.x * width, y: y + point.y * height };
    });
}
