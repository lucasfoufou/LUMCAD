const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Triangulate a validated simple polygon. Vertices are retained in their original space. */
export function triangulateDrawingPolygon(points, { maxChecks = 1000000 } = {}) {
    if (!Array.isArray(points) || points.length < 3 || !Number.isSafeInteger(maxChecks) || maxChecks < 1
        || !points.every(p => p && [p.x, p.y].every(Number.isFinite))) throw new Error('wmfGeometry');
    const vertices = points.map(p => ({ ...p })); let checks = 0;
    const area = vertices.reduce((sum, a, i) => {
        const b = vertices[(i + 1) % vertices.length]; return sum + a.x * b.y - a.y * b.x;
    }, 0);
    if (!area) throw new Error('wmfGeometry');
    if (area < 0) vertices.reverse();
    const triangles = [];
    while (vertices.length > 3) {
        let found = false;
        for (let i = 0; i < vertices.length; i++) {
            const a = vertices[(i + vertices.length - 1) % vertices.length];
            const b = vertices[i]; const c = vertices[(i + 1) % vertices.length];
            if (++checks > maxChecks) throw new Error('wmfLimit');
            if (cross(a, b, c) <= 0) continue;
            let occupied = false;
            for (const point of vertices) {
                if (++checks > maxChecks) throw new Error('wmfLimit');
                if (point === a || point === b || point === c) continue;
                if (cross(a, b, point) >= 0 && cross(b, c, point) >= 0 && cross(c, a, point) >= 0) { occupied = true; break; }
            }
            if (!occupied) {
                triangles.push([a, b, c]); vertices.splice(i, 1); found = true; break;
            }
        }
        if (!found) throw new Error('wmfGeometry');
    }
    triangles.push(vertices); return triangles;
}

/** Intersect a convex polygon with an axis-aligned rectangle. */
export function clipDrawingPolygonToBounds(points, { minX, minY, maxX, maxY }) {
    let result = points;
    for (const [axis, boundary, sign] of [['x', minX, 1], ['x', maxX, -1], ['y', minY, 1], ['y', maxY, -1]]) {
        const input = result; result = [];
        for (let i = 0; i < input.length; i++) {
            const a = input[i]; const b = input[(i + 1) % input.length];
            const da = (a[axis] - boundary) * sign; const db = (b[axis] - boundary) * sign;
            if (da >= 0) result.push(a);
            if ((da >= 0) !== (db >= 0)) {
                const t = da / (da - db);
                result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
            }
        }
    }
    return result;
}
