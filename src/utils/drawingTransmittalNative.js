import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { strToU8 } from 'fflate';
import { isTauriRuntime } from './lcadStorage.js';
import { createDrawingTransmittal } from './drawingTransmittal.js';

export async function exportNativeDrawingTransmittal(sheetSet, indexPath, destination, filterName) {
    if (!isTauriRuntime()) throw new Error('sheetSetDesktop');
    const result = await createDrawingTransmittal(sheetSet, indexPath, {
        resolvePath: (path, relativeTo, kind) => invoke(kind === 'csv' ? 'resolve_table_csv_path' : 'resolve_lcad_recovery_path', { path, relativeTo }),
        readBytes: async (path, maxBytes, kind) => {
            if (kind === 'csv') return strToU8(await invoke('read_table_csv', { path }));
            const bytes = await invoke('read_lcad_recovery_source', { path, protectedPath: null, maxBytes });
            return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        },
    });
    const path = destination || await save({ defaultPath: 'sheet-set.zip', filters: [{ name: filterName, extensions: ['zip'] }] });
    if (!path) return null;
    await invoke('write_drawing_transmittal', { path, bytes: Array.from(result.bytes) });
    return { path, ...result.report };
}
