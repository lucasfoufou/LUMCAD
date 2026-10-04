import { curveLength, intersectCurves } from './drawingCurveKernel.js';
const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));

export function normalizeDimensionBreaks(value) {
    return Array.isArray(value) ? value.slice(0, 128).flatMap(item => {
        if (!item || !['line', 'arc'].includes(item.kind) || !Number.isInteger(item.index) || item.index < 0 || item.index > 10000
            || !Number.isFinite(item.start) || !Number.isFinite(item.end)) return [];
        const start = clamp(Math.min(item.start, item.end));
        const end = clamp(Math.max(item.start, item.end));
        return end - start > 1e-9 ? [{ kind: item.kind, index: item.index, start, end }] : [];
    }) : [];
}

function visibleIntervals(breaks, kind, index) {
    const gaps = [...normalizeDimensionBreaks(breaks), ...normalizeDimensionBreaks(Array.isArray(breaks) ? breaks.slice(128, 256) : [])].filter(item => item.kind === kind && item.index === index).sort((a, b) => a.start - b.start);
    const intervals = []; let cursor = 0;
    for (const gap of gaps) {
        if (gap.start > cursor) intervals.push([cursor, gap.start]);
        cursor = Math.max(cursor, gap.end);
    }
    if (cursor < 1) intervals.push([cursor, 1]);
    return intervals;
}

function sweep(arc) {
    let value = (arc.endAngle - arc.startAngle) % TAU;
    if (arc.counterClockwise && value < 0) value += TAU;
    if (!arc.counterClockwise && value > 0) value -= TAU;
    return value;
}

function linePoint(line, t) {
    return { x: line.start.x + (line.end.x - line.start.x) * t, y: line.start.y + (line.end.y - line.start.y) * t };
}

export function breakDimensionLine(line, index, breaks) {
    return visibleIntervals(breaks, 'line', index).map(([start, end]) => ({ ...line, dimensionPrimitiveIndex: index, start: linePoint(line, start), end: linePoint(line, end) }));
}

export function breakDimensionArc(arc, index, breaks) {
    const angle = sweep(arc);
    return visibleIntervals(breaks, 'arc', index).map(([start, end]) => ({ ...arc, dimensionPrimitiveIndex: index, startAngle: arc.startAngle + angle * start, endAngle: arc.startAngle + angle * end }));
}

function project(primitive, kind, point) {
    if (kind === 'line') {
        const dx = primitive.end.x - primitive.start.x; const dy = primitive.end.y - primitive.start.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared < 1e-18) return null;
        const parameter = clamp(((point.x - primitive.start.x) * dx + (point.y - primitive.start.y) * dy) / lengthSquared);
        const nearest = linePoint(primitive, parameter);
        return { parameter, distance: Math.hypot(point.x - nearest.x, point.y - nearest.y) };
    }
    const angle = Math.atan2(point.y - primitive.center.y, point.x - primitive.center.x);
    const arcSweep = sweep(primitive);
    if (Math.abs(arcSweep) < 1e-9) return null;
    let difference = (angle - primitive.startAngle) % TAU;
    if (arcSweep > 0 && difference < 0) difference += TAU;
    if (arcSweep < 0 && difference > 0) difference -= TAU;
    const candidates = [0, 1, clamp(difference / arcSweep)];
    return candidates.map(parameter => {
        const direction = primitive.startAngle + arcSweep * parameter;
        return { parameter, distance: Math.hypot(point.x - primitive.center.x - primitive.radius * Math.cos(direction), point.y - primitive.center.y - primitive.radius * Math.sin(direction)) };
    }).sort((a, b) => a.distance - b.distance)[0];
}

/** Both points project onto the primitive nearest the first point. */
export function pickDimensionBreak(geometry, first, second) {
    if (![first?.x, first?.y, second?.x, second?.y].every(Number.isFinite)) return null;
    const candidates = ['line', 'arc'].flatMap(kind => (geometry?.[kind === 'line' ? 'lines' : 'arcs'] || []).flatMap((primitive, index) => {
        const projected = project(primitive, kind, first);
        return projected ? [{ kind, index: primitive.dimensionPrimitiveIndex ?? index, primitive, ...projected }] : [];
    })).sort((a, b) => a.distance - b.distance);
    const closest = candidates[0];
    if (!closest) return null;
    const end = project(closest.primitive, closest.kind, second)?.parameter;
    return normalizeDimensionBreaks([{ kind: closest.kind, index: closest.index, start: closest.parameter, end }])[0] || null;
}

