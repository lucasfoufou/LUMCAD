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
 * Command search over names, aliases, alternatives and the translated label.
 * Accents and case are ignored. Ranking: exact token, token prefix, then a
 * label word starting with each query word, then a label containing the query.
 * `translate` maps a labelKey to the label in the current language.
 */
export function searchDrawingCommands(value, { translate = key => key, limit = 50, allowSpaces = false } = {}) {
    const query = foldDrawingSearchText(value);
    if (!query || (!allowSpaces && /\s/.test(query))) return [];
    const token = query.toUpperCase();
    const words = query.split(/\s+/).filter(Boolean);
    const results = [];
    for (const definition of drawingCommandDefinitions) {
        const tokens = definition.tokens.map(item => foldDrawingSearchText(item).toUpperCase());
        let rank = null;
        if (tokens.includes(token)) rank = definition.alias === token ? 0 : definition.name === token ? 1 : 2;
        else if (tokens.some(item => item.startsWith(token))) rank = 3 + suggestionScore(definition, token) / 10;
        else {
            const label = foldDrawingSearchText(translate(definition.labelKey));
            const labelWords = label.split(/[^a-z0-9]+/).filter(Boolean);
            if (words.every(word => labelWords.some(item => item.startsWith(word)))) rank = 5;
            else if (query.length >= 3 && label.includes(query)) rank = 6;
        }
        if (rank !== null) results.push({ definition, rank });
    }
    results.sort((left, right) => left.rank - right.rank || left.definition.name.localeCompare(right.definition.name, 'en'));
    return results.slice(0, limit).map(({ definition, rank }) => ({
        command: definition.command,
        name: definition.name,
        alias: definition.alias,
        labelKey: definition.labelKey,
        completion: definition.name,
        tokens: definition.tokens,
        matchedLabel: rank >= 5,
    }));
}

/** Lower case without diacritics, for accent-insensitive search. */
export function foldDrawingSearchText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function resolveDrawingAutocompleteSubmission(value, suggestions = [], selectedIndex = -1) {
    const trimmed = String(value || '').trim();
    if (!trimmed || !suggestions.length) return trimmed;
    const selected = selectedIndex >= 0 ? suggestions[selectedIndex] : null;
    if (selected) return selected.completion;
    const token = normalizeCommandToken(trimmed);
    return suggestions.some(suggestion => suggestion.tokens?.includes(token))
        ? trimmed
        : suggestions[0].completion;
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
