/** TIFF 6 LZW: MSB-first 9–12-bit codes with early dictionary-width changes. */
export function decodeDrawingTiffLzw(bytes, expected) {
    const invalid = () => { throw new Error('tiffInvalid'); };
    if (!(bytes instanceof Uint8Array)) invalid();
    if (!Number.isSafeInteger(expected) || expected < 0 || expected > 128 * 1024 * 1024
        || bytes.length > 64 * 1024 * 1024) throw new Error('tiffLimit');
    const output = new Uint8Array(expected);
    const prefix = new Uint16Array(4096); const suffix = new Uint8Array(4096); const stack = new Uint8Array(4096);
    let offset = 0; let pending = 0; let buffer = 0; let target = 0;
    let width = 9; let next = 258; let previous = -1; let started = false;
    const read = () => {
        while (pending < width) {
            if (offset >= bytes.length) invalid();
            buffer = buffer << 8 | bytes[offset++]; pending += 8;
        }
        pending -= width;
        return buffer >>> pending & (1 << width) - 1;
    };
    while (true) {
        const code = read();
        if (!started && code !== 256) invalid();
        if (code === 256) { started = true; width = 9; next = 258; previous = -1; continue; }
        if (code === 257) {
            if (target !== expected || offset !== bytes.length || pending >= 8) invalid();
            return output;
        }
        const repeated = code === next;
        if (code > next || repeated && previous < 0 || previous < 0 && code > 255) invalid();
        let current = repeated ? previous : code; let length = 0;
        while (current >= 258) {
            if (current >= next || length >= stack.length - 1) invalid();
            stack[length++] = suffix[current]; current = prefix[current];
        }
        if (current > 255) invalid();
        stack[length++] = current;
        if (target + length + (repeated ? 1 : 0) > expected) invalid();
        for (let i = length - 1; i >= 0; i--) output[target++] = stack[i];
        if (repeated) output[target++] = current;
        if (previous >= 0 && next < 4096) {
            prefix[next] = previous; suffix[next] = current; next++;
            if (width < 12 && next === (1 << width) - 1) width++;
        }
        previous = code;
    }
}
