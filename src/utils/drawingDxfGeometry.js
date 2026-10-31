import { failDxf, recordNumber, recordPoint, recordPointList } from './drawingDxfReader.js';
import { drawingLineworkArc } from './drawingLinework.js';
import { normalizeDrawingHatch } from './drawingAdvancedEntities.js';
import { extractEntityPaths, getCurveStart, getCurveEnd, normalizeCurvePrimitive } from './drawingCurveKernel.js';
import { transformEllipseAffine } from './drawingAdvancedEntities.js';
import { createDrawingWipeout } from './drawingWipeout.js';

const line = (start, end) => ({ type: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y });
const close = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
const rad = value => value * Math.PI / 180;

/** AutoCAD arbitrary-axis basis, shared by OCS geometry and MTEXT rotation. */
export function dxfOcsAxes(normal) {
    const length = normal && Math.hypot(normal.x, normal.y, normal.z);
    if (!(length > 0)) failDxf('cadInvalid');
    const z = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
    let x = Math.abs(z.x) < 1 / 64 && Math.abs(z.y) < 1 / 64
        ? { x: z.z, y: 0, z: -z.x } : { x: -z.y, y: z.x, z: 0 };
    const size = Math.hypot(x.x, x.y, x.z);
    x = { x: x.x / size, y: x.y / size, z: x.z / size };
    return { x, y: { x: z.y * x.z - z.z * x.y, y: z.z * x.x - z.x * x.z, z: z.x * x.y - z.y * x.x }, z };
}

function solid(points) {
    if (points.length < 3) failDxf('cadUnsupported', 'degenerate fill');
    return normalizeDrawingHatch({ type: 'hatch', boundaries: [{ type: 'polyline', points, closed: true }],
        pattern: { name: 'solid' }, boundaryStroke: false });
}

export function importDxfSolid(source, local) {
    const points = source.corners.filter(Boolean).map(local).filter((point, index, all) => !index || !close(point, all[index - 1]));
    if (points.length > 1 && close(points[0], points.at(-1))) points.pop();
    return solid(points);
}

/** Cached wipeout boundary is in normalized image coordinates, anchored by U/V. */
export function importDxfWipeout(source, local) {
    const origin = local(recordPoint(source, 10));
    const u = recordPoint(source, 11); const v = recordPoint(source, 12);
    if (!u || !v) failDxf('cadInvalid');
    const size = recordPoint(source, 13) || { x: 1, y: 1 };
    let clip = recordPointList(source, 14);
    if (recordNumber(source, 71, 2) === 1 && clip.length === 2) {
        clip = [clip[0], { x: clip[1].x, y: clip[0].y }, clip[1], { x: clip[0].x, y: clip[1].y }];
    }
    if (clip.length > 1 && close(clip[0], clip.at(-1))) clip.pop();
    if (clip.length < 3 || clip.length > 128) failDxf('cadUnsupported', 'wipeout boundary');
    const points = clip.map(point => ({ x: origin.x + u.x * (point.x + 0.5) + v.x * (0.5 - point.y),
        y: origin.y + u.y * (point.x + 0.5) + v.y * (0.5 - point.y) }));
    if (![size.x, size.y, ...points.flatMap(p => [p.x, p.y])].every(Number.isFinite)) failDxf('cadInvalid');
    return createDrawingWipeout(points, 'geometry', undefined, false) || failDxf('cadUnsupported', 'wipeout boundary');
}

/** ELLIPSE axes are WCS vectors; extrusion determines the minor axis and sweep. */
export function importDxfEllipse(source, local, factor, warnings) {
    const center = local(source.center);
    const axis = source.majorAxis; const normal = source.extrusion;
    if (!axis || !normal) failDxf('cadInvalid');
    const radius = Math.hypot(axis.x, axis.y, axis.z);
    const length = Math.hypot(normal.x, normal.y, normal.z);
    if (!(radius > 0 && length > 0 && source.axisRatio > 0 && source.axisRatio <= 1)) failDxf('cadInvalid');
    const n = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
    if (Math.abs(n.x * axis.x + n.y * axis.y + n.z * axis.z) > radius * 1e-8) failDxf('cadInvalid');
    if (Math.abs(n.x) > 1e-8 || Math.abs(n.y) > 1e-8) warnings.add('elevation');
    const minor = { x: (n.y * axis.z - n.z * axis.y) * source.axisRatio,
        y: (n.z * axis.x - n.x * axis.z) * source.axisRatio };
    const ellipse = transformEllipseAffine({ type: 'ellipse', cx: 0, cy: 0, rx: 1, ry: 1, rotation: 0,
        startAngle: source.startParameter, endAngle: source.endParameter, counterClockwise: true,
        fullEllipse: Math.abs(source.endParameter - source.startParameter) >= 2 * Math.PI - 1e-9 },
    { a: axis.x, b: axis.y, c: minor.x, d: minor.y, e: center.x, f: center.y });
    return ellipse || failDxf('cadUnsupported', 'edge-on ellipse');
}

