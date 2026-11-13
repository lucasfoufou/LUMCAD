import { open as nativeOpen, save as nativeSave } from '@tauri-apps/plugin-dialog';
import { isHeadlessRuntime } from './runtimeMode.js';
import { createI18nError } from '../i18n/translator.js';
import { takePreselectedDrawingFile } from './drawingFileSelection.js';

function requireInteractive() {
    if (isHeadlessRuntime()) throw createI18nError('headless.dialogUnavailable');
}

export async function open(options) {
    // A file already chosen in the File menu answers the command's own picker.
    const preselected = !options?.directory && takePreselectedDrawingFile('path');
    if (preselected) return preselected;
    requireInteractive();
    return nativeOpen(options);
}

export async function save(options) {
    requireInteractive();
    return nativeSave(options);
}
