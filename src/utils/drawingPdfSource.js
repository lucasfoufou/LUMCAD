import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { chooseBrowserFile, isTauriRuntime } from './lcadStorage.js';
import { drawingPdfBytes, drawingPdfDataUrl, MAX_PDF_SOURCE_BYTES } from './drawingPdfReader.js';
import { createI18nError } from '../i18n/translator.js';

export async function openDrawingPdfSource(path = null) {
    if (isTauriRuntime()) {
        const selected = path || await open({ multiple: false, directory: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (!selected) return null;
        const source = await invoke('read_pdf_source', { path: selected });
        return { ...source, bytes: drawingPdfBytes(source.link) };
    }
    if (path) throw createI18nError('errors.pathOpenTauriOnly');
    const file = await chooseBrowserFile({ accept: '.pdf,application/pdf' });
    if (!file) return null;
    if (file.size > MAX_PDF_SOURCE_BYTES) throw createI18nError('pdf.invalid');
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { name: file.name, path: null, link: drawingPdfDataUrl(bytes), bytes };
}
