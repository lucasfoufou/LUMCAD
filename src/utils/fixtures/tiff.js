/** Small independent TIFF directory/strip builder for decoder boundary tests. */
export function tiffFixture({ little = true, width = 2, height = 2, samples = 3, depth = 8,
    photo = 2, compression = 1, rows = 1, strips = [[255, 0, 0, 0, 255, 0], [0, 0, 255, 255, 255, 0]], tags = [] } = {}) {
    const entries = new Map([
        [256, [4, [width]]], [257, [4, [height]]], [258, [3, Array(samples).fill(depth)]],
        [259, [3, [compression]]], [262, [3, [photo]]], [273, [4, strips.map(() => 0)]],
        [277, [3, [samples]]], [278, [4, [rows]]], [279, [4, strips.map(strip => strip.length)]],
        [282, [5, [[192, 1]]]], [283, [5, [[96, 1]]]], [296, [3, [2]]],
    ]);
    for (const [tag, type, values] of tags) {
        if (type === null) entries.delete(tag); else entries.set(tag, [type, values]);
    }
    let offset = 8 + 2 + entries.size * 12 + 4;
    const positions = new Map();
    for (const [tag, [type, values]] of entries) {
        const length = values.length * (type === 3 ? 2 : type === 5 ? 8 : 4);
        if (length > 4) { positions.set(tag, offset); offset += length; }
    }
    const stripOffsets = strips.map(strip => { const start = offset; offset += strip.length; return start; });
    entries.set(273, [4, stripOffsets]);
    const bytes = new Uint8Array(offset); const view = new DataView(bytes.buffer);
    view.setUint16(0, little ? 0x4949 : 0x4d4d); view.setUint16(2, 42, little); view.setUint32(4, 8, little);
    view.setUint16(8, entries.size, little); let i = 0;
    for (const [tag, [type, values]] of entries) {
        const p = 10 + i++ * 12; view.setUint16(p, tag, little); view.setUint16(p + 2, type, little);
        view.setUint32(p + 4, values.length, little);
        const start = positions.get(tag) ?? p + 8;
        if (positions.has(tag)) view.setUint32(p + 8, start, little);
        values.forEach((value, j) => {
            if (type === 3) view.setUint16(start + j * 2, value, little);
            else if (type === 4) view.setUint32(start + j * 4, value, little);
            else { view.setUint32(start + j * 8, value[0], little); view.setUint32(start + j * 8 + 4, value[1], little); }
        });
    }
    strips.forEach((strip, index) => bytes.set(strip, stripOffsets[index]));
    return bytes;
}
