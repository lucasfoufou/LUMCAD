import { closestPointOnCurve, curvePointAt, curveSubcurve, curveTangentAt, extractEntityPaths, getCurveStart, getCurveEnd, intersectCurves, reverseCurve, splitCurve } from './drawingCurveKernel.js';

const EPSILON = 1e-7;
const DISPLAY_TOLERANCE = 1e-5;
const MAX_CURVES = 256;
const MAX_EDGES = 2048;
const MAX_SAMPLES = 32768;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const supported = new Set(['line', 'arc', 'circle', 'ellipse', 'spline', 'rectangle', 'polygon', 'polyline', 'region']);

/** Create independent native closed paths, one per detected outer/island loop. */
export function createDrawingBoundaries(entities, point, layerId, createId) {
    const detected = detectDrawingBoundary(entities, point);
    if (!detected) return null;
    return detected.boundaries.map(boundary => ({ ...boundary, id: createId(), layerId }));
}

export function drawingPolygonContainsPoint(polygon, point) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i]; const b = polygon[j];
        if ((a.y > point.y) !== (b.y > point.y)
            && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

export function sampleDrawingBoundaryPath(path) {
    const budget = { samples: 0 };
    const points = [];
    for (const part of path.parts) {
        const divisions = part.type === 'line' ? 1 : 4;
        for (let index = 0; index < divisions; index += 1) {
            const curve = divisions === 1 ? part : curveSubcurve(part, index / divisions, (index + 1) / divisions);
            const sampled = curve && sampleCurve(curve, budget);
            if (!sampled) return null;
            points.push(...sampled);
        }
    }
    return points;
}

function sampleCurve(curve, budget, depth = 0) {
    const a = getCurveStart(curve); const b = getCurveEnd(curve);
    const chord = distance(a, b);
    let error;
    if (curve.type === 'line') error = 0;
    else if (curve.type === 'spline') {
        const segmentDistance = point => {
            const t = chord ? Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / chord ** 2)) : 0;
            return distance(point, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
        };
        error = Math.max(...curve.controlPoints.slice(1, 3).map(segmentDistance));
    } else {
        // Each circular/elliptical input spans at most a quarter turn. Its midpoint
        // deviation is scaled by the axis ratio for a conservative flatness bound.
        const middle = curvePointAt(curve, 0.5);
        error = distance(middle, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        if (curve.type === 'ellipse') error *= Math.max(curve.rx, curve.ry) / Math.min(curve.rx, curve.ry);
    }
    if (error <= DISPLAY_TOLERANCE) {
        budget.samples += 1;
        return budget.samples <= MAX_SAMPLES ? [a] : null;
    }
    if (depth >= 20) return null;
    const halves = splitCurve(curve, 0.5);
    if (!halves?.every(Boolean)) return null;
    const left = sampleCurve(halves[0], budget, depth + 1);
    const right = left && sampleCurve(halves[1], budget, depth + 1);
    return right ? [...left, ...right] : null;
}

/** Bounded native-curve planar arrangement. Returns only the bounded face at a pick. */
export function detectDrawingBoundary(entities, point) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    const curves = [];
    for (const entity of entities || []) {
        if (!supported.has(entity.type) || entity.array) continue;
        for (const path of extractEntityPaths(entity)) {
            for (const part of path.parts) {
                const divisions = part.type === 'line' ? 1 : 4;
                for (let index = 0; index < divisions; index += 1) {
                    const curve = divisions === 1 ? part : curveSubcurve(part, index / divisions, (index + 1) / divisions);
                    if (curve) curves.push({ curve, sourceId: entity.id, cuts: [0, 1] });
                    if (curves.length > MAX_CURVES) return null;
                }
            }
        }
    }
    if (!curves.length) return null;
    for (const { curve } of curves) {
        const closest = closestPointOnCurve(curve, point);
        if (closest && distance(closest.point, point) <= DISPLAY_TOLERANCE * 2) return null;
    }
    let checks = 0;
    for (let i = 0; i < curves.length; i += 1) {
        for (let j = i + 1; j < curves.length; j += 1) {
            const intersections = intersectCurves(curves[i].curve, curves[j].curve, { maxIntersectionChecks: Math.max(1, 200000 - checks) });
            checks += intersections.checks || 1;
            if (intersections.truncated || intersections.overlaps.length || checks > 200000) return null;
            for (const hit of intersections.points) {
                curves[i].cuts.push(hit.leftT);
                curves[j].cuts.push(hit.rightT);
            }
        }
    }
    const nodes = [];
    const edges = [];
    const nodeAt = point => {
        const found = nodes.findIndex(node => distance(node.point, point) <= EPSILON);
        if (found >= 0) return found;
        nodes.push({ point, outgoing: [] });
        return nodes.length - 1;
    };
    for (const record of curves) {
        const cuts = record.cuts.sort((a, b) => a - b).filter((t, index, values) => index === 0 || t - values[index - 1] > 1e-9);
        for (let index = 1; index < cuts.length; index += 1) {
            const part = curveSubcurve(record.curve, cuts[index - 1], cuts[index]);
            if (!part) continue;
            const from = nodeAt(getCurveStart(part)); const to = nodeAt(getCurveEnd(part));
            if (from === to) continue;
            const first = edges.length;
            for (const [curve, start, end, twin] of [[part, from, to, first + 1], [reverseCurve(part), to, from, first]]) {
                const near = curvePointAt(curve, 0.001); const origin = getCurveStart(curve);
                const tangent = curveTangentAt(curve, 0) || { x: near.x - origin.x, y: near.y - origin.y };
                edges.push({ curve, from: start, to: end, twin, sourceId: record.sourceId,
                    angle: Math.atan2(tangent.y, tangent.x), bend: Math.atan2(near.y - origin.y, near.x - origin.x) });
                nodes[start].outgoing.push(edges.length - 1);
            }
            if (edges.length > MAX_EDGES * 2) return null;
        }
    }
    for (const node of nodes) node.outgoing.sort((a, b) => edges[a].angle - edges[b].angle || edges[a].bend - edges[b].bend);
    const visited = new Set(); const faces = []; const budget = { samples: 0 };
    for (let initial = 0; initial < edges.length; initial += 1) {
        if (visited.has(initial)) continue;
        const ring = []; let current = initial;
        while (!visited.has(current)) {
            visited.add(current); ring.push(current);
            const edge = edges[current]; const outgoing = nodes[edge.to].outgoing;
            const reverseIndex = outgoing.indexOf(edge.twin);
            current = outgoing[(reverseIndex + outgoing.length - 1) % outgoing.length];
        }
        if (current !== initial) return null;
        // Remove out-and-back dangling branches; they do not bound a face.
        const ringSet = new Set(ring);
        const boundaryEdges = ring.filter(index => !ringSet.has(edges[index].twin));
        if (boundaryEdges.length < 2) continue;
        const polygon = [];
        for (const index of boundaryEdges) {
            const sampled = sampleCurve(edges[index].curve, budget);
            if (!sampled) return null;
            polygon.push(...sampled);
        }
        const origin = polygon[0];
        const area = polygon.reduce((sum, p, index) => {
            const q = polygon[(index + 1) % polygon.length];
            return sum + (p.x - origin.x) * (q.y - origin.y) - (q.x - origin.x) * (p.y - origin.y);
        }, 0) / 2;
        if (area > EPSILON ** 2) faces.push({ area, polygon, edges: boundaryEdges });
    }
    const outer = faces.filter(face => drawingPolygonContainsPoint(face.polygon, point)).sort((a, b) => a.area - b.area)[0];
    if (!outer) return null;
    const enclosed = faces.filter(face => face !== outer && face.area < outer.area
        && face.polygon.every(vertex => drawingPolygonContainsPoint(outer.polygon, vertex)));
    // A face excludes each immediate island in its entirety. Deeper nested faces
    // belong to another connected area and must not refill that island.
    const loops = [outer, ...enclosed.filter(face => !enclosed.some(parent => parent !== face
        && parent.area > face.area && face.polygon.every(vertex => drawingPolygonContainsPoint(parent.polygon, vertex))))];
    return {
        boundaries: loops.map(face => ({ type: 'polyline', closed: true, parts: face.edges.map(index => edges[index].curve) })),
        sourceIds: [...new Set(loops.flatMap(face => face.edges.map(index => edges[index].sourceId)).filter(Boolean))],
    };
}
