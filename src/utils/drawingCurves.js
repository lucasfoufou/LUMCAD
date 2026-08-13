const EPSILON = 1e-9;
const TAU = Math.PI * 2;
const RELATIVE_NUMERIC_EPSILON = 1e-12;
const MAX_GEOMETRY_MAGNITUDE = 1e12;
const MAX_ARC_SEGMENTS = 4096;

export const DEFAULT_CIRCLE_SAFETY = Object.freeze({
    relativeCollinearityTolerance: 1e-10,
    maxRadiusFactor: 1e6,
    maxRadius: MAX_GEOMETRY_MAGNITUDE,
    maxCoordinate: MAX_GEOMETRY_MAGNITUDE,
});

export const DRAWING_GEOMETRY_EPSILON = EPSILON;
export const DRAWING_GEOMETRY_MAX_MAGNITUDE = MAX_GEOMETRY_MAGNITUDE;
export const DRAWING_CURVE_MAX_SEGMENTS = MAX_ARC_SEGMENTS;

export function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeRadians(angle) {
    const normalized = Number(angle) % TAU;
    return normalized < 0 ? normalized + TAU : normalized;
}

export function positiveAngleDelta(startAngle, endAngle) {
    return normalizeRadians(endAngle - startAngle);
}

export function signedAngleDelta(startAngle, endAngle, counterClockwise = true) {
    const positive = positiveAngleDelta(startAngle, endAngle);
    if (positive <= EPSILON) return 0;
    return counterClockwise ? positive : positive - TAU;
}

export function pointAngle(center, point) {
    return Math.atan2(point.y - center.y, point.x - center.x);
}

export function pointOnCircle(center, radius, angle) {
    return {
        x: center.x + Math.cos(angle) * Math.abs(radius),
        y: center.y + Math.sin(angle) * Math.abs(radius),
    };
}

export function getRectangleOutlinePoints(entity, arcSegments = 8) {
    if (!entity) return [];
    const minX = Math.min(Number(entity.x) || 0, (Number(entity.x) || 0) + (Number(entity.width) || 0));
    const minY = Math.min(Number(entity.y) || 0, (Number(entity.y) || 0) + (Number(entity.height) || 0));
    const maxX = Math.max(Number(entity.x) || 0, (Number(entity.x) || 0) + (Number(entity.width) || 0));
    const maxY = Math.max(Number(entity.y) || 0, (Number(entity.y) || 0) + (Number(entity.height) || 0));
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const rotation = Number(entity.rotation) || 0;
    const local = getLocalRectangleOutlinePoints(entity, minX, minY, maxX, maxY, arcSegments);
    return rotation ? local.map(point => rotatePointDegrees(point, center, rotation)) : local;
}

export function getRectangleOutlinePath(entity) {
    if (!entity) return '';
    const minX = Math.min(Number(entity.x) || 0, (Number(entity.x) || 0) + (Number(entity.width) || 0));
    const minY = Math.min(Number(entity.y) || 0, (Number(entity.y) || 0) + (Number(entity.height) || 0));
    const maxX = Math.max(Number(entity.x) || 0, (Number(entity.x) || 0) + (Number(entity.width) || 0));
    const maxY = Math.max(Number(entity.y) || 0, (Number(entity.y) || 0) + (Number(entity.height) || 0));
    const style = normalizeCornerStyle(entity.cornerStyle || (Number(entity.fillet) > 0 ? 'fillet' : Number(entity.chamfer) > 0 ? 'chamfer' : 'square'));
    const value = cornerValue(entity, maxX - minX, maxY - minY);
    let path;
    if (style === 'chamfer' && value > EPSILON) {
        const corners = [
            { x: minX, y: minY }, { x: maxX, y: minY },
            { x: maxX, y: maxY }, { x: minX, y: maxY },
        ];
        const points = corners.flatMap((corner, index) => {
            const previous = corners[(index + corners.length - 1) % corners.length];
            const next = corners[(index + 1) % corners.length];
            return [
                moveToward(corner, previous, value),
                moveToward(corner, next, value),
            ];
        });
        path = `${points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')} Z`;
    } else if (style === 'fillet' && value > EPSILON) {
        path = roundedRectanglePath(minX, minY, maxX, maxY, value);
    } else {
        path = `M ${minX} ${minY} L ${maxX} ${minY} L ${maxX} ${maxY} L ${minX} ${maxY} Z`;
    }
    return path;
}

export function getRegularPolygonVertexRadius(entity) {
    const sides = normalizePolygonSides(entity?.sides);
    const radius = Math.abs(Number(entity?.r) || 0);
    return entity?.mode === 'circumscribed' ? radius / Math.max(EPSILON, Math.cos(Math.PI / sides)) : radius;
}

export function getRegularPolygonApothem(entity) {
    const sides = normalizePolygonSides(entity?.sides);
    const vertexRadius = getRegularPolygonVertexRadius(entity);
    return vertexRadius * Math.cos(Math.PI / sides);
}

export function getRegularPolygonVertices(entity) {
    if (!entity) return [];
    const sides = normalizePolygonSides(entity.sides);
    const vertexRadius = getRegularPolygonVertexRadius(entity);
    const rotation = Number(entity.rotation) || 0;
    const rotationRadians = rotation * Math.PI / 180;
    return Array.from({ length: sides }, (_, index) => pointOnCircle(
        { x: Number(entity.cx) || 0, y: Number(entity.cy) || 0 },
        vertexRadius,
        rotationRadians - Math.PI / 2 + index * TAU / sides,
    ));
}

