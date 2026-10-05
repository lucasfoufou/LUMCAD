import { sampleDrawingBoundaryPath, drawingPolygonContainsPoint } from './drawingBoundaryDetection.js';
import { extractEntityPaths, curvePointAt, curveDerivativeAt, pathLength, curveSubcurve, intersectCurves } from './drawingCurveKernel.js';
import { getEntityBounds } from './drawingGeometry.js';

const NODES = [0.09501250983763744, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.755404408355003, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499];
const WEIGHTS = [0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767, 0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541];

export function measureDrawingPoints(mode, points) {
    if (!points.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y))) return null;
    if (mode === 'id' && points.length === 1) return { x: points[0].x, y: points[0].y };
    if (mode === 'distance' && points.length === 2) {
        const dx = points[1].x - points[0].x; const dy = points[1].y - points[0].y;
        return { distance: Math.hypot(dx, dy), dx, dy, angle: Math.atan2(dy, dx) * 180 / Math.PI };
    }
    if (mode === 'angle' && points.length === 3) {
        const a = { x: points[0].x - points[1].x, y: points[0].y - points[1].y };
        const b = { x: points[2].x - points[1].x, y: points[2].y - points[1].y };
        if (Math.hypot(a.x, a.y) < 1e-12 || Math.hypot(b.x, b.y) < 1e-12) return null;
        return { angle: Math.atan2(Math.abs(a.x * b.y - a.y * b.x), a.x * b.x + a.y * b.y) * 180 / Math.PI };
    }
    return null;
}

export function measureDrawingEntity(entity) {
    if (!entity) return null;
    const paths = extractEntityPaths(entity);
    if (!paths.length || paths.length > 32 || paths.reduce((sum, path) => sum + path.parts.length, 0) > 256) return null;
    const perimeter = paths.reduce((sum, path) => sum + pathLength(path), 0);
    const result = { perimeter };
    if (['circle', 'arc'].includes(entity.type)) result.radius = entity.r;
    if (!paths.every(path => path.closed)) return result;
    const bounds = getEntityBounds(entity);
    if (!bounds) return null;
    const origin = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    const loops = paths.map(path => ({ path, polygon: sampleDrawingBoundaryPath(path) }));
    if (loops.some(loop => !loop.polygon) || !simpleDisjointLoops(paths)) return null;
    let area = 0; let momentX = 0; let momentY = 0; let inertiaX = 0; let inertiaY = 0;
    for (const loop of loops) {
        const integrals = [0, 0, 0, 0, 0];
        for (const curve of loop.path.parts) {
            for (let section = 0; section < 4; section += 1) {
                for (let i = 0; i < NODES.length; i += 1) {
                    for (const sign of [-1, 1]) {
                        const t = (section + (1 + sign * NODES[i]) / 2) / 4;
                        const p = curvePointAt(curve, t); const d = curveDerivativeAt(curve, t);
                        const x = p.x - origin.x; const y = p.y - origin.y;
                        const values = [x * d.y, x * x * d.y / 2, -y * y * d.x / 2, -(y ** 3) * d.x / 3, x ** 3 * d.y / 3];
                        values.forEach((value, index) => { integrals[index] += value * WEIGHTS[i] / 8; });
                    }
                }
            }
        }
        loop.integrals = integrals;
    }
    let filledPerimeter = 0;
    for (const loop of loops) {
        const integrals = loop.integrals;
        const sample = curvePointAt(loop.path.parts[0], 0);
        const parents = loops.filter(other => other !== loop && drawingPolygonContainsPoint(other.polygon, sample));
        const outside = parents.reduce((sum, other) => sum + Math.sign(other.integrals[0]), 0);
        const contribution = entity.fillRule === 'nonzero'
            ? Number(outside + Math.sign(integrals[0]) !== 0) - Number(outside !== 0)
            : parents.length % 2 ? -1 : 1;
        if (contribution) filledPerimeter += pathLength(loop.path);
        const direction = (integrals[0] < 0 ? -1 : 1) * contribution;
        area += direction * integrals[0]; momentX += direction * integrals[1]; momentY += direction * integrals[2];
        inertiaX += direction * integrals[3]; inertiaY += direction * integrals[4];
    }
    if (!(area > 1e-12)) return null;
    return { ...result, ...(entity.fillRule === 'nonzero' ? { perimeter: filledPerimeter } : {}), area, centroidX: origin.x + momentX / area, centroidY: origin.y + momentY / area,
        inertiaX: inertiaX - momentY * momentY / area, inertiaY: inertiaY - momentX * momentX / area };
}

function simpleDisjointLoops(paths) {
    const curves = paths.flatMap((path, loop) => {
        const parts = path.parts.flatMap(part => Array.from({ length: part.type === 'line' ? 1 : 4 }, (_, i) =>
            part.type === 'line' ? part : curveSubcurve(part, i / 4, (i + 1) / 4)));
        return parts.map((curve, index) => ({ loop, curve, index, count: parts.length }));
    });
    if (curves.length > 256) return false;
    let checks = 0;
    for (let i = 0; i < curves.length; i += 1) {
        for (let j = i + 1; j < curves.length; j += 1) {
            const result = intersectCurves(curves[i].curve, curves[j].curve, { maxIntersectionChecks: Math.max(1, 200000 - checks) });
            checks += result.checks || 1;
            if (result.truncated || checks > 200000 || result.overlaps.length) return false;
            const separation = Math.abs(curves[i].index - curves[j].index);
            const adjacent = curves[i].loop === curves[j].loop && (separation === 1 || separation === curves[i].count - 1);
            if (result.points.some(hit => !adjacent
                || hit.leftT > 1e-7 && hit.leftT < 1 - 1e-7 || hit.rightT > 1e-7 && hit.rightT < 1 - 1e-7)) return false;
        }
    }
    return true;
}
