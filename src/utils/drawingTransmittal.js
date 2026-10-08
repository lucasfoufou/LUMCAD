import { createTranslator } from '../i18n/translator.js';
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
export async function createDrawingTransmittal(input, indexPath, { resolvePath, readBytes, translate = createTranslator(),
    maxFiles = 512, maxEdges = 4096, maxBytes = 300 * 1024 * 1024,
    maxDecodedCharacters = 300 * 1024 * 1024 } = {}) {
    if (typeof resolvePath !== 'function' || typeof readBytes !== 'function'
        || ![maxFiles, maxEdges, maxBytes, maxDecodedCharacters].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('sheetSetInvalid');
    const sheetSet = normalizeDrawingSheetSet(input);
    const files = new Map(); const queue = []; const sourceFiles = new Map(); const references = [];
    let edges = 0; let bytesRead = 0; let decoded = 0;
    let activePath = null;
    const inventory = () => ({ name: sheetSet.name, sheets: sheetSet.sheets.length, bytesRead,
        files: [...files.values()].map(file => ({ sourcePath: file.path, path: `drawings/${file.name}`,
            kind: file.kind, bytes: file.bytesRead ?? null, collected: Boolean(file.collected) })) });
    try {
        const discover = async (path, relativeTo, kind) => {
            activePath = path;
            if (++edges > maxEdges) throw new Error('sheetSetLimit');
            if (typeof path !== 'string' || !path || path.length > 4096 || /[\u0000-\u001f]/.test(path)
                || /^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) throw new Error('sheetSetPath');
            let canonical;
            try { canonical = await resolvePath(path, relativeTo, kind); }
            catch (cause) { throw new Error('sheetSetDependencyUnreadable', { cause }); }
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
            activePath = file.path;
            const remaining = maxBytes - bytesRead;
            if (remaining <= 0) throw new Error('sheetSetLimit');
            let bytes;
            try { bytes = await readBytes(file.path, remaining, file.kind); }
            catch (cause) { throw new Error('sheetSetDependencyUnreadable', { cause }); }
            if (!(bytes instanceof Uint8Array) || bytes.byteLength > remaining || !bytes.byteLength && file.kind === 'drawing') throw new Error('sheetSetLimit');
            bytesRead += bytes.byteLength;
            file.bytesRead = bytes.byteLength;
            if (file.kind === 'csv') { file.bytes = bytes.slice(); file.collected = true; continue; }
            try { file.envelope = readLcadArchive(bytes); }
            catch (cause) { throw new Error('sheetSetDependencyInvalid', { cause }); }
            decoded += JSON.stringify(file.envelope).length;
            if (decoded > maxDecodedCharacters) throw new Error('sheetSetLimit');
            for (const dependency of dependencies(file.envelope.document)) {
                const target = await discover(dependency.target.path, file.path, dependency.kind);
                if (dependency.kind === 'drawing') references.push({ target, expectedId: dependency.target.sourceDocumentId });
                dependency.target.path = target.name;
            }
            file.collected = true;
        }
        for (const reference of references) if (reference.target.envelope.document.id !== reference.expectedId) {
            activePath = reference.target.path;
            throw new Error('sheetSetSourceChanged');
        }
        const sources = new Map();
        for (const source of sheetSet.sources) {
            const file = sourceFiles.get(source.id);
            activePath = file.path;
            if (file.envelope.document.id !== source.documentId) throw new Error('sheetSetSourceChanged');
            source.path = `drawings/${file.name}`;
            sources.set(source.id, file.envelope.document);
        }
        activePath = null;
        prepareDrawingSheetSetPublication(sheetSet, sources);
        const entries = Object.create(null);
        let outputBytes = 0;
        const add = (path, bytes) => {
            if (!path.startsWith('drawings/') && bytes.byteLength > 4 * 1024 * 1024) throw new Error('sheetSetLimit');
            outputBytes += bytes.byteLength;
            if (outputBytes > maxBytes) throw new Error('sheetSetLimit');
            entries[path] = [bytes, { level: 0, mtime: new Date(1980, 0, 1) }];
        };
        for (const file of files.values()) add(`drawings/${file.name}`, file.envelope ? createLcadArchive(file.envelope) : file.bytes);
        add('sheet-set.json', strToU8(JSON.stringify(sheetSet)));
        const report = { format: 'lumcad-transmittal', version: 1, sheets: sheetSet.sheets.length,
            files: [...files.values()].map(file => ({ path: `drawings/${file.name}`, kind: file.kind,
                name: file.path.split(/[\\/]/).at(-1), bytes: file.bytesRead })),
            bytesRead, note: 'Embedded assets and cached reference/table content are retained. Refresh links explicitly after extraction.' };
        add('transmittal.json', strToU8(JSON.stringify(report)));
        add('transmittal.txt', strToU8(formatDrawingTransmittalReport(report, sheetSet.name, translate)));
        return { bytes: zipSync(entries), report, sheetSet, inventory: { ...inventory(), complete: true } };
    } catch (cause) {
        const error = new Error(typeof cause?.message === 'string' ? cause.message : 'sheetSetInvalid', { cause });
        error.transmittalInventory = { ...inventory(), complete: false, issue: {
            path: activePath, code: /^sheetSet[A-Z]/.test(error.message) ? error.message : 'failed',
        } };
        throw error;
    }
}


export function formatDrawingTransmittalReport(report, name, t = createTranslator()) {
    // Keep user-authored labels on one line so they cannot impersonate report sections.
    const label = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ');
    return [t('sheetSet.inventoryTitle'), label(name),
        t('sheetSet.transmittalSummary', { sheets: report.sheets, files: report.files.length }), '',
        ...report.files.map(file => `${label(file.name)} → ${file.path} — ${t(`sheetSet.inventoryKind.${file.kind}`)} — ${t('sheetSet.inventoryBytes', { count: file.bytes })}`),
        '', t('sheetSet.transmittalInstructions'), '',
    ].join('\n');
}
