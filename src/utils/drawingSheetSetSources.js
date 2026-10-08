import { readLcadArchive } from './lcadArchive.js';
import { normalizeDrawingSheetSet, prepareDrawingSheetSetPublication } from './drawingSheetSets.js';

/** Read each physical source once and resolve the complete set before rendering or publishing. */
export async function loadDrawingSheetSetSources(input, setPath, { resolvePath, readBytes,
    maxBytes = 300 * 1024 * 1024, maxDocumentCharacters = 300 * 1024 * 1024 } = {}) {
    if (typeof resolvePath !== 'function' || typeof readBytes !== 'function'
        || ![maxBytes, maxDocumentCharacters].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('sheetSetInvalid');
    const sheetSet = normalizeDrawingSheetSet(input);
    const needed = new Set(sheetSet.sheets.map(sheet => sheet.sourceId));
    if (!needed.size) throw new Error('sheetSetEmpty');
    const physical = new Map(); const sources = new Map(); const paths = new Map();
    let totalBytes = 0; let documentCharacters = 0;
    for (const source of sheetSet.sources.filter(source => needed.has(source.id))) {
        const path = await resolvePath(source.path, setPath);
        if (typeof path !== 'string' || !path || path.length > 4096) throw new Error('sheetSetPath');
        let document = physical.get(path);
        if (!document) {
            const remaining = maxBytes - totalBytes;
            if (remaining <= 0) throw new Error('sheetSetLimit');
            const bytes = await readBytes(path, remaining);
            if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.byteLength > remaining) throw new Error('sheetSetLimit');
            totalBytes += bytes.byteLength;
            document = readLcadArchive(bytes).document;
            documentCharacters += JSON.stringify(document).length;
            if (documentCharacters > maxDocumentCharacters) throw new Error('sheetSetLimit');
            physical.set(path, document);
        }
        if (document.id !== source.documentId) throw new Error('sheetSetSourceChanged');
        sources.set(source.id, document); paths.set(source.id, path);
    }
    return { sheetSet, sources, paths, pages: prepareDrawingSheetSetPublication(sheetSet, sources), totalBytes };
}
