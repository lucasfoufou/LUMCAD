// One-shot file selection handed to the next file picker of a command.
//
// The File menu and OPEN choose a file once, in a multi-format picker, then run
// the matching command (DWGIN, DXFIN, PDFIMPORT...). That command still asks
// its usual picker; the preselection answers it instead of showing a second
// dialog, so every format keeps a single import path.

let preselected = null;

/**
 * Runs `task` while the next picker answers with `selection`:
 * `{ kind: 'path', value }` for a native path, `{ kind: 'file', value }` for a
 * browser File. The selection is dropped afterwards even when unused.
 */
export async function withPreselectedDrawingFile(selection, task) {
    preselected = selection || null;
    try {
        return await task();
    } finally {
        preselected = null;
    }
}

/** Consumes the preselection of the requested kind, or returns null. */
export function takePreselectedDrawingFile(kind) {
    if (!preselected || preselected.kind !== kind) return null;
    const { value } = preselected;
    preselected = null;
    return value;
}
