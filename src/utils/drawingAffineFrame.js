import { affineMatrixToSvg, multiplyAffineMatrices, transformAffinePoint } from './drawingAffine.js';

export function normalizeDrawingAffineFrame(value) {
    if (!value || !['a', 'b', 'c', 'd', 'e', 'f'].every(key => Number.isFinite(value[key]) && Math.abs(value[key]) <= 1e12)) return null;
    const determinant = value.a * value.d - value.b * value.c;
    if (Math.abs(determinant) < 1e-12) return null;
    return Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map(key => [key, value[key]]));
}

export function drawingAffineFrame(entity) {
    return ['image', 'text'].includes(entity?.type) ? normalizeDrawingAffineFrame(entity.affineFrame) : null;
}

export function transformDrawingAffineFrame(entity, matrix) {
    return { ...entity, affineFrame: multiplyAffineMatrices(matrix, drawingAffineFrame(entity)) };
}

export function unframeDrawingPoint(point, frame) {
    const determinant = frame.a * frame.d - frame.b * frame.c;
    const x = point.x - frame.e; const y = point.y - frame.f;
    return { x: (frame.d * x - frame.c * y) / determinant, y: (frame.a * y - frame.b * x) / determinant };
}

export function framedDrawingPoint(entity, point) {
    const frame = drawingAffineFrame(entity);
    return frame ? transformAffinePoint(point, frame) : point;
}

export function drawingRectTransform(entity) {
    const frame = drawingAffineFrame(entity);
    const rotation = Number(entity.rotation) || 0;
    const mirrored = Boolean(entity.mirrored);
    const centerX = entity.x + entity.width / 2;
    const centerY = entity.y + entity.height / 2;
    const local = mirrored
        ? `translate(${centerX} ${centerY}) rotate(${rotation}) scale(1 -1) translate(${-centerX} ${-centerY})`
        : rotation ? `rotate(${rotation} ${centerX} ${centerY})` : '';
    return [frame && affineMatrixToSvg(frame), local].filter(Boolean).join(' ') || undefined;
}
