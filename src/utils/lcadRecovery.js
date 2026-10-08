import { createI18nError } from '../i18n/translator.js';
import { prepareRecoveredReferencePaths } from './lcadRecoveryReferences.js';
import { readLcadRecoveryCandidate } from './lcadArchive.js';
import { normalizeLcadEnvelope } from './lcadDocument.js';
import { salvageDrawingDocument } from './drawingRecovery.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';

export function parseLcadRecoveryInput(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return null;
    if (!tokens.length) return { action: 'read', path: null };
    if (tokens.length === 1 && ['OPEN', 'REPORT'].includes(tokens[0].toUpperCase())) return { action: tokens[0].toLowerCase() };
    if (tokens.length === 2 && tokens[0].toUpperCase() === 'FROM' && tokens[1].trim()) return { action: 'read', path: tokens[1] };
    return null;
}

export function parseLcadRecoveryManagerInput(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return null;
    if (!tokens.length || tokens.length === 1 && tokens[0].toUpperCase() === 'REPORT') return { action: 'report' };
    if (tokens.length === 1 && ['HISTORY', 'RELINK'].includes(tokens[0].toUpperCase())) return { action: tokens[0].toLowerCase() };
    if (tokens.length === 2 && ['RETRY', 'REMOVE'].includes(tokens[0].toUpperCase()) && /^(?:[1-9]|1[0-2])$/.test(tokens[1])) return { action: tokens[0].toLowerCase(), index: Number(tokens[1]) - 1 };
    if (tokens.length === 2 && ['SELECT', 'OPEN'].includes(tokens[0].toUpperCase()) && /^[1-9]\d*$/.test(tokens[1])) {
        const index = Number(tokens[1]);
        if (Number.isSafeInteger(index) && index <= 32) return { action: tokens[0].toLowerCase(), id: `recovery-${index}` };
    }
    return null;
}

export function lcadRecoveryReport(result, { opened = false } = {}) {
    return { mode: 'recovery', ...result.report, ready: Boolean(result.ready), opened,
        name: result.sourceName, path: result.sourcePath || null };
}

export function createLcadRecoveredSession(result, name, recoveryGraph = null) {
    if (!result?.ready || !result.report?.valid || !result.envelope?.document) return null;
    const references = prepareRecoveredReferencePaths(result.envelope.document, result.sourcePath, recoveryGraph);
    return { document: { ...references.document, name }, path: null, recovered: true,
        recoveryReport: { ...lcadRecoveryReport(result, { opened: true }), referencePaths: references.changes, unresolvedReferencePaths: references.unresolved }, recoveryGraph };
}

/** Prepare a separate recovery candidate; this function performs no file or session writes. */
export function prepareLcadRecovery(bytes, options = {}) {
    const staged = readLcadRecoveryCandidate(bytes);
    const salvaged = salvageDrawingDocument(staged.envelope.document, options);
    if (salvaged.error) return salvaged;
    const candidate = { ...staged.envelope, document: salvaged.document };
    const report = { ...salvaged.report, archiveIssues: staged.issues };
    if (!report.valid) return { ready: false, candidate, report };
    return { ready: true, envelope: normalizeLcadEnvelope(candidate), candidate, report };
}

/** Re-read saved copies after the current session has been saved, preserving later edits. */
export async function readSavedRecoveredCandidate(result, graph, readDocument) {
    const entry = graph?.entries?.find(entry => entry.sourcePath === result.sourcePath);
    if (!entry?.savedPath) return result;
    const loaded = await readDocument(entry.savedPath);
    if (!loaded?.envelope?.document || loaded.envelope.document.id !== result.envelope.document.id) throw createI18nError('recovery.savedCopyChanged');
    return { ...result, envelope: loaded.envelope };
}
