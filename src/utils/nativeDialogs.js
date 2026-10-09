import { open as nativeOpen, save as nativeSave } from '@tauri-apps/plugin-dialog';
import { isHeadlessRuntime } from './runtimeMode.js';
import { createI18nError } from '../i18n/translator.js';

function requireInteractive() {
    if (isHeadlessRuntime()) throw createI18nError('headless.dialogUnavailable');
}

export async function open(options) {
    requireInteractive();
    return nativeOpen(options);
}

export async function save(options) {
    requireInteractive();
    return nativeSave(options);
}