export function normalizeAutomaticDimensionBreak(value) {
    if (!value || !Number.isFinite(value.gap) || value.gap <= 0 || value.gap > 1e6 || !Array.isArray(value.sourceIds)) return null;
    const sourceIds = [...new Set(value.sourceIds.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128))].slice(0, 1000);
    return sourceIds.length ? { gap: value.gap, sourceIds } : null;
}

export function automaticDimensionBreaks(geometry, obstacles, gap) {
    if (obstacles.length > 10000) return { gaps: [], truncated: true };
    const gaps = [];
    let checks = 0;
    for (const kind of ['line', 'arc']) {
        for (const [index, primitive] of (geometry[kind === 'line' ? 'lines' : 'arcs'] || []).entries()) {
            const curve = kind === 'line'
                ? { type: 'line', x1: primitive.start.x, y1: primitive.start.y, x2: primitive.end.x, y2: primitive.end.y }
                : { type: 'arc', cx: primitive.center.x, cy: primitive.center.y, r: primitive.radius, startAngle: primitive.startAngle, endAngle: primitive.endAngle, counterClockwise: primitive.counterClockwise };
            const length = curveLength(curve);
            if (length < 1e-9) continue;
            for (const obstacle of obstacles) {
                if (++checks > 100000) return { gaps: [], truncated: true };
                const result = intersectCurves(curve, obstacle);
                if (result.truncated) return { gaps: [], truncated: true };
                for (const hit of result.points) {
                    // Shared endpoints are attachment points, not crossings to mask.
                    if (hit.leftT <= 1e-7 || hit.leftT >= 1 - 1e-7) continue;
                    const start = clamp(hit.leftT - gap / (2 * length));
                    const end = clamp(hit.leftT + gap / (2 * length));
                    const primitiveIndex = primitive.dimensionPrimitiveIndex ?? index;
                    if (!gaps.some(item => item.kind === kind && item.index === primitiveIndex && Math.abs(item.start - start) < 1e-8 && Math.abs(item.end - end) < 1e-8)) gaps.push({ kind, index: primitiveIndex, start, end });
                    if (gaps.length > 128) return { gaps: [], truncated: true };
                }
            }
        }
    }
    return { gaps, truncated: false };
}


export function styledDimensionLines(geometry, entity) {
    const bounded = value => Number.isFinite(value) ? Math.max(0, Math.min(1e6, value)) : 0;
    const gap = bounded(entity.extensionGap);
    const overrun = bounded(entity.extensionOverrun);
    return geometry.lines.flatMap((line, index) => {
        if (line.role !== 'extension' || (!gap && !overrun)) return [{ ...line, dimensionPrimitiveIndex: index }];
        const dx = line.end.x - line.start.x; const dy = line.end.y - line.start.y;
        const length = Math.hypot(dx, dy);
        if (length <= 1e-9 || gap >= length + overrun) return [];
        return [{ ...line, dimensionPrimitiveIndex: index,
            start: { x: line.start.x + dx * gap / length, y: line.start.y + dy * gap / length },
            end: { x: line.end.x + dx * overrun / length, y: line.end.y + dy * overrun / length } }];
    });
}

/** Ignore automatic gaps on obstacles so mutually referencing dimensions remain deterministic. */
export function dimensionObstacleCurves(geometry, entity) {
    if (!geometry) return [];
    const lines = styledDimensionLines(geometry, entity).flatMap(line => breakDimensionLine(line, line.dimensionPrimitiveIndex, entity.dimensionBreaks));
    const arcs = geometry.arcs.flatMap((arc, index) => breakDimensionArc(arc, index, entity.dimensionBreaks));
    return [
        ...lines.map(line => ({ type: 'line', x1: line.start.x, y1: line.start.y, x2: line.end.x, y2: line.end.y })),
        ...arcs.map(arc => ({ type: 'arc', cx: arc.center.x, cy: arc.center.y, r: arc.radius, startAngle: arc.startAngle, endAngle: arc.endAngle, counterClockwise: arc.counterClockwise })),
    ];
}
