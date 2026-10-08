import { transformAffinePoint } from './drawingAffine.js';

export const DRAWING_POINT_STYLES = Object.freeze(['dot', 'cross', 'x', 'circle', 'square', 'circle-cross', 'square-cross']);
export const DEFAULT_DRAWING_POINT_STYLE = Object.freeze({ symbol: 'cross', size: 0.2 });

export function normalizeDrawingPointStyle(value) {
    return {
        symbol: DRAWING_POINT_STYLES.includes(value?.symbol) ? value.symbol : DEFAULT_DRAWING_POINT_STYLE.symbol,
        size: Number.isFinite(value?.size) && value.size >= 1e-6 && value.size <= 1e6 ? value.size : DEFAULT_DRAWING_POINT_STYLE.size,
    };
}

export function isValidDrawingPoint(point) {
    return Boolean(point) && [point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e12);
}

export function drawingPointBounds(entity) {
    if (!isValidDrawingPoint(entity)) return null;
    const half = normalizeDrawingPointStyle(entity.pointStyle).size / 2;
    const { a, b, c, d } = drawingPointMarkerMatrix(entity);
    const dx = half * (Math.abs(a) + Math.abs(c));
    const dy = half * (Math.abs(b) + Math.abs(d));
    return { minX: entity.x - dx, minY: entity.y - dy, maxX: entity.x + dx, maxY: entity.y + dy };
}

export function drawingPointMarkerMatrix(entity) {
    const value = entity?.pointTransform;
    return value && ['a', 'b', 'c', 'd'].every(key => Number.isFinite(value[key]) && Math.abs(value[key]) <= 1e12)
        && Math.abs(value.a * value.d - value.b * value.c) > 1e-18
        ? { a: value.a, b: value.b, c: value.c, d: value.d } : { a: 1, b: 0, c: 0, d: 1 };
}

export function transformDrawingPoint(entity, matrix) {
    const prior = drawingPointMarkerMatrix(entity);
    const pointTransform = { a: matrix.a * prior.a + matrix.c * prior.b, b: matrix.b * prior.a + matrix.d * prior.b,
        c: matrix.a * prior.c + matrix.c * prior.d, d: matrix.b * prior.c + matrix.d * prior.d };
    return { ...entity, ...transformAffinePoint(entity, matrix), pointTransform };
}

export function drawingPointSvgTransform(entity) {
    const { a, b, c, d } = drawingPointMarkerMatrix(entity);
    return `matrix(${a} ${b} ${c} ${d} ${entity.x - a * entity.x - c * entity.y} ${entity.y - b * entity.x - d * entity.y})`;
}

/** Shared SVG geometry for model, paper, print and clipboard presentation. */
export function drawingPointPath(entity) {
    if (!isValidDrawingPoint(entity)) return '';
    const { symbol, size } = normalizeDrawingPointStyle(entity.pointStyle);
    const { x, y } = entity;
    const half = size / 2;
    const cross = `M ${x - half} ${y} L ${x + half} ${y} M ${x} ${y - half} L ${x} ${y + half}`;
    if (symbol === 'cross') return cross;
    if (symbol === 'x') return `M ${x - half} ${y - half} L ${x + half} ${y + half} M ${x - half} ${y + half} L ${x + half} ${y - half}`;
    const radius = symbol === 'dot' ? size / 8 : half;
    const outline = symbol.startsWith('square')
        ? `M ${x - half} ${y - half} L ${x + half} ${y - half} L ${x + half} ${y + half} L ${x - half} ${y + half} Z`
        : `M ${x + radius} ${y} A ${radius} ${radius} 0 1 1 ${x - radius} ${y} A ${radius} ${radius} 0 1 1 ${x + radius} ${y} Z`;
    return symbol.endsWith('-cross') ? `${outline} ${cross}` : outline;
}
