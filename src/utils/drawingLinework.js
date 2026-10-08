import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices, transformAffinePoint } from './drawingAffine.js';
import { normalizeDrawingHatch, transformEllipseAffine } from './drawingAdvancedEntities.js';

export const MAX_LINEWORK_VERTICES = 512;
export const DEFAULT_MULTILINE_STYLE = Object.freeze({ name: 'Standard', elements: [{ offset: -0.1 }, { offset: 0.1 }], startCap: 'line', endCap: 'line', fill: false });
const finitePoint = point => point && [point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e12);
const finiteWidth = value => Number.isFinite(value) && value >= 0 && value <= 1e6;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const plus = (p, n, d) => ({ x: p.x + n.x * d, y: p.y + n.y * d });
const line = (a, b) => ({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y });

export function normalizeMultilineStyle(value = DEFAULT_MULTILINE_STYLE) {
    if (!value || !Array.isArray(value.elements) || value.elements.length < 2 || value.elements.length > 16) return null;
    const elements = value.elements.map(element => ({ offset: element?.offset,
        ...(/^#[0-9a-f]{6}$/i.test(element?.color || '') ? { color: element.color.toLowerCase() } : {}),
        ...(['continuous', 'dashed', 'dotted'].includes(element?.lineType) ? { lineType: element.lineType } : {}) }));
    if (elements.some(element => !Number.isFinite(element.offset) || Math.abs(element.offset) > 1e6)
        || new Set(elements.map(element => element.offset)).size !== elements.length) return null;
    elements.sort((a, b) => a.offset - b.offset);
    return { name: String(value.name || 'Standard').trim().slice(0, 128) || 'Standard', elements,
        startCap: ['none', 'line', 'arc'].includes(value.startCap) ? value.startCap : 'line',
        endCap: ['none', 'line', 'arc'].includes(value.endCap) ? value.endCap : 'line', fill: value.fill === true };
}

function validMatrix(value) {
    return value && ['a', 'b', 'c', 'd', 'e', 'f'].every(key => Number.isFinite(value[key]) && Math.abs(value[key]) <= 1e12)
        && Math.abs(value.a * value.d - value.b * value.c) > 1e-12;
}

export function normalizeDrawingLinework(value) {
    if (!value || !['donut', 'multiline', 'wide'].includes(value.kind)) return null;
    const transform = value.transform || IDENTITY_AFFINE_MATRIX;
    if (!validMatrix(transform)) return null;
    if (value.kind === 'donut') {
        if (!finiteWidth(value.innerDiameter) || !finiteWidth(value.outerDiameter)
            || value.outerDiameter <= 1e-8 || value.innerDiameter >= value.outerDiameter) return null;
        return { kind: 'donut', innerDiameter: value.innerDiameter, outerDiameter: value.outerDiameter, transform: { ...transform } };
    }
    if (!Array.isArray(value.points) || value.points.length < (value.closed ? 3 : 2)
        || value.points.length > MAX_LINEWORK_VERTICES || value.points.some(point => !finitePoint(point))) return null;
    const points = value.points.map(({ x, y }) => ({ x, y }));
    const closed = value.closed === true;
    const segmentCount = points.length - (closed ? 0 : 1);
    for (let index = 0; index < segmentCount; index += 1) {
        if (distance(points[index], points[(index + 1) % points.length]) <= 1e-8) return null;
    }
    const common = { kind: value.kind, points, closed, transform: { ...transform } };
    if (value.kind === 'multiline') {
        const style = normalizeMultilineStyle(value.style);
        const scale = value.scale ?? 1;
        if (!style || !Number.isFinite(scale) || scale <= 1e-8 || scale > 1e6) return null;
        return { ...common, style, scale, justification: ['top', 'bottom'].includes(value.justification) ? value.justification : 'zero' };
    }
    if (!Array.isArray(value.widths) || value.widths.length !== segmentCount
        || value.widths.some(width => !finiteWidth(width?.start) || !finiteWidth(width?.end))) return null;
    const bulges = value.bulges || Array(segmentCount).fill(0);
    if (!Array.isArray(bulges) || bulges.length !== segmentCount || bulges.some(value => !Number.isFinite(value) || Math.abs(value) > 1000)) return null;
    return { ...common, widths: value.widths.map(({ start, end }) => ({ start, end })), bulges: [...bulges] };
}

/** Materialized native geometry stays available to existing render, selection and archive paths. */
export function rebuildDrawingLinework(entity) {
    const definition = normalizeDrawingLinework(entity?.linework);
    if (!definition) return null;
    const geometry = definition.kind === 'donut' ? donutGeometry(definition)
        : definition.kind === 'multiline' ? multilineGeometry(definition) : wideGeometry(definition);
    if (!geometry) return null;
    const { parts, points, boundaries, pattern, sourceIds, sourceId, boundaryPick, array, splineDefinition, closed, fillRule, boundaryStroke, ...rest } = entity;
    return { ...rest, ...geometry, linework: definition };
}

export function transformDrawingLinework(entity, matrix) {
    if (!validMatrix(matrix) || !normalizeDrawingLinework(entity?.linework)) return null;
    return rebuildDrawingLinework({ ...entity, linework: { ...entity.linework, transform: multiplyAffineMatrices(matrix, entity.linework.transform || IDENTITY_AFFINE_MATRIX) } });
}

export function drawingLineworkGrips(entity) {
    const definition = normalizeDrawingLinework(entity?.linework);
    if (!definition) return [];
    const points = definition.kind === 'donut'
        ? [{ id: 'linework-center', x: 0, y: 0 }, { id: 'linework-outer', x: definition.outerDiameter / 2, y: 0 },
            ...(definition.innerDiameter > 0 ? [{ id: 'linework-inner', x: definition.innerDiameter / 2, y: 0 }] : [])]
        : definition.points.map((point, index) => ({ ...point, id: `linework-vertex-${index}` }));
    return points.map(point => ({ id: point.id, ...transformAffinePoint(point, definition.transform) }));
}

export function editDrawingLineworkGrip(entity, id, world) {
    const definition = normalizeDrawingLinework(entity?.linework);
    if (!definition || !finitePoint(world)) return entity;
    const matrix = definition.transform;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    const x = world.x - matrix.e; const y = world.y - matrix.f;
    const local = { x: (matrix.d * x - matrix.c * y) / determinant, y: (matrix.a * y - matrix.b * x) / determinant };
    let updated;
    if (id === 'linework-center' && definition.kind === 'donut') updated = { ...definition, transform: { ...matrix, e: world.x, f: world.y } };
    else if (['linework-inner', 'linework-outer'].includes(id) && definition.kind === 'donut') {
        updated = { ...definition, [id === 'linework-inner' ? 'innerDiameter' : 'outerDiameter']: 2 * Math.hypot(local.x, local.y) };
    } else if (id.startsWith('linework-vertex-') && definition.points) {
        const index = Number(id.slice('linework-vertex-'.length));
        if (!Number.isInteger(index) || index < 0 || index >= definition.points.length) return entity;
        updated = { ...definition, points: definition.points.map((point, i) => i === index ? local : point) };
    }
    return updated && rebuildDrawingLinework({ ...entity, linework: updated }) || entity;
}

function donutGeometry(definition) {
    const boundaries = [definition.outerDiameter, definition.innerDiameter].filter(value => value > 0).map(diameter => {
        const ellipse = transformEllipseAffine({ type: 'ellipse', cx: 0, cy: 0, rx: diameter / 2, ry: diameter / 2, fullEllipse: true }, definition.transform);
        if (!ellipse || !finitePoint({ x: ellipse.cx, y: ellipse.cy }) || Math.max(ellipse.rx, ellipse.ry) > 1e12) return null;
        return { type: 'polyline', closed: true, parts: [ellipse] };
    });
    if (boundaries.some(boundary => !boundary)) return null;
    const hatch = normalizeDrawingHatch({ type: 'hatch', boundaries, pattern: { name: 'solid' }, boundaryStroke: false });
    return hatch.boundaries.length === boundaries.length ? hatch : null;
}

function segmentSides(points, widths, closed, sign) {
    return widths.map((width, index) => {
        const start = points[index]; const end = points[(index + 1) % points.length];
        const length = distance(start, end);
        const normal = { x: (start.y - end.y) / length, y: (end.x - start.x) / length };
        return { start: plus(start, normal, sign * width.start), end: plus(end, normal, sign * width.end), width };
    });
}

/** Intersect tapered edge rays, with a bounded miter and a bevel at sharp turns. */
function joinSides(sides, points, closed) {
    const result = [];
    for (let index = 0; index < points.length; index += 1) {
        const prior = index === 0 ? closed ? sides.at(-1) : null : sides[index - 1];
        const next = sides[index] || (closed ? sides[0] : null);
        if (!prior) { result.push(next.start); continue; }
        if (!next) { result.push(prior.end); continue; }
        if (distance(prior.end, next.start) < 1e-9) { result.push(prior.end); continue; }
        const a = { x: prior.end.x - prior.start.x, y: prior.end.y - prior.start.y };
        const b = { x: next.end.x - next.start.x, y: next.end.y - next.start.y };
        const cross = a.x * b.y - a.y * b.x;
        if (Math.abs(cross) > 1e-12 * Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)) {
            const delta = { x: next.start.x - prior.end.x, y: next.start.y - prior.end.y };
            const t = (delta.x * b.y - delta.y * b.x) / cross;
            const miter = { x: prior.end.x + a.x * t, y: prior.end.y + a.y * t };
            const limit = 10 * Math.max(Math.abs(prior.width.end), Math.abs(next.width.start), 1e-8);
            if (finitePoint(miter) && distance(miter, points[index]) <= limit) { result.push(miter); continue; }
        }
        result.push(prior.end, next.start);
    }
    return result;
}

