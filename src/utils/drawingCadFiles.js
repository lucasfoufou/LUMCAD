import { invoke } from '@tauri-apps/api/core';
import { open, save } from './nativeDialogs.js';
import { chooseBrowserFile, isTauriRuntime } from './lcadStorage.js';
import { downloadBrowserBlob } from './browserDownload.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { DRAWING_IMPORT_UNITS } from './drawingCoordinates.js';
import { CAD_FILE_LIMIT } from './drawingDxf.js';

export function parseDrawingCadInput(input, exporting = false) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) throw new Error('cadSyntax');
    const result = { path: null, x: 0, y: 0, scale: 1, unit: null, skip: false }; const used = new Set();
    if (tokens.length && !['AT', 'SCALE', 'UNIT', 'SKIP'].includes(tokens[0].toUpperCase())) result.path = tokens.shift();
    while (tokens.length) {
        const key = tokens.shift().toUpperCase();
        if (exporting || used.has(key)) throw new Error('cadSyntax');
        used.add(key);
        if (key === 'SKIP') result.skip = true;
        else if (key === 'AT' && tokens.length >= 2) { result.x = Number(tokens.shift()); result.y = Number(tokens.shift()); }
        else if (key === 'SCALE' && tokens.length) result.scale = Number(tokens.shift());
        else if (key === 'UNIT' && tokens.length) { result.unit = tokens.shift().toLowerCase(); if (!Object.hasOwn(DRAWING_IMPORT_UNITS, result.unit)) throw new Error('cadSyntax'); }
        else throw new Error('cadSyntax');
    }
    if (![result.x, result.y, result.scale].every(Number.isFinite) || result.scale <= 0 || result.scale > 1e9) throw new Error('cadSyntax');
    return result;
}

export async function readDrawingCadFile(path, label, format) {
    if (isTauriRuntime()) {
        path ||= await open({ multiple: false, directory: false, filters: [{ name: label, extensions: [format] }] });
        if (!path) return null;
        return new Uint8Array(await invoke('read_drawing_cad', { path, format }));
    }
    if (format === 'dwg') throw new Error('cadDwgDesktop');
    if (path) throw new Error('cadDesktop');
    const file = await chooseBrowserFile({ accept: '.dxf' });
    if (!file) return null;
    if (file.size > CAD_FILE_LIMIT) throw new Error('cadLimit');
    return new Uint8Array(await file.arrayBuffer());
}

export async function saveDrawingCadFile({ text, path, name, format, label }) {
    if (isTauriRuntime()) {
        path ||= await save({ defaultPath: `${name}.${format}`, filters: [{ name: label, extensions: [format] }] });
        if (!path) return false;
        await invoke('write_drawing_cad', { path, format, text });
    } else {
        if (format === 'dwg') throw new Error('cadDwgDesktop');
        if (path) throw new Error('cadDesktop');
        downloadBrowserBlob(new Blob([text], { type: 'application/dxf' }), `${name}.dxf`);
    }
    return true;
}
