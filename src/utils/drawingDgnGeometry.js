import { drawingDgnInt32, drawingDgnVaxDouble } from './drawingDgnNumbers.js';

const invalid = () => { throw new Error('dgnInvalid'); };

/** Decode an individual V7 element in master units (Y up), retaining uninterpreted linkage data. */
export function readDrawingDgnElementGeometry(record, header, { maxPoints = 4096 } = {}) {
    if (!Number.isSafeInteger(maxPoints) || maxPoints < 2) throw new Error('dgnLimit');
    if (header?.dimension !== 2) throw new Error('dgnUnsupported');
    if (!Number.isSafeInteger(header.uorPerMaster) || header.uorPerMaster <= 0
        || ![header.originUor?.x, header.originUor?.y].every(Number.isFinite)) invalid();
    const bytes = record?.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.length < 4) invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const type = bytes[1] & 127;
    if (type !== record.type || view.getUint16(2, true) * 2 + 4 !== bytes.length) invalid();
    if (bytes[1] & 128) return null;
    if (![2, 3, 4, 6, 12, 14, 15, 16, 17].includes(type)) throw new Error('dgnUnsupported');
    if (bytes.length < 36) invalid();
    const properties = view.getUint16(32, true);
    const end = properties & 0x0800 ? 32 + view.getUint16(30, true) * 2 : bytes.length;
    if (end < 36 || end > bytes.length) invalid();
    const need = length => { if (length > end) invalid(); };
    const coordinate = (value, axis) => {
        const result = (value - header.originUor[axis]) / header.uorPerMaster;
        if (!Number.isFinite(result) || Math.abs(result) > 1e12) throw new Error('dgnLimit');
        return result;
    };
    const point = offset => ({ x: coordinate(drawingDgnInt32(view, offset), 'x'),
        y: coordinate(drawingDgnInt32(view, offset + 4), 'y') });
    let geometry;
    if (type === 2) {
        need(92);
        const radix50 = offset => {
            const value = view.getUint16(offset, true);
            if (value >= 64000) invalid();
            const alphabet = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ$. 0123456789';
            return [1600, 40, 1].map(divisor => alphabet[Math.floor(value / divisor) % 40]).join('');
        };
        geometry = { type: 'dgnCell', totalBytes: 38 + view.getUint16(36, true) * 2,
            name: (radix50(38) + radix50(40)).trimEnd(), classMask: view.getUint16(42, true),
            levelMask: Array.from({ length: 4 }, (_, i) => view.getUint16(44 + i * 2, true)),
            rangeLow: point(52), rangeHigh: point(60), origin: point(84),
            sourceTransform: Array.from({ length: 4 }, (_, i) => drawingDgnInt32(view, 68 + i * 4) / 2147483648) };
        if (geometry.totalBytes < bytes.length || geometry.rangeLow.x > geometry.rangeHigh.x
            || geometry.rangeLow.y > geometry.rangeHigh.y) invalid();
    } else if (type === 12 || type === 14) {
        need(40);
        geometry = { type: 'dgnComplex', closed: type === 14,
            totalBytes: 38 + view.getUint16(36, true) * 2, count: view.getUint16(38, true) };
        if (!geometry.count || geometry.totalBytes < bytes.length) invalid();
    } else if (type === 3) {
        need(52); const first = point(36); const second = point(44);
        geometry = { type: 'line', x1: first.x, y1: first.y, x2: second.x, y2: second.y };
    } else if (type === 4 || type === 6) {
        need(38); const count = view.getUint16(36, true);
        if (count < (type === 6 ? 3 : 2)) invalid();
        if (count > maxPoints) throw new Error('dgnLimit');
        need(38 + count * 8);
        geometry = { type: 'polyline', closed: type === 6, points: Array.from({ length: count }, (_, i) => point(38 + i * 8)) };
    } else if (type === 17) {
        need(60); const count = bytes[58]; need(60 + count);
        const textBytes = bytes.slice(60, 60 + count);
        // V7 font encodings are not universally Unicode; do not guess extended glyphs.
        if (!count || textBytes.some(value => value < 32 || value > 126)) throw new Error('dgnUnsupported');
        const width = drawingDgnInt32(view, 38) / header.uorPerMaster * 6 / 1000;
        const height = drawingDgnInt32(view, 42) / header.uorPerMaster * 6 / 1000;
        if (width <= 0 || height <= 0) invalid();
        if (Math.max(width, height) > 1e12) throw new Error('dgnLimit');
        if (![0, 1, 2, 6, 7, 8, 12, 13, 14].includes(bytes[37])) throw new Error('dgnUnsupported');
        geometry = { type: 'dgnText', text: String.fromCharCode(...textBytes), origin: point(50),
            characterWidth: width, characterHeight: height, rotation: drawingDgnInt32(view, 46) / 360000,
            fontId: bytes[36], justification: bytes[37] };
    } else {
        const arc = type === 16; const offset = arc ? 8 : 0; need(72 + offset);
        const rx = drawingDgnVaxDouble(view, 36 + offset) / header.uorPerMaster;
        const ry = drawingDgnVaxDouble(view, 44 + offset) / header.uorPerMaster;
        if (rx <= 0 || ry <= 0) invalid();
        if (Math.max(rx, ry) > 1e12) throw new Error('dgnLimit');
        const start = arc ? drawingDgnInt32(view, 36) / 360000 : 0;
        const encodedSweep = arc ? drawingDgnInt32(view, 40) >>> 0 : 0;
        const magnitude = encodedSweep & 0x7fffffff;
        const sweep = magnitude ? magnitude / 360000 * (encodedSweep & 0x80000000 ? -1 : 1) : 360;
        if (Math.abs(start) > 360 || Math.abs(sweep) > 360) invalid();
        geometry = { type: 'ellipse', cx: coordinate(drawingDgnVaxDouble(view, 56 + offset), 'x'),
            cy: coordinate(drawingDgnVaxDouble(view, 64 + offset), 'y'), rx, ry,
            rotation: drawingDgnInt32(view, 52 + offset) / 360000, startAngle: start * Math.PI / 180,
            endAngle: (start + sweep) * Math.PI / 180, counterClockwise: sweep > 0, fullEllipse: Math.abs(sweep) === 360 };
    }
    return { geometry, level: bytes[0] & 63, complex: Boolean(bytes[0] & 128),
        graphicGroup: view.getUint16(28, true), properties, colorIndex: bytes[35], weight: bytes[34] >>> 3,
        style: bytes[34] & 7, attributes: bytes.slice(end) };
}
