import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';

export function normalizeDrawingHyperlink(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const url = typeof value.url === 'string' ? value.url.trim() : '';
    const label = typeof value.label === 'string' ? value.label.trim() : '';
    if (!url || url.length > 4096 || label.length > 256 || /[\u0000-\u001f\u007f]/.test(url + label)) return null;
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
        return { url: parsed.href, label };
    } catch { return null; }
}

export function parseDrawingHyperlinkInput(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) throw new Error('syntax');
    if (!tokens.length) return { action: 'edit' };
    const action = tokens.shift().toUpperCase();
    if (['OPEN', 'REMOVE'].includes(action) && !tokens.length) return { action: action.toLowerCase() };
    if (action !== 'SET' || tokens.length < 1 || tokens.length > 2) throw new Error('syntax');
    const link = normalizeDrawingHyperlink({ url: tokens[0], label: tokens[1] || '' });
    if (!link) throw new Error('url');
    return { action: 'set', link };
}
