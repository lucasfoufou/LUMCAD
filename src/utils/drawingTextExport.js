import { downloadBrowserBlob } from './browserDownload.js';
import { invoke } from '@tauri-apps/api/core';
import { save } from '../utils/nativeDialogs.js';
import { isTauriRuntime } from './lcadStorage.js';

/** Shared atomic desktop export and browser download for UTF-8 CSV/JSON and binary XLS reports. */
export async function exportDrawingText({ text, bytes = null, format, path, name, filterName }) {
    if (isTauriRuntime()) {
        path ||= await save({ defaultPath: `${name}.${format}`, filters: [{ name: filterName, extensions: [format] }] });
        if (!path) return false;
        if (format === 'xls') await invoke('write_spreadsheet_export', { path, bytes: Array.from(bytes) });
        else await invoke('write_attribute_export', { path, text, format });
    } else {
        if (path) throw new Error('attributeExtractionDesktop');
        const blob = new Blob([bytes || text], { type: format === 'xls' ? 'application/vnd.ms-excel' : format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
        downloadBrowserBlob(blob, `${name}.${format}`);
    }
    return true;
}