function nativeLoop(points, matrix) {
    const world = points.map(point => transformAffinePoint(point, matrix));
    if (world.some(point => !finitePoint(point))) return null;
    const cleaned = world.filter((point, index) => !index || distance(point, world[index - 1]) > 1e-9);
    if (cleaned.length > 1 && distance(cleaned[0], cleaned.at(-1)) <= 1e-9) cleaned.pop();
    return cleaned.length >= 3 ? { type: 'polyline', closed: true, points: cleaned } : null;
}

function filledStrip(left, right, definition) {
    const loops = definition.closed ? [left, right] : [[...left, ...right.toReversed()]];
    const boundaries = loops.map(points => nativeLoop(points, definition.transform));
    if (boundaries.some(boundary => !boundary)) return null;
    const hatch = normalizeDrawingHatch({ type: 'hatch', boundaries, pattern: { name: 'solid' }, boundaryStroke: false });
    return hatch.boundaries.length === boundaries.length ? hatch : null;
}

function wideGeometry(definition) {
    if (definition.bulges.some(Boolean)) return curvedWideGeometry(definition);
    const halfWidths = definition.widths.map(width => ({ start: width.start / 2, end: width.end / 2 }));
    const parts = [];
    if (halfWidths.some(width => width.start > 0 || width.end > 0)) {
        const left = joinSides(segmentSides(definition.points, halfWidths, definition.closed, 1), definition.points, definition.closed);
        const right = joinSides(segmentSides(definition.points, halfWidths, definition.closed, -1), definition.points, definition.closed);
        const hatch = filledStrip(left, right, definition);
        if (!hatch) return null;
        parts.push(hatch);
    }
    definition.widths.forEach((width, index) => {
        if (width.start === 0 && width.end === 0) parts.push(line(transformAffinePoint(definition.points[index], definition.transform),
            transformAffinePoint(definition.points[(index + 1) % definition.points.length], definition.transform)));
    });
    return { type: 'polyline', parts, closed: definition.closed };
}

