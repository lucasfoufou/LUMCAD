import { curveLength, curveParameterAtLength, curvePointAt, curveTangentAt, extractEntityPaths, reversePath } from './drawingCurveKernel.js';

export const MAX_POINT_PLACEMENTS = 10_000;

/** DIVIDE excludes open endpoints; closed paths include their seam once.
 * MEASURE starts one spacing from the origin and excludes the terminal endpoint.
 * Distances are measured along native curves, never along their display mesh.
 */
export function drawingPlacementStations(entity, { mode = 'divide', count, spacing, reverse = false } = {}) {
    if (!['divide', 'measure'].includes(mode)) return null;
    const paths = extractEntityPaths(entity);
    if (paths.length !== 1) return null;
    const path = reverse ? reversePath(paths[0]) : paths[0];
    if (!path) return null;
    const lengths = path.parts.map(part => curveLength(part));
    const length = lengths.reduce((total, value) => total + value, 0);
    if (!lengths.every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(length)) return null;
    let distances;
    if (mode === 'divide') {
        if (!Number.isInteger(count) || count < 2 || count > MAX_POINT_PLACEMENTS) return null;
        distances = Array.from({ length: path.closed ? count : count - 1 }, (_, index) =>
            (index + (path.closed ? 0 : 1)) * length / count);
    } else {
        if (!Number.isFinite(spacing) || spacing <= 0) return null;
        const ratio = length / spacing;
        const tolerance = 32 * Number.EPSILON * Math.max(1, ratio);
        const placements = Math.max(0, Math.ceil(ratio - tolerance) - 1);
        if (!Number.isFinite(placements) || placements > MAX_POINT_PLACEMENTS) return null;
        distances = Array.from({ length: placements }, (_, index) => (index + 1) * spacing);
    }
    let partIndex = 0;
    let prefix = 0;
    const stations = [];
    for (const distance of distances) {
        // At a corner use the outgoing segment for aligned block placement.
        while (partIndex < lengths.length - 1 && distance >= prefix + lengths[partIndex]) {
            prefix += lengths[partIndex++];
        }
        const part = path.parts[partIndex];
        const parameter = curveParameterAtLength(part, Math.max(0, Math.min(lengths[partIndex], distance - prefix)));
        if (parameter === null) return null;
        const point = curvePointAt(part, parameter);
        let tangent = curveTangentAt(part, parameter);
        if (!tangent) {
            const before = curvePointAt(part, Math.max(0, parameter - 1e-6));
            const after = curvePointAt(part, Math.min(1, parameter + 1e-6));
            const magnitude = Math.hypot(after.x - before.x, after.y - before.y);
            if (magnitude > 0) tangent = { x: (after.x - before.x) / magnitude, y: (after.y - before.y) / magnitude };
        }
        if (!point || !tangent) return null;
        stations.push({ point, tangent, distance, rotation: Math.atan2(tangent.y, tangent.x) * 180 / Math.PI });
    }
    return stations;
}
