import { parseDrawingStandards } from './drawingStandards.js';
import { createI18nError } from '../i18n/translator.js';

/** The embedded snapshot is authoritative; the source path never triggers automatic file access. */
export function normalizeDrawingStandardsBinding(value) {
    try { return readBinding(value); }
    catch { throw createI18nError('errors.invalidDrawingStandards'); }
}

function readBinding(value) {
    if (value === null || value === undefined) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1
        || Object.keys(value).some(key => !['version', 'path', 'standard'].includes(key))) throw new Error('standardsInvalid');
    const path = value.path ?? null;
    if (path !== null && (typeof path !== 'string' || path.length > 4096 || /[\u0000-\u001f]/.test(path)
        || !/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(path))) throw new Error('standardsInvalid');
    return { version: 1, path, standard: parseDrawingStandards(value.standard) };
}
