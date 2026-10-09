import { invoke } from '@tauri-apps/api/core';
import { open } from '../utils/nativeDialogs.js';
import { chooseBrowserFile, isTauriRuntime } from './lcadStorage.js';
import { drawingDwfxBytes, drawingDwfxDataUrl, MAX_DWFX_SOURCE_BYTES } from './drawingDwfxSource.js';

export async function openDrawingDwfSource(path = null) {
    if (isTauriRuntime()) {
        const selected = path || await open({ multiple: false, directory: false, filters: [{ name: 'DWFx', extensions: ['dwfx'] }] });
        if (!selected) return null;
        const source = await invoke('read_dwfx_source', { path: selected });
        return { ...source, bytes: drawingDwfxBytes(source.link) };
    }
    if (path) throw new Error('dwfxDesktop');
    const file = await chooseBrowserFile({ accept: '.dwfx,model/vnd.dwfx+xps' });
    if (!file) return null;
    if (file.size > MAX_DWFX_SOURCE_BYTES) throw new Error('dwfxLimit');
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { name: file.name, path: null, link: drawingDwfxDataUrl(bytes), bytes };
}
