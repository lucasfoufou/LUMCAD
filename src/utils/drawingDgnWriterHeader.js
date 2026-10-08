import { writeDrawingDgnInt32 } from './drawingDgnNumbers.js';

/** Shared V7 graphic header and conservative binary-offset display range. */
export function writeDrawingDgnHeader(type, length, bounds, {
    uorPerMaster = 100000, originUor = { x: 0, y: 0 }, level = 1, color = 0,
    weight = 0, style = 0, graphicGroup = 0, complex = false,
} = {}) {
    if (!Number.isSafeInteger(uorPerMaster) || uorPerMaster <= 0
        || ![originUor?.x, originUor?.y].every(Number.isFinite)) throw new Error('dgnRange');
    for (const [value, maximum] of [[level, 63], [color, 255], [weight, 31], [style, 7], [graphicGroup, 65535]]) {
        if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error('dgnRange');
    }
    if (!Number.isInteger(length) || length < 36 || length % 2 || length > 131074) throw new Error('dgnLimit');
    const bytes = new Uint8Array(length); const view = new DataView(bytes.buffer);
    bytes[0] = level | (complex ? 128 : 0); bytes[1] = type;
    view.setUint16(2, (length - 4) / 2, true);
    view.setUint16(28, graphicGroup, true); view.setUint16(30, (length - 32) / 2, true);
    bytes[34] = style | weight << 3; bytes[35] = color;
    const coordinate = (value, axis) => value * uorPerMaster + originUor[axis];
    if (!bounds) throw new Error('dgnGeometry');
    const range = [Math.floor(coordinate(bounds.minX, 'x')), Math.floor(coordinate(bounds.minY, 'y')), 0,
        Math.ceil(coordinate(bounds.maxX, 'x')), Math.ceil(coordinate(bounds.maxY, 'y')), 0];
    range.forEach((value, index) => {
        const offset = 4 + index * 4;
        writeDrawingDgnInt32(view, offset, value);
        bytes[offset + 1] ^= 128; // Display ranges use unsigned binary-offset coordinates.
    });
    return bytes;
}
