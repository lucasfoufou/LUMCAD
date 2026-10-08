import { strToU8, zipSync } from 'fflate';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { normalizeDrawingSheetSet, prepareDrawingSheetSetPublication } from './drawingSheetSets.js';

function dependencies(document) {
    const result = [];
    const collections = [document.content.entities, ...document.content.blocks.map(block => block.entities),
        ...document.layouts.map(layout => layout.paperEntities)];
    for (const entities of collections) for (const entity of entities || []) {
        if (entity.externalReference?.path) result.push({ target: entity.externalReference, kind: 'drawing' });
        if (entity.table?.dataLink?.path) result.push({ target: entity.table.dataLink, kind: 'csv' });
        // Browser-linked tables have no retrievable source; their cached cells remain in the drawing.
    }
    return result;
}

/** Build a complete relocated snapshot; originals are read-only and missing dependencies abort. */
export async function createDrawingTransmittal(input, indexPath, { resolvePath, readBytes,
    maxFiles = 512, maxEdges = 4096, maxBytes = 300 * 1024 * 1024,
    maxDecodedCharacters = 300 * 1024 * 1024 } = {}) {
    if (typeof resolvePath !== 'function' || typeof readBytes !== 'function'
        || ![maxFiles, maxEdges, maxBytes, maxDecodedCharacters].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('sheetSetInvalid');
    const sheetSet = normalizeDrawingSheetSet(input);
    const files = new Map(); const queue = []; const sourceFiles = new Map(); const references = [];
    let edges = 0; let bytesRead = 0; let decoded = 0;
    const discover = async (path, relativeTo, kind) => {
        if (++edges > maxEdges) throw new Error('sheetSetLimit');
        if (typeof path !== 'string' || !path || path.length > 4096 || /[\u0000-\u001f]/.test(path)
            || /^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) throw new Error('sheetSetPath');
        const canonical = await resolvePath(path, relativeTo, kind);
        if (typeof canonical !== 'string' || !canonical || canonical.length > 4096 || /[\u0000-\u001f]/.test(canonical)) throw new Error('sheetSetPath');
        const known = files.get(canonical);
        if (known) {
            if (known.kind !== kind) throw new Error('sheetSetInvalid');
            return known;
        }
        if (files.size >= maxFiles) throw new Error('sheetSetLimit');
        const file = { path: canonical, kind, name: `file-${files.size + 1}.${kind === 'drawing' ? 'lcad' : 'csv'}` };
        files.set(canonical, file); queue.push(file);
        return file;
    };
    // Keep even unused declared sources portable rather than leaving machine-local paths behind.
    for (const source of sheetSet.sources) sourceFiles.set(source.id, await discover(source.path, indexPath, 'drawing'));
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const file = queue[cursor];
        const remaining = maxBytes - bytesRead;
        if (remaining <= 0) throw new Error('sheetSetLimit');
        const bytes = await readBytes(file.path, remaining, file.kind);
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > remaining || !bytes.byteLength && file.kind === 'drawing') throw new Error('sheetSetLimit');
        bytesRead += bytes.byteLength;
        if (file.kind === 'csv') { file.bytes = bytes.slice(); continue; }
        file.envelope = readLcadArchive(bytes);
        decoded += JSON.stringify(file.envelope).length;
        if (decoded > maxDecodedCharacters) throw new Error('sheetSetLimit');
        for (const dependency of dependencies(file.envelope.document)) {
            const target = await discover(dependency.target.path, file.path, dependency.kind);
            if (dependency.kind === 'drawing') references.push({ target, expectedId: dependency.target.sourceDocumentId });
            dependency.target.path = target.name;
        }
    }
    for (const reference of references) if (reference.target.envelope.document.id !== reference.expectedId) throw new Error('sheetSetSourceChanged');
    const sources = new Map();
    for (const source of sheetSet.sources) {
        const file = sourceFiles.get(source.id);
        if (file.envelope.document.id !== source.documentId) throw new Error('sheetSetSourceChanged');
        source.path = `drawings/${file.name}`;
        sources.set(source.id, file.envelope.document);
    }
    prepareDrawingSheetSetPublication(sheetSet, sources);
    const entries = Object.create(null);
    let outputBytes = 0;
    const add = (path, bytes) => {
        outputBytes += bytes.byteLength;
        if (outputBytes > maxBytes) throw new Error('sheetSetLimit');
        entries[path] = [bytes, { level: 0, mtime: new Date(1980, 0, 1) }];
    };
    for (const file of files.values()) add(`drawings/${file.name}`, file.envelope ? createLcadArchive(file.envelope) : file.bytes);
    add('sheet-set.json', strToU8(JSON.stringify(sheetSet)));
    const report = { format: 'lumcad-transmittal', version: 1, sheets: sheetSet.sheets.length,
        files: [...files.values()].map(file => ({ path: `drawings/${file.name}`, kind: file.kind })),
        bytesRead, note: 'Embedded assets and cached reference/table content are retained. Refresh links explicitly after extraction.' };
    add('transmittal.json', strToU8(JSON.stringify(report)));
    return { bytes: zipSync(entries), report, sheetSet };
}