export function normalizePolygonSides(value, fallback = 6) {
    const sides = Math.round(Number(value));
    return Number.isFinite(sides) ? Math.max(3, Math.min(1_000, sides)) : fallback;
}

export function normalizePolygonMode(value) {
    return String(value || '').toLowerCase() === 'circumscribed' ? 'circumscribed' : 'inscribed';
}

export function arcSweep(entity) {
    const start = Number(entity?.startAngle) || 0;
    const end = Number(entity?.endAngle) || 0;
    const fullCircle = Boolean(entity?.fullCircle);
    if (fullCircle) return entity?.counterClockwise === false ? -TAU : TAU;
    const sweep = signedAngleDelta(start, end, entity?.counterClockwise !== false);
    return Math.abs(sweep) <= EPSILON ? 0 : sweep;
}

export function arcPoint(entity, angle) {
    return pointOnCircle({ x: Number(entity?.cx) || 0, y: Number(entity?.cy) || 0 }, entity?.r, angle);
}

export function arcStartPoint(entity) {
    return arcPoint(entity, Number(entity?.startAngle) || 0);
}

export function arcEndPoint(entity) {
    return arcPoint(entity, Number(entity?.endAngle) || 0);
}

export function arcMidpoint(entity) {
    const sweep = arcSweep(entity);
    return arcPoint(entity, (Number(entity?.startAngle) || 0) + sweep / 2);
}

export function arcContainsAngle(entity, angle, tolerance = EPSILON) {
    const sweep = arcSweep(entity);
    if (Math.abs(sweep) >= TAU - tolerance) return true;
    if (Math.abs(sweep) <= tolerance) {
        const delta = Math.min(
            positiveAngleDelta(angle, entity?.startAngle || 0),
            positiveAngleDelta(entity?.startAngle || 0, angle),
        );
        return delta <= tolerance;
    }
    const start = normalizeRadians(entity?.startAngle || 0);
    const candidate = normalizeRadians(angle);
    if (sweep > 0) return positiveAngleDelta(start, candidate) <= sweep + tolerance;
    return positiveAngleDelta(candidate, start) <= -sweep + tolerance;
}

export function getArcPoints(entity, minimumSegments = 12) {
    const sweep = arcSweep(entity);
    const centerX = Number(entity?.cx);
    const centerY = Number(entity?.cy);
    const radius = Math.abs(Number(entity?.r));
    if (!Number.isFinite(sweep) || Math.abs(sweep) <= EPSILON
        || !Number.isFinite(centerX) || !Number.isFinite(centerY)
        || !Number.isFinite(radius) || radius <= EPSILON
        || Math.max(Math.abs(centerX), Math.abs(centerY)) + radius > MAX_GEOMETRY_MAGNITUDE) return [];
    const arcLength = Math.abs(sweep) * radius;
    const lengthSegments = Number.isFinite(arcLength) ? Math.ceil(arcLength / 0.08) : MAX_ARC_SEGMENTS;
    const minimum = Number.isFinite(Number(minimumSegments)) ? Math.max(2, Number(minimumSegments)) : 2;
    const requestedSegments = Math.max(lengthSegments, minimum * Math.abs(sweep) / TAU, 2);
    const count = Math.min(MAX_ARC_SEGMENTS, Math.max(2, Math.ceil(requestedSegments)));
    return Array.from({ length: count + 1 }, (_, index) => arcPoint(
        entity,
        (Number(entity.startAngle) || 0) + sweep * index / count,
    ));
}

