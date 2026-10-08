import { drawingReportText } from './drawingReportExport.js';
import { extractDrawingData, aggregateDrawingData } from './drawingDataExtraction.js';
import { drawingDataReportCells } from './drawingDataCommands.js';
import { normalizeDrawingTable, MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, MAX_TABLE_CELLS } from './drawingTables.js';
import { rebuildDrawingTableEntity } from './drawingTableGeometry.js';

/** Derived quantities exclude tables, including the table being refreshed. */
export function refreshDrawingQuantityTable(content, entity) {
    const table = normalizeDrawingTable(entity.table);
    if (!table?.quantityLink) return entity;
    const { definition, headers } = table.quantityLink;
    try {
        const source = { ...content, entities: content.entities.filter(item => !item.table) };
        const records = extractDrawingData(source, { selectedIds: definition.selectedIds, nested: definition.nested, excludeTables: true });
        const report = aggregateDrawingData(records, definition);
        const rows = drawingDataReportCells(report);
        rows[0] = headers;
        if (rows.length > MAX_TABLE_ROWS || rows[0].length > MAX_TABLE_COLUMNS || rows.length * rows[0].length > MAX_TABLE_CELLS) throw new Error('dataExtractionLimit');
        const cells = rows.map((row, r) => row.map((value, c) => ({ value: typeof value === 'number' ? String(value) : drawingReportText(value),
            ...(table.cells[r]?.[c]?.style ? { style: table.cells[r][c].style } : {}) })));
        const updated = normalizeDrawingTable({ ...table, cells,
            rowHeights: cells.map((_, i) => table.rowHeights[i] ?? table.style.rowHeight),
            merges: [], quantityLink: { ...table.quantityLink, status: records.length ? 'current' : 'empty' } });
        if (!updated) throw new Error('dataExtractionLimit');
        if (JSON.stringify(updated) === JSON.stringify(table)) return entity;
        return rebuildDrawingTableEntity({ ...entity, table: updated });
    } catch (error) {
        const status = error.message === 'dataExtractionDependency' ? 'dependency' : 'limit';
        if (table.quantityLink.status === status) return entity;
        return { ...entity, table: { ...table, quantityLink: { ...table.quantityLink, status } } };
    }
}

/** Recompute derived cells in the source edit's undo step; failed queries retain a marked cache. */
export function refreshDrawingQuantityTables(content) {
    let changed = false;
    const entities = content.entities.map(entity => {
        if (!entity.table?.quantityLink) return entity;
        const updated = refreshDrawingQuantityTable(content, entity);
        changed ||= updated !== entity;
        return updated;
    });
    return changed ? { ...content, entities } : content;
}
