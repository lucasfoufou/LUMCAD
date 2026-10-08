import { getDimensionGeometry, formatDrawingDimensionLabel } from './drawingDimensions.js';
import { presentDrawingDimension } from './drawingDimensionPresentation.js';
import { getDrawingTextLayout } from './drawingText.js';
import { createDrawingHatch } from './drawingHatches.js';

/** Resolve the same styled lines, arcs, arrows and measurement text used by the canvas. */
export function drawingDimensionExportEntities(entity, sources, { locale = 'en' } = {}) {
    const size = Math.max(1e-12, Number(entity.textSize) || .35);
    const geometry = presentDrawingDimension(getDimensionGeometry(entity, sources), entity, size);
    if (!geometry) throw new Error('wmfGeometry');
    if (geometry.automaticBreakTruncated) throw new Error('wmfLimit');
    const appearance = Object.fromEntries(['layerId', 'color', 'lineType', 'lineWeight', 'lineWidth', 'transparency', 'plotStyleId']
        .filter(key => entity[key] !== undefined).map(key => [key, entity[key]]));
    const parts = geometry.lines.map(line => ({ type: 'line', x1: line.start.x, y1: line.start.y, x2: line.end.x, y2: line.end.y }));
    parts.push(...geometry.arcs.map(arc => ({ type: 'arc', cx: arc.center.x, cy: arc.center.y, r: arc.radius,
        startAngle: arc.startAngle, endAngle: arc.endAngle, counterClockwise: arc.counterClockwise })));
    for (const marker of geometry.markers) {
        const points = marker.points;
        const segments = points.slice(1).map((point, i) => ({ type: 'line', x1: points[i].x, y1: points[i].y, x2: point.x, y2: point.y }));
        if (marker.type === 'polygon') {
            segments.push({ type: 'line', x1: points.at(-1).x, y1: points.at(-1).y, x2: points[0].x, y2: points[0].y });
            const hatch = createDrawingHatch([{ type: 'polyline', parts: segments, closed: true }], entity.layerId, 'solid');
            if (!hatch) throw new Error('wmfGeometry');
            parts.push(hatch);
        } else parts.push(...segments);
    }
    if (geometry.label) {
        const formatted = formatDrawingDimensionLabel(geometry, entity, locale);
        // The inspection frame is translucent; retain the explicit unsupported-opacity behavior.
        if (formatted.inspection) throw new Error('wmfExportTransparency');
        let degrees = ((geometry.label.angle * 180 / Math.PI + 180) % 360 + 360) % 360 - 180;
        if (degrees > 90) degrees -= 180;
        if (degrees < -90) degrees += 180;
        const angle = degrees * Math.PI / 180; const a = Math.cos(angle); const b = Math.sin(angle);
        formatted.lines.forEach((text, index) => {
            if (!text) return;
            const label = { type: 'text', text, x: 0, y: 0, width: Math.max(size, text.length * size), height: size * 1.5,
                fontSize: size, fontFamily: 'sans', textMode: 'singleLine', horizontalAlign: ['radial', 'ordinate'].includes(geometry.kind) ? 'left' : 'center' };
            const layout = getDrawingTextLayout(label);
            const offset = -size * .35 - (formatted.lines.length - 1 - index) * size * 1.08;
            const x = layout.textX; const y = layout.firstBaseline;
            label.affineFrame = { a, b, c: -b, d: a,
                e: geometry.label.point.x - b * offset - a * x + b * y,
                f: geometry.label.point.y + a * offset - b * x - a * y };
            parts.push(label);
        });
    }
    return parts.map(part => ({ ...part, ...appearance }));
}
