import { importDrawingPdfGeometry } from './drawingPdfImport.js';
import { importDrawingPdfFills } from './drawingPdfFillImport.js';
import { importDrawingPdfText } from './drawingPdfTextImport.js';
import { importDrawingPdfImages } from './drawingPdfImageImport.js';
import { createI18nError } from '../i18n/translator.js';

/** Stage all categories before committing, retaining the PDF painter's order. */
export function importDrawingPdfCombined(document, page, options = {}) {
    const order = new Map();
    const onImport = (id, position, phase) => {
        if (!Number.isSafeInteger(position) || position < 0) throw createI18nError('pdf.invalid');
        order.set(id, { position, phase });
    };
    let result = document;
    for (const importer of [importDrawingPdfFills, importDrawingPdfGeometry, importDrawingPdfText, importDrawingPdfImages]) {
        result = importer(result, page, { ...options, allowEmpty: true, onImport });
    }
    if (!order.size) throw createI18nError('pdf.noObjects');
    const imported = result.content.entities.filter(entity => order.has(entity.id));
    imported.sort((a, b) => order.get(a.id).position - order.get(b.id).position || order.get(a.id).phase - order.get(b.id).phase);
    return { ...result, content: { ...result.content, entities: [...document.content.entities, ...imported] },
        selectedIds: imported.map(entity => entity.id), report: { imported: imported.length, unsupported: page.paths.unsupported || [] } };
}
