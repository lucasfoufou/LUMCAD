import { drawingDgnInt32, drawingDgnVaxDouble } from './drawingDgnNumbers.js';

// ISFF element/TCB layout cross-checked against GDAL's public DGN reader:
// https://github.com/OSGeo/gdal/blob/master/ogr/ogrsf_frmts/dgn/dgnread.cpp
const invalid = () => { throw new Error('dgnInvalid'); };
const unsupported = () => { throw new Error('dgnUnsupported'); };

/** Snapshot and validate V7 element boundaries before geometry interpretation. */
export function readDrawingDgnRecords(input, { maxBytes = 64 * 1024 * 1024, maxRecords = 100000 } = {}) {
    if (![maxBytes, maxRecords].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('dgnLimit');
    const source = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
    if (!source || source.length < 4 || source.length % 2) invalid();
    if (source.length > maxBytes) throw new Error('dgnLimit');
    // V8 is a compound document; cell libraries have a separate V7 header.
    if ([0xd0, 0xcf, 0x11, 0xe0].every((value, i) => source[i] === value)
        || source[0] === 8 && source[1] === 5 && source[2] === 0x17 && source[3] === 0) unsupported();
    if (![8, 0xc8].includes(source[0]) || source[1] !== 9 || source[2] !== 0xfe || source[3] !== 2) invalid();
    const bytes = Uint8Array.from(source); const view = new DataView(bytes.buffer);
    const records = []; let offset = 0; let ended = false;
    while (offset < bytes.length) {
        if (bytes[offset] === 255 && bytes[offset + 1] === 255) { offset += 2; ended = true; break; }
        if (records.length >= maxRecords) throw new Error('dgnLimit');
        if (bytes.length - offset < 4) invalid();
        const words = view.getUint16(offset + 2, true); const length = 4 + words * 2;
        if (length > bytes.length - offset) invalid();
        const type = bytes[offset + 1] & 127;
        if (!type) invalid();
        records.push({ index: records.length, offset, length, type, level: bytes[offset] & 63,
            complex: Boolean(bytes[offset] & 128), deleted: Boolean(bytes[offset + 1] & 128),
            bytes: bytes.subarray(offset, offset + length) });
        offset += length;
    }
    if (!ended || !records.length) invalid();
    const tcb = records[0];
    if (tcb.length !== 1536 || tcb.deleted) invalid();
    const subunitsPerMaster = drawingDgnInt32(view, 1112);
    const uorPerSubunit = drawingDgnInt32(view, 1116);
    const uorPerMaster = subunitsPerMaster * uorPerSubunit;
    if (subunitsPerMaster <= 0 || uorPerSubunit <= 0 || !Number.isSafeInteger(uorPerMaster)) invalid();
    const label = offset => String.fromCharCode(bytes[offset], bytes[offset + 1]).replace(/\0/g, '').trim();
    const originUor = { x: drawingDgnVaxDouble(view, 1240), y: drawingDgnVaxDouble(view, 1248), z: drawingDgnVaxDouble(view, 1256) };
    return { records, trailingBytes: bytes.length - offset, header: { version: 7, dimension: bytes[1214] & 64 ? 3 : 2,
        masterUnit: label(1120), subUnit: label(1122), subunitsPerMaster, uorPerSubunit, uorPerMaster, originUor } };
}
