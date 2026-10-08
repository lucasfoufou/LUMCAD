/** Write a packed BITMAPINFOHEADER with bottom-up, DWORD-aligned 24-bit BGR rows. */
export function encodeDrawingDib({ width, height, pixels }, { maxPixels = 16000000, maxBytes = 64 * 1024 * 1024 } = {}) {
    if (![maxPixels, maxBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('wmfLimit');
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 32767)
        || !(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) throw new Error('wmfInvalidBitmap');
    const stride = Math.ceil(width * 3 / 4) * 4;
    const size = stride * height;
    if (width * height > maxPixels || size + 40 > maxBytes) throw new Error('wmfLimit');
    // Classic SRCCOPY does not retain alpha. Never silently flatten transparent pixels.
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) throw new Error('wmfExportTransparency');
    const bytes = new Uint8Array(40 + size); const data = new DataView(bytes.buffer);
    data.setUint32(0, 40, true); data.setInt32(4, width, true); data.setInt32(8, height, true);
    data.setUint16(12, 1, true); data.setUint16(14, 24, true); data.setUint32(20, size, true);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const source = (y * width + x) * 4; const target = 40 + (height - 1 - y) * stride + x * 3;
        bytes[target] = pixels[source + 2]; bytes[target + 1] = pixels[source + 1]; bytes[target + 2] = pixels[source];
    }
    return bytes;
}
