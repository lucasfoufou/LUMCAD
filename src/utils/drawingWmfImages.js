import { getRectEntityCorners } from './drawingPrimitives.js';
import { getImageClipPoints, normalizeImageClip } from './drawingImageClip.js';
import { drawingRasterPolygons } from './drawingRasterPolygons.js';
import { applyImageAdjustmentsToPixels } from './drawingImageAdjustments.js';
import { readDrawingRasterImage, transposeDrawingRasterImage } from './drawingRasterImage.js';
import { encodeDrawingDib } from './drawingDibWriter.js';

/** Resolve embedded image resources before constructing a WMF candidate. */
export async function prepareDrawingWmfImages(entities, assets, options = {}) {
    const result = new Map(); const assetMap = new Map(assets.map(asset => [asset.id, asset]));
    const cache = new Map(); let totalPixels = 0; let totalBytes = 0; let totalPolygons = 0;
    for (const entity of entities) {
        if (entity.type !== 'image') continue;
        if ((entity.opacity ?? .55) !== 1) throw new Error('wmfExportTransparency');
        if (!(entity.width > 0) || !(entity.height > 0)) throw new Error('wmfExportUnsupported');
        let points = getRectEntityCorners(entity);
        if (entity.mirrored) points = [points[3], points[2], points[1], points[0]];
        const [a, b, c, d] = points;
        const span = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(d.x - a.x, d.y - a.y));
        const near = (x, y) => Math.abs(x - y) <= span * 1e-10;
        const horizontal = near(b.y, a.y) && near(d.x, a.x) && near(c.x, b.x) && near(c.y, d.y);
        const vertical = near(b.x, a.x) && near(d.y, a.y) && near(c.y, b.y) && near(c.x, d.x);
        if (!points.every(point => [point.x, point.y].every(Number.isFinite)) || !span) throw new Error('wmfExportUnsupported');
        const clipPoints = getImageClipPoints(entity, { world: true });
        let clip = null;
        const rectangularClip = !clipPoints || (clipPoints.length === 4 && clipPoints.every((point, index) => {
                const next = clipPoints[(index + 1) % 4];
                return near(point.x, next.x) !== near(point.y, next.y);
            }));
        if (clipPoints && rectangularClip) {
            clip = { minX: Math.min(...clipPoints.map(p => p.x)), minY: Math.min(...clipPoints.map(p => p.y)),
                maxX: Math.max(...clipPoints.map(p => p.x)), maxY: Math.max(...clipPoints.map(p => p.y)) };
        }
        const link = entity.link || assetMap.get(entity.assetId)?.link;
        if (!cache.has(link)) {
            const image = await readDrawingRasterImage(link, { ...options, maxPixels: 16000000 - totalPixels });
            totalPixels += image.width * image.height; cache.set(link, image);
        }
        const source = cache.get(link);
        let image = { ...source, pixels: applyImageAdjustmentsToPixels(source.pixels.slice(), entity.imageAdjustments) };
        let hasAlpha = false;
        for (let i = 3; i < image.pixels.length; i += 4) if (image.pixels[i] !== 255) { hasAlpha = true; break; }
        if ((!horizontal && !vertical) || !rectangularClip || hasAlpha) {
            const sourceClip = normalizeImageClip(entity.imageClip);
            const polygons = drawingRasterPolygons(image, { clip: sourceClip?.enabled ? sourceClip.points : null,
                maxPolygons: 8192 - totalPolygons });
            totalPolygons += polygons.length;
            const world = point => ({ x: a.x + point.x * (b.x - a.x) + point.y * (d.x - a.x),
                y: a.y + point.x * (b.y - a.y) + point.y * (d.y - a.y) });
            result.set(entity, { kind: 'rasterPolygons', points,
                polygons: polygons.map(polygon => ({ ...polygon, points: polygon.points.map(world) })) });
            continue;
        }
        if (!horizontal) {
            image = transposeDrawingRasterImage(image);
            points = [a, d, c, b];
        }
        const dib = encodeDrawingDib(image, { maxBytes: Math.min(options.maxBytes ?? 64 * 1024 * 1024, 64 * 1024 * 1024) - totalBytes });
        totalBytes += dib.length;
        result.set(entity, { kind: 'image', points, dib, width: image.width, height: image.height, clip });
    }
    return result;
}
