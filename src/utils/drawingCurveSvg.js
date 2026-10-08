import { curvePointAt, normalizeCurvePrimitive } from './drawingCurveKernel.js';

/** Shared SVG path serialization for canvas, clipping and portable vector output. */
export function drawingCurvePathToSvgData(path) {
    const commands = []; let previous = null;
    for (const input of path?.parts || []) {
        const part = normalizeCurvePrimitive(input);
        if (!part) continue;
        const start = curvePointAt(part, 0); const end = curvePointAt(part, 1);
        if (!previous || Math.hypot(previous.x - start.x, previous.y - start.y) > 1e-9) commands.push(`M ${start.x} ${start.y}`);
        if (part.type === 'line') commands.push(`L ${end.x} ${end.y}`);
        else if (part.type === 'spline') {
            const [, a, b] = part.controlPoints;
            commands.push(`C ${a.x} ${a.y} ${b.x} ${b.y} ${end.x} ${end.y}`);
        } else {
            const full = part.type === 'circle' || part.fullCircle || part.fullEllipse;
            const direction = part.counterClockwise === false ? 0 : 1;
            const rx = part.type === 'ellipse' ? part.rx : part.r;
            const ry = part.type === 'ellipse' ? part.ry : part.r;
            const rotation = part.type === 'ellipse' ? part.rotation : 0;
            const arc = (point, large) => `A ${rx} ${ry} ${rotation} ${large} ${direction} ${point.x} ${point.y}`;
            if (full) {
                // SVG ignores a single arc with coincident endpoints. Use two half arcs.
                commands.push(arc(curvePointAt(part, 0.5), 0), arc(start, 0));
            } else {
                const tau = Math.PI * 2;
                const sweep = direction ? (part.endAngle - part.startAngle + tau) % tau : (part.startAngle - part.endAngle + tau) % tau;
                commands.push(arc(end, sweep > Math.PI ? 1 : 0));
            }
        }
        previous = end;
    }
    if (path?.closed && commands.length) commands.push('Z');
    return commands.join(' ');
}
