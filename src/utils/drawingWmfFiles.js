import { readDrawingInterchangeFile } from './drawingInterchangeFiles.js';
import { downloadBrowserBlob } from './browserDownload.js';
import { readDrawingWmfRecords } from './drawingWmfRecords.js';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { isTauriRuntime } from './lcadStorage.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';

export function parseDrawingWmfInput(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) throw new Error('wmfSyntax');
    const result = { path: null, x: 0, y: 0, scale: 1 }; const used = new Set();
    if (tokens.length && !['AT', 'SCALE'].includes(tokens[0].toUpperCase())) result.path = tokens.shift();
    while (tokens.length) {
        const option = tokens.shift().toUpperCase();
        if (used.has(option)) throw new Error('wmfSyntax');
        used.add(option);
        if (option === 'AT' && tokens.length >= 2) {
            result.x = Number(tokens.shift()); result.y = Number(tokens.shift());
        } else if (option === 'SCALE' && tokens.length) result.scale = Number(tokens.shift());
        else throw new Error('wmfSyntax');
    }
    if (![result.x, result.y, result.scale].every(Number.isFinite) || result.scale <= 0 || result.scale > 1e9) throw new Error('wmfSyntax');
    return result;
}

export const readDrawingWmfFile = (path, filterName) => readDrawingInterchangeFile(path, filterName, 'wmf');

export function parseDrawingWmfExportInput(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) throw new Error('wmfExportSyntax');
    const result = { path: tokens.length && tokens[0].toUpperCase() !== 'RASTER' ? tokens.shift() : null };
    if (!tokens.length) return result;
    if (tokens.shift().toUpperCase() !== 'RASTER') throw new Error('wmfExportSyntax');
    Object.assign(result, { mode: 'raster', width: 2048, background: '#ffffff' });
    const used = new Set();
    while (tokens.length) {
        const key = tokens.shift().toUpperCase(); const value = tokens.shift();
        if (!value || used.has(key)) throw new Error('wmfExportSyntax');
        used.add(key);
        if (key === 'WIDTH') result.width = Number(value);
        else if (key === 'BACKGROUND') result.background = value.toLowerCase();
        else throw new Error('wmfExportSyntax');
    }
    if (!Number.isInteger(result.width) || result.width < 64 || result.width > 4096
        || !/^#[0-9a-f]{6}$/i.test(result.background)) throw new Error('wmfExportSyntax');
    return result;
}

export async function saveDrawingWmfFile({ bytes, path = null, name = 'drawing' }, filterName) {
    readDrawingWmfRecords(bytes);
    if (isTauriRuntime()) {
        path ||= await save({ defaultPath: `${name}.wmf`, filters: [{ name: filterName, extensions: ['wmf'] }] });
        if (!path) return false;
        await invoke('write_drawing_wmf', { path, bytes: Array.from(bytes) });
    } else {
        if (path) throw new Error('wmfDesktop');
        downloadBrowserBlob(new Blob([bytes], { type: 'image/wmf' }), `${name}.wmf`);
    }
    return true;
}
