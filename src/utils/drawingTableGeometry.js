import { normalizeDrawingTable, evaluateDrawingTable } from './drawingTables.js';
import { normalizeDrawingTextEntity } from './drawingText.js';
import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices, transformAffinePoint } from './drawingAffine.js';
import { normalizeDrawingAffineFrame } from './drawingAffineFrame.js';

/** Materialize cells as native text and line parts with deterministic sub-entity IDs. */
export function rebuildDrawingTableEntity(entity) {
    const table = normalizeDrawingTable(entity?.table);
    const transform = normalizeDrawingAffineFrame(entity?.table?.transform || IDENTITY_AFFINE_MATRIX);
    if (!table || !transform) return null;
    const values = evaluateDrawingTable(table);
    const xs = [0]; const ys = [0];
    table.columnWidths.forEach(width => xs.push(xs.at(-1) + width));
    table.rowHeights.forEach(height => ys.push(ys.at(-1) + height));
    const rows = table.cells.length; const columns = table.cells[0].length;
    const mergeAt = (row, column) => table.merges.find(merge => row >= merge.row && row < merge.row + merge.rows && column >= merge.column && column < merge.column + merge.columns);
    const parts = [];
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
        const merge = mergeAt(row, column);
        if (merge && (merge.row !== row || merge.column !== column)) continue;
        const style = { ...table.style, ...table.cells[row][column].style };
        const width = xs[column + (merge?.columns || 1)] - xs[column];
        const height = ys[row + (merge?.rows || 1)] - ys[row];
        const padding = Math.min(style.padding, width / 4, height / 4);
        const result = values[row][column];
        parts.push(normalizeDrawingTextEntity({ id: `${entity.id}:cell:${row}:${column}`, type: 'text', layerId: entity.layerId,
            x: xs[column] + padding, y: ys[row] + padding, width: width - padding * 2, height: height - padding * 2,
            text: result.error || result.value, textMode: 'multiline', wrapMode: 'word', fontSize: style.fontSize, fontFamily: 'sans-serif',
            fontWeight: (style.bold ?? (row < table.style.headerRows && style.headerBold)) ? 'bold' : 'normal', horizontalAlign: style.alignment, color: style.color, affineFrame: transform }));
    }
    const addLine = (x1, y1, x2, y2, id) => {
        const a = transformAffinePoint({ x: x1, y: y1 }, transform); const b = transformAffinePoint({ x: x2, y: y2 }, transform);
        parts.push({ id: `${entity.id}:grid:${id}`, type: 'line', layerId: entity.layerId, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
            color: table.style.gridColor, lineWeight: table.style.lineWeight, lineType: 'continuous' });
    };
    for (let row = 0; row <= rows; row += 1) for (let column = 0; column < columns; column += 1) {
        if (table.merges.some(merge => row > merge.row && row < merge.row + merge.rows && column >= merge.column && column < merge.column + merge.columns)) continue;
        addLine(xs[column], ys[row], xs[column + 1], ys[row], `h:${row}:${column}`);
    }
    for (let column = 0; column <= columns; column += 1) for (let row = 0; row < rows; row += 1) {
        if (table.merges.some(merge => column > merge.column && column < merge.column + merge.columns && row >= merge.row && row < merge.row + merge.rows)) continue;
        addLine(xs[column], ys[row], xs[column], ys[row + 1], `v:${column}:${row}`);
    }
    const { points, boundaries, linework, revisionSymbol, splineDefinition, array, ...rest } = entity;
    return { ...rest, type: 'polyline', parts, closed: false, table: { ...table, transform } };
}

export function transformDrawingTableEntity(entity, matrix) {
    const rebuilt = rebuildDrawingTableEntity(entity);
    return rebuilt ? rebuildDrawingTableEntity({ ...rebuilt, table: { ...rebuilt.table, transform: multiplyAffineMatrices(matrix, rebuilt.table.transform) } }) : null;
}
