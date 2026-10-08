const invalid = () => { throw new Error('dwfxGlyphs'); };

/** Expand XPS UTF-16 cluster mappings without performing shaping or Unicode normalization. */
export function parseDrawingXpsGlyphIndices(unicodeString = '', indices = '') {
    if (typeof unicodeString !== 'string' || typeof indices !== 'string') invalid();
    if (unicodeString.startsWith('{}')) unicodeString = unicodeString.slice(2);
    else if (unicodeString.startsWith('{')) invalid();
    if (unicodeString.length > 20000 || indices.length > 1024 * 1024) throw new Error('dwfxLimit');
    for (const character of unicodeString) {
        const code = character.codePointAt(0);
        if (code >= 0xd800 && code <= 0xdfff) invalid();
    }
    const entries = indices ? indices.split(';') : [];
    if (entries.length > 10000) throw new Error('dwfxLimit');
    const result = []; let cursor = 0; let index = 0;
    const boundary = position => {
        const code = unicodeString.charCodeAt(position);
        if (code >= 0xdc00 && code <= 0xdfff) invalid();
    };
    while (index < entries.length || cursor < unicodeString.length) {
        const entry = (entries[index] || '').trim();
        const cluster = /^\((\d+)(?::(\d+))?\)/.exec(entry);
        const units = cluster ? Number(cluster[1]) : 1;
        const glyphCount = cluster ? Number(cluster[2] || 1) : 1;
        if (!units || !glyphCount) invalid();
        if (!Number.isSafeInteger(units) || !Number.isSafeInteger(glyphCount) || units > 20000 || glyphCount + result.length > 10000) throw new Error('dwfxLimit');
        if (cluster && index + glyphCount > entries.length || unicodeString && cursor + units > unicodeString.length) invalid();
        if (unicodeString) { boundary(cursor); boundary(cursor + units); }
        for (let offset = 0; offset < glyphCount; offset++) {
            const value = offset === 0 ? entry.slice(cluster?.[0].length || 0) : entries[index + offset].trim();
            const fields = value.split(',').map(field => field.trim());
            if (fields.length > 4 || fields[0] && !/^\d+$/.test(fields[0])) invalid();
            if (!fields[0] && (units !== 1 || glyphCount !== 1 || !unicodeString[cursor])) invalid();
            result.push({ fields, codePoint: fields[0] ? null : unicodeString.charCodeAt(cursor) });
        }
        cursor += units; index += glyphCount;
    }
    if (!result.length) invalid();
    return result;
}
