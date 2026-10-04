const MAX_ATTRIBUTE_VALUE = 16384;

export function normalizeDrawingAttributeTag(value) {
    const tag = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return /^[A-Z][A-Z0-9_-]{0,63}$/.test(tag) ? tag : null;
}

export function normalizeDrawingAttributeDefinition(value) {
    const tag = normalizeDrawingAttributeTag(value?.tag);
    if (!tag) return null;
    return { tag, prompt: typeof value.prompt === 'string' ? value.prompt.slice(0, 256) : tag,
        constant: Boolean(value.constant), invisible: Boolean(value.invisible) };
}

export function normalizeDrawingAttributeValues(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).slice(0, 256).flatMap(([key, entry]) => {
        const tag = normalizeDrawingAttributeTag(key);
        return tag && typeof entry === 'string' ? [[tag, entry.slice(0, MAX_ATTRIBUTE_VALUE)]] : [];
    }));
}

export function drawingAttributeDefinitions(block) {
    return (block?.entities || []).filter(entity => entity.type === 'text' && normalizeDrawingAttributeDefinition(entity.attributeDefinition));
}

export function drawingAttributeValues(block, reference = {}) {
    const existing = normalizeDrawingAttributeValues(reference.attributeValues);
    return Object.fromEntries(drawingAttributeDefinitions(block).map(entity => {
        const definition = normalizeDrawingAttributeDefinition(entity.attributeDefinition);
        return [definition.tag, !definition.constant && Object.hasOwn(existing, definition.tag)
            ? existing[definition.tag] : String(entity.text || '').slice(0, MAX_ATTRIBUTE_VALUE)];
    }));
}

export function resolveDrawingAttributeText(entity, reference, display = 'normal') {
    const definition = entity.type === 'text' && normalizeDrawingAttributeDefinition(entity.attributeDefinition);
    if (!definition) return entity;
    if (display === 'off' || display !== 'all' && definition.invisible) return null;
    const values = normalizeDrawingAttributeValues(reference.attributeValues);
    const text = !definition.constant && Object.hasOwn(values, definition.tag) ? values[definition.tag] : String(entity.text || '');
    const { attributeDefinition, ...rest } = entity;
    return { ...rest, text, runs: text === entity.text && entity.runs ? entity.runs
        : [{ text, marks: entity.runs?.[0]?.marks || {} }] };
}

export function validateDrawingAttributeTags(entities) {
    const tags = new Set();
    for (const entity of entities || []) {
        const definition = entity.type === 'text' && normalizeDrawingAttributeDefinition(entity.attributeDefinition);
        if (!definition) continue;
        if (tags.has(definition.tag) || tags.size >= 256) return false;
        tags.add(definition.tag);
    }
    return true;
}

export function tokenizeDrawingAttributeInput(input) {
    const tokens = [];
    const pattern = /\s*("(?:[^"\\]|\\.)*"|[^\s"]+)/gy;
    const text = String(input || '').trim();
    let index = 0;
    try {
        while (index < text.length) {
            pattern.lastIndex = index;
            const match = pattern.exec(text);
            if (!match) return null;
            tokens.push(match[1].startsWith('"') ? JSON.parse(match[1]) : match[1]);
            index = pattern.lastIndex;
        }
    } catch { return null; }
    return tokens;
}
