import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './lcadStorage.js';
import { loadDrawingSheetSetSources } from './drawingSheetSetSources.js';

/** Reuse the bounded native archive reader and canonical relative-path resolver. */
export async function loadNativeDrawingSheetSetSources(sheetSet, setPath) {
    if (!isTauriRuntime()) throw new Error('sheetSetDesktop');
    return loadDrawingSheetSetSources(sheetSet, setPath, {
        resolvePath: (path, relativeTo) => invoke('resolve_lcad_recovery_path', { path, relativeTo }),
        readBytes: async (path, maxBytes) => {
            const bytes = await invoke('read_lcad_recovery_source', { path, protectedPath: null, maxBytes });
            return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        },
    });
}
