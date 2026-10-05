import { canEditEntity, createDrawingId, DRAWING_LINE_WEIGHT_OPTIONS } from './drawingDocument.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';
import { drawingBlockClipShape } from './drawingBlockClip.js';
import { drawingPdfSnapEntities } from './drawingPdfUnderlay.js';
import { createI18nError } from '../i18n/translator.js';

/** Import the geometry category independently of PDF text, images and solid fills. */
export function importDrawingPdfGeometry(document, page, { x = 0, y = 0, scale = 1, reference = null, allowEmpty = false, onImport } = {}) {
    const layerId = document.content.activeLayerId;
    if (!canEditEntity(document.content, { layerId })) throw createI18nError('block.error.layer');
    if (![x, y, scale].every(Number.isFinite) || scale <= 0 || scale > 1e9) throw createI18nError('pdf.placement');
    const matrix = reference?.transform || { a: scale, b: 0, c: 0, d: scale, e: x, f: y };
    if (!Object.values(matrix).every(Number.isFinite)) throw createI18nError('pdf.placement');
    const extraClip = drawingBlockClipShape(reference);
    const entities = [];
    const report = { imported: 0, ignoredFills: 0, ignoredText: page.text?.items?.filter(item => item.str?.trim()).length || 0,
        unsupported: [...(page.paths.unsupported || [])] };
    // Share a total clipping budget across the page rather than allowing each
    // small path to consume a fresh full budget.
    const budget = { remaining: 1000000 };
    for (const record of page.paths.records) {
        if (!record.visible) continue;
        if (record.paint.toLowerCase().includes('fill') && record.fillAlpha > 0) report.ignoredFills++;
        if (!record.paint.toLowerCase().includes('stroke') || record.strokeAlpha <= 0 || record.strokeSupported === false) continue;
        const parts = drawingPdfSnapEntities([{ ...record, paint: 'stroke',
            clips: extraClip ? [...record.clips, extraClip] : record.clips }], { budget });
        const weight = Number(record.width) || 1;
        const appearance = { color: /^#[0-9a-f]{6}$/i.test(record.stroke) ? record.stroke : '#000000',
            lineWeight: DRAWING_LINE_WEIGHT_OPTIONS.reduce((best, value) => Math.abs(value - weight) < Math.abs(best - weight) ? value : best, 1),
            lineType: record.dash?.length ? 'dashed' : 'continuous', transparency: Math.min(90, Math.round((1 - record.strokeAlpha) * 100)) };
        for (const part of parts) {
            const entity = transformDrawingEntityAffine({ ...part, id: createDrawingId(part.type), layerId, ...appearance }, matrix);
            const coordinates = entity.type === 'line' ? [entity.x1, entity.y1, entity.x2, entity.y2] : entity.controlPoints.flatMap(point => [point.x, point.y]);
            if (!coordinates.every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) throw createI18nError('pdf.placement');
            entities.push(entity);
            onImport?.(entity.id, record.order, 1);
            if (entities.length > 100000 || document.content.entities.length + entities.length > 100000) throw createI18nError('pdf.limit');
        }
    }
    if (!entities.length && !allowEmpty) throw createI18nError('pdf.noGeometry');
    report.imported = entities.length;
    return { ...document, content: { ...document.content, entities: [...document.content.entities, ...entities] },
        selectedIds: entities.map(entity => entity.id), report };
}
