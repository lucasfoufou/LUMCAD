import { normalizeDrawingQuantityLink } from './drawingDataDefinitions.js';
import { normalizeDrawingAffineFrame } from './drawingAffineFrame.js';
import { evaluateDrawingExpression } from './drawingPrecisionInput.js';

export const MAX_TABLE_ROWS = 256;
export const MAX_TABLE_COLUMNS = 64;
export const MAX_TABLE_CELLS = 4096;
export const DEFAULT_TABLE_STYLE = Object.freeze({ name: 'Standard', fontSize: 0.25, padding: 0.1, rowHeight: 0.6, columnWidth: 2,
    color: '#172033', gridColor: '#172033', lineWeight: 1, headerRows: 1, headerBold: true, alignment: 'left' });

export function normalizeDrawingTableStyle(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const style = { ...DEFAULT_TABLE_STYLE };
    style.name = String(value.name || 'Standard').trim().slice(0, 128) || 'Standard';
    for (const key of ['fontSize', 'rowHeight', 'columnWidth', 'lineWeight']) {
        if (Number.isFinite(value[key]) && value[key] > 1e-6 && value[key] <= 1e6) style[key] = value[key];
    }
    if (Number.isFinite(value.padding) && value.padding >= 0 && value.padding <= 1e6) style.padding = value.padding;
    for (const key of ['color', 'gridColor']) if (/^#[0-9a-f]{6}$/i.test(value[key])) style[key] = value[key].toLowerCase();
    if (Number.isInteger(value.headerRows) && value.headerRows >= 0 && value.headerRows <= MAX_TABLE_ROWS) style.headerRows = value.headerRows;
    if (typeof value.headerBold === 'boolean') style.headerBold = value.headerBold;
    if (['left', 'center', 'right'].includes(value.alignment)) style.alignment = value.alignment;
    return style;
}

export function normalizeDrawingTableDataLink(value) {
    if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 256
        || ![',', ';', '\t'].includes(value.delimiter)) return null;
    const path = value.path ?? null;
    if (path !== null && (typeof path !== 'string' || path.length > 4096 || /[\u0000-\u001f]/.test(path)
        || /^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path) || !/\.csv$/i.test(path))) return null;
    return { name: value.name.trim(), path, delimiter: value.delimiter };
}

export function normalizeDrawingTableCellStyle(value = {}) {
    const style = {};
    if (!value || typeof value !== 'object') return style;
    if (Number.isFinite(value.fontSize) && value.fontSize > 1e-6 && value.fontSize <= 1e6) style.fontSize = value.fontSize;
    if (Number.isFinite(value.padding) && value.padding >= 0 && value.padding <= 1e6) style.padding = value.padding;
    if (/^#[0-9a-f]{6}$/i.test(value.color)) style.color = value.color.toLowerCase();
    if (['left', 'center', 'right'].includes(value.alignment)) style.alignment = value.alignment;
    if (typeof value.bold === 'boolean') style.bold = value.bold;
    return style;
}

export function tableCellAddress(row, column) {
    let label = ''; let value = column + 1;
    while (value > 0) { label = String.fromCharCode(65 + (value - 1) % 26) + label; value = Math.floor((value - 1) / 26); }
    return `${label}${row + 1}`;
}

export function parseTableCellAddress(address) {
    const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,3})$/i.exec(String(address));
    if (!match) return null;
    const column = [...match[1].toUpperCase()].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
    const row = Number(match[2]) - 1;
    return row < MAX_TABLE_ROWS && column < MAX_TABLE_COLUMNS ? { row, column } : null;
}

