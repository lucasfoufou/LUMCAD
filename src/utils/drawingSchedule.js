import { createDrawingId } from './drawingDocument.js';
import { createDrawingTable } from './drawingTableCommands.js';

/** Count schedules share the editable table model, styles and CSV workflow. */
export function createDrawingSchedule(content, cells, origin, name) {
    if (!Array.isArray(cells) || !cells.length || cells.length > 201 || !Array.isArray(cells[0]) || !cells[0].length || cells[0].length > 8
        || cells.some(row => !Array.isArray(row) || row.length !== cells[0].length || row.some(cell => typeof cell !== 'string' || cell.length > 256))) return null;
    const widths = cells[0].map((_, column) => Math.max(1, ...cells.map(row => [...row[column]].length * 0.18 + 0.3)));
    const result = createDrawingTable(content, { cells, columnWidths: widths }, origin);
    if (result.error) return null;
    const id = createDrawingId('group');
    const group = { id, name: `${name} ${id}`, entityIds: result.selectedIds, selectable: true };
    return { ...result, content: { ...result.content, groups: [...(content.groups || []), group] } };
}
