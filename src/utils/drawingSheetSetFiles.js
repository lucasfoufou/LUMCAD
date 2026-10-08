import { save } from '@tauri-apps/plugin-dialog';
import { isTauriRuntime } from './lcadStorage.js';
import { readDrawingJsonFile } from './drawingJsonFiles.js';
import { exportDrawingText } from './drawingTextExport.js';
import { parseDrawingSheetSet } from './drawingSheetSets.js';
import { relocateDrawingSheetSet } from './drawingSheetSetPaths.js';

export async function readDrawingSheetSetFile(path, filterName) {
    const loaded = await readDrawingJsonFile(path, filterName, 'sheetSet');
    return loaded ? { sheetSet: parseDrawingSheetSet(loaded.text), path: loaded.path } : null;
}

export async function writeDrawingSheetSetFile(sheetSet, previousPath, destinationPath, filterName) {
    let path = destinationPath || null;
    if (isTauriRuntime()) {
        path ||= await save({ defaultPath: previousPath || 'sheet-set.json', filters: [{ name: filterName, extensions: ['json'] }] });
        if (!path) return null;
    } else if (path) throw new Error('sheetSetDesktop');
    const prepared = relocateDrawingSheetSet(sheetSet, previousPath, path);
    // The native reader's limit is in UTF-8 bytes, including non-ASCII metadata.
    const text = JSON.stringify(prepared);
    if (new TextEncoder().encode(text).length > 4 * 1024 * 1024) throw new Error('sheetSetLimit');
    const written = await exportDrawingText({ text, format: 'json', path, name: 'sheet-set', filterName });
    return written ? { sheetSet: prepared, path } : null;
}
