import { writeDrawingDgnHeader } from './drawingDgnWriterHeader.js';
import { writeDrawingDgnInt32 } from './drawingDgnNumbers.js';

/** Encode prepared V7 text in Y-up master units, with a bottom-left origin. */
export function writeDrawingDgnText(source, options = {}) {
    const { uorPerMaster = 100000, originUor = { x: 0, y: 0 } } = options;
    if (typeof source?.text !== 'string' || !source.text.length || /[^\x20-\x7e]/.test(source.text)) throw new Error('dgnUnsupported');
    if (source.text.length > 255) throw new Error('dgnLimit');
    const { fontId = 1, justification = 2, rotation = 0, characterWidth, characterHeight, origin } = source;
    if (!Number.isInteger(fontId) || fontId < 0 || fontId > 255
        || ![0, 1, 2, 6, 7, 8, 12, 13, 14].includes(justification)
        || ![rotation, characterWidth, characterHeight, origin?.x, origin?.y].every(Number.isFinite)
        || characterWidth <= 0 || characterHeight <= 0) throw new Error('dgnRange');
    if (options.fillColor != null) throw new Error('dgnUnsupported');
    const width = Math.round(characterWidth * uorPerMaster * 1000 / 6);
    const height = Math.round(characterHeight * uorPerMaster * 1000 / 6);
    if (width < 1 || height < 1) throw new Error('dgnRange');
    const angle = Math.round((rotation % 360) * 360000);
    const radians = angle / 360000 * Math.PI / 180;
    const x = Math.round(origin.x * uorPerMaster + originUor.x);
    const y = Math.round(origin.y * uorPerMaster + originUor.y);
    const base = { x: (x - originUor.x) / uorPerMaster, y: (y - originUor.y) / uorPerMaster };
    const w = width / uorPerMaster * 6 / 1000 * source.text.length;
    const h = height / uorPerMaster * 6 / 1000;
    const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([dx, dy]) => ({
        x: base.x + dx * Math.cos(radians) - dy * Math.sin(radians),
        y: base.y + dx * Math.sin(radians) + dy * Math.cos(radians),
    }));
    const bounds = { minX: Math.min(...corners.map(p => p.x)), minY: Math.min(...corners.map(p => p.y)),
        maxX: Math.max(...corners.map(p => p.x)), maxY: Math.max(...corners.map(p => p.y)) };
    const length = 60 + source.text.length + source.text.length % 2;
    const bytes = writeDrawingDgnHeader(17, length, bounds, options);
    const view = new DataView(bytes.buffer);
    bytes[36] = fontId; bytes[37] = justification;
    writeDrawingDgnInt32(view, 38, width); writeDrawingDgnInt32(view, 42, height);
    writeDrawingDgnInt32(view, 46, angle);
    writeDrawingDgnInt32(view, 50, x); writeDrawingDgnInt32(view, 54, y);
    bytes[58] = source.text.length;
    for (let i = 0; i < source.text.length; i++) bytes[60 + i] = source.text.charCodeAt(i);
    return bytes;
}
