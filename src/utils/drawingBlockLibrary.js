import { validateDrawingBlockGraph } from './drawingBlockEditing.js';
import { createI18nError } from '../i18n/translator.js';
import { createDrawingId, normalizeDrawingContent } from './drawingDocument.js';
import { createLcadDocument, createLcadEnvelope, normalizeLcadDocument } from './lcadDocument.js';
import { createLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, pasteDrawingClipboardPayload, DRAWING_CLIPBOARD_LIMITS } from './drawingClipboard.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference } from './drawingBlocks.js';
import { findNamedDrawingBlock, normalizeDrawingBlockName } from './drawingNamedBlocks.js';
import { normalizeDrawingBasePoint } from './drawingBasePoint.js';

// The library uses archive image limits rather than the smaller OS clipboard budget.
const LIBRARY_LIMITS = Object.freeze({ ...DRAWING_CLIPBOARD_LIMITS,
    bytes: 300 * 1024 * 1024, stringLength: 36 * 1024 * 1024, assets: 512,
    entities: 100000, blockEntities: 100000,
});

export function createDrawingBlockLibrary(document, { selector = null, selectedIds = [] } = {}) {
    assertLibraryGraph(document);
    const source = normalizeLcadDocument(document);
    let entryIds;
    if (selector?.toUpperCase() === 'LIBRARY') {
        entryIds = source.content.blocks.filter(block => !block.name.startsWith('*')).map(block => block.id);
    } else if (selector && selector.toUpperCase() !== 'SELECTION') {
        const block = findNamedDrawingBlock(source.content, selector);
        if (!block) throw createI18nError('block.error.missing');
        entryIds = [block.id];
    } else {
        const ids = selectedIds.length ? selectedIds : source.content.entities.map(entity => entity.id);
        if (!ids.length) throw createI18nError('block.error.selection');
        const payload = createDrawingClipboardPayload(source, ids, { limits: LIBRARY_LIMITS });
        const block = createAnonymousDrawingBlock(payload.entities, {
            basePoint: normalizeDrawingBasePoint(source.content.metadata?.basePoint),
            name: libraryBlockName(source.name),
        });
        source.content.blocks.push(block);
        entryIds = [block.id];
    }
    if (!entryIds.length) throw createI18nError('block.error.emptyLibrary');
    return exportEntries(source, entryIds);
}

export function importDrawingBlockLibrary(target, document) {
    assertLibraryGraph(document);
    let source = normalizeLcadDocument(document);
    const marker = source.content.metadata?.blockLibrary;
    let entryIds;
    if (marker !== undefined) {
        if (marker?.version !== 1 || !Array.isArray(marker.entryBlockIds) || !marker.entryBlockIds.length
            || marker.entryBlockIds.length > 1024 || marker.entryBlockIds.some(id => !source.content.blocks.some(block => block.id === id))) {
            throw createI18nError('block.error.invalidLibrary');
        }
        entryIds = [...new Set(marker.entryBlockIds)];
    } else if (source.content.entities.length) {
        source = createDrawingBlockLibrary(source);
        entryIds = source.content.metadata.blockLibrary.entryBlockIds;
    } else {
        entryIds = source.content.blocks.filter(block => !block.name.startsWith('*')).map(block => block.id);
    }
    if (!entryIds.length) throw createI18nError('block.error.emptyLibrary');
    const styles = mergeLibraryTextStyles(target.content.textStyles, source.content.textStyles);
    source.content = { ...source.content, blocks: source.content.blocks.map(block => ({ ...block,
        entities: block.entities.map(entity => remapTextStyle(entity, styles.idMap)),
    })) };
    const payload = entriesPayload(source, entryIds);
    const pasted = pasteDrawingClipboardPayload(target, payload, { mode: 'original', limits: LIBRARY_LIMITS });
    if (pasted.content.blocks.length > 1024 || pasted.content.blocks.reduce((total, block) => total + block.entities.length, 0) > 100000) {
        throw createI18nError('block.error.limit');
    }
    const content = normalizeDrawingContent({ ...pasted.content, entities: target.content.entities, textStyles: styles.styles });
    const result = { content, assets: pasted.assets, entryBlockIds: entryIds.map(id => pasted.blockIdMap.get(id)) };
    // Validate combined manifest/assets before the caller commits any resources.
    createLcadArchive(createLcadEnvelope({ ...target, content, assets: result.assets }));
    return result;
}

export function parseBlockExportInput(input) {
    const text = String(input || '').trim();
    if (!text) return { selector: null, path: null };
    const match = text.match(/^(?:"([^"]+)"|(\S+))(?:\s+TO\s+([\s\S]+))?$/i);
    if (!match) return null;
    if (match[2]?.toUpperCase() === 'TO' && !match[3]) return null;
    return { selector: match[1] || match[2], path: match[3]?.trim().replace(/^"(.*)"$/, '$1') || null };
}

function exportEntries(source, entryIds) {
    const payload = entriesPayload(source, entryIds);
    const first = source.content.blocks.find(block => block.id === entryIds[0]);
    const document = createLcadDocument({ name: entryIds.length === 1 ? first.name : source.name });
    document.content = normalizeDrawingContent({ ...document.content,
        blocks: payload.blocks, entities: payload.entities, layers: payload.layers,
        textStyles: source.content.textStyles,
        dimensionStyles: payload.dimensionStyles,
        metadata: { ...document.content.metadata, blockLibrary: { version: 1, entryBlockIds: entryIds } },
    });
    document.assets = payload.assets;
    return document;
}

function entriesPayload(source, entryIds) {
    const refs = entryIds.map(id => createAnonymousDrawingBlockReference(findNamedDrawingBlock(source.content, id), {
        id: createDrawingId('library-entry'), layerId: 'geometry',
    }));
    return createDrawingClipboardPayload({ ...source, content: { ...source.content, entities: refs } }, refs.map(reference => reference.id), {
        basePoint: { x: 0, y: 0 }, limits: LIBRARY_LIMITS,
    });
}

function libraryBlockName(value) {
    return normalizeDrawingBlockName(String(value || '').replace(/[\u0000-\u001f<>/\\":;?*|=]/g, '_').slice(0, 128)) || 'Block';
}

function mergeLibraryTextStyles(existing = [], incoming = []) {
    const styles = [...existing];
    const idMap = new Map();
    for (const style of incoming) {
        const matching = styles.find(candidate => candidate.id === style.id && JSON.stringify(candidate) === JSON.stringify(style));
        if (matching) { idMap.set(style.id, matching.id); continue; }
        const id = styles.some(candidate => candidate.id === style.id) ? createDrawingId('text-style') : style.id;
        let name = style.name;
        let suffix = 2;
        while (styles.some(candidate => candidate.name.toLowerCase() === name.toLowerCase())) name = `${style.name} (${suffix++})`;
        styles.push({ ...style, id, name });
        idMap.set(style.id, id);
    }
    return { styles, idMap };
}

function remapTextStyle(entity, idMap) {
    return { ...entity,
        ...(entity.textStyleId && idMap.has(entity.textStyleId) ? { textStyleId: idMap.get(entity.textStyleId) } : {}),
        ...(Array.isArray(entity.parts) ? { parts: entity.parts.map(part => remapTextStyle(part, idMap)) } : {}),
    };
}

function assertLibraryGraph(document) {
    const blocks = document?.content?.blocks || [];
    if (!Array.isArray(blocks) || blocks.some(block => !block || !Array.isArray(block.entities))) throw createI18nError('block.error.invalidLibrary');
    const error = validateDrawingBlockGraph(blocks);
    if (error) throw createI18nError(`block.error.${error}`);
}
