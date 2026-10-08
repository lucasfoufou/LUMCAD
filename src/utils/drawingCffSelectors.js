const invalid = () => { throw new Error('dwfxFont'); };

/** Decode CFF 1 FDSelect formats without leaving gaps or extending past the glyph set. */
export function readDrawingCffSelectors(bytes, offset, glyphCount, dictionaryCount) {
    if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length
        || !Number.isInteger(glyphCount) || glyphCount < 1 || glyphCount > 65535
        || !Number.isInteger(dictionaryCount) || dictionaryCount < 1 || dictionaryCount > 256) invalid();
    const result = new Uint8Array(glyphCount); const format = bytes[offset++];
    if (format === 0) {
        if (offset + glyphCount > bytes.length) invalid();
        result.set(bytes.subarray(offset, offset + glyphCount));
        if (result.some(value => value >= dictionaryCount)) invalid();
    } else if (format === 3) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (offset + 2 > bytes.length) invalid();
        const count = view.getUint16(offset); offset += 2;
        if (!count || count > glyphCount || offset + count * 3 + 2 > bytes.length) invalid();
        if (view.getUint16(offset) !== 0 || view.getUint16(offset + count * 3) !== glyphCount) invalid();
        for (let i = 0; i < count; i++) {
            const start = view.getUint16(offset + i * 3); const end = view.getUint16(offset + (i + 1) * 3);
            const fd = bytes[offset + i * 3 + 2];
            if (fd >= dictionaryCount || end <= start || end > glyphCount) invalid();
            result.fill(fd, start, end);
        }
    } else throw new Error('dwfxUnsupported');
    return result;
}
