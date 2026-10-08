/** Encode the MS-WMF container. Record parameters are already little-endian WORDs. */
export function createDrawingWmfWriter({ objects = 0, placeable = null, maxBytes = 64 * 1024 * 1024, maxRecords = 100000 } = {}) {
    if (!Number.isInteger(objects) || objects < 0 || objects > 65535) throw new Error('wmfObjects');
    if (![maxBytes, maxRecords].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('wmfLimit');
    const prefix = placeable ? placeableHeader(placeable) : new Uint8Array();
    const records = []; let byteLength = prefix.length + 24; let maximumWords = 3;
    if (byteLength > maxBytes) throw new Error('wmfLimit');
    return {
        append(opcode, parameters = new Uint8Array()) {
            if (!Number.isInteger(opcode) || opcode <= 0 || opcode > 65535
                || !(parameters instanceof Uint8Array) || parameters.length % 2) throw new Error('wmfInvalid');
            const length = parameters.length + 6;
            if (byteLength + length > maxBytes || records.length + 2 > maxRecords) throw new Error('wmfLimit');
            const record = new Uint8Array(length); const view = new DataView(record.buffer);
            view.setUint32(0, length / 2, true); view.setUint16(4, opcode, true); record.set(parameters, 6);
            records.push(record); byteLength += length; maximumWords = Math.max(maximumWords, length / 2);
        },
        finish() {
            const bytes = new Uint8Array(byteLength); bytes.set(prefix);
            const header = new DataView(bytes.buffer, prefix.length, 18);
            header.setUint16(0, 1, true); header.setUint16(2, 9, true); header.setUint16(4, 0x300, true);
            header.setUint32(6, (byteLength - prefix.length) / 2, true);
            header.setUint16(10, objects, true); header.setUint32(12, maximumWords, true);
            let offset = prefix.length + 18;
            for (const record of records) { bytes.set(record, offset); offset += record.length; }
            new DataView(bytes.buffer).setUint32(offset, 3, true);
            return bytes;
        },
    };
}

function placeableHeader({ left, top, right, bottom, unitsPerInch }) {
    if (![left, top, right, bottom].every(value => Number.isInteger(value) && value >= -32768 && value <= 32767)
        || right <= left || bottom <= top || !Number.isInteger(unitsPerInch) || unitsPerInch < 1 || unitsPerInch > 65535) throw new Error('wmfPlacement');
    const bytes = new Uint8Array(22); const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x9ac6cdd7, true);
    [left, top, right, bottom].forEach((value, i) => view.setInt16(6 + i * 2, value, true));
    view.setUint16(14, unitsPerInch, true);
    let checksum = 0;
    for (let i = 0; i < 20; i += 2) checksum ^= view.getUint16(i, true);
    view.setUint16(20, checksum, true); return bytes;
}

export function drawingWmfWords(...values) {
    if (!values.every(value => Number.isInteger(value) && value >= -32768 && value <= 65535)) throw new Error('wmfPlacement');
    const bytes = new Uint8Array(values.length * 2); const view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setUint16(index * 2, value & 65535, true));
    return bytes;
}