export function normalizeDrawingTable(value) {
    if (!value || !Array.isArray(value.cells) || !value.cells.length || value.cells.length > MAX_TABLE_ROWS) return null;
    const columns = value.cells[0]?.length;
    if (!columns || columns > MAX_TABLE_COLUMNS || columns * value.cells.length > MAX_TABLE_CELLS) return null;
    if (value.cells.some(row => !Array.isArray(row) || row.length !== columns)) return null;
    const cells = value.cells.map(row => row.map(cell => {
        const source = typeof cell === 'string' || typeof cell === 'number' ? { value: String(cell) } : cell;
        if (!source || typeof source.value !== 'string' || source.value.length > 4096) return null;
        const style = normalizeDrawingTableCellStyle(source.style);
        return { value: source.value, ...(Object.keys(style).length ? { style } : {}) };
    }));
    if (cells.some(row => row.some(cell => !cell))) return null;
    const style = normalizeDrawingTableStyle(value.style);
    const dimensions = (input, count, fallback) => input === undefined ? Array(count).fill(fallback)
        : Array.isArray(input) && input.length === count && input.every(size => Number.isFinite(size) && size > 1e-6 && size <= 1e6) ? [...input] : null;
    const rowHeights = dimensions(value.rowHeights, cells.length, style.rowHeight);
    const columnWidths = dimensions(value.columnWidths, columns, style.columnWidth);
    if (!rowHeights || !columnWidths) return null;
    const merges = []; const occupied = new Set();
    if (value.merges !== undefined && !Array.isArray(value.merges)) return null;
    for (const merge of value.merges || []) {
        const { row, column, rows, columns: width } = merge || {};
        if (![row, column, rows, width].every(Number.isInteger) || row < 0 || column < 0 || rows < 1 || width < 1
            || row + rows > cells.length || column + width > columns || rows * width < 2) return null;
        for (let r = row; r < row + rows; r += 1) for (let c = column; c < column + width; c += 1) {
            const key = `${r}:${c}`;
            if (occupied.has(key)) return null;
            occupied.add(key);
        }
        merges.push({ row, column, rows, columns: width });
    }
    const transform = value.transform === undefined ? null : normalizeDrawingAffineFrame(value.transform);
    if (value.transform !== undefined && !transform) return null;
    const dataLink = normalizeDrawingTableDataLink(value.dataLink);
    const quantityLink = normalizeDrawingQuantityLink(value.quantityLink);
    if (value.quantityLink && (!quantityLink || dataLink || columns !== quantityLink.headers.length)) return null;
    return { cells, style, rowHeights, columnWidths, merges, ...(transform ? { transform } : {}), ...(dataLink ? { dataLink } : {}), ...(quantityLink ? { quantityLink } : {}) };
}

/** Formula results are derived; source values remain untouched and cycles are explicit. */
export function evaluateDrawingTable(table) {
    const normalized = normalizeDrawingTable(table);
    if (!normalized) return null;
    const values = new Map(); const visiting = new Set();
    const evaluate = (row, column, depth = 0) => {
        const key = tableCellAddress(row, column);
        if (values.has(key)) return values.get(key);
        if (visiting.has(key) || depth > 128) return { error: '#CYCLE!' };
        const cell = normalized.cells[row]?.[column];
        if (!cell) return { error: '#REF!' };
        if (!cell.value.startsWith('=')) {
            const result = { value: cell.value, number: cell.value.trim() !== '' && Number.isFinite(Number(cell.value)) ? Number(cell.value) : null };
            values.set(key, result); return result;
        }
        visiting.add(key);
        const reference = address => {
            const target = parseTableCellAddress(address);
            if (!target) throw new Error('#REF!');
            const result = evaluate(target.row, target.column, depth + 1);
            if (result.error) throw new Error(result.error);
            if (result.number === null && result.value !== '') throw new Error('#VALUE!');
            return result.number || 0;
        };
        let result;
        try {
            let expression = cell.value.slice(1).toUpperCase();
            if (expression.length > 512) throw new Error('#FORMULA!');
            expression = expression.replace(/\b(SUM|AVERAGE|MIN|MAX|COUNT)\(\s*(\$?[A-Z]+\$?\d+)\s*:\s*(\$?[A-Z]+\$?\d+)\s*\)/g, (_, fn, first, last) => {
                const a = parseTableCellAddress(first); const b = parseTableCellAddress(last);
                if (!a || !b) throw new Error('#REF!');
                const numbers = [];
                for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r += 1) for (let c = Math.min(a.column, b.column); c <= Math.max(a.column, b.column); c += 1) {
                    const item = evaluate(r, c, depth + 1);
                    if (item.error) throw new Error(item.error);
                    if (item.number !== null) numbers.push(item.number);
                }
                const sum = numbers.reduce((total, value) => total + value, 0);
                const value = fn === 'COUNT' ? numbers.length : fn === 'SUM' ? sum : !numbers.length ? 0
                    : fn === 'AVERAGE' ? sum / numbers.length : fn === 'MIN' ? Math.min(...numbers) : Math.max(...numbers);
                return `(${value})`;
            });
            expression = expression.replace(/(?<![A-Z0-9_.])\$?[A-Z]{1,3}\$?[1-9]\d{0,3}\b/g, address => `(${reference(address)})`);
            const number = evaluateDrawingExpression(expression);
            result = { value: String(Number(number.toPrecision(12))), number };
        } catch (error) { result = { error: /^#(REF|VALUE|CYCLE)!$/.test(error.message) ? error.message : '#FORMULA!' }; }
        visiting.delete(key); values.set(key, result); return result;
    };
    return normalized.cells.map((row, r) => row.map((_, c) => evaluate(r, c)));
}

export function parseDrawingTableCsv(text, delimiter = ',') {
    if (typeof text !== 'string' || text.length > 4 * 1024 * 1024 || ![',', ';', '\t'].includes(delimiter)) return null;
    text = text.replace(/^\uFEFF/, '');
    const rows = []; let row = []; let cell = ''; let quoted = false; let afterQuote = false;
    const pushCell = () => { row.push(cell); cell = ''; afterQuote = false; return row.length <= MAX_TABLE_COLUMNS; };
    const pushRow = () => { rows.push(row); row = []; return rows.length <= MAX_TABLE_ROWS; };
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (quoted) {
            if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
            else if (char === '"') { quoted = false; afterQuote = true; }
            else cell += char;
        } else if (char === delimiter) { if (!pushCell()) return null; }
        else if (char === '\r' || char === '\n') {
            if (char === '\r' && text[index + 1] === '\n') index += 1;
            if (!pushCell() || !pushRow()) return null;
        } else if (char === '"' && !cell && !afterQuote) quoted = true;
        else if (afterQuote || char === '"') return null;
        else cell += char;
        if (cell.length > 4096) return null;
    }
    if (quoted) return null;
    if (cell || row.length || afterQuote || !rows.length) { if (!pushCell() || !pushRow()) return null; }
    const columns = Math.max(...rows.map(row => row.length));
    if (rows.length * columns > MAX_TABLE_CELLS) return null;
    return rows.map(row => [...row, ...Array(columns - row.length).fill('')]);
}

