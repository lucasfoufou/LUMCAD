// WMF container layout: Microsoft MS-WMF sections 2.3.2.1–2.3.2.3.
// https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-wmf/d169108a-e3fe-436a-bb44-bea61a46ce56
const PLACEABLE_KEY = 0x9ac6cdd7;

/** Decode record boundaries only. No GDI calls, escape execution or partial drawing import. */
export function readDrawingWmfRecords(input, { maxBytes = 64 * 1024 * 1024, maxRecords = 100000 } = {}) {
    if (![maxBytes, maxRecords].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('wmfLimit');
    const source = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
    if (!source || source.byteLength < 24 || source.byteLength % 2) throw new Error('wmfInvalid');
    if (source.byteLength > maxBytes) throw new Error('wmfLimit');
    // Snapshot only the supplied slice; callers may reuse or mutate their input buffer.
    const bytes = Uint8Array.from(source);
    const view = new DataView(bytes.buffer);
    const u16 = offset => view.getUint16(offset, true);
    const i16 = offset => view.getInt16(offset, true);
    const u32 = offset => view.getUint32(offset, true);
    let offset = 0; let placeable = null;
    if (u32(0) === PLACEABLE_KEY) {
        if (bytes.length < 46) throw new Error('wmfInvalid');
        let checksum = 0;
        for (let index = 0; index < 20; index += 2) checksum ^= u16(index);
        if (checksum !== u16(20) || u16(6) === u16(10) || u16(8) === u16(12) || !u16(14)) throw new Error('wmfInvalid');
        placeable = { left: i16(6), top: i16(8), right: i16(10), bottom: i16(12), unitsPerInch: u16(14) };
        offset = 22;
    }
    const header = { type: u16(offset), version: u16(offset + 4), words: u32(offset + 6),
        objects: u16(offset + 10), maxRecordWords: u32(offset + 12) };
    if (![1, 2].includes(header.type) || u16(offset + 2) !== 9 || ![0x100, 0x300].includes(header.version)
        || header.words * 2 !== bytes.length - offset || header.maxRecordWords < 3) throw new Error('wmfInvalid');
    offset += 18;
    const records = []; let ended = false;
    while (offset < bytes.length) {
        if (records.length >= maxRecords) throw new Error('wmfLimit');
        if (bytes.length - offset < 6) throw new Error('wmfInvalid');
        const words = u32(offset); const opcode = u16(offset + 4);
        if (words < 3 || words > header.maxRecordWords || words * 2 > bytes.length - offset) throw new Error('wmfInvalid');
        const end = offset + words * 2;
        if (opcode === 0) {
            if (words !== 3 || end !== bytes.length) throw new Error('wmfInvalid');
            ended = true;
        }
        records.push({ opcode, offset, words, parameters: bytes.subarray(offset + 6, end) });
        offset = end;
    }
    if (!ended) throw new Error('wmfInvalid');
    return { header, placeable, records };
}
