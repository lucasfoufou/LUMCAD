import { extractEntityPaths } from './drawingCurveKernel.js';
import { normalizeDrawingHatch } from './drawingAdvancedEntities.js';

/** Exact opaque solid strokes for linear native paths. */
export function createDrawingLinearStrokeFill(entities, width, color, { maxSegments = 10000, endCap = 'round', join = 'round', miterLimit = 10 } = {}) {
    if (!Number.isFinite(width) || width <= 0 || !Number.isSafeInteger(maxSegments) || maxSegments <= 0
        || !['round', 'flat', 'square'].includes(endCap) || !['round', 'bevel', 'miter'].includes(join)
        || !Number.isFinite(miterLimit) || miterLimit < 1 || miterLimit > 1000) throw new Error('strokeGeometryInvalid');
    const paths = entities.flatMap(entity => extractEntityPaths(entity));
    if (!paths.length || paths.some(path => path.parts.some(part => part.type !== 'line'))) return null;
    const boundaries = []; const radius = width / 2;
    for (const path of paths) for (const [index, line] of path.parts.entries()) {
        const dx = line.x2 - line.x1; const dy = line.y2 - line.y1;
        const length = Math.hypot(dx, dy);
        if (length <= 1e-12) continue;
        if (boundaries.length >= maxSegments) throw new Error('strokeGeometryLimit');
        const nx = -dy / length * radius; const ny = dx / length * radius;
        const angle = Math.atan2(ny, nx);
        const internalCap = join === 'round' ? 'round' : 'flat';
        const firstCap = !path.closed && index === 0 ? endCap : internalCap;
        const lastCap = !path.closed && index === path.parts.length - 1 ? endCap : internalCap;
        const a = { x: line.x1 - (firstCap === 'square' ? dx / length * radius : 0),
            y: line.y1 - (firstCap === 'square' ? dy / length * radius : 0) };
        const b = { x: line.x2 + (lastCap === 'square' ? dx / length * radius : 0),
            y: line.y2 + (lastCap === 'square' ? dy / length * radius : 0) };
        boundaries.push({ type: 'path', closed: true, parts: [
            { type: 'line', x1: a.x + nx, y1: a.y + ny, x2: b.x + nx, y2: b.y + ny },
            lastCap === 'round'
                ? { type: 'arc', cx: b.x, cy: b.y, r: radius, startAngle: angle, endAngle: angle - Math.PI, counterClockwise: false }
                : { type: 'line', x1: b.x + nx, y1: b.y + ny, x2: b.x - nx, y2: b.y - ny },
            { type: 'line', x1: b.x - nx, y1: b.y - ny, x2: a.x - nx, y2: a.y - ny },
            firstCap === 'round'
                ? { type: 'arc', cx: a.x, cy: a.y, r: radius, startAngle: angle - Math.PI, endAngle: angle - 2 * Math.PI, counterClockwise: false }
                : { type: 'line', x1: a.x - nx, y1: a.y - ny, x2: a.x + nx, y2: a.y + ny },
        ] });
        if (join !== 'round' && (path.closed || index + 1 < path.parts.length)) {
            const next = path.parts[(index + 1) % path.parts.length];
            const boundary = linearStrokeJoin(line, next, radius, join, miterLimit);
            if (boundary) {
                if (boundaries.length >= maxSegments) throw new Error('strokeGeometryLimit');
                boundaries.push(boundary);
            }
        }
    }
    if (!boundaries.length) return null;
    // All capsules have the same winding, so overlaps remain filled rather than XORed.
    const hatch = normalizeDrawingHatch({ type: 'hatch', boundaries, pattern: { name: 'solid' }, color,
        fillRule: 'nonzero', boundaryStroke: false });
    if (hatch.boundaries.length !== boundaries.length) throw new Error('strokeGeometryLimit');
    return hatch;
}

function linearStrokeJoin(first, second, radius, join, miterLimit) {
    const ax = first.x2 - first.x1; const ay = first.y2 - first.y1;
    const bx = second.x2 - second.x1; const by = second.y2 - second.y1;
    const al = Math.hypot(ax, ay); const bl = Math.hypot(bx, by);
    if (al <= 1e-12 || bl <= 1e-12) return null;
    const cross = (ax * by - ay * bx) / (al * bl);
    if (Math.abs(cross) < 1e-12) return null;
    const side = cross > 0 ? -1 : 1;
    const n1 = { x: -ay / al * side, y: ax / al * side };
    const n2 = { x: -by / bl * side, y: bx / bl * side };
    const vertex = { x: first.x2, y: first.y2 };
    const points = [vertex, { x: vertex.x + n1.x * radius, y: vertex.y + n1.y * radius }];
    const denominator = 1 + (ax * bx + ay * by) / (al * bl);
    if (join === 'miter' && denominator > 1e-12) {
        const mx = (n1.x + n2.x) / denominator; const my = (n1.y + n2.y) / denominator;
        if (Math.hypot(mx, my) <= miterLimit) points.push({ x: vertex.x + mx * radius, y: vertex.y + my * radius });
    }
    points.push({ x: vertex.x + n2.x * radius, y: vertex.y + n2.y * radius });
    // Match the clockwise winding of the segment outlines on both turn directions.
    if (cross > 0) points.reverse();
    return { type: 'polyline', closed: true, points };
}

