import commandManifest from '../mcp/commands.json' with { type: 'json' };

export const drawingCommandDefinitions = Object.freeze(commandManifest.map(definition => ({
    ...definition,
    alternatives: [...definition.alternatives],
    tokens: [...new Set([definition.name, definition.alias, ...definition.alternatives].map(normalizeCommandToken))],
})));

const aliases = new Map(drawingCommandDefinitions.flatMap(definition => (
    definition.tokens.map(token => [token, definition.command])
)));

export function parseDrawingCommand(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    const [rawAlias, ...rawArgs] = trimmed.split(/\s+/);
    const commandName = aliases.get(normalizeCommandToken(rawAlias));
    if (!commandName) return { command: 'unknown', alias: rawAlias, args: rawArgs };
    return { command: commandName, alias: rawAlias, args: parseDrawingNumbers(rawArgs.join(' ')) };
}

export function parseDrawingNumbers(value) {
    if (Array.isArray(value)) value = value.join(' ');
    return String(value || '')
        .trim()
        .split(/[;\s]+/)
        .filter(Boolean)
        .map(part => Number.parseFloat(part.replace(',', '.')))
        .filter(Number.isFinite);
}

export function getDrawingCommandInput(value) {
    const trimmed = String(value || '').trim();
    const separator = trimmed.search(/\s/);
    return separator < 0 ? '' : trimmed.slice(separator).trim();
}

export function isNumericDrawingInput(value) {
    const trimmed = String(value || '').trim();
    return Boolean(trimmed) && /^[+-]?\d+(?:[.,]\d+)?\s*m?(?:[;\s]+[+-]?\d+(?:[.,]\d+)?\s*m?)*$/i.test(trimmed);
}

export function getDrawingCommandSuggestions(value, limit = 5) {
    const prefix = normalizeCommandToken(value);
    if (!prefix || /\s/.test(prefix)) return [];
    return drawingCommandDefinitions
        .filter(definition => definition.tokens.some(token => token.startsWith(prefix)))
        .sort((left, right) => suggestionScore(left, prefix) - suggestionScore(right, prefix)
            || left.name.localeCompare(right.name, 'en'))
        .slice(0, limit)
        .map(definition => ({
            command: definition.command,
            name: definition.name,
            alias: definition.alias,
            labelKey: definition.labelKey,
            completion: definition.name,
            tokens: definition.tokens,
        }));
}

/**
 * What Enter submits from the command line. A suggestion runs only when it was
 * chosen explicitly (arrow keys, Tab, click) or when the text is exactly one of
 * its names or aliases; numbers, coordinates and expressions are never completed.
 * At an option prompt (`options: true`) a prefix matching a single keyword is
 * accepted, as AutoCAD accepts any unambiguous keyword abbreviation; a command
 * prefix is never run, so "OP" cannot open a file dialog by accident.
 */
export function resolveDrawingAutocompleteSubmission(value, suggestions = [], selectedIndex = -1, { options = false } = {}) {
    const trimmed = String(value || '').trim();
    const selected = selectedIndex >= 0 ? suggestions[selectedIndex] : null;
    if (selected) return selected.completion;
    if (!trimmed || !suggestions.length || !isKeywordLikeInput(trimmed)) return trimmed;
    const token = normalizeCommandToken(trimmed);
    if (suggestions.some(suggestion => suggestion.tokens?.includes(token))) return trimmed;
    return options && suggestions.length === 1 ? suggestions[0].completion : trimmed;
}

function isKeywordLikeInput(value) {
    return /^[-_]?[\p{L}][\p{L}\d_-]*$/u.test(value);
}

export function getDrawingCommandDefinition(value) {
    const normalized = normalizeCommandToken(value);
    return drawingCommandDefinitions.find(definition => (
        definition.command === value || definition.tokens.includes(normalized)
    )) || null;
}

function normalizeCommandToken(value) {
    return String(value || '').trim().toUpperCase();
}

function suggestionScore(definition, prefix) {
    if (definition.alias === prefix) return 0;
    if (definition.name === prefix) return 1;
    if (definition.name.startsWith(prefix)) return 2;
    if (definition.alias.startsWith(prefix)) return 3;
    return 4;
}
