const invalid = () => { throw new Error('dwfxFont'); };

/** Select one bounded Unicode cmap without expanding character ranges into a lookup array. */
export function readDrawingFontCmap(resource, glyphCount) {
    const bytes = resource.tables.get('cmap')?.bytes;
    if (!bytes || bytes.length < 4 || !Number.isInteger(glyphCount) || glyphCount < 1 || glyphCount > 65535) invalid();
    const table = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = table.getUint16(2); const recordsEnd = 4 + count * 8;
    if (table.getUint16(0) !== 0 || !count || recordsEnd > bytes.length) invalid();
    if (count > 256) throw new Error('dwfxLimit');
    const candidates = [];
    for (let i = 0; i < count; i++) {
        const record = 4 + i * 8; const platform = table.getUint16(record); const encoding = table.getUint16(record + 2);
        const offset = table.getUint32(record + 4);
        if (offset < recordsEnd || offset + 2 > bytes.length) invalid();
        if (!(platform === 0 && encoding !== 5 || platform === 3 && [1, 10].includes(encoding))) continue;
        const format = table.getUint16(offset);
        if ([4, 12].includes(format)) candidates.push({ offset, format });
    }
    candidates.sort((a, b) => b.format - a.format);
    if (!candidates.length) throw new Error('dwfxUnsupported');
    const { offset, format } = candidates[0];
    if (offset + (format === 12 ? 16 : 14) > bytes.length) invalid();
    const length = format === 12 ? table.getUint32(offset + 4) : table.getUint16(offset + 2);
    if (length < 16 || offset + length > bytes.length) invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, length);
    const ranges = [];
    if (format === 12) {
        const groups = view.getUint32(12);
        if (view.getUint16(2) !== 0 || 16 + groups * 12 > length) invalid();
        if (groups > 65536) throw new Error('dwfxLimit');
        for (let i = 0; i < groups; i++) {
            const position = 16 + i * 12;
            const start = view.getUint32(position); const end = view.getUint32(position + 4); const glyph = view.getUint32(position + 8);
            if (start > end || end > 0x10ffff || glyph + end - start >= glyphCount || i && start <= ranges[i - 1].end) invalid();
            ranges.push({ start, end, glyph });
        }
    } else {
        const count = view.getUint16(6) / 2;
        if (!Number.isInteger(count) || !count || 16 + count * 8 > length || view.getUint16(14 + count * 2) !== 0) invalid();
        for (let i = 0; i < count; i++) {
            const end = view.getUint16(14 + i * 2); const start = view.getUint16(16 + count * 2 + i * 2);
            const delta = view.getInt16(16 + count * 4 + i * 2); const position = 16 + count * 6 + i * 2;
            const relative = view.getUint16(position); const address = relative ? position + relative : 0;
            if (start > end || i && start <= ranges[i - 1].end || relative % 2
                || relative && (address < 16 + count * 8 || address + (end - start + 1) * 2 > length)) invalid();
            ranges.push({ start, end, delta, address });
        }
        if (ranges.at(-1).end !== 0xffff) invalid();
    }
    return codePoint => {
        if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || codePoint >= 0xd800 && codePoint <= 0xdfff) invalid();
        let low = 0; let high = ranges.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (ranges[middle].end < codePoint) low = middle + 1;
            else high = middle;
        }
        const range = ranges[low];
        if (!range || codePoint < range.start) return 0;
        let glyph;
        if (format === 12) glyph = range.glyph + codePoint - range.start;
        else if (!range.address) glyph = (codePoint + range.delta) & 0xffff;
        else {
            glyph = view.getUint16(range.address + (codePoint - range.start) * 2);
            if (glyph) glyph = (glyph + range.delta) & 0xffff;
        }
        if (glyph >= glyphCount) invalid();
        return glyph;
    };
}
