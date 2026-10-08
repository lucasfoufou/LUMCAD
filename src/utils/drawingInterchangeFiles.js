import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { chooseBrowserFile, isTauriRuntime } from './lcadStorage.js';

const formats = { wmf: { accept: '.wmf,image/wmf,image/x-wmf', command: 'read_drawing_wmf' },
    dgn: { accept: '.dgn', command: 'read_drawing_dgn' } };

/** Shared native/browser file boundary for bounded binary drawing imports. */
export async function readDrawingInterchangeFile(path, filterName, format) {
    return (await readDrawingInterchangeSource(path, filterName, format))?.bytes || null;
}

export async function readDrawingInterchangeSource(path, filterName, format) {
    if (!Object.hasOwn(formats, format)) throw new Error('interchangeFormat');
    const config = formats[format]; const limit = 64 * 1024 * 1024;
    if (isTauriRuntime()) {
        path ||= await open({ multiple: false, directory: false, filters: [{ name: filterName, extensions: [format] }] });
        if (!path) return null;
        const bytes = new Uint8Array(await invoke(config.command, { path }));
        if (bytes.length > limit) throw new Error(`${format}Limit`);
        return { bytes, name: path.split(/[\\/]/).at(-1) };
    }
    if (path) throw new Error(`${format}Desktop`);
    const file = await chooseBrowserFile({ accept: config.accept });
    if (!file) return null;
    if (file.size > limit) throw new Error(`${format}Limit`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > limit) throw new Error(`${format}Limit`);
    return { bytes, name: file.name };
}
