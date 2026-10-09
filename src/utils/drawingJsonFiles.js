import { invoke } from '@tauri-apps/api/core';
import { open } from '../utils/nativeDialogs.js';
import { chooseBrowserFile, isTauriRuntime } from './lcadStorage.js';

/** Shared bounded UTF-8 reading for portable project and resource JSON files. */
export async function readDrawingJsonFile(path, filterName, errorPrefix) {
    let text; let name;
    if (isTauriRuntime()) {
        path ||= await open({ multiple: false, filters: [{ name: filterName, extensions: ['json'] }] });
        if (!path) return null;
        text = await invoke('read_drawing_json', { path });
        name = path.split(/[\\/]/).at(-1);
    } else {
        if (path) throw new Error(`${errorPrefix}Desktop`);
        const file = await chooseBrowserFile({ accept: '.json,application/json' });
        if (!file) return null;
        if (file.size > 4 * 1024 * 1024) throw new Error(`${errorPrefix}Limit`);
        text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        name = file.name;
    }
    return { text, name, path: path || null };
}
