import { triangulateDrawingPolygon, clipDrawingPolygonToBounds } from './drawingPolygonClip.js';

/** Represent opaque pixel runs by polygons; zero-alpha pixels retain the underlying drawing. */
export function drawingRasterPolygons({ width, height, pixels }, { clip = null, maxPolygons = 8192, maxChecks = 1000000 } = {}) {
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || width * height > 16000000
        || !(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) throw new Error('wmfInvalidBitmap');
    if (![maxPolygons, maxChecks].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('wmfLimit');
    const triangles = clip ? triangulateDrawingPolygon(clip, { maxChecks }) : null;
    const rectangles = []; let previous = new Map();
    for (let y = 0; y < height; y++) {
        const current = new Map();
        for (let x = 0; x < width;) {
            const offset = (y * width + x) * 4; const alpha = pixels[offset + 3];
            if (alpha !== 0 && alpha !== 255) throw new Error('wmfExportTransparency');
            if (alpha === 0) { x++; continue; }
            const color = '#' + [...pixels.subarray(offset, offset + 3)].map(n => n.toString(16).padStart(2, '0')).join('');
            let end = x + 1;
            while (end < width && [0, 1, 2, 3].every(c => pixels[(y * width + end) * 4 + c] === pixels[offset + c])) end++;
            const key = `${x}:${end}:${color}`;
            let rectangle = previous.get(key);
            if (rectangle) rectangle.maxY = (y + 1) / height;
            else {
                if (rectangles.length >= maxPolygons) throw new Error('wmfLimit');
                rectangle = { minX: x / width, maxX: end / width, minY: y / height, maxY: (y + 1) / height, color };
                rectangles.push(rectangle);
            }
            current.set(key, rectangle); x = end;
        }
        previous = current;
    }
    if (triangles && rectangles.length * triangles.length * 32 > maxChecks) throw new Error('wmfLimit');
    const result = [];
    for (const rect of rectangles) {
        const polygons = triangles ? triangles.map(triangle => clipDrawingPolygonToBounds(triangle, rect)) : [[
            { x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY },
            { x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }]];
        for (const points of polygons) {
            if (points.length < 3) continue;
            const area = points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a.x * b.y - a.y * b.x; }, 0);
            if (Math.abs(area) < 1e-15) continue;
            if (result.length >= maxPolygons) throw new Error('wmfLimit');
            result.push({ points, color: rect.color });
        }
    }
    return result;
}
