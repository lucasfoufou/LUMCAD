import { breakDimensionLine, breakDimensionArc, automaticDimensionBreaks, styledDimensionLines } from './drawingDimensionBreaks.js';
import { formatDrawingDimensionLabel } from './drawingDimensions.js';

/** Shared model/print/SVG presentation; measurement geometry stays unchanged. */
export function presentDrawingDimension(geometry, entity, textSize = 0.35) {
    if (!geometry) return null;
    const bounded = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(1e6, value)) : fallback;
    const size = bounded(entity.arrowSize, textSize * 0.7);
    const styledLines = styledDimensionLines(geometry, entity);
    const automatic = geometry.automaticBreakSourceTruncated ? { gaps: [], truncated: true } : entity.dimensionAutoBreak && geometry.automaticBreakCurves
        ? automaticDimensionBreaks({ ...geometry, lines: styledLines }, geometry.automaticBreakCurves, entity.dimensionAutoBreak.gap)
        : { gaps: [], truncated: false };
    const allBreaks = [...(entity.dimensionBreaks || []), ...automatic.gaps];
    const lines = styledLines.flatMap(line => breakDimensionLine(line, line.dimensionPrimitiveIndex, allBreaks));
    const markers = !size || entity.arrowType === 'none' ? [] : geometry.ticks.map((tick, index) => {
        if (!['closed', 'open'].includes(entity.arrowType)) {
            const angle = tick.angle + Math.PI / 4;
            const dx = Math.cos(angle) * size / 2; const dy = Math.sin(angle) * size / 2;
            return { type: 'line', points: [{ x: tick.point.x - dx, y: tick.point.y - dy }, { x: tick.point.x + dx, y: tick.point.y + dy }] };
        }
        const direction = arrowInteriorDirection(geometry, tick, index);
        const base = { x: tick.point.x + direction.x * size, y: tick.point.y + direction.y * size };
        const halfWidth = size * 0.22;
        const left = { x: base.x - direction.y * halfWidth, y: base.y + direction.x * halfWidth };
        const right = { x: base.x + direction.y * halfWidth, y: base.y - direction.x * halfWidth };
        return { type: entity.arrowType === 'closed' ? 'polygon' : 'polyline', points: [left, tick.point, right] };
    });
    const label = geometry.label ? { ...geometry.label,
        point: Number.isFinite(entity.dimensionTextPosition?.x) && Number.isFinite(entity.dimensionTextPosition?.y)
            ? { ...entity.dimensionTextPosition } : geometry.label.point,
        angle: Number.isFinite(entity.dimensionTextAngle) ? entity.dimensionTextAngle : geometry.label.angle,
    } : geometry.label;
    return { ...geometry, lines, arcs: geometry.arcs.flatMap((arc, index) => breakDimensionArc(arc, index, allBreaks)), markers, label, automaticBreakTruncated: automatic.truncated };
}

function arrowInteriorDirection(geometry, tick, index) {
    const close = point => Math.hypot(point.x - tick.point.x, point.y - tick.point.y) < 1e-7;
    const line = geometry.lines.find(candidate => ['dimension', 'radius', 'leader', 'ordinate'].includes(candidate.role)
        && (close(candidate.start) || close(candidate.end)) && Math.hypot(candidate.end.x - candidate.start.x, candidate.end.y - candidate.start.y) > 1e-9);
    if (line) {
        const target = close(line.start) ? line.end : line.start;
        const length = Math.hypot(target.x - tick.point.x, target.y - tick.point.y);
        return { x: (target.x - tick.point.x) / length, y: (target.y - tick.point.y) / length };
    }
    const arc = geometry.arcs.find(candidate => candidate.role === 'dimension');
    if (arc) {
        const radial = Math.atan2(tick.point.y - arc.center.y, tick.point.x - arc.center.x);
        const sign = (arc.counterClockwise ? 1 : -1) * (index === 0 ? 1 : -1);
        return { x: -Math.sin(radial) * sign, y: Math.cos(radial) * sign };
    }
    const angle = tick.angle - Math.PI / 2;
    return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function drawingDimensionPresentationPoints(geometry, entity) {
    const presented = presentDrawingDimension(geometry, entity, entity.textSize);
    return presented ? [...presented.points, ...drawingDimensionTextPoints(presented, entity), ...presented.lines.flatMap(line => [line.start, line.end]), ...presented.markers.flatMap(marker => marker.points)] : [];
}

/** Conservative text frame shared by bounds and selection, in drawing coordinates. */
export function drawingDimensionTextPoints(geometry, entity) {
    if (!geometry?.label) return [];
    const { lines } = formatDrawingDimensionLabel(geometry, entity, 'en');
    if (!lines.some(Boolean)) return [];
    const size = Number.isFinite(entity.textSize) ? Math.max(1e-12, entity.textSize) : 0.35;
    const width = Math.max(...lines.map(line => String(line).length), 1) * size * 0.58 + size * 0.8;
    const height = Math.max(1, lines.length) * size * 1.08 + size * 0.45;
    const left = ['radial', 'ordinate'].includes(geometry.kind) ? -size * 0.22 : -width / 2;
    const top = -height - size * 0.12;
    let angle = ((geometry.label.angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    const point = geometry.label.point;
    return [[left, top], [left + width, top], [left + width, top + height], [left, top + height]]
        .map(([x, y]) => ({ x: point.x + x * Math.cos(angle) - y * Math.sin(angle), y: point.y + x * Math.sin(angle) + y * Math.cos(angle) }));
}