export function importDxfHatch(source, local, warnings) {
    const groups = source.groups;
    let index = groups.findIndex(group => group[0] === 91);
    if (index < 0) failDxf('cadInvalid');
    const read = (code, fallback) => {
        if (groups[index]?.[0] !== code) {
            if (fallback !== undefined) return fallback;
            failDxf('cadInvalid');
        }
        const value = Number(groups[index++][1]);
        if (!Number.isFinite(value)) failDxf('cadInvalid');
        return value;
    };
    const point = code => local({ x: read(code), y: read(code + 10), z: 0 });
    const count = (code, max = 100000) => { const value = read(code); if (!Number.isInteger(value) || value < 0 || value > max) failDxf('cadLimit'); return value; };
    const loopCount = count(91, 10000); const boundaries = [];
    for (let loop = 0; loop < loopCount; loop++) {
        const flags = read(92); const parts = [];
        if (flags & 2) {
            const bulges = read(72); const closed = read(73); const length = count(93);
            const vertices = [];
            for (let vertex = 0; vertex < length; vertex++) vertices.push({ point: point(10), bulge: bulges ? read(42, 0) : 0 });
            if (!closed || vertices.length < 2) failDxf('cadUnsupported', 'open hatch boundary');
            for (let j = 0; j < vertices.length; j++) {
                const start = vertices[j]; const end = vertices[(j + 1) % vertices.length].point;
                if (close(start.point, end)) continue;
                if (!start.bulge) parts.push(line(start.point, end));
                else {
                    const arc = drawingLineworkArc(start.point, end, start.bulge);
                    if (!arc) failDxf('cadInvalid');
                    parts.push({ type: 'arc', cx: arc.center.x, cy: arc.center.y, r: arc.radius,
                        startAngle: arc.startAngle, endAngle: arc.startAngle + arc.sweep, counterClockwise: arc.sweep > 0 });
                }
            }
        } else {
            const length = count(93);
            for (let edge = 0; edge < length; edge++) {
                const type = read(72);
                if (type === 1) parts.push(line(point(10), point(11)));
                else if (type === 2 || type === 3) {
                    const center = point(10);
                    const axis = type === 3 ? { x: read(11), y: read(21) } : null;
                    const radius = read(40);
                    const startAngle = rad(read(50)); const endAngle = rad(read(51)); const counterClockwise = read(73) !== 0;
                    if (!(radius > 0)) failDxf('cadInvalid');
                    // DXF clockwise hatch angles are measured clockwise, unlike ARC.
                    const angles = { startAngle: counterClockwise ? startAngle : -startAngle,
                        endAngle: counterClockwise ? endAngle : -endAngle, counterClockwise };
                    if (type === 2) parts.push(Math.abs(endAngle - startAngle) >= 2 * Math.PI - 1e-9
                        ? { type: 'circle', cx: center.x, cy: center.y, r: radius }
                        : { type: 'arc', cx: center.x, cy: center.y, r: radius, ...angles });
                    else {
                        const major = Math.hypot(axis.x, axis.y);
                        if (!(major > 0 && radius <= 1)) failDxf('cadInvalid');
                        parts.push({ type: 'ellipse', cx: center.x, cy: center.y, rx: major, ry: major * radius,
                            rotation: Math.atan2(axis.y, axis.x) * 180 / Math.PI, fullEllipse: Math.abs(endAngle - startAngle) >= 2 * Math.PI - 1e-9,
                            ...angles, startAngle: Math.atan2(Math.sin(angles.startAngle) / radius, Math.cos(angles.startAngle)),
                            endAngle: Math.atan2(Math.sin(angles.endAngle) / radius, Math.cos(angles.endAngle)) });
                    }
                } else failDxf('cadUnsupported', 'spline hatch boundary');
            }
        }
        if (groups[index]?.[0] === 97) { const refs = count(97); for (let ref = 0; ref < refs; ref++) { if (groups[index++]?.[0] !== 330) failDxf('cadInvalid'); } }
        const valid = parts.map(part => normalizeCurvePrimitive(part)).filter(Boolean);
        if (valid.length !== parts.length) warnings.add('hatchBoundary');
        const joined = [];
        for (let j = 0; j < valid.length; j++) {
            const current = valid[j]; const next = valid[(j + 1) % valid.length];
            joined.push(current);
            const end = getCurveEnd(current); const start = getCurveStart(next);
            if (!close(end, start)) {
                joined.push(line(end, start));
                warnings.add('hatchBoundary');
            }
        }
        if (joined.length > 4096 || boundaries.length >= 1024) failDxf('cadLimit');
        if (joined.length) boundaries.push({ type: 'polyline', parts: joined, closed: true });
    }
    if (!boundaries.length) failDxf('cadUnsupported', 'empty hatch');
    let pattern = { name: 'solid' };
    if (!recordNumber(source, 70, 0)) {
        const angle = recordNumber(source, 53, recordNumber(source, 52, 45));
        const dx = recordNumber(source, 45, 0); const dy = recordNumber(source, 46, 1);
        const spacing = Math.abs(-Math.sin(rad(angle)) * dx + Math.cos(rad(angle)) * dy);
        pattern = { name: 'lines', angle, spacing: spacing > 0 ? spacing : 1,
            origin: local({ x: recordNumber(source, 43, 0), y: recordNumber(source, 44, 0), z: 0 }) };
        if (recordNumber(source, 78, 0) !== 1 || recordNumber(source, 79, 0) !== 0) warnings.add('hatchPattern');
    }
    if (recordNumber(source, 450, 0)) warnings.add('hatchPattern');
    const hatch = normalizeDrawingHatch({ type: 'hatch', boundaries, pattern, boundaryStroke: false });
    if (hatch.boundaries.length !== boundaries.length
        || hatch.boundaries.some((boundary, i) => extractEntityPaths(boundary)[0]?.parts.length !== boundaries[i].parts.length)) {
        failDxf('cadUnsupported', 'degenerate hatch boundary');
    }
    return hatch;
}
