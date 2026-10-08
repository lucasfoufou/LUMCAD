import { canEditEntity } from './drawingDocument.js';
import { normalizeDrawingTable } from './drawingTables.js';
import { rebuildDrawingTableEntity } from './drawingTableGeometry.js';

/** Replace linked values while retaining placement, formatting and surviving dimensions. */
export function refreshDrawingTableDefinition(source, incoming) {
    const table = normalizeDrawingTable(source); const loaded = normalizeDrawingTable(incoming);
    if (!table || !loaded?.dataLink) return null;
    const rows = loaded.cells.length; const columns = loaded.cells[0].length;
    return normalizeDrawingTable({ ...table, dataLink: loaded.dataLink,
        cells: loaded.cells.map((row, r) => row.map((cell, c) => ({ value: cell.value,
            ...(table.cells[r]?.[c]?.style ? { style: table.cells[r][c].style } : {}) }))),
        rowHeights: Array.from({ length: rows }, (_, row) => table.rowHeights[row] ?? table.style.rowHeight),
        columnWidths: Array.from({ length: columns }, (_, column) => table.columnWidths[column] ?? table.style.columnWidth),
        merges: table.merges.filter(merge => merge.row + merge.rows <= rows && merge.column + merge.columns <= columns),
    });
}

export function updateDrawingTableLinks(content, updates) {
    if (!updates.length || new Set(updates.map(update => update.id)).size !== updates.length) return { error: 'linkSelection' };
    const replacements = new Map();
    for (const update of updates) {
        const source = content.entities.find(entity => entity.id === update.id);
        if (!source?.table || !canEditEntity(content, source)) return { error: 'linkSelection' };
        let table;
        if (update.detach) {
            table = normalizeDrawingTable(source.table);
            if (table) delete table.dataLink;
        } else table = refreshDrawingTableDefinition(source.table, update.table);
        const entity = table && rebuildDrawingTableEntity({ ...source, table });
        if (!entity) return { error: 'invalid' };
        replacements.set(source.id, entity);
    }
    return { content: { ...content, entities: content.entities.map(entity => replacements.get(entity.id) || entity) }, selectedIds: [...replacements.keys()] };
}