/** Exact solid outlines for standalone circular paths, including circular ellipse records. */
export function createDrawingCircularStrokeFill(entities, width, color, { endCap = 'round', maxSegments = 10000 } = {}) {
    if (!Number.isFinite(width) || width <= 0 || !Number.isSafeInteger(maxSegments) || maxSegments <= 0
        || !['round', 'flat', 'square'].includes(endCap)) throw new Error('strokeGeometryInvalid');
    const paths = entities.flatMap(entity => extractEntityPaths(entity));
    if (!paths.length || paths.some(path => path.parts.length !== 1)) return null;
    const curves = paths.map(path => path.parts[0]);
    if (curves.some(curve => !['circle', 'arc', 'ellipse'].includes(curve.type)
        || curve.type === 'ellipse' && Math.abs(curve.rx - curve.ry) > Number.EPSILON * 32 * Math.max(curve.rx, curve.ry))) return null;
    const half = width / 2; const boundaries = [];
    for (const curve of curves) {
        const radius = curve.type === 'ellipse' ? curve.rx : curve.r;
        const full = curve.type === 'circle' || curve.fullCircle || curve.fullEllipse;
        const circle = (r, counterClockwise) => ({ type: 'circle', cx: curve.cx, cy: curve.cy, r, counterClockwise });
        if (full) {
            boundaries.push(circle(radius + half, false));
            if (radius > half) boundaries.push(circle(radius - half, true));
        } else {
            // Round caps allow a swept disk construction even when the inward offset crosses the centre.
            if (radius <= half && endCap !== 'round') return null;
            const rotation = curve.type === 'ellipse' ? curve.rotation * Math.PI / 180 : 0;
            const start = (curve.counterClockwise ? curve.endAngle : curve.startAngle) + rotation;
            const end = (curve.counterClockwise ? curve.startAngle : curve.endAngle) + rotation;
            const point = (angle, r) => ({ x: curve.cx + Math.cos(angle) * r, y: curve.cy + Math.sin(angle) * r });
            const line = (a, b) => ({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
            const arc = (r, a, b, counterClockwise) => ({ type: 'arc', cx: curve.cx, cy: curve.cy, r,
                startAngle: a, endAngle: b, counterClockwise });
            const cap = (angle, atEnd) => {
                const outer = point(angle, radius + half); const inner = point(angle, radius - half);
                const a = atEnd ? outer : inner; const b = atEnd ? inner : outer;
                if (endCap === 'flat') return [line(a, b)];
                if (endCap === 'round') {
                    const center = point(angle, radius);
                    const first = angle + (atEnd ? 0 : Math.PI);
                    return [{ type: 'arc', cx: center.x, cy: center.y, r: half,
                        startAngle: first, endAngle: first - Math.PI, counterClockwise: false }];
                }
                const direction = atEnd ? 1 : -1;
                const shift = p => ({ x: p.x + Math.sin(angle) * half * direction,
                    y: p.y - Math.cos(angle) * half * direction });
                return [line(a, shift(a)), line(shift(a), shift(b)), line(shift(b), b)];
            };
            if (radius <= half) {
                const center = { x: curve.cx, y: curve.cy };
                boundaries.push({ type: 'path', closed: true, parts: [arc(radius + half, start, end, false),
                    line(point(end, radius + half), center), line(center, point(start, radius + half))] });
                for (const angle of [start, end]) {
                    const tip = point(angle, radius);
                    boundaries.push({ type: 'circle', cx: tip.x, cy: tip.y, r: half, counterClockwise: false });
                }
            } else boundaries.push({ type: 'path', closed: true, parts: [arc(radius + half, start, end, false),
                ...cap(end, true), arc(radius - half, end, start, true), ...cap(start, false)] });
        }
        if (boundaries.length > maxSegments) throw new Error('strokeGeometryLimit');
    }
    const hatch = normalizeDrawingHatch({ type: 'hatch', boundaries, pattern: { name: 'solid' }, color,
        fillRule: 'nonzero', boundaryStroke: false });
    if (hatch.boundaries.length !== boundaries.length) throw new Error('strokeGeometryLimit');
    return hatch;
}

/** Union of exact segment sweeps; round joins are the shared endpoint disks. */
export function createDrawingRoundStrokeFill(entities, width, color, { endCap = 'round', join = 'round', maxSegments = 10000 } = {}) {
    if (!Number.isFinite(width) || width <= 0 || !Number.isSafeInteger(maxSegments) || maxSegments <= 0
        || !['round', 'flat', 'square'].includes(endCap) || !['round', 'bevel', 'miter'].includes(join)) throw new Error('strokeGeometryInvalid');
    const paths = entities.flatMap(entity => extractEntityPaths(entity));
    if (!paths.length || join !== 'round' || endCap !== 'round' && paths.some(path => !path.closed)) return null;
    const boundaries = [];
    for (const path of paths) for (const part of path.parts) {
        const remaining = maxSegments - boundaries.length;
        if (remaining <= 0) throw new Error('strokeGeometryLimit');
        const outline = part.type === 'line'
            ? createDrawingLinearStrokeFill([part], width, color, { maxSegments: remaining })
            : createDrawingCircularStrokeFill([part], width, color, { maxSegments: remaining });
        if (!outline) return null;
        boundaries.push(...outline.boundaries);
    }
    const hatch = normalizeDrawingHatch({ type: 'hatch', boundaries, pattern: { name: 'solid' }, color,
        fillRule: 'nonzero', boundaryStroke: false });
    if (hatch.boundaries.length !== boundaries.length) throw new Error('strokeGeometryLimit');
    return hatch;
}
