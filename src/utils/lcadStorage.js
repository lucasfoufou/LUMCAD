import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';

import { createI18nError } from '../i18n/translator.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { normalizeLcadEnvelope, safeLcadFilename } from './lcadDocument.js';

const RECOVERY_STORAGE_KEY = 'lumcad.recovery.v1';

export function isTauriRuntime() {
    return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

export async function loadStartupLcad() {
    if (isTauriRuntime()) {
        const loaded = await invoke('load_startup_document');
        return loaded ? normalizeLoadedDocument(loaded) : null;
    }

    const recovery = window.localStorage.getItem(RECOVERY_STORAGE_KEY);
    if (!recovery) return null;
    return { path: null, recovered: true, envelope: normalizeLcadEnvelope(JSON.parse(recovery)) };
}

export async function openLcadDocument({ filterName = 'LUMCAD drawing' } = {}) {
    if (isTauriRuntime()) {
        const path = await open({ multiple: false, directory: false, filters: lcadFilters(filterName) });
        if (!path) return null;
        return normalizeLoadedDocument(await invoke('read_lcad_document', { path }));
    }

    const file = await chooseBrowserFile();
    if (!file) return null;
    const envelope = readLcadArchive(await file.arrayBuffer());
    return { path: null, recovered: false, envelope };
}

export async function readLcadDocumentAtPath(path) {
    if (!isTauriRuntime()) throw createI18nError('errors.pathOpenTauriOnly');
    return normalizeLoadedDocument(await invoke('read_lcad_document', { path }));
}

export async function listenForLcadOpen(callback) {
    if (!isTauriRuntime()) return () => {};
    return listen('lumcad://open-file', event => callback(String(event.payload || '')));
}

export async function writeLcadDocument(path, envelope) {
    const normalized = normalizeLcadEnvelope(envelope);
    if (isTauriRuntime()) {
        return invoke('write_lcad_document', { path, envelope: normalized });
    }
    downloadBrowserDocument(normalized);
    window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
    return { path: null, savedAt: Date.now(), recovery: false };
}

export async function saveLcadDocumentAs(envelope, suggestedName, { filterName = 'LUMCAD drawing' } = {}) {
    const result = await exportLcadDocumentAs(envelope, suggestedName, { filterName });
    if (result && !isTauriRuntime()) window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
    return result;
}

export async function exportLcadDocumentAs(envelope, suggestedName, { filterName = 'LUMCAD drawing' } = {}) {
    const normalized = normalizeLcadEnvelope(envelope);
    if (isTauriRuntime()) {
        const path = await save({
            defaultPath: safeLcadFilename(suggestedName || normalized.document.name),
            filters: lcadFilters(filterName),
        });
        if (!path) return null;
        return invoke('write_lcad_document', { path, envelope: normalized });
    }
    downloadBrowserDocument(normalized);
    return { path: null, savedAt: Date.now(), recovery: false };
}

export async function autosaveLcadDocument(currentPath, envelope) {
    const normalized = normalizeLcadEnvelope(envelope);
    if (isTauriRuntime()) {
        return invoke('autosave_lcad_document', { currentPath: currentPath || null, envelope: normalized });
    }
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(normalized));
    return { path: currentPath || null, savedAt: Date.now(), recovery: !currentPath };
}

export async function clearLcadRecovery() {
    if (isTauriRuntime()) return invoke('clear_recovery');
    window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
    return null;
}

export function getLcadPathLabel(path) {
    if (!path) return null;
    return String(path).split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function lcadFilters(name) {
    return [{ name, extensions: ['lcad'] }];
}

function normalizeLoadedDocument(loaded) {
    return {
        path: loaded.path || null,
        recovered: Boolean(loaded.recovered),
        envelope: normalizeLcadEnvelope(loaded.envelope),
    };
}

function chooseBrowserFile() {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.lcad,application/x-lumcad,application/zip';
        input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
        input.addEventListener('cancel', () => resolve(null), { once: true });
        input.click();
    });
}

function downloadBrowserDocument(envelope) {
    const blob = new Blob([createLcadArchive(envelope)], { type: 'application/x-lumcad' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeLcadFilename(envelope.document.name);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
