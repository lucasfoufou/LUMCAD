import { closestPointOnCurve, curvePointAt, curveTangentAt, normalizeCurvePrimitive } from './drawingCurveKernel.js';

const TAU = Math.PI * 2;
export const ELLIPSE_OFFSET_TOLERANCE = 1e-5;

export function ellipseOffsetThroughParameters(entity, point, { requireNormal = true } = {}) {
    const ellipse = normalizeCurvePrimitive(entity);
    if (ellipse?.type !== 'ellipse' || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    const nearest = closestPointOnCurve(ellipse, point);
    const normal = nearest && ellipseNormalAt(ellipse, nearest.t);
    if (!normal) return null;
    const dx = point.x - nearest.point.x;
    const dy = point.y - nearest.point.y;
    const signedDistance = dx * normal.x + dy * normal.y;
    // A point past an open arc's endpoint is not on a normal parallel curve.
    if ((requireNormal && Math.abs(dx * normal.y - dy * normal.x) > Math.max(1e-7, nearest.distance * 1e-7))
        || Math.abs(signedDistance) <= 1e-9) return null;
    return { distance: Math.abs(signedDistance), side: signedDistance < 0 ? -1 : 1 };
}

/** Bounded cubic approximation of the true normal offset, not enlarged radii. */
export function offsetEllipseEntity(entity, distance, { tolerance = ELLIPSE_OFFSET_TOLERANCE, maximumParts = 256 } = {}) {
    const ellipse = normalizeCurvePrimitive(entity);
    if (ellipse?.type !== 'ellipse' || !Number.isFinite(distance) || Math.abs(distance) <= 1e-9
        || !Number.isFinite(tolerance) || tolerance <= 0
        || !Number.isInteger(maximumParts) || maximumParts < 1 || maximumParts > 4096
        || distance <= -minimumEllipseCurvatureRadius(ellipse) + 1e-9) return null;
    const parts = [];
    let failed = false;
    const fit = (start, end, depth) => {
        if (failed) return;
        const first = ellipseOffsetPoint(ellipse, start, distance);
        const last = ellipseOffsetPoint(ellipse, end, distance);
        const firstDerivative = offsetDerivative(ellipse, start, distance);
        const lastDerivative = offsetDerivative(ellipse, end, distance);
        const span = (end - start) / 3;
        if (!first || !last) { failed = true; return; }
        const curve = normalizeCurvePrimitive({ type: 'spline', degree: 3, controlPoints: [
            first,
            { x: first.x + span * firstDerivative.x, y: first.y + span * firstDerivative.y },
            { x: last.x - span * lastDerivative.x, y: last.y - span * lastDerivative.y },
            last,
        ] });
        if (!curve) { failed = true; return; }
        const error = Math.max(...[1, 2, 3, 4, 5, 6, 7].map(index => {
            const fraction = index / 8;
            const expected = ellipseOffsetPoint(ellipse, start + (end - start) * fraction, distance);
            const actual = curvePointAt(curve, fraction);
            return Math.hypot(expected.x - actual.x, expected.y - actual.y);
        }));
        if (error <= tolerance / 2 && Math.abs(ellipseSweep(ellipse) * (end - start)) <= Math.PI / 4) {
            parts.push(curve);
            failed = parts.length > maximumParts;
        } else if (depth >= 20) failed = true;
        else {
            fit(start, (start + end) / 2, depth + 1);
            fit((start + end) / 2, end, depth + 1);
        }
    };
    fit(0, 1, 0);
    if (failed || !parts.length) return null;
    if (ellipse.fullEllipse) parts[parts.length - 1].controlPoints[3] = { ...parts[0].controlPoints[0] };
    const { cx, cy, rx, ry, rotation, startAngle, endAngle, counterClockwise, fullEllipse,
        radiusX, radiusY, majorRadius, minorRadius, ...properties } = entity;
    return { ...properties, type: 'polyline', closed: ellipse.fullEllipse, parts };
}

function ellipseSweep(ellipse) {
    if (ellipse.fullEllipse) return ellipse.counterClockwise === false ? -TAU : TAU;
    const positive = value => (value % TAU + TAU) % TAU;
    return ellipse.counterClockwise === false
        ? -positive(ellipse.startAngle - ellipse.endAngle)
        : positive(ellipse.endAngle - ellipse.startAngle);
}

function curvatureRadius(ellipse, angle) {
    return Math.hypot(ellipse.rx * Math.sin(angle), ellipse.ry * Math.cos(angle)) ** 3 / (ellipse.rx * ellipse.ry);
}

function minimumEllipseCurvatureRadius(ellipse) {
    const sweep = ellipseSweep(ellipse);
    const angles = [ellipse.startAngle, ellipse.startAngle + sweep];
    for (let index = -8; index <= 8; index += 1) {
        const angle = index * Math.PI / 2;
        const parameter = (angle - ellipse.startAngle) / sweep;
        if (parameter >= 0 && parameter <= 1) angles.push(angle);
    }
    return Math.min(...angles.map(angle => curvatureRadius(ellipse, angle)));
}

function offsetDerivative(ellipse, parameter, distance) {
    const sweep = ellipseSweep(ellipse);
    const angle = ellipse.startAngle + parameter * sweep;
    const factor = sweep * (1 + distance / curvatureRadius(ellipse, angle));
    const x = -ellipse.rx * Math.sin(angle) * factor;
    const y = ellipse.ry * Math.cos(angle) * factor;
    const rotation = ellipse.rotation * Math.PI / 180;
    return { x: x * Math.cos(rotation) - y * Math.sin(rotation), y: x * Math.sin(rotation) + y * Math.cos(rotation) };
}

export function ellipseNormalAt(ellipse, parameter) {
    const tangent = curveTangentAt(ellipse, parameter);
    if (!tangent) return null;
    const length = Math.hypot(tangent.x, tangent.y);
    const direction = ellipse.counterClockwise === false ? -1 : 1;
    return length > 0 ? { x: direction * tangent.y / length, y: -direction * tangent.x / length } : null;
}

export function ellipseOffsetPoint(ellipse, parameter, distance) {
    const point = curvePointAt(ellipse, parameter);
    const normal = ellipseNormalAt(ellipse, parameter);
    return point && normal ? { x: point.x + normal.x * distance, y: point.y + normal.y * distance } : null;
}

/** Adaptive display tessellation of a regular parallel curve, in model metres. */
export function sampleEllipseOffset(entity, distance, { tolerance = 1e-5, maximumPoints = 4096 } = {}) {
    const ellipse = normalizeCurvePrimitive(entity);
    if (ellipse?.type !== 'ellipse' || !Number.isFinite(distance)
        || !Number.isFinite(tolerance) || tolerance <= 0
        || !Number.isInteger(maximumPoints) || maximumPoints < 2 || maximumPoints > 16384) return null;
    const minimumCurvatureRadius = Math.min(ellipse.rx, ellipse.ry) ** 2 / Math.max(ellipse.rx, ellipse.ry);
    if (distance <= -minimumCurvatureRadius + 1e-9) return null;
    const points = [ellipseOffsetPoint(ellipse, 0, distance)];
    let failed = false;
    const subdivide = (start, end, first, last, depth) => {
        if (failed) return;
        const probes = [0.25, 0.5, 0.75].map(fraction => ({
            fraction, point: ellipseOffsetPoint(ellipse, start + (end - start) * fraction, distance),
        }));
        if (probes.some(probe => !probe.point)) { failed = true; return; }
        const error = Math.max(...probes.map(({ fraction, point }) => Math.hypot(
            point.x - (first.x + (last.x - first.x) * fraction),
            point.y - (first.y + (last.y - first.y) * fraction),
        )));
        if (error <= tolerance) {
            points.push(last);
            failed = points.length > maximumPoints;
        } else if (depth >= 20) failed = true;
        else {
            const middle = (start + end) / 2;
            subdivide(start, middle, first, probes[1].point, depth + 1);
            subdivide(middle, end, probes[1].point, last, depth + 1);
        }
    };
    const end = ellipseOffsetPoint(ellipse, 1, distance);
    if (!points[0] || !end) return null;
    subdivide(0, 1, points[0], end, 0);
    return failed || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)) ? null : points;
}
