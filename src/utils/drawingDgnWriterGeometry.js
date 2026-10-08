import { writeDrawingDgnHeader } from './drawingDgnWriterHeader.js';
import { writeDrawingDgnInt32, writeDrawingDgnVaxDouble } from './drawingDgnNumbers.js';
import { normalizeCurvePrimitive } from './drawingCurveKernel.js';
import { arcSweep } from './drawingCurves.js';
import { getEntityBounds } from './drawingGeometry.js';
import { writeDrawingDgnFill } from './drawingDgnWriterFill.js';

/** Encode one V7 2D element in source master units (Y up). File assembly owns axis conversion. */
export function writeDrawingDgnGeometry(input, { uorPerMaster = 100000, originUor = { x: 0, y: 0 },
    level = 1, color = 0, weight = 0, style = 0, graphicGroup = 0, complex = false, fillColor = null } = {}) {
    let geometry; let type; let length; let points;
    if (input?.type === 'polyline' && !input.parts) {
        if (!Array.isArray(input.points)) throw new Error('dgnGeometry');
        if (input.points.length > 101) throw new Error('dgnLimit');
        points = input.points.map(point => ({ x: point?.x, y: point?.y }));
        if (!points || points.length < (input.closed ? 3 : 2)
            || points.some(point => ![point.x, point.y].every(Number.isFinite))) throw new Error('dgnGeometry');
        if (input.closed && (points[0].x !== points.at(-1).x || points[0].y !== points.at(-1).y)) points.push({ ...points[0] });
        if (points.length > 101) throw new Error('dgnLimit');
        geometry = { ...input, points }; type = input.closed ? 6 : 4; length = 38 + points.length * 8;
    } else {
        geometry = normalizeCurvePrimitive(input);
        if (!geometry || !['line', 'circle', 'arc', 'ellipse'].includes(geometry.type)) throw new Error('dgnUnsupported');
        if (geometry.type === 'line') {
            points = [{ x: geometry.x1, y: geometry.y1 }, { x: geometry.x2, y: geometry.y2 }]; type = 3; length = 52;
        } else {
            const full = geometry.type === 'circle' || geometry.fullCircle || geometry.fullEllipse;
            type = full ? 15 : 16; length = full ? 72 : 80;
        }
    }
    let startUnits; let sweepUnits; let rotationUnits;
    if (!points) {
        rotationUnits = Math.round((geometry.rotation || 0) % 360 * 360000);
        geometry = { ...geometry, rotation: rotationUnits / 360000 };
        if (type === 16) {
            startUnits = Math.round(geometry.startAngle * 180 / Math.PI * 360000);
            sweepUnits = Math.round(arcSweep(geometry) * 180 / Math.PI * 360000);
            if (!sweepUnits || Math.abs(sweepUnits) >= 360 * 360000) throw new Error('dgnRange');
            geometry = { ...geometry, startAngle: startUnits / 360000 * Math.PI / 180,
                endAngle: (startUnits + sweepUnits) / 360000 * Math.PI / 180 };
        }
    }
    const bytes = writeDrawingDgnHeader(type, length, getEntityBounds(geometry),
        { uorPerMaster, originUor, level, color, weight, style, graphicGroup, complex });
    const view = new DataView(bytes.buffer);
    const coordinate = (value, axis) => value * uorPerMaster + originUor[axis];
    if (points) {
        const start = type === 3 ? 36 : 38;
        if (type !== 3) view.setUint16(36, points.length, true);
        points.forEach((point, index) => {
            writeDrawingDgnInt32(view, start + index * 8, Math.round(coordinate(point.x, 'x')));
            writeDrawingDgnInt32(view, start + index * 8 + 4, Math.round(coordinate(point.y, 'y')));
        });
    } else {
        const shift = type === 16 ? 8 : 0;
        if (type === 16) {
            writeDrawingDgnInt32(view, 36, startUnits);
            writeDrawingDgnInt32(view, 40, sweepUnits < 0 ? Math.abs(sweepUnits) | 0x80000000 : sweepUnits);
        }
        writeDrawingDgnVaxDouble(view, 36 + shift, (geometry.rx ?? geometry.r) * uorPerMaster);
        writeDrawingDgnVaxDouble(view, 44 + shift, (geometry.ry ?? geometry.r) * uorPerMaster);
        writeDrawingDgnInt32(view, 52 + shift, rotationUnits);
        writeDrawingDgnVaxDouble(view, 56 + shift, coordinate(geometry.cx, 'x'));
        writeDrawingDgnVaxDouble(view, 64 + shift, coordinate(geometry.cy, 'y'));
    }
    return writeDrawingDgnFill(bytes, fillColor);
}
