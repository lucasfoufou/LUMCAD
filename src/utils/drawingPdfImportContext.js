import { drawingClipShapeBounds, drawingClipShapeFromPoints, drawingClipShapeIntersectsBounds, drawingClipShapePolygons } from './drawingClipPaths.js';
import { canEditEntity } from './drawingDocument.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference, refreshDrawingBlockBounds, transformDrawingEntityAffine } from './drawingBlocks.js';
import { drawingBlockClipShape, drawingClipContainsPoint, normalizeDrawingBlockClip } from './drawingBlockClip.js';
import { getEntityBounds } from './drawingGeometry.js';
import { closeDrawingPdfPath } from './drawingPdfGeometry.js';
import { createI18nError } from '../i18n/translator.js';

/** Shared native clipping and placement for imported PDF text, fills and images. */
export function createDrawingPdfImportContext(document, options = {}) {
    const { x = 0, y = 0, scale = 1, reference = null } = options;
    const layerId = document.content.activeLayerId;
    if (!canEditEntity(document.content, { layerId })) throw createI18nError('block.error.layer');
    if (![x, y, scale].every(Number.isFinite) || scale <= 0 || scale > 1e9) throw createI18nError('pdf.placement');
    const matrix = reference?.transform || { a: scale, b: 0, c: 0, d: scale, e: x, f: y };
    if (!['a', 'b', 'c', 'd', 'e', 'f'].every(key => Number.isFinite(matrix[key]))) throw createI18nError('pdf.placement');
    const blocks = [...document.content.blocks]; const entities = [];
    const extra = drawingBlockClipShape(reference);
    const clipCache = new WeakMap();
    let remainingChecks = 1000000;
    const add = (input, sourceClips = []) => {
        if (sourceClips.some(clip => !clip.paths.length)) return false;
        let entity = input;
        const pendingBlocks = [];
        const clips = sourceClips.map(clip => {
            if (clipCache.has(clip)) return clipCache.get(clip);
            const paths = clip.paths.map(closeDrawingPdfPath);
            const polygon = paths.length === 1 && paths[0].parts.every(part => part.type === 'line')
                ? normalizeDrawingBlockClip({ points: paths[0].parts.map(part => ({ x: part.x1, y: part.y1 })) }) : null;
            const normalized = polygon ? { ...polygon, ...drawingClipShapeFromPoints(polygon.points) }
                : normalizeDrawingBlockClip({ paths, rule: clip.rule });
            if (!normalized) throw createI18nError('pdf.clipUnsupported');
            if (!normalized.points && drawingClipShapePolygons(normalized).length !== normalized.paths.length) throw createI18nError('pdf.limit');
            clipCache.set(clip, normalized); return normalized;
        });
        if (extra) clips.push(extra);
        for (const clip of clips) {
            const points = clip.points;
            remainingChecks -= clip.paths.reduce((sum, path) => sum + path.parts.length, 0) * 5;
            if (remainingChecks < 0) throw createI18nError('pdf.limit');
            const bounds = getEntityBounds(entity);
            const { minX, minY, maxX, maxY } = drawingClipShapeBounds(clip);
            if (!bounds || bounds.maxX < minX || bounds.minX > maxX || bounds.maxY < minY || bounds.minY > maxY) { entity = null; break; }
            if (!points) {
                const budget = { checks: remainingChecks };
                const visible = drawingClipShapeIntersectsBounds(clip, bounds, budget);
                remainingChecks = budget.checks;
                if (remainingChecks < 0) throw createI18nError('pdf.limit');
                if (!visible) { entity = null; break; }
            }
            const corners = [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }];
            if (points && isConvex(points) && corners.every(point => drawingClipContainsPoint(points, point))) continue;
            const definition = createAnonymousDrawingBlock([entity]);
            pendingBlocks.push(definition);
            if (blocks.length + pendingBlocks.length > 1024 || pendingBlocks.length >= 32) throw createI18nError('pdf.limit');
            entity = { ...createAnonymousDrawingBlockReference(definition, { layerId }), blockClip: points ? { enabled: true, points } : { enabled: true, paths: clip.paths, rule: clip.rule } };
        }
        if (!entity) return false;
        entity = transformDrawingEntityAffine(entity, matrix);
        const bounds = getEntityBounds(entity);
        if (!bounds || !Object.values(bounds).every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) throw createI18nError('pdf.placement');
        blocks.push(...pendingBlocks);
        entities.push(entity);
        if (document.content.entities.length + entities.length > 100000) throw createI18nError('pdf.limit');
        return entity.id;
    };
    const finish = (emptyError, allowEmpty = false) => {
        if (!entities.length && !allowEmpty) throw createI18nError(emptyError);
        if (blocks.reduce((sum, block) => sum + block.entities.length, 0) > 100000) throw createI18nError('pdf.limit');
        return { ...document, content: refreshDrawingBlockBounds({ ...document.content, blocks, entities: [...document.content.entities, ...entities] }),
            selectedIds: entities.map(entity => entity.id), report: { imported: entities.length } };
    };
    return { layerId, add, finish };
}

function isConvex(points) {
    let sign = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]; const b = points[(i + 1) % points.length]; const c = points[(i + 2) % points.length];
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (Math.abs(cross) < 1e-12) continue;
        if (sign && Math.sign(cross) !== sign) return false;
        sign = Math.sign(cross);
    }
    return Boolean(sign);
}