function multilineGeometry(definition) {
    const { points, closed, style, transform, scale, justification } = definition;
    const shift = justification === 'top' ? style.elements.at(-1).offset : justification === 'bottom' ? style.elements[0].offset : 0;
    const chains = style.elements.map(element => {
        const offset = (element.offset - shift) * scale;
        const widths = Array.from({ length: points.length - (closed ? 0 : 1) }, () => ({ start: offset, end: offset }));
        return joinSides(segmentSides(points, widths, closed, 1), points, closed);
    });
    if (chains.flat().some(point => !finitePoint(transformAffinePoint(point, transform)))) return null;
    const parts = [];
    if (style.fill) {
        const fill = filledStrip(chains.at(-1), chains[0], definition);
        if (!fill) return null;
        parts.push(fill);
    }
    chains.forEach((chain, index) => {
        const { color, lineType } = style.elements[index];
        parts.push({ type: 'polyline', points: chain.map(point => transformAffinePoint(point, transform)), closed,
            ...(color ? { color } : {}), ...(lineType ? { lineType } : {}) });
    });
    if (!closed) for (const [position, mode] of [['start', style.startCap], ['end', style.endCap]]) {
        if (mode === 'none') continue;
        const first = position === 'start' ? chains[0][0] : chains[0].at(-1);
        const second = position === 'start' ? chains.at(-1)[0] : chains.at(-1).at(-1);
        if (mode === 'line') parts.push(line(transformAffinePoint(first, transform), transformAffinePoint(second, transform)));
        else {
            const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
            const radius = distance(first, second) / 2;
            const startAngle = Math.atan2(first.y - center.y, first.x - center.x);
            const ellipse = transformEllipseAffine({ type: 'ellipse', cx: center.x, cy: center.y, rx: radius, ry: radius,
                startAngle, endAngle: startAngle + Math.PI, fullEllipse: false, counterClockwise: position === 'end' }, transform);
            if (!ellipse) return null;
            if (style.fill) {
                const boundary = { type: 'polyline', closed: true, parts: [ellipse,
                    line(transformAffinePoint(second, transform), transformAffinePoint(first, transform))] };
                const cap = normalizeDrawingHatch({ type: 'hatch', boundaries: [boundary], pattern: { name: 'solid' }, boundaryStroke: false });
                if (cap.boundaries.length !== 1) return null;
                parts.push(cap);
            }
            parts.push(ellipse);
        }
    }
    return { type: 'polyline', parts, closed: false };
}

