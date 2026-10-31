import { failDxf } from './drawingDxfReader.js';
import { rebuildDefinedSpline } from './drawingSplineCreation.js';

/** Exact cubic spans, including large and closed imported control polygons. */
export function importDxfSpline(source, local) {
    if (source.degree !== 3 || source.rational) failDxf('cadUnsupported', 'SPLINE');
    const points = source.controlPoints.map(local); const knots = source.knots;
    if (points.length < 4 || points.length > 4096 || knots.length !== points.length + 4
        || knots.some((value, i) => !Number.isFinite(value) || i && value < knots[i - 1])) failDxf('cadInvalid');
    const low = knots[3]; const high = knots[points.length];
    if (!(high > low)) failDxf('cadInvalid');
    if (!source.closed && !source.periodic && points.length <= 128) {
        const defined = rebuildDefinedSpline({}, { mode: 'control', points, knots: knots.map(value => (value - low) / (high - low)) });
        if (defined) return defined;
    }
    const evaluate = (value, span) => {
        const work = points.slice(span - 3, span + 1).map(point => ({ ...point }));
        for (let level = 1; level <= 3; level++) for (let j = 3; j >= level; j--) {
            const index = span - 3 + j;
            const denominator = knots[index + 4 - level] - knots[index];
            const alpha = denominator ? (value - knots[index]) / denominator : 0;
            work[j] = { x: (1 - alpha) * work[j - 1].x + alpha * work[j].x,
                y: (1 - alpha) * work[j - 1].y + alpha * work[j].y };
        }
        return work[3];
    };
    const parts = [];
    for (let span = 3; span < points.length; span++) {
        const start = knots[span]; const end = knots[span + 1];
        if (end === start) continue;
        const p0 = evaluate(start, span); const p3 = evaluate(end, span);
        const q1 = evaluate(start + (end - start) / 3, span); const q2 = evaluate(start + 2 * (end - start) / 3, span);
        const p1 = {}; const p2 = {};
        for (const axis of ['x', 'y']) {
            // Work relative to p0 to avoid cancellation in georeferenced plans.
            const a = 27 * (q1[axis] - p0[axis]) - (p3[axis] - p0[axis]);
            const b = 27 * (q2[axis] - p0[axis]) - 8 * (p3[axis] - p0[axis]);
            p1[axis] = p0[axis] + (2 * a - b) / 18;
            p2[axis] = p0[axis] + (2 * b - a) / 18;
        }
        parts.push({ type: 'spline', degree: 3, controlPoints: [p0, p1, p2, p3] });
    }
    if (!parts.length) failDxf('cadInvalid');
    return { type: 'polyline', parts, closed: source.closed || source.periodic };
}
