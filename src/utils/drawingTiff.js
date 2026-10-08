import { decodeDrawingCcitt } from './drawingCcitt.js';
import { decodeDrawingTiffLzw } from './drawingTiffLzw.js';

const invalid = () => { throw new Error('tiffInvalid'); };
const unsupported = () => { throw new Error('tiffUnsupported'); };
const limit = () => { throw new Error('tiffLimit'); };
const tagTypes = new Map([
    [256, [3, 4]], [257, [3, 4]], [258, [3]], [259, [3]], [262, [3]], [266, [3]],
    [273, [3, 4]], [277, [3]], [278, [3, 4]], [279, [3, 4]], [282, [5]], [283, [5]],
    [284, [3]], [292, [4]], [293, [4]], [296, [3]], [317, [3]], [320, [3]], [338, [3]], [339, [3]],
]);

/** Decode the first TIFF 6 directory into owned RGBA pixels; orientation remains in file order. */
export function decodeDrawingTiff(bytes, { maxPixels = 16000000, maxBytes = 32 * 1024 * 1024 } = {}) {
    if (![maxPixels, maxBytes].every(value => Number.isSafeInteger(value) && value > 0)) limit();
    if (!(bytes instanceof Uint8Array) || bytes.length < 8) invalid();
    if (bytes.length > maxBytes) limit();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const order = view.getUint16(0); const little = order === 0x4949;
    if (![0x4949, 0x4d4d].includes(order)) invalid();
    if (view.getUint16(2, little) !== 42) unsupported();
    const directory = view.getUint32(4, little);
    if (directory < 8 || directory + 2 > bytes.length) invalid();
    const count = view.getUint16(directory, little);
    if (count > 1024) limit();
    if (directory + 2 + count * 12 + 4 > bytes.length) invalid();
    const tags = new Map(); const seen = new Set(); let valuesRead = 0;
    for (let i = 0; i < count; i++) {
        const entry = directory + 2 + i * 12; const tag = view.getUint16(entry, little);
        if (seen.has(tag)) invalid(); seen.add(tag);
        // Tiled storage and embedded color profiles need their own decoders, not silent fallbacks.
        if ([322, 323, 324, 325, 34675].includes(tag)) unsupported();
        if (!tagTypes.has(tag)) continue;
        const type = view.getUint16(entry + 2, little); const length = view.getUint32(entry + 4, little);
        if (!tagTypes.get(tag).includes(type) || !length) invalid();
        valuesRead += length; if (valuesRead > 1000000) limit();
        const size = type === 3 ? 2 : type === 4 ? 4 : 8;
        const start = length * size <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
        if (start < 8 || start + length * size > bytes.length) invalid();
        const values = [];
        for (let j = 0; j < length; j++) {
            const p = start + j * size;
            if (type === 3) values.push(view.getUint16(p, little));
            else if (type === 4) values.push(view.getUint32(p, little));
            else {
                const numerator = view.getUint32(p, little); const denominator = view.getUint32(p + 4, little);
                if (!denominator || !numerator) invalid();
                values.push(numerator / denominator);
            }
        }
        tags.set(tag, values);
    }
    const scalar = (tag, fallback) => {
        const values = tags.get(tag);
        if (!values) { if (fallback === undefined) invalid(); return fallback; }
        if (values.length !== 1) invalid();
        return values[0];
    };
    const width = scalar(256); const height = scalar(257);
    if (!width || !height) invalid();
    if (width > 16384 || height > 16384 || width * height > maxPixels) limit();
    const samples = scalar(277, 1); const photo = scalar(262);
    if (![0, 1, 2, 3].includes(photo) || scalar(284, 1) !== 1) unsupported();
    const colors = photo === 2 ? 3 : 1;
    const extra = tags.get(338) || [];
    if (samples !== colors + extra.length || extra.length > 1 || extra.some(value => ![0, 1, 2].includes(value))) unsupported();
    if (photo === 3 && extra.length) unsupported();
    const bits = tags.get(258) || Array(samples).fill(1); const depth = bits[0];
    if (bits.length !== samples) invalid();
    if (!bits.every(value => value === depth) || ![1, 2, 4, 8, 16].includes(depth)
        || photo === 2 && depth < 8 || photo === 3 && depth > 8) unsupported();
    const formats = tags.get(339);
    if (formats && (formats.length !== samples || formats.some(value => value !== 1))) unsupported();
    const fillOrder = scalar(266, 1); if (![1, 2].includes(fillOrder)) invalid();
    const compression = scalar(259, 1); if (![1, 2, 3, 4, 5, 32773].includes(compression)) unsupported();
    const fax = [2, 3, 4].includes(compression);
    if (fax && (depth !== 1 || samples !== 1 || ![0, 1].includes(photo))) unsupported();
    const t4Options = compression === 3 ? scalar(292, 0) : 0;
    const t6Options = compression === 4 ? scalar(293, 0) : 0;
    const predictor = scalar(317, 1);
    if (![1, 2].includes(predictor) || predictor === 2 && compression !== 5) unsupported();
    const rowsPerStrip = scalar(278, 0xffffffff); if (!rowsPerStrip) invalid();
    const strips = Math.ceil(height / rowsPerStrip);
    const offsets = tags.get(273); const counts = tags.get(279);
    if (offsets?.length !== strips || counts?.length !== strips) invalid();
    const palette = tags.get(320); const paletteSize = 2 ** depth;
    if (photo === 3 && palette?.length !== 3 * paletteSize) invalid();
    const rowBytes = Math.ceil(width * samples * depth / 8);
    const pixels = new Uint8Array(width * height * 4); const maximum = 2 ** depth - 1;
    let encodedWork = 0;
    for (let strip = 0; strip < strips; strip++) {
        const start = offsets[strip]; const length = counts[strip];
        if (start < 8 || !length || start + length > bytes.length) invalid();
        const firstRow = strip * rowsPerStrip; const rows = Math.min(rowsPerStrip, height - firstRow);
        encodedWork += length; if (encodedWork > 64 * 1024 * 1024) limit();
        const source = bytes.subarray(start, start + length);
        const encoded = fillOrder === 2 ? source.map(reverseByte) : source;
        const data = compression === 1 ? encoded : fax
            ? decodeDrawingCcitt(encoded, { width, rows, compression, t4Options, t6Options }) : compression === 5
            ? decodeDrawingTiffLzw(encoded, rowBytes * rows) : unpackTiffBits(encoded, rowBytes, rows);
        if (data.length !== rowBytes * rows) invalid();
        if (predictor === 2) restoreHorizontalSamples(data, { width, rows, samples, depth, rowBytes, little });
        const byteAt = index => data[index];
        const component = (row, index) => {
            const bit = index * depth; const offset = row * rowBytes + Math.floor(bit / 8);
            if (depth === 16) return little ? byteAt(offset) + byteAt(offset + 1) * 256 : byteAt(offset) * 256 + byteAt(offset + 1);
            return byteAt(offset) >> (8 - depth - bit % 8) & maximum;
        };
        for (let row = 0; row < rows; row++) for (let x = 0; x < width; x++) {
            const index = x * samples; const target = ((firstRow + row) * width + x) * 4;
            const alpha = extra[0] === 1 || extra[0] === 2 ? component(row, index + colors) : maximum;
            for (let channel = 0; channel < 3; channel++) {
                let value;
                if (photo === 3) value = (palette[channel * paletteSize + component(row, index)] >>> 8) / 255;
                else {
                    value = component(row, index + (photo === 2 ? channel : 0)) / maximum;
                    if (photo === 0) value = 1 - value;
                    if (extra[0] === 1) value = alpha ? Math.min(1, value * maximum / alpha) : 0;
                }
                pixels[target + channel] = Math.round(value * 255);
            }
            pixels[target + 3] = Math.round(alpha * 255 / maximum);
        }
    }
    const resolutionUnit = scalar(296, 2); if (![1, 2, 3].includes(resolutionUnit)) invalid();
    const fallbackResolution = resolutionUnit === 3 ? 96 / 2.54 : 96;
    const xResolution = scalar(282, fallbackResolution); const yResolution = scalar(283, fallbackResolution);
    return { width, height, pixels, xResolution, yResolution, resolutionUnit };
}

