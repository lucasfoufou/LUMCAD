import { readDrawingCffData } from './drawingCffData.js';
import { createDrawingCffOutlineReader } from './drawingCffOutlines.js';
import { createDrawingTrueTypeReader, drawingTrueTypeContoursGeometry } from './drawingTrueTypeOutlines.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';
import { transformAffinePoint } from './drawingAffine.js';
import { getEntityBounds } from './drawingGeometry.js';

const invalid = () => { throw new Error('dwfxFont'); };

export function drawingFontOutlineBounds(geometry) {
    let result = null;
    for (const path of geometry.paths) for (const part of path.parts) {
        const bounds = getEntityBounds(part);
        if (!bounds || ![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) invalid();
        result = result ? { minX: Math.min(result.minX, bounds.minX), maxX: Math.max(result.maxX, bounds.maxX),
            minY: Math.min(result.minY, bounds.minY), maxY: Math.max(result.maxY, bounds.maxY) } : bounds;
    }
    return result;
}

/** Keep both outline formats on the same native curve and placement pipeline. */
export function createDrawingFontOutlineReader(resource, metrics) {
    if (resource.format === 'truetype') {
        const read = createDrawingTrueTypeReader(resource, metrics.glyphCount);
        return { yMax(index) { read(index); return read.yMax(index); }, geometry(index, matrix) {
            const contours = read(index).map(contour => contour.map(point => ({ ...point, ...transformAffinePoint(point, matrix) })));
            if (contours.some(contour => contour.some(point => ![point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)))) invalid();
            return drawingTrueTypeContoursGeometry(contours);
        } };
    }
    const data = readDrawingCffData(resource, metrics.glyphCount);
    const read = createDrawingCffOutlineReader(data); const cache = new Map();
    const transform = (geometry, matrix) => ({ ...geometry, paths: geometry.paths.map(path => ({ ...path,
        parts: path.parts.map(part => transformDrawingEntityAffine(part, matrix)),
    })) });
    const glyph = index => {
        if (!cache.has(index)) {
            const raw = read(index);
            const matrix = data.fontDicts ? data.fontDicts[data.fdSelect[index]].matrix : data.matrix;
            const [a, b, c, d, e, f] = matrix.map(value => value * metrics.unitsPerEm);
            if (!Number.isFinite(a * d - b * c) || Math.abs(a * d - b * c) < 1e-12) invalid();
            const geometry = transform(raw, { a, b, c, d, e, f });
            const bounds = drawingFontOutlineBounds(geometry);
            cache.set(index, { geometry, yMax: bounds?.maxY || 0 });
        }
        return cache.get(index);
    };
    return { yMax: index => glyph(index).yMax, geometry(index, matrix) {
        const geometry = transform(glyph(index).geometry, matrix);
        drawingFontOutlineBounds(geometry);
        return geometry;
    } };
}
