const EPSILON = 1e-9;
const finitePoint = point => point && [point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e12);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const along = (origin, axis, distance) => ({ x: origin.x + axis.x * distance, y: origin.y + axis.y * distance });

/** A finite midline for parallel sources, or an angle bisector for intersecting lines. */
export function centerLineGeometry(entity, sources = []) {
    let first = entity.p1;
    let second = entity.p2;
    if (entity.sourceIds?.length) {
        if (sources.length !== 2) return null;
        const lines = sources.map(line => {
            if (line?.type !== 'line') return null;
            const start = { x: line.x1, y: line.y1 }; const end = { x: line.x2, y: line.y2 };
            if (!finitePoint(start) || !finitePoint(end)) return null;
            const length = Math.hypot(end.x - start.x, end.y - start.y);
            if (length < EPSILON) return null;
            let axis = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
            // Source endpoint reversal must not choose the other angle bisector.
            if (axis.x < -EPSILON || Math.abs(axis.x) <= EPSILON && axis.y < 0) axis = { x: -axis.x, y: -axis.y };
            return { start, end, axis };
        });
        if (lines.some(line => !line)) return null;
        const [a, b] = lines;
        let axis;
        let origin;
        const determinant = cross(a.axis, b.axis);
        if (Math.abs(determinant) < EPSILON) {
            axis = a.axis;
            const normal = { x: -axis.y, y: axis.x };
            origin = along(a.start, normal, dot(subtract(b.start, a.start), normal) / 2);
        } else {
            origin = along(a.start, a.axis, cross(subtract(b.start, a.start), b.axis) / determinant);
            const sign = dot(a.axis, b.axis) < 0 ? -1 : 1;
            const sum = { x: a.axis.x + sign * b.axis.x, y: a.axis.y + sign * b.axis.y };
            const length = Math.hypot(sum.x, sum.y);
            axis = { x: sum.x / length, y: sum.y / length };
            if (entity.alternateBisector) axis = { x: -axis.y, y: axis.x };
        }
        const stations = lines.flatMap(line => [line.start, line.end]).map(point => dot(subtract(point, origin), axis));
        first = along(origin, axis, Math.min(...stations));
        second = along(origin, axis, Math.max(...stations));
    }
    if (!finitePoint(first) || !finitePoint(second)) return null;
    const length = Math.hypot(second.x - first.x, second.y - first.y);
    if (length < EPSILON) return null;
    const axis = { x: (second.x - first.x) / length, y: (second.y - first.y) / length };
    const extension = Number.isFinite(entity.extension) ? Math.max(0, Math.min(1e6, entity.extension)) : 0.25;
    const start = along(first, axis, -extension); const end = along(second, axis, extension);
    if (!finitePoint(start) || !finitePoint(end)) return null;
    return { kind: 'centerLine', entityType: 'centerLine', value: null, unitKind: null,
        sourceFirst: { ...first }, sourceSecond: { ...second }, first: start, second: end,
        points: [start, end], lines: [{ start, end, role: 'center' }], arcs: [], ticks: [], jogs: [], label: null };
}