function reverseByte(value) {
    value = (value & 0x55) << 1 | (value >> 1) & 0x55;
    value = (value & 0x33) << 2 | (value >> 2) & 0x33;
    return (value & 0x0f) << 4 | value >> 4;
}

/** TIFF PackBits runs cannot cross a scanline; decoded size is fixed before allocating. */
function unpackTiffBits(bytes, rowBytes, rows) {
    const output = new Uint8Array(rowBytes * rows); let source = 0; let target = 0;
    while (source < bytes.length) {
        const control = bytes[source++];
        if (control === 128) continue;
        const length = control < 128 ? control + 1 : 257 - control;
        const available = rowBytes - target % rowBytes;
        if (length > available || target + length > output.length) invalid();
        if (control < 128) {
            if (source + length > bytes.length) invalid();
            output.set(bytes.subarray(source, source + length), target); source += length;
        } else {
            if (source >= bytes.length) invalid();
            output.fill(bytes[source++], target, target + length);
        }
        target += length;
    }
    if (target !== output.length) invalid();
    return output;
}


/** Restore same-channel deltas modulo the sample depth, restarting at every row. */
function restoreHorizontalSamples(data, { width, rows, samples, depth, rowBytes, little }) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const maximum = 2 ** depth - 1;
    for (let row = 0; row < rows; row++) {
        const previous = new Uint16Array(samples);
        for (let index = 0; index < width * samples; index++) {
            const bit = index * depth; const offset = row * rowBytes + Math.floor(bit / 8);
            const shift = 8 - depth - bit % 8; const channel = index % samples;
            const delta = depth === 16 ? view.getUint16(offset, little) : data[offset] >> shift & maximum;
            const value = (delta + previous[channel]) & maximum;
            if (depth === 16) view.setUint16(offset, value, little);
            else data[offset] = (data[offset] & ~(maximum << shift)) | value << shift;
            previous[channel] = value;
        }
    }
}
