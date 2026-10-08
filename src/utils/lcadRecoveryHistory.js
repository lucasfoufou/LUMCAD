export const LCAD_RECOVERY_HISTORY_LIMIT = 12;
export const LCAD_RECOVERY_HISTORY_BYTES = 256 * 1024;

const text = (value, maximum) => typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).length <= maximum && !/[\u0000-\u001f]/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000000;

export function normalizeLcadRecoveryHistory(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > LCAD_RECOVERY_HISTORY_LIMIT) throw new Error('Invalid recovery history.');
    const ids = new Set();
    const entries = value.entries.map(entry => {
        if (!entry || !text(entry.id, 128) || ids.has(entry.id) || !text(entry.sourceName, 256)
            || !['single', 'batch'].includes(entry.kind) || entry.sourcePath !== null && !text(entry.sourcePath, 4096)
            || typeof entry.complete !== 'boolean' || typeof entry.limited !== 'boolean'
            || !Number.isSafeInteger(entry.recordedAt) || entry.recordedAt < 1 || entry.recordedAt > 8640000000000000
            || ![entry.files, entry.ready, entry.unresolved, entry.failed, entry.quarantined, entry.issues].every(count)
            || entry.files < 1 || entry.files > 32 || entry.ready + entry.unresolved + entry.failed !== entry.files) throw new Error('Invalid recovery history record.');
        if (entry.complete && (entry.limited || entry.ready !== entry.files)) throw new Error('Inconsistent recovery history status.');
        ids.add(entry.id);
        return { id: entry.id, recordedAt: entry.recordedAt, sourcePath: entry.sourcePath, sourceName: entry.sourceName,
            kind: entry.kind, complete: entry.complete, limited: entry.limited, files: entry.files, ready: entry.ready, unresolved: entry.unresolved, failed: entry.failed,
            quarantined: entry.quarantined, issues: entry.issues };
    });
    const result = { version: 1, entries };
    if (new TextEncoder().encode(JSON.stringify(result)).length > LCAD_RECOVERY_HISTORY_BYTES) throw new Error('Recovery history exceeds its size limit.');
    return result;
}

export function createLcadRecoveryHistoryEntry(result, { batch = false, id = globalThis.crypto.randomUUID(), recordedAt = Date.now() } = {}) {
    const entries = batch ? result.entries : [{ status: result.ready ? 'ready' : 'unresolved', result, sourcePath: result.sourcePath }];
    const root = entries[0];
    const rawName = root.result?.sourceName || String(root.sourcePath || '').split(/[\\/]/).at(-1) || 'recovery.lcad';
    let sourceName = ''; let nameBytes = 0;
    for (const character of rawName) {
        nameBytes += new TextEncoder().encode(character).length;
        if (nameBytes > 256) break;
        sourceName += character;
    }
    const record = { id, recordedAt, kind: batch ? 'batch' : 'single', sourcePath: root.sourcePath || null,
        sourceName, complete: batch ? result.complete : Boolean(result.ready), limited: batch ? result.limited : false,
        files: entries.length, ready: entries.filter(entry => entry.status === 'ready').length,
        unresolved: entries.filter(entry => entry.status === 'unresolved').length,
        failed: entries.filter(entry => entry.status === 'failed').length,
        quarantined: entries.reduce((sum, entry) => sum + (entry.result?.report?.quarantine?.length || 0), 0),
        issues: entries.reduce((sum, entry) => sum + (entry.result?.report?.issues?.length || 0) + (entry.result?.report?.archiveIssues?.length || 0) + (entry.error ? 1 : 0), 0)
            + (batch ? result.edges.filter(edge => ['cycle', 'failed', 'limit'].includes(edge.status)).length : 0) };
    return normalizeLcadRecoveryHistory({ version: 1, entries: [record] }).entries[0];
}

export function appendLcadRecoveryHistory(history, entry) {
    const current = normalizeLcadRecoveryHistory(history);
    const record = normalizeLcadRecoveryHistory({ version: 1, entries: [entry] }).entries[0];
    return normalizeLcadRecoveryHistory({ version: 1, entries: [record, ...current.entries.filter(previous => previous.id !== record.id
        && !(record.sourcePath && previous.kind === record.kind && previous.sourcePath === record.sourcePath))].slice(0, LCAD_RECOVERY_HISTORY_LIMIT) });
}

export function forgetLcadRecoveryHistoryEntry(history, id) {
    const current = normalizeLcadRecoveryHistory(history);
    return { ...current, entries: current.entries.filter(entry => entry.id !== id) };
}
