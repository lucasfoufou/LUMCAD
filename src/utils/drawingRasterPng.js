import { zlibSync } from 'fflate';
import { crc32 } from './boundedZip.js';

/** Lossless RGBA PNG encoding for decoded resources, without a browser/canvas dependency. */
export function encodeDrawingRasterPng({ width, height, pixels }) {
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384)
        || width * height > 16000000 || !(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) {
        throw new Error('rasterInvalid');
    }
    const stride = width * 4; const scanlines = new Uint8Array((stride + 1) * height);
    for (let row = 0; row < height; row++) scanlines.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
    const header = new Uint8Array(13); const view = new DataView(header.buffer);
    view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
    const chunks = [pngChunk('IHDR', header), pngChunk('IDAT', zlibSync(scanlines)), pngChunk('IEND', new Uint8Array())];
    const output = new Uint8Array(8 + chunks.reduce((size, chunk) => size + chunk.length, 0));
    output.set([137, 80, 78, 71, 13, 10, 26, 10]); let offset = 8;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
}

function pngChunk(type, bytes) {
    const output = new Uint8Array(bytes.length + 12); const view = new DataView(output.buffer);
    view.setUint32(0, bytes.length);
    for (let i = 0; i < 4; i++) output[4 + i] = type.charCodeAt(i);
    output.set(bytes, 8); view.setUint32(output.length - 4, crc32(output.subarray(4, output.length - 4)));
    return output;
}