export function normalizeDrawingMultilineStyles(styles) {
    const result = [{ ...DEFAULT_MULTILINE_STYLE, elements: DEFAULT_MULTILINE_STYLE.elements.map(element => ({ ...element })) }];
    if (!Array.isArray(styles)) return result;
    for (const candidate of styles.slice(0, 128)) {
        const style = normalizeMultilineStyle(candidate);
        if (!style) continue;
        const index = result.findIndex(entry => entry.name.toLowerCase() === style.name.toLowerCase());
        if (index >= 0) result[index] = style;
        else if (result.length < 128) result.push(style);
    }
    return result;
}

export function previewDrawingLinework(operation, point, layerId) {
    if (operation?.type !== 'linework') return null;
    let linework;
    if (operation.kind === 'donut' && operation.stage === 'center' && finitePoint(point)) {
        linework = { kind: 'donut', innerDiameter: operation.innerDiameter, outerDiameter: operation.outerDiameter,
            transform: { ...IDENTITY_AFFINE_MATRIX, e: point.x, f: point.y } };
    } else if (operation.stage === 'vertices') {
        const draft = appendDrawingLineworkVertex(operation, point) || operation;
        linework = finishDrawingLineworkDefinition(draft);
    }
    return linework ? rebuildDrawingLinework({ id: 'linework-preview', layerId, linework }) : null;
}

export function appendDrawingLineworkVertex(operation, point) {
    if (!finitePoint(point) || !Array.isArray(operation.points) || operation.points.length >= MAX_LINEWORK_VERTICES
        || operation.points.length && distance(operation.points.at(-1), point) <= 1e-8) return null;
    return { ...operation, points: [...operation.points, { x: point.x, y: point.y }],
        ...(operation.kind === 'wide' ? { widths: [...operation.widths, ...(operation.points.length ? [{ ...operation.nextWidth }] : [])],
            bulges: [...(operation.bulges || []), ...(operation.points.length ? [operation.nextBulge || 0] : [])] } : {}) };
}

export function finishDrawingLineworkDefinition(operation, closed = false) {
    return { ...operation, closed,
        ...(operation.kind === 'wide' && closed ? { widths: [...operation.widths, { ...operation.nextWidth }], bulges: [...(operation.bulges || Array(operation.widths.length).fill(0)), operation.nextBulge || 0] } : {}) };
}


/** Signed bulge is tan(sweep / 4); zero is a straight segment. */
export function drawingLineworkArc(start, end, bulge) {
    if (!finitePoint(start) || !finitePoint(end) || !Number.isFinite(bulge) || Math.abs(bulge) < 1e-10) return null;
    const chord = distance(start, end);
    if (chord <= 1e-8) return null;
    const center = { x: (start.x + end.x) / 2 - (end.y - start.y) * (1 - bulge * bulge) / (4 * bulge),
        y: (start.y + end.y) / 2 + (end.x - start.x) * (1 - bulge * bulge) / (4 * bulge) };
    return { center, radius: chord * (1 + bulge * bulge) / (4 * Math.abs(bulge)),
        startAngle: Math.atan2(start.y - center.y, start.x - center.x), sweep: 4 * Math.atan(bulge) };
}

