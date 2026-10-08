import { canEditEntity, createDrawingId, getLayer } from './drawingDocument.js';
import { isDrawingLayerVisible } from './drawingLayers.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { drawingTableToCsv, editDrawingTableDefinition, normalizeDrawingTable, normalizeDrawingTableStyles, normalizeDrawingTableStyle, MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, MAX_TABLE_CELLS } from './drawingTables.js';
import { rebuildDrawingTableEntity } from './drawingTableGeometry.js';

export function parseDrawingTableCreation(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens || ![2, 4].includes(tokens.length)) return null;
    const [rows, columns, rowHeight = 0.6, columnWidth = 2] = tokens.map(Number);
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > MAX_TABLE_ROWS || columns < 1 || columns > MAX_TABLE_COLUMNS || rows * columns > MAX_TABLE_CELLS) return null;
    return normalizeDrawingTable({ cells: Array.from({ length: rows }, () => Array(columns).fill('')), rowHeights: Array(rows).fill(rowHeight), columnWidths: Array(columns).fill(columnWidth) });
}

export function parseDrawingTableImport(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (tokens?.shift()?.toUpperCase() !== 'CSV') return null;
    let path = null; let delimiter = ',';
    const used = new Set();
    while (tokens.length) {
        const key = tokens.shift().toUpperCase();
        if (used.has(key)) return null;
        used.add(key);
        if (key === 'FROM') { path = tokens.shift(); if (!path) return null; }
        else if (key === 'DELIMITER') {
            delimiter = { COMMA: ',', SEMICOLON: ';', TAB: '\t' }[tokens.shift()?.toUpperCase()];
            if (!delimiter) return null;
        } else return null;
    }
    return { path, delimiter };
}

/** Read-only export: locked tables may be exported without changing their contents. */
export function prepareDrawingTableExport(content, selectedIds, input = '') {
    const source = selectedIds.length === 1 && content.entities.find(entity => entity.id === selectedIds[0]);
    if (!source?.table) return { error: 'exportSelection' };
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return { error: 'exportSyntax' };
    let formulas = false; let delimiter = ','; let path = null;
    const used = new Set();
    while (tokens.length) {
        const option = tokens.shift().toUpperCase();
        const key = ['VALUES', 'FORMULAS'].includes(option) ? 'mode' : option;
        if (used.has(key)) return { error: 'exportSyntax' };
        used.add(key);
        if (key === 'mode') formulas = option === 'FORMULAS';
        else if (option === 'DELIMITER') {
            delimiter = { COMMA: ',', SEMICOLON: ';', TAB: '\t' }[tokens.shift()?.toUpperCase()];
            if (!delimiter) return { error: 'exportSyntax' };
        } else if (option === 'TO') {
            path = tokens.shift();
            if (!path) return { error: 'exportSyntax' };
        } else return { error: 'exportSyntax' };
    }
    const table = normalizeDrawingTable(source.table);
    if (!table) return { error: 'invalid' };
    // BOM supports spreadsheet UTF-8 detection, including a single empty cell.
    return { text: `\uFEFF${drawingTableToCsv(table, { formulas, delimiter })}`, format: 'csv', path, name: 'table' };
}

export function createDrawingTable(content, table, point) {
    const layer = getLayer(content, content.activeLayerId);
    if (!isDrawingLayerVisible(layer) || layer.locked) return { error: 'layer' };
    if (![point?.x, point?.y].every(Number.isFinite)) return { error: 'invalid' };
    const entity = rebuildDrawingTableEntity({ id: createDrawingId('table'), layerId: layer.id, table: { ...table, transform: { a: 1, b: 0, c: 0, d: 1, e: point.x, f: point.y } } });
    if (!entity) return { error: 'invalid' };
    return { content: { ...content, entities: [...content.entities, entity] }, selectedIds: [entity.id] };
}

