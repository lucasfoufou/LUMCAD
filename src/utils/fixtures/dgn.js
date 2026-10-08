// Hand-authored ISFF layouts, independent of the production readers.
export function dgnSeed() {
    const bytes = new Uint8Array(1536); const view = new DataView(bytes.buffer);
    bytes.set([8, 9, 0xfe, 2]);
    // High-word first, independently authored integer encodings for 1000 and 100.
    bytes.set([0, 0, 0xe8, 3], 1112); bytes.set([0, 0, 100, 0], 1116);
    bytes.set([109, 32, 109, 109], 1120);
    // VAX D constants: 1.25 and -0.5 UOR global origins.
    bytes.set([0xa0, 0x40, 0, 0, 0, 0, 0, 0], 1240);
    bytes.set([0, 0xc0, 0, 0, 0, 0, 0, 0], 1248);
    return { bytes, view };
}
export function dgnFile(...records) {
    const { bytes } = dgnSeed();
    return Uint8Array.from([...bytes, ...records.flatMap(record => [...record]), 255, 255]);
}

export function dgnElement(type, length) {
    const bytes = new Uint8Array(length); const view = new DataView(bytes.buffer);
    bytes[0] = 7; bytes[1] = type; view.setUint16(2, (length - 4) / 2, true);
    bytes[34] = (5 << 3) | 2; bytes[35] = 83;
    const integer = (offset, value) => { view.setUint16(offset, value >>> 16, true); view.setUint16(offset + 2, value & 65535, true); };
    return { record: { type, bytes }, bytes, view, integer };
}


export function dgnComplexGroup(type, children) {
    const members = children.flatMap(child => Array.isArray(child) ? child : [child]);
    const parent = dgnElement(type, 48); parent.bytes[0] |= 128; parent.bytes[34] = 0;
    parent.view.setUint16(36, (48 + members.reduce((size, bytes) => size + bytes.length, 0) - 38) / 2, true);
    parent.view.setUint16(38, children.length, true);
    return [parent.bytes, ...members];
}

export function dgnCellGroup(children) {
    const members = children.flatMap(child => Array.isArray(child) ? child : [child]);
    const parent = dgnElement(2, 92); parent.bytes[0] |= 128; parent.bytes[34] = 0;
    parent.view.setUint16(36, (92 + members.reduce((size, bytes) => size + bytes.length, 0) - 38) / 2, true);
    parent.view.setUint16(38, 8 * 1600 + 15 * 40 + 12, true); // HOL
    parent.view.setUint16(40, 5 * 1600 + 19 * 40, true); // ES
    [-1000000, -1000000, 1000000, 1000000].forEach((v, i) => parent.integer(52 + 4 * i, v));
    parent.integer(68, 2147483647); parent.integer(80, 2147483647);
    return [parent.bytes, ...members];
}

export function dgnRectangleShape(x, y, width, height, { hole = false, fill = null } = {}) {
    const value = dgnElement(6, fill === null ? 78 : 94); value.bytes[0] |= 128; value.bytes[34] = 0; value.bytes[35] = 3;
    value.view.setUint16(36, 5, true);
    [x, y, x + width, y, x + width, y + height, x, y + height, x, y]
        .forEach((v, i) => value.integer(38 + i * 4, v * 100000));
    value.view.setUint16(32, (hole ? 0x8000 : 0) | (fill === null ? 0 : 0x800), true);
    if (fill !== null) {
        value.view.setUint16(30, 23, true);
        value.bytes.set([7, 16, 65, 0, 2, 8, 1, 0, fill, 0, 0, 0, 0, 0, 0, 0], 78);
    }
    return value.bytes;
}
