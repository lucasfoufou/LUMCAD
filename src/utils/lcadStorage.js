import { downloadBrowserBlob } from './browserDownload.js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';

import { createI18nError } from '../i18n/translator.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { normalizeLcadEnvelope, safeLcadFilename } from './lcadDocument.js';
import { prepareLcadRecovery } from './lcadRecovery.js';
import { prepareLcadRecoveryGraph } from './lcadRecoveryGraph.js';
import { prepareRecoveredReferencePaths } from './lcadRecoveryReferences.js';
import { normalizeLcadRecoveryHistory, appendLcadRecoveryHistory, forgetLcadRecoveryHistoryEntry, LCAD_RECOVERY_HISTORY_BYTES } from './lcadRecoveryHistory.js';

const RECOVERY_STORAGE_KEY = 'lumcad.recovery.v1';
const RECOVERY_HISTORY_KEY = 'lumcad.recovery-history.v1';

export async function listLcadRecoveryHistory() {
    if (isTauriRuntime()) return normalizeLcadRecoveryHistory(await invoke('list_recovery_history'));
    const stored = window.localStorage.getItem(RECOVERY_HISTORY_KEY);
    if (!stored) return { version: 1, entries: [] };
    if (new TextEncoder().encode(stored).length > LCAD_RECOVERY_HISTORY_BYTES) throw createI18nError('recovery.historyFailed');
    return normalizeLcadRecoveryHistory(JSON.parse(stored));
}

export async function recordLcadRecoveryHistory(entry) {
    if (isTauriRuntime()) return normalizeLcadRecoveryHistory(await invoke('record_recovery_history', { entry }));
    const history = appendLcadRecoveryHistory(await listLcadRecoveryHistory(), entry);
    window.localStorage.setItem(RECOVERY_HISTORY_KEY, JSON.stringify(history));
    return history;
}

export async function forgetLcadRecoveryHistory(id) {
    if (isTauriRuntime()) return normalizeLcadRecoveryHistory(await invoke('forget_recovery_history', { id }));
    const history = forgetLcadRecoveryHistoryEntry(await listLcadRecoveryHistory(), id);
    window.localStorage.setItem(RECOVERY_HISTORY_KEY, JSON.stringify(history));
    return history;
}

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

/** Prepare a separate candidate; neither this function nor salvage opens or saves it. */
export async function recoverLcadDocument({ path = null, protectedPath = null, filterName = 'LUMCAD drawing', ...options } = {}) {
    if (isTauriRuntime()) {
        const sourcePath = path || await open({ multiple: false, directory: false, filters: lcadFilters(filterName) });
        if (!sourcePath) return null;
        const bytes = await invoke('read_lcad_recovery_source', { path: sourcePath, protectedPath });
        return { ...prepareLcadRecovery(bytes, options), sourcePath, sourceName: getLcadPathLabel(sourcePath) };
    }
    if (path) throw createI18nError('errors.pathOpenTauriOnly');
    const file = await chooseBrowserFile();
    if (!file) return null;
    if (file.size > 300 * 1024 * 1024) throw createI18nError('storage.invalidArchive');
    return { ...prepareLcadRecovery(await file.arrayBuffer(), options), sourcePath: null, sourceName: file.name };
}

export async function recoverLcadDocumentTree({ path = null, protectedPath = null, filterName = 'LUMCAD drawing', ...options } = {}) {
    if (!isTauriRuntime()) throw createI18nError('errors.pathOpenTauriOnly');
    const sourcePath = path || await open({ multiple: false, directory: false, filters: lcadFilters(filterName) });
    if (!sourcePath) return null;
    return prepareLcadRecoveryGraph(sourcePath, { ...options,
        resolvePath: (path, relativeTo) => invoke('resolve_lcad_recovery_path', { path, relativeTo }),
        readBytes: (path, maxBytes) => invoke('read_lcad_recovery_source', { path, protectedPath, maxBytes }) });
}

export async function readLcadReferenceAtPath(path) {
    if (!isTauriRuntime()) throw createI18nError('errors.pathOpenTauriOnly');
    const result = await invoke('read_lcad_reference', { path });
    return { ...normalizeLoadedDocument(result.loaded), revision: result.revision };
}

export async function writeLcadReference(path, envelope, expectedRevision) {
    if (!isTauriRuntime()) throw createI18nError('errors.pathOpenTauriOnly');
    const result = await invoke('write_lcad_reference', {
        path, envelope: normalizeLcadEnvelope(envelope), expectedRevision,
    });
    return { ...normalizeLoadedDocument(result.loaded), revision: result.revision };
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

export async function saveLcadDocumentAs(envelope, suggestedName, { filterName = 'LUMCAD drawing', protectedPath = null, protectedPaths = [] } = {}) {
    const result = await exportLcadDocumentAs(envelope, suggestedName, { filterName, protectedPath, protectedPaths });
    if (result) await clearLcadRecovery();
    return result;
}

export async function exportLcadDocumentAs(envelope, suggestedName, { filterName = 'LUMCAD drawing', protectedPath = null, protectedPaths = [], destinationPath = null } = {}) {
    const normalized = normalizeLcadEnvelope(envelope);
    if (isTauriRuntime()) {
        const path = destinationPath || await save({
            defaultPath: safeLcadFilename(suggestedName || normalized.document.name),
            filters: lcadFilters(filterName),
        });
        if (!path) return null;
        return invoke('export_lcad_document', { path, envelope: normalized, protectedPath, protectedPaths });
    }
    if (destinationPath) throw createI18nError('errors.pathOpenTauriOnly');
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
    const envelope = normalizeLcadEnvelope(loaded.envelope);
    // Anchor portable links once, before history/autosave captures a session. Moving the
    // active file later must not reinterpret old links against the new directory.
    if (loaded.path) envelope.document = prepareRecoveredReferencePaths(envelope.document, loaded.path).document;
    return {
        path: loaded.path || null,
        recovered: Boolean(loaded.recovered),
        envelope,
    };
}

export function chooseBrowserFile({ accept = '.lcad,application/x-lumcad,application/zip' } = {}) {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.hidden = true;
        const finish = file => { input.remove(); resolve(file); };
        input.addEventListener('change', () => finish(input.files?.[0] || null), { once: true });
        input.addEventListener('cancel', () => finish(null), { once: true });
        document.body.appendChild(input);
        input.click();
    });
}

function downloadBrowserDocument(envelope) {
    const blob = new Blob([createLcadArchive(envelope)], { type: 'application/x-lumcad' });
    downloadBrowserBlob(blob, safeLcadFilename(envelope.document.name));
}
