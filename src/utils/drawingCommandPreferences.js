import defaultShortcuts from '../settings/defaultShortcuts.json' with { type: 'json' };

export const DEFAULT_DRAWING_SHORTCUTS = Object.freeze(defaultShortcuts.map(row => Object.freeze({ ...row })));
export const DRAWING_SHORTCUT_ACTIONS = Object.freeze([...new Set(defaultShortcuts.map(row => row.command))]);
import { drawingCommandDefinitions, getDrawingCommandDefinition } from './drawingCommands.js';

const defaultTokens = new Set(drawingCommandDefinitions.flatMap(definition => definition.tokens));
const maximumBindings = 256;

// Preferences name commands by their stable catalog ID, never by another personal alias.
export function validateDrawingAliases(value) {
    if (!Array.isArray(value) || value.length > maximumBindings) throw new Error('limit');
    const seen = new Set();
    return value.map(row => {
        const alias = String(row?.alias || '').trim().toUpperCase();
        const definition = getDrawingCommandDefinition(row?.command);
        if (!/^[A-Z][A-Z0-9_-]{0,31}$/.test(alias) || !definition) throw new Error('invalid');
        if (seen.has(alias) || defaultTokens.has(alias)) throw new Error('conflict');
        seen.add(alias);
        return { alias, command: definition.command };
    });
}

export function expandDrawingAlias(value, aliases = []) {
    const text = String(value || '').trim();
    const token = text.match(/^\S+/)?.[0];
    const row = aliases.find(item => item.alias === token?.toUpperCase());
    const definition = row && getDrawingCommandDefinition(row.command);
    return definition ? definition.name + text.slice(token.length) : text;
}

// Mod is the portable primary modifier: Command on macOS and Control elsewhere.
export function normalizeDrawingShortcut(value) {
    if (typeof value !== 'string') throw new Error('invalid');
    const parts = value.trim().split('+').map(part => part.trim().toUpperCase());
    const key = parts.pop();
    const modifiers = new Set(parts);
    if (parts.some(part => !['MOD', 'ALT', 'SHIFT'].includes(part)) || modifiers.size !== parts.length
        || !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|DELETE|BACKSPACE)$/.test(key || '')) throw new Error('invalid');
    if (!parts.length && /^[A-Z0-9]$/.test(key)) throw new Error('reserved');
    const shortcut = [...['MOD', 'ALT', 'SHIFT'].filter(part => modifiers.has(part)), key].join('+');
    if (['MOD+Q', 'MOD+W', 'MOD+S', 'ALT+F4'].includes(shortcut)) throw new Error('reserved');
    return shortcut;
}

export function drawingShortcutFromEvent(event) {
    if (event.isComposing || event.key === 'Dead' || event.ctrlKey && event.metaKey) return null;
    try {
        return normalizeDrawingShortcut([
            ...(event.ctrlKey || event.metaKey ? ['MOD'] : []),
            ...(event.altKey ? ['ALT'] : []),
            ...(event.shiftKey ? ['SHIFT'] : []), event.key,
        ].join('+'));
    } catch { return null; }
}

export function formatDrawingShortcut(value, platform = '') {
    const names = { MOD: /Mac|iPhone|iPad/i.test(platform) ? 'Cmd' : 'Ctrl', ALT: /Mac/i.test(platform) ? 'Option' : 'Alt',
        SHIFT: 'Shift', BACKSPACE: 'Backspace', DELETE: 'Delete' };
    return String(value || '').split('+').map(key => names[key] || key).join(' + ');
}

export function validateDrawingCommandShortcuts(value, reserved = []) {
    if (!Array.isArray(value) || value.length > maximumBindings) throw new Error('limit');
    const seen = new Set(reserved.map(normalizeDrawingShortcut));
    return value.map(row => {
        const shortcut = normalizeDrawingShortcut(row?.shortcut);
        const definition = getDrawingCommandDefinition(row?.command);
        if (!definition && !DRAWING_SHORTCUT_ACTIONS.includes(row?.command)) throw new Error('invalid');
        if (seen.has(shortcut)) throw new Error('conflict');
        seen.add(shortcut);
        return { shortcut, command: definition?.command || row.command };
    });
}
