import { getCurveStart, getCurveEnd, normalizeCurvePath } from './drawingCurveKernel.js';

const ANGLE_TICK = Math.PI / (180 * 360000);

/** Endpoint uncertainty from integer coordinates and encoded start/sweep/rotation angles. */
export function drawingDgnJunctionTolerance(left, right, uorPerMaster) {
    const uncertainty = curve => curve.type === 'line' ? Math.SQRT2 / uorPerMaster
        : 3 * ANGLE_TICK * Math.max(curve.rx || curve.r || 0, curve.ry || curve.r || 0);
    const points = [getCurveEnd(left), getCurveStart(right)];
    const roundoff = 16 * Number.EPSILON * Math.max(1, ...points.flatMap(point => [Math.abs(point.x), Math.abs(point.y)]));
    return uncertainty(left) + uncertainty(right) + roundoff;
}

/** Reconcile only sub-resolution gaps, preserving arcs and appearance-source correspondence. */
export function reconcileDrawingDgnJunctions(parts, sources, closed, uorPerMaster) {
    const curves = parts.map(part => ({ ...part })); const bridges = new Map(); let adjusted = false;
    for (let index = 0; index < curves.length - (closed ? 0 : 1); index++) {
        const next = (index + 1) % curves.length; const left = curves[index]; const right = curves[next];
        const end = getCurveEnd(left); const start = getCurveStart(right);
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        const roundoff = 16 * Number.EPSILON * Math.max(1, Math.abs(end.x), Math.abs(end.y), Math.abs(start.x), Math.abs(start.y));
        if (distance <= Math.min(1e-7, Math.max(1e-9, roundoff))) continue;
        if (distance > drawingDgnJunctionTolerance(left, right, uorPerMaster)) throw new Error('dgnUnsupported');
        adjusted = true;
        if (left.type === 'line') curves[index] = { ...left, x2: start.x, y2: start.y };
        else if (right.type === 'line') curves[next] = { ...right, x1: end.x, y1: end.y };
        else bridges.set(index, { type: 'line', x1: end.x, y1: end.y, x2: start.x, y2: start.y });
    }
    if (curves.length + bridges.size > 4096) throw new Error('dgnLimit');
    const joined = []; const partSources = [];
    curves.forEach((curve, index) => {
        joined.push(curve); partSources.push(sources[index]);
        if (bridges.has(index)) { joined.push(bridges.get(index)); partSources.push(sources[index]); }
    });
    const path = normalizeCurvePath({ parts: joined, closed });
    if (!path) throw new Error('dgnUnsupported');
    return { path, partSources, adjusted, addedPoints: bridges.size * 2 };
}
