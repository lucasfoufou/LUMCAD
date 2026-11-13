// ZOOM command input, AutoCAD style: a factor (2, 0,5, 2X), a keyword
// (Extents/All, Window) or nothing, in which case a window corner is picked.
const ZOOM_KEYWORDS = new Map([
    ['E', 'extents'], ['EXTENTS', 'extents'], ['ET', 'extents'], ['ETENDU', 'extents'], ['ÉTENDU', 'extents'],
    ['A', 'extents'], ['ALL', 'extents'], ['T', 'extents'], ['TOUT', 'extents'],
    ['W', 'window'], ['WINDOW', 'window'], ['F', 'window'], ['FENETRE', 'window'], ['FENÊTRE', 'window'],
]);

export const DRAWING_ZOOM_MAX_FACTOR = 1000;

/**
 * Returns { action: 'prompt' | 'extents' | 'window' } or { action: 'factor', factor }
 * (factor > 1 zooms in), or null when the input is not ZOOM syntax.
 */
export function parseDrawingZoomInput(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return { action: 'prompt' };
    const keyword = ZOOM_KEYWORDS.get(trimmed.toUpperCase());
    if (keyword) return { action: keyword };
    const match = /^(\d+(?:[.,]\d+)?|[.,]\d+)\s*X?$/i.exec(trimmed);
    if (!match) return null;
    const factor = Number.parseFloat(match[1].replace(',', '.'));
    if (!Number.isFinite(factor) || factor <= 0 || factor > DRAWING_ZOOM_MAX_FACTOR || factor < 1 / DRAWING_ZOOM_MAX_FACTOR) return null;
    return { action: 'factor', factor };
}

/** Bounds of a zoom window from two opposite corners, or null when it is degenerate. */
export function drawingZoomWindowBounds(first, second, minimumSize = 1e-9) {
    if (![first?.x, first?.y, second?.x, second?.y].every(Number.isFinite)) return null;
    const bounds = {
        minX: Math.min(first.x, second.x), minY: Math.min(first.y, second.y),
        maxX: Math.max(first.x, second.x), maxY: Math.max(first.y, second.y),
    };
    return bounds.maxX - bounds.minX > minimumSize || bounds.maxY - bounds.minY > minimumSize ? bounds : null;
}
