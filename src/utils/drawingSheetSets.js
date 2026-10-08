import { createDrawingId } from './drawingDocument.js';

const MAX_SOURCES = 256;
const MAX_SHEETS = 1000;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

function text(value, maximum = 128, empty = false) {
    if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f]/.test(value) || !empty && !value.trim()) throw new Error('sheetSetInvalid');
    return value.trim();
}

function metadata(value = {}) {
    if (!plain(value) || Object.keys(value).length > 128) throw new Error('sheetSetInvalid');
    return Object.fromEntries(Object.entries(value).map(([key, content]) => [text(key), text(content, 4096, true)]));
}

function unique(values, key, insensitive = false) {
    const names = values.map(value => insensitive ? value[key].toLowerCase() : value[key]);
    if (new Set(names).size !== names.length) throw new Error('sheetSetDuplicate');
}

/** A portable project index: drawings stay independent and retain their document/layout identities. */
export function normalizeDrawingSheetSet(input) {
    if (!plain(input) || input.format !== 'lumcad-sheet-set' || input.version !== 1
        || !Array.isArray(input.sources) || input.sources.length > MAX_SOURCES
        || !Array.isArray(input.sheets) || input.sheets.length > MAX_SHEETS) throw new Error('sheetSetInvalid');
    const sources = input.sources.map(source => {
        if (!plain(source)) throw new Error('sheetSetInvalid');
        const path = text(source.path, 4096);
        // Paths can be project-relative or native absolute paths, never remote URLs.
        if (!/\.lcad$/i.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) throw new Error('sheetSetPath');
        return { id: text(source.id), path, documentId: text(source.documentId) };
    });
    unique(sources, 'id');
    const sourceIds = new Set(sources.map(source => source.id));
    const sheets = input.sheets.map(sheet => {
        if (!plain(sheet)) throw new Error('sheetSetInvalid');
        const sourceId = text(sheet.sourceId);
        if (!sourceIds.has(sourceId)) throw new Error('sheetSetSource');
        return { id: text(sheet.id), sourceId, layoutId: text(sheet.layoutId), number: text(sheet.number),
            title: text(sheet.title, 512), properties: metadata(sheet.properties) };
    });
    unique(sheets, 'id'); unique(sheets, 'number', true);
    const result = { format: 'lumcad-sheet-set', version: 1, id: text(input.id), name: text(input.name, 512),
        properties: metadata(input.properties), sources, sheets };
    // Bound combined metadata before serializing the complete project index.
    let remaining = 4 * 1024 * 1024;
    const measure = value => {
        remaining -= typeof value === 'string' ? JSON.stringify(value).length : 2;
        if (remaining < 0) throw new Error('sheetSetLimit');
        if (Array.isArray(value)) value.forEach(item => { remaining -= 1; measure(item); });
        else if (plain(value)) Object.entries(value).forEach(([key, item]) => { remaining -= 2; measure(key); measure(item); });
    };
    measure(result);
    return result;
}

export function createDrawingSheetSet(name) {
    return normalizeDrawingSheetSet({ format: 'lumcad-sheet-set', version: 1, id: createDrawingId('sheet-set'), name, sources: [], sheets: [] });
}

export function parseDrawingSheetSet(input) {
    if (typeof input !== 'string' || input.length > 4 * 1024 * 1024) throw new Error('sheetSetLimit');
    return normalizeDrawingSheetSet(JSON.parse(input));
}

/** Batch changes are validated together, allowing number swaps without intermediate collisions. */
export function editDrawingSheetSet(input, changes) {
    const set = normalizeDrawingSheetSet(input);
    if (!Array.isArray(changes) || !changes.length || changes.length > MAX_SHEETS) throw new Error('sheetSetInvalid');
    for (const change of changes) {
        if (!plain(change)) throw new Error('sheetSetInvalid');
        if (change.type === 'source') {
            const index = set.sources.findIndex(source => source.id === change.source?.id);
            if (index < 0) set.sources.push(structuredClone(change.source));
            else set.sources[index] = structuredClone(change.source);
        } else if (change.type === 'sheet') {
            const index = set.sheets.findIndex(sheet => sheet.id === change.sheet?.id);
            if (index < 0) set.sheets.push(structuredClone(change.sheet));
            else set.sheets[index] = structuredClone(change.sheet);
        } else if (change.type === 'removeSheet' || change.type === 'removeSource') {
            const key = change.type === 'removeSheet' ? 'sheets' : 'sources';
            if (!set[key].some(value => value.id === change.id)) throw new Error('sheetSetMissing');
            set[key] = set[key].filter(value => value.id !== change.id);
        } else if (change.type === 'properties') {
            const targets = change.ids === null ? [set] : Array.isArray(change.ids) ? set.sheets.filter(sheet => change.ids.includes(sheet.id)) : [];
            if (!targets.length || change.ids !== null && (new Set(change.ids).size !== change.ids.length || targets.length !== change.ids.length)) throw new Error('sheetSetMissing');
            for (const target of targets) target.properties = { ...target.properties, ...metadata(change.properties) };
        } else if (change.type === 'order') {
            if (!Array.isArray(change.ids) || change.ids.length !== set.sheets.length || new Set(change.ids).size !== change.ids.length) throw new Error('sheetSetOrder');
            const byId = new Map(set.sheets.map(sheet => [sheet.id, sheet]));
            if (change.ids.some(id => !byId.has(id))) throw new Error('sheetSetOrder');
            set.sheets = change.ids.map(id => byId.get(id));
        } else throw new Error('sheetSetInvalid');
    }
    return normalizeDrawingSheetSet(set);
}

/** Resolve the entire publication before rendering any page; never publish a silent partial set. */
export function prepareDrawingSheetSetPublication(input, loadedSources) {
    const set = normalizeDrawingSheetSet(input);
    if (!(loadedSources instanceof Map) || !set.sheets.length) throw new Error('sheetSetEmpty');
    const sources = new Map(set.sources.map(source => [source.id, source]));
    return set.sheets.map((sheet, index) => {
        const source = sources.get(sheet.sourceId);
        const document = loadedSources.get(sheet.sourceId);
        if (!document || document.id !== source.documentId) throw new Error('sheetSetSourceChanged');
        const matches = (document.layouts || []).filter(layout => layout.id === sheet.layoutId);
        if (matches.length !== 1) throw new Error('sheetSetLayoutMissing');
        return { sheetId: sheet.id, sourceId: source.id, documentId: document.id, layoutId: sheet.layoutId,
            index: index + 1, number: sheet.number, title: sheet.title, properties: { ...set.properties, ...sheet.properties } };
    });
}
