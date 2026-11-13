// Session command log (AutoCAD's F2 text window): commands and replies in order.

export const DRAWING_COMMAND_LOG_LIMIT = 500;

/** Appends one entry, dropping the oldest beyond the limit and repeated replies. */
export function appendDrawingCommandLog(entries, entry, limit = DRAWING_COMMAND_LOG_LIMIT) {
    const text = String(entry?.text ?? '').trim();
    if (!text) return entries;
    const last = entries.at(-1);
    if (entry.kind === 'message' && last?.kind === 'message' && last.text === text) return entries;
    const next = [...entries, { ...entry, text }];
    return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Plain text for the clipboard: commands prefixed by "> ". */
export function formatDrawingCommandLog(entries) {
    return entries.map(entry => (entry.kind === 'command' ? `> ${entry.text}` : entry.text)).join('\n');
}
