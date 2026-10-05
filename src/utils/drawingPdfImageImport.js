import { createDrawingId } from './drawingDocument.js';
import { createDrawingPdfImportContext } from './drawingPdfImportContext.js';
import { normalizeDrawingAffineFrame } from './drawingAffineFrame.js';
import { createI18nError } from '../i18n/translator.js';

export function importDrawingPdfImages(document, page, options = {}) {
    const context = createDrawingPdfImportContext(document, options);
    const assets = [...document.assets];
    const cached = new Map(assets.map(asset => [asset.link, asset]));
    for (const record of page.paths.images || []) {
        if (!record.visible || record.alpha <= 0) continue;
        if (!record.image?.link || !normalizeDrawingAffineFrame(record.matrix)) throw createI18nError('pdf.imageUnsupported');
        const asset = cached.get(record.image.link) || { id: createDrawingId('asset'), name: `PDF ${assets.length + 1}`,
            mimeType: 'image/png', ...record.image };
        const entity = { id: createDrawingId('image'), type: 'image', layerId: context.layerId, assetId: asset.id,
            x: 0, y: 0, width: 1, height: 1, rotation: 0, affineFrame: record.matrix,
            opacity: record.alpha, transparency: 0, ...(record.interpolate === false ? { imageRendering: 'pixelated' } : {}) };
        const id = context.add(entity, record.clips);
        if (id) options.onImport?.(id, record.order, 0);
        if (id && !cached.has(asset.link)) {
            assets.push(asset); cached.set(asset.link, asset);
            if (assets.length > 512) throw createI18nError('pdf.limit');
        }
    }
    const result = context.finish('pdf.noImages', options.allowEmpty);
    return { ...result, assets, report: { ...result.report, unsupported: page.paths.unsupported || [] } };
}
