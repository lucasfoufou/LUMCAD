// Plain-language save state shown beside the drawing name. Without a .lcad
// file the drawing only lives in local recovery: that state is a warning, not
// a success, whatever the autosave did.

/**
 * Returns `{ key, tone }`: `key` names a `saveStatus.*` label, `tone` is
 * 'success', 'progress', 'warning' or 'danger'.
 */
export function resolveDrawingSaveStatus({ status, filePath = null, isRecovery = false, recovered = false }) {
    if (status === 'error') return { key: 'saveStatus.error', tone: 'danger' };
    if (status === 'saving') return { key: 'saveStatus.saving', tone: 'progress' };
    if (!filePath) {
        const inRecovery = isRecovery || recovered || status === 'dirty';
        return { key: inRecovery ? 'saveStatus.recovery' : 'saveStatus.unsaved', tone: 'warning' };
    }
    if (status === 'dirty') return { key: 'saveStatus.saving', tone: 'progress' };
    return { key: 'saveStatus.saved', tone: 'success' };
}
