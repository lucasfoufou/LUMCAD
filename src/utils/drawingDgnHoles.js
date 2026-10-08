import { extractEntityPaths, getCurveStart, closestPointOnCurve } from './drawingCurveKernel.js';
import { sampleDrawingBoundaryPath, drawingPolygonContainsPoint } from './drawingBoundaryDetection.js';
import { measureDrawingEntity } from './drawingInquiry.js';

/** Validate one solid with disjoint internal holes, retaining exact curves for the fill. */
export function drawingDgnGroupedHole(primitives) {
    if (primitives.length < 2) throw new Error('dgnUnsupported');
    if (primitives.length > 32) throw new Error('dgnLimit');
    const solids = primitives.filter(primitive => !(primitive.properties & 0x8000));
    if (solids.length !== 1) throw new Error('dgnUnsupported');
    const solid = solids[0];
    const ordered = [solid, ...primitives.filter(primitive => primitive !== solid)];
    const boundaries = ordered.map(primitive => {
        const paths = extractEntityPaths(primitive.geometry);
        if (paths.length !== 1 || !paths[0].closed) throw new Error('dgnUnsupported');
        return paths[0];
    });
    // Reuse the inquiry topology checks: self-crossings, touching and intersecting loops reject.
    if (!measureDrawingEntity({ type: 'hatch', boundaries })) throw new Error('dgnUnsupported');
    const polygons = boundaries.map(sampleDrawingBoundaryPath);
    if (polygons.some(polygon => !polygon)) throw new Error('dgnLimit');
    for (let i = 1; i < boundaries.length; i++) {
        const point = getCurveStart(boundaries[i].parts[0]);
        for (let j = 0; j < boundaries.length; j++) {
            if (i === j) continue;
            // Keep polygon classification away from its adaptive-sampling tolerance.
            if (boundaries[j].parts.some(curve => {
                const closest = closestPointOnCurve(curve, point);
                return !closest || Math.hypot(closest.point.x - point.x, closest.point.y - point.y) <= 3e-5;
            })) throw new Error('dgnUnsupported');
            if (drawingPolygonContainsPoint(polygons[j], point) !== (j === 0)) throw new Error('dgnUnsupported');
        }
    }
    return { solid, boundaries };
}
