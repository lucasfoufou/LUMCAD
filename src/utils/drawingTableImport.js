import { invoke } from '@tauri-apps/api/core';
import { open } from '../utils/nativeDialogs.js';
import { chooseBrowserFile, isTauriRuntime } from './lcadStorage.js';
import { normalizeDrawingTable, parseDrawingTableCsv } from './drawingTables.js';
import { resolveRecoveredReferencePath } from './lcadRecoveryReferences.js';

export async function importDrawingTableCsv({ path, delimiter, linked = false, documentPath = null }, filterName) {
    let text; let name;
    if (isTauriRuntime()) {
        path ||= await open({ multiple: false, filters: [{ name: filterName, extensions: ['csv'] }] });
        if (!path) return null;
        const absolute = /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(path);
        const readPath = absolute ? path : resolveRecoveredReferencePath(path, documentPath);
        if (!readPath) throw new Error('importInvalid');
        text = await invoke('read_table_csv', { path: readPath });
        name = path.split(/[\\/]/).at(-1);
    } else {
        if (path) throw new Error('attributeExtractionDesktop');
        const file = await chooseBrowserFile({ accept: '.csv,text/csv' });
        if (!file) return null;
        name = file.name;
        if (file.size > 4 * 1024 * 1024) throw new Error('importInvalid');
        text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    }
    const cells = parseDrawingTableCsv(text, delimiter);
    const table = cells && normalizeDrawingTable({ cells, ...(linked ? { dataLink: { path: path || null, name, delimiter } } : {}) });
    if (!table) throw new Error('importInvalid');
    return table;
}
