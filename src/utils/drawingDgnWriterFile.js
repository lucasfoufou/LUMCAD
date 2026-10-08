import { readDrawingDgnRecords } from './drawingDgnRecords.js';
import { writeDrawingDgnInt32, writeDrawingDgnVaxDouble } from './drawingDgnNumbers.js';
import { writeDrawingDgnElements } from './drawingDgnWriterElements.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';

/** Assemble a metre-based 2D V7 file from an explicit seed and supported model primitives. */
export function writeDrawingDgnFile(elements, { seed, uorPerSubunit = 100, originUor = { x: 0, y: 0 },
    maxBytes = 64 * 1024 * 1024, maxRecords = 100000 } = {}) {
    if (!Array.isArray(elements) || !elements.length) throw new Error('dgnEmpty');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1538 || maxBytes > 64 * 1024 * 1024
        || !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 100000
        || !Number.isInteger(uorPerSubunit) || uorPerSubunit < 1 || uorPerSubunit > 1000000
        || ![originUor?.x, originUor?.y].every(Number.isFinite)) throw new Error('dgnLimit');
    const parsed = readDrawingDgnRecords(seed, { maxBytes, maxRecords });
    if (parsed.header.dimension !== 2) throw new Error('dgnUnsupported');
    const tcb = parsed.records[0].bytes.slice(); const view = new DataView(tcb.buffer);
    writeDrawingDgnInt32(view, 1112, 1000);
    writeDrawingDgnInt32(view, 1116, uorPerSubunit);
    tcb.set([109, 32, 109, 109], 1120); // master metres / subunit millimetres
    writeDrawingDgnVaxDouble(view, 1240, originUor.x);
    writeDrawingDgnVaxDouble(view, 1248, originUor.y);
    writeDrawingDgnVaxDouble(view, 1256, 0);
    // Preserve seed digitizer/level setup, never its drawing objects or old color table.
    const records = [tcb, ...parsed.records.slice(1).filter(record => !record.deleted && [8, 10].includes(record.type)).map(record => record.bytes)];
    let length = records.reduce((sum, bytes) => sum + bytes.length, 2);
    const options = { uorPerMaster: 1000 * uorPerSubunit, originUor };
    if (records.length + elements.length > maxRecords || length > maxBytes) throw new Error('dgnLimit');
    for (const element of elements) {
        if (!element?.geometry || element.appearance?.complex) throw new Error('dgnUnsupported');
        const geometry = element.geometry.type === 'dgnText'
            ? { ...element.geometry, origin: { x: element.geometry.origin?.x, y: -element.geometry.origin?.y }, rotation: -(element.geometry.rotation || 0) }
            : transformDrawingEntityAffine(element.geometry, { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 });
        const group = writeDrawingDgnElements(geometry, { ...element.appearance, ...options });
        length += group.reduce((sum, bytes) => sum + bytes.length, 0);
        if (length > maxBytes || records.length + group.length > maxRecords) throw new Error('dgnLimit');
        records.push(...group);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const record of records) { bytes.set(record, offset); offset += record.length; }
    bytes.set([255, 255], offset);
    return bytes;
}
