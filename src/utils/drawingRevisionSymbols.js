import { curveLength, curveParameterAtLength, curvePointAt, extractEntityPaths } from './drawingCurveKernel.js';
import { drawingLineworkArc } from './drawingLinework.js';
import { transformEllipseAffine } from './drawingAdvancedEntities.js';
import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices, transformAffinePoint } from './drawingAffine.js';

const validPoint = point => point && [point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e12);
const validPositive = value => Number.isFinite(value) && value > 1e-6 && value <= 1e6;

export function rebuildDrawingRevisionSymbol(entity) {
    const definition = entity?.revisionSymbol;
    if (!definition || !['cloud', 'break'].includes(definition.kind)) return null;
    const matrix = definition.transform || IDENTITY_AFFINE_MATRIX;
    if (!['a', 'b', 'c', 'd', 'e', 'f'].every(key => Number.isFinite(matrix[key]) && Math.abs(matrix[key]) <= 1e12)
        || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-12) return null;
    let parts; let normalized;
    if (definition.kind === 'cloud') {
        if (!validPositive(definition.arcLength)) return null;
        const paths = extractEntityPaths(definition.source);
        if (paths.length !== 1 || !paths[0].closed) return null;
        const source = paths[0];
        const stations = [];
        for (const part of source.parts) {
            const length = curveLength(part);
            const count = Math.max(source.parts.length === 1 ? 4 : 1, Math.ceil(length / definition.arcLength));
            if (!Number.isFinite(length) || length <= 0 || count + stations.length > 2048) return null;
            for (let index = 0; index < count; index += 1) {
                const point = curvePointAt(part, curveParameterAtLength(part, length * index / count));
                if (!validPoint(point)) return null;
                stations.push(point);
            }
        }
        if (stations.length < 3) return null;
        const area = stations.reduce((sum, point, index) => { const next = stations[(index + 1) % stations.length]; return sum + point.x * next.y - point.y * next.x; }, 0);
        if (Math.abs(area) < 1e-10) return null;
        const bulge = Math.tan(Math.PI / 8) * Math.sign(area) * (definition.reverse ? -1 : 1);
        parts = stations.map((start, index) => {
            const arc = drawingLineworkArc(start, stations[(index + 1) % stations.length], bulge);
            if (!arc) return null;
            return transformEllipseAffine({ type: 'ellipse', cx: arc.center.x, cy: arc.center.y, rx: arc.radius, ry: arc.radius,
                startAngle: arc.startAngle, endAngle: arc.startAngle + arc.sweep, counterClockwise: arc.sweep > 0, fullEllipse: false }, matrix);
        });
        normalized = { kind: 'cloud', source, arcLength: definition.arcLength, reverse: definition.reverse === true, transform: { ...matrix } };
    } else {
        const { start, end, size } = definition;
        const extension = definition.extension ?? size / 2;
        const position = definition.position ?? 0.5;
        if (!validPoint(start) || !validPoint(end) || !validPositive(size) || !Number.isFinite(extension) || extension < 0 || extension > 1e6
            || !Number.isFinite(position) || position <= 0 || position >= 1) return null;
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        if (size >= length * Math.min(position, 1 - position) * 2) return null;
        const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
        const point = (along, across = 0) => transformAffinePoint({ x: start.x + direction.x * along - direction.y * across,
            y: start.y + direction.y * along + direction.x * across }, matrix);
        const center = length * position;
        const points = [point(-extension), point(center - size / 2), point(center - size / 4, -size / 2),
            point(center + size / 4, size / 2), point(center + size / 2), point(length + extension)];
        parts = points.slice(1).map((p, index) => ({ type: 'line', x1: points[index].x, y1: points[index].y, x2: p.x, y2: p.y }));
        normalized = { kind: 'break', start: { ...start }, end: { ...end }, size, extension, position, transform: { ...matrix } };
    }
    if (parts.some(part => !part)) return null;
    const { points, boundaries, linework, splineDefinition, array, ...rest } = entity;
    return { ...rest, type: 'polyline', parts, closed: definition.kind === 'cloud', revisionSymbol: normalized };
}

export function transformDrawingRevisionSymbol(entity, matrix) {
    const source = rebuildDrawingRevisionSymbol(entity);
    return source ? rebuildDrawingRevisionSymbol({ ...source, revisionSymbol: { ...source.revisionSymbol,
        transform: multiplyAffineMatrices(matrix, source.revisionSymbol.transform) } }) : null;
}

export function drawingRevisionGripSource(definition) {
    if (definition.kind === 'break') return { type: 'polyline', points: [definition.start, definition.end], closed: false };
    const source = definition.source;
    if (source.parts.every(part => part.type === 'line')) return { type: 'polyline', closed: true, points: source.parts.map(part => ({ x: part.x1, y: part.y1 })) };
    return { ...source, type: 'polyline' };
}

export function previewDrawingRevision(operation, point, layerId) {
    if (operation?.type !== 'revision' || operation.stage !== 'points' || !operation.points.length || !validPoint(point)) return null;
    let definition;
    if (operation.kind === 'break') definition = { ...operation, start: operation.points[0], end: point };
    else {
        const a = operation.points[0];
        const points = operation.mode === 'RECT' ? [a, { x: point.x, y: a.y }, point, { x: a.x, y: point.y }] : [...operation.points, point];
        definition = { ...operation, source: { type: 'polyline', closed: true, points } };
    }
    return rebuildDrawingRevisionSymbol({ id: 'revision-preview', layerId, revisionSymbol: definition });
}
