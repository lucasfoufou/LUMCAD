import { prepareDrawingSheetSetPublication } from './drawingSheetSets.js';

/** Each sheet owns its render key, even when drawings share layout IDs or repeat a layout. */
export function drawingSheetSetRenderEntries(sheetSet, sources) {
    return prepareDrawingSheetSetPublication(sheetSet, sources).map(page => {
        const drawing = sources.get(page.sourceId);
        const layout = drawing.layouts.find(item => item.id === page.layoutId);
        return { key: page.sheetId, drawing, layout: { ...layout, name: `${page.number} — ${page.title}` } };
    });
}