export function getArcBounds(entity) {
    const points = [arcStartPoint(entity), arcEndPoint(entity)];
    [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach(angle => {
        if (arcContainsAngle(entity, angle)) points.push(arcPoint(entity, angle));
    });
    return points.reduce((bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxX: Math.max(bounds.maxX, point.x),
        maxY: Math.max(bounds.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

export function getArcPath(entity) {
    const start = arcStartPoint(entity);
    const end = arcEndPoint(entity);
    const sweep = arcSweep(entity);
    if (!sweep) return `M ${start.x} ${start.y}`;
    const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0;
    const sweepFlag = sweep > 0 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${Math.abs(Number(entity.r) || 0)} ${Math.abs(Number(entity.r) || 0)} 0 ${largeArc} ${sweepFlag} ${end.x} ${end.y}`;
}

export function createArcFromThreePoints(start, through, end, safety = {}) {
    const circle = circleFromThreePoints(start, through, end, safety);
    if (!circle) return null;
    const center = { x: circle.cx, y: circle.cy };
    const startAngle = pointAngle(center, start);
    const throughAngle = pointAngle(center, through);
    const endAngle = pointAngle(center, end);
    const counterClockwise = positiveAngleDelta(startAngle, throughAngle) <= positiveAngleDelta(startAngle, endAngle) + EPSILON;
    return {
        cx: circle.cx,
        cy: circle.cy,
        r: circle.r,
        startAngle,
        endAngle,
        counterClockwise,
    };
}

export function createArcFromStartCenterEnd(start, center, end, counterClockwise = true, safety = {}) {
    const radius = distance(start, center);
    const endRadius = distance(end, center);
    if (radius <= EPSILON || endRadius <= EPSILON) return null;
    const arc = {
        cx: center.x,
        cy: center.y,
        r: radius,
        startAngle: pointAngle(center, start),
        endAngle: pointAngle(center, end),
        counterClockwise: Boolean(counterClockwise),
    };
    return isFiniteBoundedCircle(arc, safety) ? arc : null;
}

export function createArcFromStartEndRadius(start, end, radius, {
    counterClockwise = true,
    sidePoint = null,
    safety = {},
} = {}) {
    const requestedRadius = Math.abs(Number(radius));
    const chord = distance(start, end);
    if (!Number.isFinite(requestedRadius) || requestedRadius <= EPSILON || chord <= EPSILON || chord > requestedRadius * 2 + EPSILON) return null;
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const halfChordRatio = chord / (requestedRadius * 2);
    const height = requestedRadius * Math.sqrt(Math.max(0, 1 - halfChordRatio ** 2));
    const normal = { x: -(end.y - start.y) / chord, y: (end.x - start.x) / chord };
    const centers = [
        { x: midpoint.x + normal.x * height, y: midpoint.y + normal.y * height },
        { x: midpoint.x - normal.x * height, y: midpoint.y - normal.y * height },
    ];
    let center = centers[0];
    if (sidePoint) {
        center = centers.reduce((best, candidate) => (
            distance(candidate, sidePoint) < distance(best, sidePoint) ? candidate : best
        ));
    }
    const arc = {
        cx: center.x,
        cy: center.y,
        r: requestedRadius,
        startAngle: pointAngle(center, start),
        endAngle: pointAngle(center, end),
        counterClockwise: Boolean(counterClockwise),
    };
    return isFiniteBoundedCircle(arc, safety) ? arc : null;
}

export function circleFromThreePoints(first, second, third, safety = {}) {
    const circleSafety = normalizeCircleSafety(safety);
    const points = [first, second, third].map(point => finitePoint(point, circleSafety.maxCoordinate));
    if (points.some(point => !point)) return null;

    // Translate the calculation to the first point. This avoids the large
    // squared-coordinate cancellation that made a moving, almost-collinear
    // third point produce an astronomical circumcentre.
    const [origin, secondPoint, thirdPoint] = points;
    const ux = secondPoint.x - origin.x;
    const uy = secondPoint.y - origin.y;
    const vx = thirdPoint.x - origin.x;
    const vy = thirdPoint.y - origin.y;
    const secondToThird = { x: thirdPoint.x - secondPoint.x, y: thirdPoint.y - secondPoint.y };
    const span = Math.max(
        Math.hypot(ux, uy),
        Math.hypot(vx, vy),
        Math.hypot(secondToThird.x, secondToThird.y),
    );
    if (!Number.isFinite(span) || span <= EPSILON) return null;

    const cross = ux * vy - uy * vx;
    const spanSquared = span * span;
    if (!Number.isFinite(cross) || !Number.isFinite(spanSquared)
        || Math.abs(cross) <= circleSafety.relativeCollinearityTolerance * spanSquared) return null;

    const determinant = 2 * cross;
    const secondSquared = ux * ux + uy * uy;
    const thirdSquared = vx * vx + vy * vy;
    const relativeCenterX = (secondSquared * vy - thirdSquared * uy) / determinant;
    const relativeCenterY = (ux * thirdSquared - vx * secondSquared) / determinant;
    const cx = origin.x + relativeCenterX;
    const cy = origin.y + relativeCenterY;
    const radius = Math.hypot(relativeCenterX, relativeCenterY);
    const circle = { cx, cy, r: radius };
    const relativeRadiusLimit = circleSafety.maxRadiusFactor * span;
    if (!Number.isFinite(relativeRadiusLimit) || radius > relativeRadiusLimit) return null;
    return isFiniteBoundedCircle(circle, circleSafety) ? circle : null;
}

export function findTangentCircleCandidates(entities, radius, safety = {}) {
    const circleSafety = normalizeCircleSafety(safety);
    const sources = Array.isArray(entities) ? entities.filter(Boolean).slice(0, 3) : [];
    const requestedRadius = Math.abs(Number(radius));
    if (sources.length < 2 || !Number.isFinite(requestedRadius) || requestedRadius <= EPSILON
        || requestedRadius > circleSafety.maxRadius || !sources.every(entity => isValidTangentSource(entity, circleSafety))) return [];
    if (sources.length === 3 && sources.every(entity => entity.type === 'line')) {
        return findThreeLineTangentCandidates(sources, circleSafety);
    }
    const candidates = tangentPairCandidates(sources[0], sources[1], requestedRadius, circleSafety);
    if (sources.length < 3) return dedupeCircles(candidates, circleSafety);
    return dedupeCircles(candidates.filter(candidate => isTangentToEntity(candidate, sources[2], requestedRadius)), circleSafety);
}

export function findThreeLineTangentCircles(lines, safety = {}) {
    const circleSafety = normalizeCircleSafety(safety);
    const sources = Array.isArray(lines) ? lines.filter(entity => entity?.type === 'line').slice(0, 3) : [];
    return sources.length === 3 && sources.every(entity => isValidTangentSource(entity, circleSafety))
        ? findThreeLineTangentCandidates(sources, circleSafety).map(candidate => ({ ...candidate, type: 'circle' }))
        : [];
}

export function findThreeEntityTangentCircles(entities, safety = {}) {
    const circleSafety = normalizeCircleSafety(safety);
    const sources = Array.isArray(entities)
        ? entities.filter(entity => ['line', 'circle'].includes(entity?.type)).slice(0, 3)
        : [];
    if (sources.length !== 3 || !sources.every(entity => isValidTangentSource(entity, circleSafety))) return [];
    if (sources.every(entity => entity.type === 'line')) return findThreeLineTangentCircles(sources, circleSafety);

    const candidates = [];
    for (let mask = 0; mask < 8; mask += 1) {
        const signs = sources.map((_, index) => mask & (1 << index) ? 1 : -1);
        const rows = [];
        sources.forEach((entity, index) => {
            if (entity.type !== 'line') return;
            const coefficients = lineCoefficients(entity);
            if (coefficients) rows.push({
                coefficients: [coefficients.a, coefficients.b, -signs[index]],
                value: -coefficients.c,
            });
        });

        const circles = sources
            .map((entity, index) => ({ entity, sign: signs[index] }))
            .filter(source => source.entity.type === 'circle');
        const reference = circles[0];
        circles.slice(1).forEach(source => {
            const first = reference.entity;
            const second = source.entity;
            const firstRadius = Math.abs(Number(first.r));
            const secondRadius = Math.abs(Number(second.r));
            rows.push({
                coefficients: [
                    2 * (first.cx - second.cx),
                    2 * (first.cy - second.cy),
                    2 * (firstRadius * reference.sign - secondRadius * source.sign),
                ],
                value: first.cx ** 2 + first.cy ** 2
                    - second.cx ** 2 - second.cy ** 2
                    + secondRadius ** 2 - firstRadius ** 2,
            });
        });

        const parameterization = parameterizeLinearRows(rows);
        if (!parameterization || !reference) continue;
        const roots = solveCircleParameter(parameterization, reference.entity, reference.sign);
        roots.forEach(parameter => {
            const values = parameterization.origin.map((value, index) => (
                value + parameterization.direction[index] * parameter
            ));
            const candidate = { cx: values[0], cy: values[1], r: values[2] };
            if (isFiniteBoundedCircle(candidate, circleSafety)
                && sources.every(entity => isTangentToEntity(candidate, entity, candidate.r))) {
                candidates.push(candidate);
            }
        });
    }
    return dedupeCircles(candidates, circleSafety).map(candidate => ({ ...candidate, type: 'circle' }));
}

export function createTangentCircle(entities, radius, referencePoint = null, safety = {}) {
    const candidates = findTangentCircleCandidates(entities, radius, safety);
    if (!candidates.length) return null;
    const sorted = referencePoint
        ? [...candidates].sort((left, right) => distance(left, referencePoint) - distance(right, referencePoint))
        : [...candidates].sort((left, right) => left.cy - right.cy || left.cx - right.cx);
    return { ...sorted[0], type: 'circle' };
}

export function tangentRadiusAtPoint(entities, point) {
    if (!Array.isArray(entities) || !point) return null;
    const distances = entities.map(entity => {
        if (entity.type === 'line') return distanceToLine(entity, point);
        if (entity.type === 'circle') return Math.abs(distance({ cx: entity.cx, cy: entity.cy }, point) - Math.abs(entity.r));
        return Infinity;
    });
    const radius = Math.min(...distances);
    return Number.isFinite(radius) && radius > EPSILON ? radius : null;
}

function getLocalRectangleOutlinePoints(entity, minX, minY, maxX, maxY, arcSegments) {
    const style = normalizeCornerStyle(entity.cornerStyle || (Number(entity.fillet) > 0 ? 'fillet' : Number(entity.chamfer) > 0 ? 'chamfer' : 'square'));
    const value = cornerValue(entity, maxX - minX, maxY - minY);
    if (style === 'chamfer' && value > EPSILON) {
        const corners = [
            { x: minX, y: minY }, { x: maxX, y: minY },
            { x: maxX, y: maxY }, { x: minX, y: maxY },
        ];
        return corners.flatMap((corner, index) => {
            const previous = corners[(index + corners.length - 1) % corners.length];
            const next = corners[(index + 1) % corners.length];
            return [moveToward(corner, previous, value), moveToward(corner, next, value)];
        });
    }
    if (style !== 'fillet' || value <= EPSILON) return [
        { x: minX, y: minY }, { x: maxX, y: minY },
        { x: maxX, y: maxY }, { x: minX, y: maxY },
    ];
    const radius = value;
    const segments = Math.max(2, Math.ceil(Number(arcSegments) || 8));
    const points = [{ x: minX + radius, y: minY }, { x: maxX - radius, y: minY }];
    appendArcPoints(points, { x: maxX - radius, y: minY + radius }, radius, -Math.PI / 2, 0, segments);
    points.push({ x: maxX, y: maxY - radius });
    appendArcPoints(points, { x: maxX - radius, y: maxY - radius }, radius, 0, Math.PI / 2, segments);
    points.push({ x: minX + radius, y: maxY });
    appendArcPoints(points, { x: minX + radius, y: maxY - radius }, radius, Math.PI / 2, Math.PI, segments);
    points.push({ x: minX, y: minY + radius });
    appendArcPoints(points, { x: minX + radius, y: minY + radius }, radius, Math.PI, Math.PI * 1.5, segments);
    return points;
}

function roundedRectanglePath(minX, minY, maxX, maxY, radius) {
    return [
        `M ${minX + radius} ${minY}`,
        `L ${maxX - radius} ${minY}`,
        `A ${radius} ${radius} 0 0 1 ${maxX} ${minY + radius}`,
        `L ${maxX} ${maxY - radius}`,
        `A ${radius} ${radius} 0 0 1 ${maxX - radius} ${maxY}`,
        `L ${minX + radius} ${maxY}`,
        `A ${radius} ${radius} 0 0 1 ${minX} ${maxY - radius}`,
        `L ${minX} ${minY + radius}`,
        `A ${radius} ${radius} 0 0 1 ${minX + radius} ${minY}`,
        'Z',
    ].join(' ');
}

function appendArcPoints(points, center, radius, start, end, segments) {
    for (let index = 1; index <= segments; index += 1) {
        const angle = start + (end - start) * index / segments;
        points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
    }
}

function normalizeCornerStyle(value) {
    const style = String(value || '').toLowerCase();
    return style === 'chamfer' || style === 'fillet' ? style : 'square';
}

function cornerValue(entity, width, height) {
    const value = Math.abs(Number(entity.cornerValue ?? entity.chamfer ?? entity.fillet) || 0);
    return clamp(value, 0, Math.min(width, height) / 2);
}

function moveToward(first, second, distanceValue) {
    const length = distance(first, second);
    if (length <= EPSILON) return { ...first };
    const ratio = Math.min(1, distanceValue / length);
    return { x: first.x + (second.x - first.x) * ratio, y: first.y + (second.y - first.y) * ratio };
}

function rotatePointDegrees(point, origin, angle) {
    const radians = angle * Math.PI / 180;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return { x: origin.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: origin.y + dx * Math.sin(radians) + dy * Math.cos(radians) };
}

function distance(first, second) {
    const firstX = Number(first?.x ?? first?.cx);
    const firstY = Number(first?.y ?? first?.cy);
    const secondX = Number(second?.x ?? second?.cx);
    const secondY = Number(second?.y ?? second?.cy);
    if (![firstX, firstY, secondX, secondY].every(Number.isFinite)) return Infinity;
    return Math.hypot(firstX - secondX, firstY - secondY);
}

function distanceToLine(line, point) {
    const coefficients = lineCoefficients(line);
    const x = Number(point?.x ?? point?.cx);
    const y = Number(point?.y ?? point?.cy);
    return coefficients && Number.isFinite(x) && Number.isFinite(y)
        ? Math.abs(coefficients.a * x + coefficients.b * y + coefficients.c)
        : Infinity;
}

function lineCoefficients(line) {
    if (line?.type !== 'line') return null;
    const x1 = Number(line.x1);
    const y1 = Number(line.y1);
    const x2 = Number(line.x2);
    const y2 = Number(line.y2);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= EPSILON) return null;
    const a = dy / length;
    const b = -dx / length;
    const c = -(a * x1 + b * y1);
    return Number.isFinite(c) ? { a, b, c } : null;
}

function tangentPairCandidates(first, second, radius, safety) {
    if (first.type === 'line' && second.type === 'line') {
        const candidates = [];
        [-1, 1].forEach(firstSide => [-1, 1].forEach(secondSide => {
            const firstLine = offsetLine(first, firstSide * radius);
            const secondLine = offsetLine(second, secondSide * radius);
            const center = intersectLines(firstLine, secondLine);
            const candidate = center && boundedCircleFromCenter(center, radius, safety);
            if (candidate) candidates.push(candidate);
        }));
        return candidates;
    }
    if (first.type === 'circle' && second.type === 'line') return tangentPairCandidates(second, first, radius, safety);
    if (first.type === 'line' && second.type === 'circle') {
        const candidates = [];
        [-1, 1].forEach(lineSide => [-1, 1].forEach(circleSide => {
            const offset = offsetLine(first, lineSide * radius);
            const targetRadius = Math.abs(Math.abs(Number(second.r)) + circleSide * radius);
            candidates.push(...intersectLineCircle(offset, second, targetRadius)
                .map(center => boundedCircleFromCenter(center, radius, safety))
                .filter(Boolean));
        }));
        return candidates.filter(candidate => isTangentToEntity(candidate, first, radius) && isTangentToEntity(candidate, second, radius));
    }
    if (first.type === 'circle' && second.type === 'circle') {
        const candidates = [];
        [-1, 1].forEach(firstSide => [-1, 1].forEach(secondSide => {
            const firstRadius = Math.abs(Math.abs(Number(first.r)) + firstSide * radius);
            const secondRadius = Math.abs(Math.abs(Number(second.r)) + secondSide * radius);
            candidates.push(...intersectCircleCircles(first, firstRadius, second, secondRadius)
                .map(center => boundedCircleFromCenter(center, radius, safety))
                .filter(Boolean));
        }));
        return candidates.filter(candidate => isTangentToEntity(candidate, first, radius) && isTangentToEntity(candidate, second, radius));
    }
    return [];
}

function findThreeLineTangentCandidates(lines, safety) {
    const coefficients = lines.map(lineCoefficients);
    if (coefficients.some(coefficientsForLine => !coefficientsForLine)) return [];
    const candidates = [];
    [-1, 1].forEach(firstSide => [-1, 1].forEach(secondSide => [-1, 1].forEach(thirdSide => {
        const [first, second, third] = coefficients;
        const solution = solveThreeByThree([
            [first.a, first.b, -firstSide],
            [second.a, second.b, -secondSide],
            [third.a, third.b, -thirdSide],
        ], [-first.c, -second.c, -third.c]);
        if (!solution) return;
        const candidate = boundedCircleFromCenter({ x: solution[0], y: solution[1] }, solution[2], safety);
        if (!candidate) return;
        if (lines.every(line => isTangentToEntity(candidate, line, candidate.r))) candidates.push(candidate);
    })));
    return dedupeCircles(candidates, safety);
}

function offsetLine(line, distanceValue) {
    const coefficients = lineCoefficients(line);
    return coefficients ? { ...coefficients, c: coefficients.c - distanceValue } : null;
}

function intersectLines(first, second) {
    if (!first || !second) return null;
    const determinant = first.a * second.b - second.a * first.b;
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= RELATIVE_NUMERIC_EPSILON) return null;
    const point = {
        x: (first.b * second.c - second.b * first.c) / determinant,
        y: (second.a * first.c - first.a * second.c) / determinant,
    };
    return finitePoint(point, MAX_GEOMETRY_MAGNITUDE) ? point : null;
}

function intersectLineCircle(line, circle, radius) {
    const centerX = Number(circle?.cx);
    const centerY = Number(circle?.cy);
    const requestedRadius = Number(radius);
    if (!line || !Number.isFinite(centerX) || !Number.isFinite(centerY)
        || !Number.isFinite(requestedRadius) || requestedRadius < 0) return [];
    const projectionDistance = line.a * centerX + line.b * centerY + line.c;
    const projection = { x: centerX - line.a * projectionDistance, y: centerY - line.b * projectionDistance };
    const squaredHeight = requestedRadius ** 2 - projectionDistance ** 2;
    const tolerance = RELATIVE_NUMERIC_EPSILON * Math.max(1, requestedRadius ** 2, projectionDistance ** 2);
    if (!Number.isFinite(squaredHeight) || squaredHeight < -tolerance) return [];
    const height = Math.sqrt(Math.max(0, squaredHeight));
    const tangent = { x: -line.b * height, y: line.a * height };
    const first = { x: projection.x + tangent.x, y: projection.y + tangent.y };
    if (!finitePoint(first, MAX_GEOMETRY_MAGNITUDE)) return [];
    if (height <= EPSILON) return [first];
    const second = { x: projection.x - tangent.x, y: projection.y - tangent.y };
    return finitePoint(second, MAX_GEOMETRY_MAGNITUDE) ? [first, second] : [first];
}

function intersectCircleCircles(first, firstRadius, second, secondRadius) {
    const firstX = Number(first?.cx);
    const firstY = Number(first?.cy);
    const secondX = Number(second?.cx);
    const secondY = Number(second?.cy);
    const radiusA = Number(firstRadius);
    const radiusB = Number(secondRadius);
    if (![firstX, firstY, secondX, secondY, radiusA, radiusB].every(Number.isFinite)
        || radiusA < 0 || radiusB < 0) return [];
    const dx = secondX - firstX;
    const dy = secondY - firstY;
    const centerDistance = Math.hypot(dx, dy);
    const tolerance = RELATIVE_NUMERIC_EPSILON * Math.max(1, centerDistance, radiusA, radiusB);
    if (!Number.isFinite(centerDistance) || centerDistance <= EPSILON
        || centerDistance > radiusA + radiusB + tolerance
        || centerDistance < Math.abs(radiusA - radiusB) - tolerance) return [];
    const along = (radiusA ** 2 - radiusB ** 2 + centerDistance ** 2) / (2 * centerDistance);
    const squaredHeight = radiusA ** 2 - along ** 2;
    const squaredTolerance = RELATIVE_NUMERIC_EPSILON * Math.max(1, radiusA ** 2, along ** 2);
    if (!Number.isFinite(squaredHeight) || squaredHeight < -squaredTolerance) return [];
    const height = Math.sqrt(Math.max(0, squaredHeight));
    const base = { x: firstX + along * dx / centerDistance, y: firstY + along * dy / centerDistance };
    const offset = { x: -dy * height / centerDistance, y: dx * height / centerDistance };
    const firstPoint = { x: base.x + offset.x, y: base.y + offset.y };
    if (!finitePoint(firstPoint, MAX_GEOMETRY_MAGNITUDE)) return [];
    if (height <= EPSILON) return [firstPoint];
    const secondPoint = { x: base.x - offset.x, y: base.y - offset.y };
    return finitePoint(secondPoint, MAX_GEOMETRY_MAGNITUDE) ? [firstPoint, secondPoint] : [firstPoint];
}

function isTangentToEntity(candidate, entity, radius) {
    if (!candidate || !Number.isFinite(radius) || radius <= EPSILON) return false;
    if (entity?.type === 'line') {
        const lineDistance = distanceToLine(entity, candidate);
        const tolerance = RELATIVE_NUMERIC_EPSILON * Math.max(1, lineDistance, radius);
        return Number.isFinite(lineDistance) && Math.abs(lineDistance - radius) <= tolerance;
    }
    if (entity?.type === 'circle') {
        const centerDistance = distance(candidate, entity);
        const sourceRadius = Math.abs(Number(entity.r));
        const tolerance = RELATIVE_NUMERIC_EPSILON * Math.max(1, centerDistance, sourceRadius, radius);
        if (!Number.isFinite(centerDistance) || !Number.isFinite(sourceRadius) || centerDistance <= tolerance) return false;
        return Math.min(
            Math.abs(centerDistance - (sourceRadius + radius)),
            Math.abs(centerDistance - Math.abs(sourceRadius - radius)),
        ) <= Math.max(tolerance, 1e-8);
    }
    return false;
}

function parameterizeLinearRows(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const normalizedRows = rows.map(row => normalizeLinearRow(row)).filter(Boolean);
    if (normalizedRows.length !== rows.length) return null;
    for (let firstIndex = 0; firstIndex < normalizedRows.length - 1; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < normalizedRows.length; secondIndex += 1) {
            const first = normalizedRows[firstIndex];
            const second = normalizedRows[secondIndex];
            for (const freeIndex of [2, 1, 0]) {
                const pivotIndices = [0, 1, 2].filter(index => index !== freeIndex);
                const [leftIndex, rightIndex] = pivotIndices;
                const determinant = first.coefficients[leftIndex] * second.coefficients[rightIndex]
                    - second.coefficients[leftIndex] * first.coefficients[rightIndex];
                if (!Number.isFinite(determinant) || Math.abs(determinant) <= RELATIVE_NUMERIC_EPSILON) continue;

                const origin = [0, 0, 0];
                const direction = [0, 0, 0];
                origin[leftIndex] = (
                    first.value * second.coefficients[rightIndex]
                    - second.value * first.coefficients[rightIndex]
                ) / determinant;
                origin[rightIndex] = (
                    first.coefficients[leftIndex] * second.value
                    - second.coefficients[leftIndex] * first.value
                ) / determinant;
                direction[freeIndex] = 1;
                direction[leftIndex] = (
                    -first.coefficients[freeIndex] * second.coefficients[rightIndex]
                    + second.coefficients[freeIndex] * first.coefficients[rightIndex]
                ) / determinant;
                direction[rightIndex] = (
                    -first.coefficients[leftIndex] * second.coefficients[freeIndex]
                    + second.coefficients[leftIndex] * first.coefficients[freeIndex]
                ) / determinant;

                const satisfiesRows = normalizedRows.every(row => (
                    Math.abs(dot(row.coefficients, origin) - row.value) <= 1e-8 * Math.max(1, Math.abs(row.value))
                    && Math.abs(dot(row.coefficients, direction)) <= 1e-8
                ));
                if (satisfiesRows && origin.every(Number.isFinite) && direction.every(Number.isFinite)) {
                    return { origin, direction };
                }
            }
        }
    }
    return null;
}

function solveCircleParameter(parameterization, circle, sign) {
    const [xOrigin, yOrigin, radiusOrigin] = parameterization.origin;
    const [xDirection, yDirection, radiusDirection] = parameterization.direction;
    const dx = xOrigin - circle.cx;
    const dy = yOrigin - circle.cy;
    const sourceRadius = Math.abs(Number(circle.r));
    const tangentOrigin = sourceRadius + sign * radiusOrigin;
    const tangentDirection = sign * radiusDirection;
    if (![xOrigin, yOrigin, radiusOrigin, xDirection, yDirection, radiusDirection, dx, dy, sourceRadius].every(Number.isFinite)) return [];
    return solveQuadratic(
        xDirection ** 2 + yDirection ** 2 - tangentDirection ** 2,
        2 * (dx * xDirection + dy * yDirection - tangentOrigin * tangentDirection),
        dx ** 2 + dy ** 2 - tangentOrigin ** 2,
    );
}

function solveQuadratic(a, b, c) {
    if (![a, b, c].every(Number.isFinite)) return [];
    const coefficientScale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c));
    const tolerance = RELATIVE_NUMERIC_EPSILON * coefficientScale;
    if (Math.abs(a) <= tolerance) return Math.abs(b) <= tolerance ? [] : [-c / b].filter(Number.isFinite);
    const discriminant = b ** 2 - 4 * a * c;
    const discriminantTolerance = RELATIVE_NUMERIC_EPSILON * Math.max(1, b ** 2, Math.abs(4 * a * c));
    if (!Number.isFinite(discriminant) || discriminant < -discriminantTolerance) return [];
    if (Math.abs(discriminant) <= discriminantTolerance) return [-b / (2 * a)].filter(Number.isFinite);
    const root = Math.sqrt(Math.max(0, discriminant));
    const q = -0.5 * (b + Math.sign(b || 1) * root);
    const roots = [q / a, c / q].filter(Number.isFinite);
    return roots.filter((value, index, all) => all.findIndex(other => Math.abs(other - value) <= 1e-9 * Math.max(1, Math.abs(value), Math.abs(other))) === index);
}

function dot(first, second) {
    return first.reduce((sum, value, index) => sum + value * second[index], 0);
}

export function isFiniteBoundedCircle(circle, safety = {}) {
    const circleSafety = normalizeCircleSafety(safety);
    const cx = Number(circle?.cx);
    const cy = Number(circle?.cy);
    const radius = Number(circle?.r);
    return Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(radius)
        && radius > EPSILON && radius <= circleSafety.maxRadius
        && Math.abs(cx) <= circleSafety.maxCoordinate
        && Math.abs(cy) <= circleSafety.maxCoordinate
        && Math.abs(cx) + radius <= circleSafety.maxCoordinate
        && Math.abs(cy) + radius <= circleSafety.maxCoordinate;
}

function boundedCircleFromCenter(center, radius, safety) {
    const candidate = { cx: Number(center?.x), cy: Number(center?.y), r: Number(radius) };
    return isFiniteBoundedCircle(candidate, safety) ? candidate : null;
}

function finitePoint(point, maxCoordinate = MAX_GEOMETRY_MAGNITUDE) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    return Number.isFinite(x) && Number.isFinite(y)
        && Math.abs(x) <= maxCoordinate && Math.abs(y) <= maxCoordinate
        ? { x, y }
        : null;
}

function normalizeCircleSafety(safety = {}) {
    const source = safety && typeof safety === 'object' ? safety : {};
    const relativeCollinearityTolerance = Number(source.relativeCollinearityTolerance);
    const maxRadiusFactor = Number(source.maxRadiusFactor);
    const maxRadius = Number(source.maxRadius);
    const maxCoordinate = Number(source.maxCoordinate);
    const normalizedMaxCoordinate = Number.isFinite(maxCoordinate) && maxCoordinate > 0
        ? Math.min(maxCoordinate, MAX_GEOMETRY_MAGNITUDE)
        : MAX_GEOMETRY_MAGNITUDE;
    return {
        relativeCollinearityTolerance: Number.isFinite(relativeCollinearityTolerance) && relativeCollinearityTolerance >= 0
            ? relativeCollinearityTolerance
            : DEFAULT_CIRCLE_SAFETY.relativeCollinearityTolerance,
        maxRadiusFactor: Number.isFinite(maxRadiusFactor) && maxRadiusFactor > 0
            ? maxRadiusFactor
            : DEFAULT_CIRCLE_SAFETY.maxRadiusFactor,
        maxRadius: Number.isFinite(maxRadius) && maxRadius > 0
            ? Math.min(maxRadius, normalizedMaxCoordinate)
            : Math.min(DEFAULT_CIRCLE_SAFETY.maxRadius, normalizedMaxCoordinate),
        maxCoordinate: normalizedMaxCoordinate,
    };
}

function normalizeLinearRow(row) {
    if (!row || !Array.isArray(row.coefficients) || row.coefficients.length !== 3) return null;
    const coefficients = row.coefficients.map(Number);
    const value = Number(row.value);
    if (!coefficients.every(Number.isFinite) || !Number.isFinite(value)) return null;
    const scale = Math.max(...coefficients.map(Math.abs), 1);
    return {
        coefficients: coefficients.map(coefficient => coefficient / scale),
        value: value / scale,
    };
}

function isValidTangentSource(entity, safety) {
    if (entity?.type === 'line') {
        const points = [
            finitePoint({ x: entity.x1, y: entity.y1 }, safety.maxCoordinate),
            finitePoint({ x: entity.x2, y: entity.y2 }, safety.maxCoordinate),
        ];
        return points.every(Boolean) && Boolean(lineCoefficients(entity));
    }
    if (entity?.type === 'circle') {
        const cx = Number(entity.cx);
        const cy = Number(entity.cy);
        const radius = Math.abs(Number(entity.r));
        return Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(radius)
            && radius >= 0 && Math.abs(cx) + radius <= safety.maxCoordinate
            && Math.abs(cy) + radius <= safety.maxCoordinate;
    }
    return false;
}

function dedupeCircles(candidates, safety = {}) {
    const circleSafety = normalizeCircleSafety(safety);
    return candidates
        .filter(candidate => isFiniteBoundedCircle(candidate, circleSafety))
        .filter((candidate, index, all) => all.findIndex(other => {
            const scale = Math.max(1, Math.abs(candidate.r), Math.abs(other.r), distance(candidate, other));
            return distance(candidate, other) <= RELATIVE_NUMERIC_EPSILON * scale
                && Math.abs(candidate.r - other.r) <= RELATIVE_NUMERIC_EPSILON * scale;
        }) === index);
}

function solveThreeByThree(matrix, values) {
    if (!Array.isArray(matrix) || matrix.length !== 3 || !Array.isArray(values) || values.length !== 3
        || matrix.some(row => !Array.isArray(row) || row.length !== 3)) return null;
    const augmented = matrix.map((row, rowIndex) => [...row.map(Number), Number(values[rowIndex])]);
    if (augmented.some(row => !row.every(Number.isFinite))) return null;
    for (let column = 0; column < 3; column += 1) {
        let pivot = column;
        for (let row = column + 1; row < 3; row += 1) {
            if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
        }
        const pivotScale = Math.max(...augmented[pivot].slice(0, 3).map(Math.abs), 1);
        if (Math.abs(augmented[pivot][column]) <= RELATIVE_NUMERIC_EPSILON * pivotScale) return null;
        [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
        const divisor = augmented[column][column];
        for (let valueIndex = column; valueIndex < 4; valueIndex += 1) augmented[column][valueIndex] /= divisor;
        for (let row = 0; row < 3; row += 1) {
            if (row === column) continue;
            const factor = augmented[row][column];
            for (let valueIndex = column; valueIndex < 4; valueIndex += 1) augmented[row][valueIndex] -= factor * augmented[column][valueIndex];
        }
        if (augmented.some(row => !row.every(Number.isFinite))) return null;
    }
    const solution = [augmented[0][3], augmented[1][3], augmented[2][3]];
    return solution.every(Number.isFinite) ? solution : null;
}
