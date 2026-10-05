import { createDrawingId } from './drawingDocument.js';
import { normalizeDrawingHatch } from './drawingAdvancedEntities.js';
import { closeDrawingPdfPath } from './drawingPdfGeometry.js';
import { createDrawingPdfImportContext } from './drawingPdfImportContext.js';

export function importDrawingPdfFills(document, page, options = {}) {
    const context = createDrawingPdfImportContext(document, options);
    for (const record of page.paths.records) {
        const paint = record.paint.toLowerCase();
        if (!record.visible || !paint.includes('fill') || record.fillAlpha <= 0 || record.fillSupported === false) continue;
        const entity = normalizeDrawingHatch({ id: createDrawingId('hatch'), type: 'hatch', layerId: context.layerId,
            boundaries: record.paths.map(closeDrawingPdfPath), pattern: { name: 'solid' },
            fillRule: paint.includes('eo') ? 'evenodd' : 'nonzero', boundaryStroke: false,
            color: record.fill, transparency: Math.min(90, Math.round((1 - record.fillAlpha) * 100)) });
        const id = context.add(entity, record.clips);
        if (id) options.onImport?.(id, record.order, 0);
    }
    const result = context.finish('pdf.noFills', options.allowEmpty);
    return { ...result, report: { ...result.report, unsupported: page.paths.unsupported || [] } };
}
