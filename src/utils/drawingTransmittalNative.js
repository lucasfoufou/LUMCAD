import { invoke } from '@tauri-apps/api/core';
import { save } from '../utils/nativeDialogs.js';
import { strToU8 } from 'fflate';
import { isTauriRuntime } from './lcadStorage.js';
import { createDrawingTransmittal } from './drawingTransmittal.js';

export async function inspectNativeDrawingTransmittal(sheetSet, indexPath, translate) {
    if (!isTauriRuntime()) throw new Error('sheetSetDesktop');
    return createDrawingTransmittal(sheetSet, indexPath, {
        translate,
        resolvePath: (path, relativeTo, kind) => invoke(kind === 'csv' ? 'resolve_table_csv_path' : 'resolve_lcad_recovery_path', { path, relativeTo }),
        readBytes: async (path, maxBytes, kind) => {
            if (kind === 'csv') return strToU8(await invoke('read_table_csv', { path }));
            const bytes = await invoke('read_lcad_recovery_source', { path, protectedPath: null, maxBytes });
            return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        },
    });
}

export async function exportNativeDrawingTransmittal(sheetSet, indexPath, destination, filterName, translate) {
    const result = await inspectNativeDrawingTransmittal(sheetSet, indexPath, translate);
    const path = destination || await save({ defaultPath: 'sheet-set.zip', filters: [{ name: filterName, extensions: ['zip'] }] });
    if (!path) return null;
    await invoke('write_drawing_transmittal', { path, bytes: Array.from(result.bytes) });
    return { path, ...result.report, inventory: result.inventory };
}