export function drawingTableToCsv(table, { delimiter = ',', formulas = false } = {}) {
    const normalized = normalizeDrawingTable(table);
    if (!normalized || ![',', ';', '\t'].includes(delimiter)) return null;
    const evaluated = formulas ? null : evaluateDrawingTable(normalized);
    return normalized.cells.map((row, r) => row.map((cell, c) => {
        const text = formulas ? cell.value : evaluated[r][c].error || evaluated[r][c].value;
        return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(delimiter)).join('\r\n');
}

export function editDrawingTableDefinition(source, edit) {
    const table = normalizeDrawingTable(source);
    if (!table || !edit || table.quantityLink && ['cell', 'merge', 'unmerge'].includes(edit.action)) return null;
    if (edit.action === 'detachQuantity') {
        if (!table.quantityLink) return null;
        delete table.quantityLink;
    } else if (edit.action === 'cell') {
        const target = parseTableCellAddress(edit.address);
        if (!target || !table.cells[target.row]?.[target.column] || typeof edit.value !== 'string') return null;
        table.cells[target.row][target.column] = { ...table.cells[target.row][target.column], value: edit.value };
    } else if (edit.action === 'cellStyle') {
        const target = parseTableCellAddress(edit.address);
        const cell = target && table.cells[target.row]?.[target.column];
        if (!cell) return null;
        if (edit.style === null) delete cell.style;
        else cell.style = normalizeDrawingTableCellStyle({ ...cell.style, ...edit.style });
    } else if (edit.action === 'merge') {
        const first = parseTableCellAddress(edit.first); const last = parseTableCellAddress(edit.last);
        if (!first || !last) return null;
        table.merges.push({ row: Math.min(first.row, last.row), column: Math.min(first.column, last.column),
            rows: Math.abs(last.row - first.row) + 1, columns: Math.abs(last.column - first.column) + 1 });
    } else if (edit.action === 'unmerge') {
        const target = parseTableCellAddress(edit.address);
        if (!target) return null;
        table.merges = table.merges.filter(merge => !(target.row >= merge.row && target.row < merge.row + merge.rows
            && target.column >= merge.column && target.column < merge.column + merge.columns));
    } else if (edit.action === 'rowHeight' || edit.action === 'columnWidth') {
        const sizes = edit.action === 'rowHeight' ? table.rowHeights : table.columnWidths;
        if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= sizes.length) return null;
        sizes[edit.index] = edit.value;
    } else if (edit.action === 'style') table.style = normalizeDrawingTableStyle(edit.style);
    else return null;
    return normalizeDrawingTable(table);
}

export function normalizeDrawingTableStyles(values) {
    const styles = [normalizeDrawingTableStyle()];
    for (const value of Array.isArray(values) ? values.slice(0, 128) : []) {
        const style = normalizeDrawingTableStyle(value);
        const index = styles.findIndex(entry => entry.name.toLowerCase() === style.name.toLowerCase());
        if (index >= 0) styles[index] = style;
        else if (styles.length < 128) styles.push(style);
    }
    return styles;
}
