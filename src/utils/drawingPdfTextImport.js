import { createDrawingId } from './drawingDocument.js';
import { createDrawingPdfImportContext } from './drawingPdfImportContext.js';
import { normalizeDrawingAffineFrame } from './drawingAffineFrame.js';
import { normalizeDrawingTextEntity } from './drawingText.js';
import { createI18nError } from '../i18n/translator.js';

export function importDrawingPdfText(document, page, { x = 0, y = 0, scale = 1, reference = null, allowEmpty = false, onImport } = {}) {
    const context = createDrawingPdfImportContext(document, { x, y, scale, reference });
    const { layerId } = context;
    if (page.paths.unsupported.some(value => ['text-font', 'text-clip'].includes(value))) throw createI18nError('pdf.textUnsupported');
    for (const record of page.paths.texts || []) {
        if (!record.visible || !record.text.trim() || !record.fontSize || record.advance <= 0) continue;
        const stroke = record.mode % 4 === 1;
        const alpha = stroke ? record.strokeAlpha : record.fillAlpha;
        if (alpha <= 0) continue;
        if ((stroke ? record.strokeSupported : record.fillSupported) === false) throw createI18nError('pdf.textUnsupported');
        const width = record.advance / record.fontSize;
        if (!Number.isFinite(width) || width <= 0 || width > 1e6) throw createI18nError('pdf.limit');
        const padding = 0.16;
        if (!normalizeDrawingAffineFrame(record.matrix)) throw createI18nError('pdf.textUnsupported');
        // The shared text layout's baseline is fontSize + padding below its top.
        // Keep fontSize in local units and place those units with the PDF matrix,
        // including very small physical text, shear and reflected baselines.
        const entity = normalizeDrawingTextEntity({ id: createDrawingId('text'), type: 'text', layerId,
            x: -padding, y: -1 - padding, width: width + 2 * padding, height: 1.4 + 2 * padding,
            text: record.text, textMode: 'singleLine', fitWidth: true, fontSize: 1, lineHeight: 1.2,
            fontFamily: record.font.family.includes('mono') ? 'monospace' : record.font.family === 'serif' ? 'serif' : 'sans',
            fontWeight: record.font.bold ? 700 : 400, fontStyle: record.font.italic ? 'italic' : 'normal',
            color: stroke ? record.stroke : record.fill, transparency: Math.min(90, Math.round((1 - alpha) * 100)),
            affineFrame: record.matrix });
        const id = context.add(entity, record.clips);
        if (id) onImport?.(id, record.order, 0);
    }
    return context.finish('pdf.noText', allowEmpty);
}