function curvedWideGeometry(definition) {
    const left = []; const right = []; const hairlines = []; const contours = []; const ends = [];
    const record = (offset, start, end) => {
        const a = left.slice(offset); const b = right.slice(offset);
        contours.push([...a, ...b.toReversed()]);
        ends.push({ start, end, leftStart: a[0], leftEnd: a.at(-1), rightStart: b[0], rightEnd: b.at(-1) });
    };
    const matrix = definition.transform;
    const amplification = Math.hypot(matrix.a, matrix.b, matrix.c, matrix.d);
    for (let index = 0; index < definition.widths.length; index += 1) {
        const start = definition.points[index]; const end = definition.points[(index + 1) % definition.points.length];
        const width = definition.widths[index];
        const offset = left.length;
        const arc = drawingLineworkArc(start, end, definition.bulges[index]);
        if (!arc) {
            const normal = { x: (start.y - end.y) / distance(start, end), y: (end.x - start.x) / distance(start, end) };
            left.push(plus(start, normal, width.start / 2), plus(end, normal, width.end / 2));
            right.push(plus(start, normal, -width.start / 2), plus(end, normal, -width.end / 2));
            if (!width.start && !width.end) hairlines.push(line(transformAffinePoint(start, matrix), transformAffinePoint(end, matrix)));
            record(offset, start, end);
            continue;
        }
        // Reject a ribbon whose inner radius crosses the centre rather than silently folding it.
        if (Math.max(width.start, width.end) / 2 >= arc.radius) return null;
        const ellipse = { type: 'ellipse', cx: arc.center.x, cy: arc.center.y, rx: arc.radius, ry: arc.radius,
            startAngle: arc.startAngle, endAngle: arc.startAngle + arc.sweep, counterClockwise: arc.sweep > 0, fullEllipse: false };
        if (!width.start && !width.end) hairlines.push(transformEllipseAffine(ellipse, matrix));
        // Linear interpolation error <= max|p''|/(8*n²), including taper and affine scale.
        const derivativeBound = (arc.radius + Math.max(width.start, width.end) / 2) * arc.sweep ** 2
            + Math.abs(width.end - width.start) * Math.abs(arc.sweep);
        const count = Math.max(2, Math.ceil(Math.sqrt(derivativeBound * amplification / (8 * 0.0001))));
        if (count > 4096 || left.length + count > 16384) return null;
        for (let sample = 0; sample <= count; sample += 1) {
            const t = sample / count; const angle = arc.startAngle + arc.sweep * t;
            const halfWidth = (width.start + (width.end - width.start) * t) / 2;
            for (const [target, sign] of [[left, -Math.sign(arc.sweep)], [right, Math.sign(arc.sweep)]]) {
                const radius = arc.radius + sign * halfWidth;
                target.push({ x: arc.center.x + radius * Math.cos(angle), y: arc.center.y + radius * Math.sin(angle) });
            }
        }
        record(offset, start, end);
    }
    const parts = [...hairlines];
    if (definition.widths.some(width => width.start || width.end)) {
        for (let index = 0; index < ends.length - (definition.closed ? 0 : 1); index += 1) {
            const prior = ends[index]; const next = ends[(index + 1) % ends.length];
            contours.push([prior.end, prior.leftEnd, next.leftStart], [prior.end, prior.rightEnd, next.rightStart]);
        }
        const boundaries = contours.map(points => {
            const area = points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y; }, 0);
            if (Math.abs(area) <= 1e-12) return null;
            return nativeLoop(area < 0 ? points.toReversed() : points, matrix);
        }).filter(Boolean);
        const fill = normalizeDrawingHatch({ type: 'hatch', boundaries, pattern: { name: 'solid' }, fillRule: 'nonzero', boundaryStroke: false });
        if (!boundaries.length || fill.boundaries.length !== boundaries.length) return null;
        parts.unshift(fill);
    }
    return { type: 'polyline', closed: definition.closed, parts };
}
