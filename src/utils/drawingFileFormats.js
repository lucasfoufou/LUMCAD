// File formats reachable from the File menu, IMPORT, EXPORT and OPEN, mapped to
// the existing command that handles each one. No format logic lives here: the
// commands keep their own readers, writers, limits and undo behaviour.

const IMAGE_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

/** Formats IMPORT accepts, by extension, with the command that imports them. */
export const DRAWING_IMPORT_FORMATS = Object.freeze([
    { id: 'dwg', extensions: ['dwg'], command: 'DWGIN', desktopOnly: true },
    { id: 'dxf', extensions: ['dxf'], command: 'DXFIN' },
    { id: 'pdf', extensions: ['pdf'], command: 'PDFIMPORT' },
    { id: 'dgn', extensions: ['dgn'], command: 'DGNIMPORT' },
    { id: 'wmf', extensions: ['wmf'], command: 'WMFIN' },
    { id: 'image', extensions: IMAGE_EXTENSIONS, command: 'IMAGEATTACH' },
    { id: 'lcad', extensions: ['lcad'], command: 'BLOCKIMPORT' },
].map(format => Object.freeze({ ...format, extensions: Object.freeze(format.extensions) })));

/** Formats EXPORT writes, in File menu order, with the command that writes them. */
export const DRAWING_EXPORT_FORMATS = Object.freeze([
    { id: 'dxf', command: 'DXFOUT' },
    { id: 'dwg', command: 'DWGOUT', desktopOnly: true },
    { id: 'pdf', command: 'PDF' },
    { id: 'png', command: 'PNGOUT' },
    { id: 'jpg', command: 'JPGOUT' },
    { id: 'svg', command: 'SVGOUT' },
    { id: 'wmf', command: 'WMFOUT' },
    { id: 'dwfx', command: 'DWFXOUT' },
].map(format => Object.freeze(format)));

/** Extensions OPEN accepts: drawings, and DWG/DXF opened as a new imported drawing. */
export const DRAWING_OPEN_EXTENSIONS = Object.freeze(['lcad', 'dwg', 'dxf']);

export function getDrawingFileExtension(name) {
    const match = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
    return match ? match[1].toLowerCase() : '';
}

/** Import format of a file name, or null when IMPORT cannot read it. */
export function resolveDrawingImportFormat(name) {
    const extension = getDrawingFileExtension(name);
    return DRAWING_IMPORT_FORMATS.find(format => format.extensions.includes(extension)) || null;
}

/** 'lcad', 'dwg' or 'dxf' for a file OPEN can handle, otherwise null. */
export function resolveDrawingOpenFormat(name) {
    const extension = getDrawingFileExtension(name);
    return DRAWING_OPEN_EXTENSIONS.includes(extension) ? extension : null;
}

/** Export format named by EXPORT's argument (DXF, JPEG...), or null. */
export function resolveDrawingExportFormat(value) {
    const id = String(value || '').trim().toLowerCase().replace(/^\./, '').replace(/^jpeg$/, 'jpg');
    return DRAWING_EXPORT_FORMATS.find(format => format.id === id) || null;
}

/** Every import extension, for one multi-format picker. */
export function getDrawingImportExtensions({ desktop = true } = {}) {
    return DRAWING_IMPORT_FORMATS.filter(format => desktop || !format.desktopOnly).flatMap(format => format.extensions);
}

/** Drawing name for a file opened through import: its base name without extension. */
export function getDrawingNameFromFile(name, fallback) {
    const base = String(name || '').split(/[\\/]/).filter(Boolean).at(-1) || '';
    return base.replace(/\.[^.]+$/, '').trim().slice(0, 120) || fallback;
}

/** Quotes a native path as one command argument. */
export function quoteDrawingCommandPath(path) {
    return `"${String(path).replace(/"/g, '')}"`;
}