export function parseDrawingTableEdit(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens?.length) return null;
    const action = tokens.shift().toUpperCase();
    if (action === 'DETACHQUANTITIES' && !tokens.length) return { action: 'detachQuantity' };
    if (action === 'CELL' && tokens.length === 2) return { action: 'cell', address: tokens[0], value: tokens[1] };
    if (action === 'FORMAT') {
        const address = tokens.shift();
        if (!address || !tokens.length) return null;
        if (tokens.length === 1 && tokens[0].toUpperCase() === 'RESET') return { action: 'cellStyle', address, style: null };
        const style = {}; const used = new Set();
        while (tokens.length) {
            const key = tokens.shift().toUpperCase(); const value = tokens.shift();
            if (value === undefined || used.has(key)) return null;
            used.add(key);
            if (['FONT', 'PADDING'].includes(key) && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e6 && (key === 'PADDING' || Number(value) > 1e-6)) style[key === 'FONT' ? 'fontSize' : 'padding'] = Number(value);
            else if (key === 'COLOR' && /^#[0-9a-f]{6}$/i.test(value)) style.color = value;
            else if (key === 'ALIGN' && ['left', 'center', 'right'].includes(value.toLowerCase())) style.alignment = value.toLowerCase();
            else if (key === 'BOLD' && ['ON', 'OFF'].includes(value.toUpperCase())) style.bold = value.toUpperCase() === 'ON';
            else return null;
        }
        return { action: 'cellStyle', address, style };
    }
    if (action === 'MERGE' && tokens.length === 2) return { action: 'merge', first: tokens[0], last: tokens[1] };
    if (action === 'UNMERGE' && tokens.length === 1) return { action: 'unmerge', address: tokens[0] };
    if (['ROWHEIGHT', 'COLWIDTH'].includes(action) && tokens.length === 2) return { action: action === 'ROWHEIGHT' ? 'rowHeight' : 'columnWidth', index: Number(tokens[0]) - 1, value: Number(tokens[1]) };
    return null;
}

export function editDrawingTable(content, selectedIds, edit) {
    if (selectedIds.length !== 1) return { error: 'selection' };
    const source = content.entities.find(entity => entity.id === selectedIds[0]);
    if (!source?.table || !canEditEntity(content, source)) return { error: 'selection' };
    const table = editDrawingTableDefinition(source.table, edit);
    const entity = table && rebuildDrawingTableEntity({ ...source, table });
    if (!entity) return { error: 'invalid' };
    return { content: { ...content, entities: content.entities.map(value => value.id === source.id ? entity : value) }, selectedIds: [source.id] };
}

export function runDrawingTableStyle(content, input, selectedIds = []) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return { error: 'styleSyntax' };
    const action = (tokens.shift() || 'LIST').toUpperCase();
    const styles = normalizeDrawingTableStyles(content.tableStyles);
    if (action === 'LIST' && !tokens.length) return { names: styles.map(style => style.name) };
    const name = tokens.shift();
    if (!name) return { error: 'styleSyntax' };
    const index = styles.findIndex(style => style.name.toLowerCase() === name.toLowerCase());
    if (action === 'APPLY' && !tokens.length) return index < 0 ? { error: 'styleMissing' } : editDrawingTable(content, selectedIds, { action: 'style', style: styles[index] });
    if (action === 'DELETE' && !tokens.length) {
        if (index < 0 || name.toLowerCase() === 'standard') return { error: 'styleMissing' };
        return { content: { ...content, tableStyles: styles.filter((_, i) => i !== index) }, selectedIds };
    }
    if (action !== 'SET') return { error: 'styleSyntax' };
    const style = { ...(styles[index] || normalizeDrawingTableStyle()), name };
    const numeric = { FONT: 'fontSize', PADDING: 'padding', ROWHEIGHT: 'rowHeight', COLWIDTH: 'columnWidth', LINEWEIGHT: 'lineWeight', HEADERS: 'headerRows' };
    while (tokens.length) {
        const key = tokens.shift().toUpperCase(); const value = tokens.shift();
        if (value === undefined) return { error: 'styleSyntax' };
        if (numeric[key]) {
            const number = Number(value);
            if (!Number.isFinite(number) || number < 0 || number > 1e6 || !['PADDING', 'HEADERS'].includes(key) && number <= 1e-6
                || key === 'HEADERS' && (!Number.isInteger(number) || number > 256)) return { error: 'styleSyntax' };
            style[numeric[key]] = number;
        } else if (['COLOR', 'GRIDCOLOR'].includes(key) && /^#[0-9a-f]{6}$/i.test(value)) style[key === 'COLOR' ? 'color' : 'gridColor'] = value;
        else if (key === 'ALIGN' && ['left', 'center', 'right'].includes(value.toLowerCase())) style.alignment = value.toLowerCase();
        else if (key === 'BOLD' && ['ON', 'OFF'].includes(value.toUpperCase())) style.headerBold = value.toUpperCase() === 'ON';
        else return { error: 'styleSyntax' };
    }
    if (index < 0 && styles.length >= 128) return { error: 'styleLimit' };
    const normalized = normalizeDrawingTableStyle(style);
    return { content: { ...content, tableStyles: index < 0 ? [...styles, normalized] : styles.map((entry, i) => i === index ? normalized : entry) }, selectedIds };
}
