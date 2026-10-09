import { invoke } from '@tauri-apps/api/core';
import { open } from '../utils/nativeDialogs.js';
import { chooseBrowserFile, isTauriRuntime } from './lcadStorage.js';
import { MAX_SHX_FONT_BYTES, parseDrawingShxFont } from './drawingShxFont.js';
import { createI18nError } from '../i18n/translator.js';

export async function openDrawingShxFont(path = null) {
    let bytes;
    if (isTauriRuntime()) {
        const selected = path || await open({ multiple: false, directory: false, filters: [{ name: 'SHX / SHP', extensions: ['shx', 'shp'] }] });
        if (!selected) return null;
        const source = await invoke('read_shx_source', { path: selected });
        const encoded = source.link.split(',')[1];
        if (!encoded || encoded.length > Math.ceil(MAX_SHX_FONT_BYTES / 3) * 4) throw createI18nError('shx.invalidFont');
        bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    } else {
        if (path) throw createI18nError('errors.pathOpenTauriOnly');
        const file = await chooseBrowserFile({ accept: '.shx,.shp' });
        if (!file) return null;
        if (file.size > MAX_SHX_FONT_BYTES) throw createI18nError('shx.invalidFont');
        bytes = new Uint8Array(await file.arrayBuffer());
    }
    try { return parseDrawingShxFont(bytes); } catch { throw createI18nError('shx.invalidFont'); }
}
