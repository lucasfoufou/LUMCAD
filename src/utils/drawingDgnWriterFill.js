/** Append the standard V7 shape-fill linkage to a newly encoded closed element. */
export function writeDrawingDgnFill(bytes, color) {
    if (color === undefined || color === null) return bytes;
    if (!Number.isInteger(color) || color < 0 || color > 255) throw new Error('dgnRange');
    if (![6, 14, 15].includes(bytes[1])) throw new Error('dgnUnsupported');
    const result = new Uint8Array(bytes.length + 16); result.set(bytes);
    const view = new DataView(result.buffer);
    const words = view.getUint16(2, true) + 8;
    if (words > 65535) throw new Error('dgnLimit');
    view.setUint16(2, words, true);
    view.setUint16(32, view.getUint16(32, true) | 0x800, true);
    if (bytes[1] === 14) {
        const total = view.getUint16(36, true) + 8;
        if (total > 65535) throw new Error('dgnLimit');
        view.setUint16(36, total, true);
    }
    result.set([7, 16, 65, 0, 2, 8, 1, 0, color, 0, 0, 0, 0, 0, 0, 0], bytes.length);
    return result;
}
