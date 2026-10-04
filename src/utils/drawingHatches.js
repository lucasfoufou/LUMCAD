import { extractEntityPaths, getCurveStart, getCurveEnd, reverseCurve } from './drawingCurveKernel.js';
import { normalizeDrawingHatch, normalizeDrawingHatchPattern } from './drawingAdvancedEntities.js';
import { detectDrawingBoundary } from './drawingBoundaryDetection.js';

const LIMIT = 512;
const close = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= 1e-7;

/** Assemble selected closed curves or unbranched endpoint-connected curves into loops. */
export function buildHatchBoundaries(entities) {
    if (!Array.isArray(entities) || !entities.length || entities.length > LIMIT) return null;
    const closed = [];
    const open = [];
    for (const entity of entities) {
        if (!['line', 'arc', 'circle', 'ellipse', 'spline', 'rectangle', 'polygon', 'polyline', 'region'].includes(entity.type) || entity.array) return null;
        const paths = extractEntityPaths(entity);
        if (!paths.length) return null;
        for (const path of paths) {
            if (path.closed) closed.push({ type: 'polyline', closed: true, parts: path.parts });
            else open.push(...path.parts);
        }
    }
    if (open.length + closed.reduce((sum, path) => sum + path.parts.length, 0) > LIMIT) return null;
    while (open.length) {
        const parts = [open.shift()];
        const start = getCurveStart(parts[0]);
        let end = getCurveEnd(parts[0]);
        while (!close(start, end)) {
            const candidates = open.flatMap((curve, index) => {
                if (close(end, getCurveStart(curve))) return [{ index, curve }];
                if (close(end, getCurveEnd(curve))) return [{ index, curve: reverseCurve(curve) }];
                return [];
            });
            if (candidates.length !== 1) return null;
            const next = candidates[0];
            open.splice(next.index, 1);
            parts.push(next.curve);
            end = getCurveEnd(next.curve);
        }
        closed.push({ type: 'polyline', closed: true, parts });
    }
    return closed.length ? closed : null;
}

export function createDrawingHatch(entities, layerId, pattern, id, point = null) {
    const detected = point && detectDrawingBoundary(entities, point);
    const boundaries = point ? detected?.boundaries : buildHatchBoundaries(entities);
    if (!boundaries) return null;
    return normalizeDrawingHatch({
        id, type: 'hatch', layerId, boundaries, pattern,
        sourceIds: detected ? detected.sourceIds : entities.map(entity => entity.id).filter(id => typeof id === 'string'),
        ...(point ? { boundaryPick: { x: point.x, y: point.y } } : {}),
    });
}

export function parseHatchPatternInput(value, current = { name: 'lines', spacing: 0.25, angle: 45 }) {
    const tokens = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return normalizeDrawingHatchPattern(current);
    const mode = tokens[0].toLowerCase();
    if (mode === 'solid' && tokens.length === 1) return normalizeDrawingHatchPattern({ ...current, name: mode });
    if (['lines', 'cross'].includes(mode) && tokens.length <= 3) {
        const spacing = tokens.length >= 2 ? Number(tokens[1]) : current.spacing || 0.25;
        const angle = tokens.length >= 3 ? Number(tokens[2]) : current.angle || 0;
        if (!Number.isFinite(spacing) || spacing < 0.02 || spacing > 1e6 || !Number.isFinite(angle)) return null;
        return normalizeDrawingHatchPattern({ ...current, name: mode, spacing, scale: 1, angle });
    }
    if (['gradient', 'radial'].includes(mode) && tokens.length <= 3) {
        const color = tokens[1] || '#ffffff';
        const angle = tokens[2] === undefined ? current.angle || 0 : Number(tokens[2]);
        if (!/^#[0-9a-f]{6}$/i.test(color) || !Number.isFinite(angle)) return null;
        return normalizeDrawingHatchPattern({ ...current, name: mode, endColor: color, angle });
    }
    if (mode === 'origin' && tokens.length === 3) {
        const x = Number(tokens[1]); const y = Number(tokens[2]);
        if (![x, y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e12)) return null;
        return normalizeDrawingHatchPattern({ ...current, origin: { x, y } });
    }
    return null;
}

function geometry(boundaries) {
    return JSON.stringify((boundaries || []).map(boundary => extractEntityPaths(boundary).map(path => path.parts.map(part => {
        const { type, x1, y1, x2, y2, cx, cy, r, rx, ry, rotation, startAngle, endAngle, counterClockwise, fullEllipse, controlPoints } = part;
        return { type, x1, y1, x2, y2, cx, cy, r, rx, ry, rotation, startAngle, endAngle, counterClockwise, fullEllipse, controlPoints };
    }))));
}

export function refreshDrawingHatches(content, previous = null) {
    if (!Array.isArray(content?.entities)) return content;
    const sourceMap = new Map(content.entities.map(entity => [entity.id, entity]));
    const oldMap = new Map((previous?.entities || []).map(entity => [entity.id, entity]));
    let changed = false;
    const entities = content.entities.map(entity => {
        if (entity.type !== 'hatch' || !Array.isArray(entity.sourceIds) || !entity.sourceIds.length) return entity;
        const sources = entity.sourceIds.map(id => sourceMap.get(id));
        const boundaries = sources.every(Boolean) ? entity.boundaryPick
            ? detectDrawingBoundary(sources, entity.boundaryPick)?.boundaries : buildHatchBoundaries(sources) : null;
        const old = oldMap.get(entity.id);
        const currentGeometry = geometry(entity.boundaries);
        const expectedGeometry = boundaries && geometry(boundaries);
        const editedIndependently = old && geometry(old.boundaries) !== currentGeometry && currentGeometry !== expectedGeometry;
        if (!boundaries || editedIndependently) {
            changed = true;
            const { sourceIds, boundaryPick, ...detached } = entity;
            return detached;
        }
        if (currentGeometry === expectedGeometry) return entity;
        changed = true;
        return { ...entity, boundaries };
    });
    return changed ? { ...content, entities } : content;
}
