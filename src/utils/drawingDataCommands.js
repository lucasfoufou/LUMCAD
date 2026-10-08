import { createDrawingId } from './drawingDocument.js';
import { normalizeDrawingDataDefinition, normalizeDrawingDataDefinitions } from './drawingDataDefinitions.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { extractDrawingData, aggregateDrawingData } from './drawingDataExtraction.js';
import { drawingReportText, serializeDrawingReportCsv } from './drawingReportExport.js';
import { createDrawingTable } from './drawingTableCommands.js';
import { MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, MAX_TABLE_CELLS } from './drawingTables.js';

export function parseDrawingDataInput(input, command = 'dataExtract') {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return null;
    const options = { action: command === 'countTable' ? 'TABLE' : 'LIST', selected: false, nested: false,
        groupBy: ['type', 'layer', 'block'], sums: command === 'dataExtract' ? ['length', 'area'] : [], path: null, point: null };
    if (command === 'countTable') tokens.unshift('TABLE');
    const used = new Set();
    while (tokens.length) {
        const token = tokens.shift().toUpperCase();
        const key = ['LIST', 'CSV', 'JSON', 'XLS', 'TABLE'].includes(token) ? 'action' : ['ALL', 'SELECTED'].includes(token) ? 'scope' : token;
        if (used.has(key)) return null;
        used.add(key);
        if (key === 'action') {
            options.action = token;
            if (token === 'TABLE') {
                const raw = tokens.splice(0, 2);
                if (raw.length !== 2 || raw.some(value => !value.trim() || !Number.isFinite(Number(value)))) return null;
                options.point = { x: Number(raw[0]), y: Number(raw[1]) };
            }
        } else if (key === 'scope') options.selected = token === 'SELECTED';
        else if (token === 'NESTED') options.nested = true;
        else if (token === 'LINKED') options.linked = true;
        else if (['GROUP', 'SUM'].includes(token)) {
            const raw = tokens.shift();
            if (!raw) return null;
            const fields = raw.toUpperCase() === 'NONE' ? [] : raw.split(',');
            if (fields.some(field => !field) || new Set(fields).size !== fields.length) return null;
            options[token === 'GROUP' ? 'groupBy' : 'sums'] = fields;
        } else if (token === 'TO') { options.path = tokens.shift(); if (!options.path) return null; }
        else return null;
    }
    if (options.linked && options.action !== 'TABLE') return null;
    if (options.path && !['CSV', 'JSON', 'XLS'].includes(options.action)) return null;
    return options;
}

export function prepareDrawingDataReport(content, selectedIds, options) {
    const records = extractDrawingData(content, { selectedIds: options.selected ? selectedIds : null, nested: options.nested, excludeTables: Boolean(options.linked) });
    if (!records.length) throw new Error('dataExtractionEmpty');
    return aggregateDrawingData(records, options);
}

export function drawingDataReportCells(report) {
    return [[...report.groupBy, 'Count', ...report.sumFields.flatMap(field => [`${field} (${field === 'area' ? 'm²' : 'm'})`, `${field}:measured`])],
        ...report.rows.map(row => [...row.values, row.count, ...report.sumFields.flatMap(field => [row.sums[field], row.measured[field]])])];
}

export function serializeDrawingDataReport(report, format) {
    if (format === 'CSV') return serializeDrawingReportCsv(drawingDataReportCells(report));
    if (format !== 'JSON') throw new Error('dataExtractionFields');
    const text = JSON.stringify(report, null, 2);
    if (new TextEncoder().encode(text).length > 64 * 1024 * 1024) throw new Error('dataExtractionLimit');
    return text;
}

export function insertDrawingDataTable(content, report, point, { label = null, quantityDefinition = null } = {}) {
    const rows = drawingDataReportCells(report);
    if (rows.length > MAX_TABLE_ROWS || rows[0].length > MAX_TABLE_COLUMNS || rows.length * rows[0].length > MAX_TABLE_CELLS) return { error: 'dataExtractionLimit' };
    if (label) rows[0] = [...report.groupBy.map(label), label('count'),
        ...report.sumFields.flatMap(field => [`${label(field)} (${field === 'area' ? 'm²' : 'm'})`, `${label('measured')} — ${label(field)}`])];
    const cells = rows.map(row => row.map(value => typeof value === 'number' ? String(value) : drawingReportText(value)));
    if (cells.some(row => row.some(value => value.length > 4096))) return { error: 'dataExtractionLimit' };
    const columnWidths = cells[0].map((_, column) => Math.min(20, Math.max(2, ...cells.map(row => [...row[column]].length * 0.16 + 0.3))));
    const quantityLink = quantityDefinition ? { definition: quantityDefinition, headers: cells[0], status: 'current' } : null;
    return createDrawingTable(content, { cells, columnWidths, ...(quantityLink ? { quantityLink } : {}) }, point);
}


/** Saved definitions contain query settings only, never destinations or old quantities. */
export function manageDrawingDataDefinition(content, selectedIds, input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return null;
    const action = tokens[0]?.toUpperCase();
    if (!['SAVE', 'RUN', 'DELETE', 'DEFINITIONS'].includes(action)) return null;
    const definitions = normalizeDrawingDataDefinitions(content.dataExtractions);
    if (action === 'DEFINITIONS' && tokens.length === 1) return { definitions };
    const name = tokens[1]?.trim();
    if (!name || name.length > 128) return { error: 'syntax' };
    const existing = definitions.find(item => item.name.toLowerCase() === name.toLowerCase());
    const tail = tokens.slice(2);
    if (action === 'DELETE') {
        if (tail.length || !existing) return { error: 'definitionMissing' };
        return { content: { ...content, dataExtractions: definitions.filter(item => item.id !== existing.id) } };
    }
    const options = parseDrawingDataInput(tail.map(token => JSON.stringify(token)).join(' '));
    if (!options) return { error: 'syntax' };
    if (action === 'SAVE') {
        if (options.action !== 'LIST' || options.path || !existing && definitions.length >= 128) return { error: 'syntax' };
        const definition = normalizeDrawingDataDefinition({ id: existing?.id || createDrawingId('extraction'), name,
            groupBy: options.groupBy, sums: options.sums, nested: options.nested, selectedIds: options.selected ? selectedIds : null });
        if (!definition) return { error: 'dataExtractionFields' };
        return { content: { ...content, dataExtractions: existing
            ? definitions.map(item => item.id === existing.id ? definition : item) : [...definitions, definition] } };
    }
    if (action === 'RUN') {
        if (!existing) return { error: 'definitionMissing' };
        // RUN can choose output but must not silently replace the persisted scope or quantities.
        const outputTokens = [...tail];
        while (outputTokens.length) {
            const option = outputTokens.shift().toUpperCase();
            if (option === 'TABLE') outputTokens.splice(0, 2);
            else if (option === 'TO') outputTokens.shift();
            else if (!['LIST', 'CSV', 'JSON', 'XLS', 'LINKED'].includes(option)) return { error: 'syntax' };
        }
        const currentIds = new Set(content.entities.map(entity => entity.id));
        if (existing.selectedIds?.some(id => !currentIds.has(id))) return { error: 'definitionSelectionMissing' };
        return { options: { ...options, groupBy: existing.groupBy, sums: existing.sums, nested: existing.nested,
            selected: existing.selectedIds !== null }, selectedIds: existing.selectedIds || [] };
    }
    return { error: 'syntax' };
}
