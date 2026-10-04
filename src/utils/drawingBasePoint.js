export function normalizeDrawingBasePoint(value) {
    return value && Number.isFinite(value.x) && Number.isFinite(value.y)
        && Math.abs(value.x) <= 1e12 && Math.abs(value.y) <= 1e12
        ? { x: value.x, y: value.y } : { x: 0, y: 0 };
}

export function setDrawingBasePoint(content, point) {
    const basePoint = normalizeDrawingBasePoint(point);
    if (!point || basePoint.x !== point.x || basePoint.y !== point.y) return null;
    return { ...content, metadata: { ...content.metadata, basePoint } };
}
