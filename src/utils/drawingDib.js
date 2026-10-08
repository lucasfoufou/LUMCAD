/** Decode packed Windows/OS2 DIB pixels without browser format guessing. */
export function decodeDrawingDib(input, { maxPixels = 16000000, maxBytes = 64 * 1024 * 1024, colorUsage = 0, scanCount } = {}) {
    if (!Number.isSafeInteger(maxPixels) || maxPixels < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('wmfLimit');
    if (!(input instanceof Uint8Array) || input.byteLength < 12) throw new Error('wmfInvalidBitmap');
    if (input.byteLength > maxBytes) throw new Error('wmfLimit');
    if (colorUsage !== 0) throw new Error('wmfUnsupportedBitmapPalette');
    const data = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const headerSize = data.getUint32(0, true);
    if (![12, 40].includes(headerSize)) throw new Error('wmfUnsupportedBitmapHeader');
    if (input.byteLength < headerSize) throw new Error('wmfInvalidBitmap');
    const core = headerSize === 12;
    const width = core ? data.getUint16(4, true) : data.getInt32(4, true);
    const signedHeight = core ? data.getUint16(6, true) : data.getInt32(8, true);
    const sourceHeight = Math.abs(signedHeight);
    const height = scanCount ?? sourceHeight;
    if (!Number.isSafeInteger(height) || height < 1 || height > sourceHeight) throw new Error('wmfInvalidBitmap');
    const planes = data.getUint16(core ? 8 : 12, true); const bits = data.getUint16(core ? 10 : 14, true);
    if (width <= 0 || !height || planes !== 1) throw new Error('wmfInvalidBitmap');
    if (!Number.isSafeInteger(width * height) || width * height > maxPixels) throw new Error('wmfLimit');
    const compression = core ? 0 : data.getUint32(16, true);
    if (![1, 4, 8, 16, 24, 32].includes(bits) || ![0, 1, 2, 3].includes(compression)
        || (compression === 1 && bits !== 8) || (compression === 2 && bits !== 4)
        || (compression === 3 && ![16, 32].includes(bits))) throw new Error('wmfUnsupportedBitmapCompression');
    if (core && [16, 32].includes(bits)) throw new Error('wmfUnsupportedBitmapHeader');
    const used = core ? 0 : data.getUint32(32, true);
    const paletteLength = bits < 16 ? Math.min(used || 2 ** bits, 2 ** bits) : used;
    const entrySize = core ? 3 : 4;
    const maskBytes = compression === 3 ? 12 : 0;
    if (input.byteLength < headerSize + maskBytes) throw new Error('wmfInvalidBitmap');
    const masks = compression === 3 ? [0, 4, 8].map(offset => data.getUint32(headerSize + offset, true)) : null;
    const channels = masks?.map(mask => bitmapChannel(mask, bits));
    if (masks && ((masks[0] & masks[1]) || (masks[0] & masks[2]) || (masks[1] & masks[2]))) throw new Error('wmfInvalidBitmapMasks');
    const offset = headerSize + maskBytes + paletteLength * entrySize;
    if (offset > input.byteLength) throw new Error('wmfInvalidBitmap');
    if (compression === 1 || compression === 2) {
        if (height !== sourceHeight) throw new Error('wmfUnsupportedBitmapScan');
        if (signedHeight < 0) throw new Error('wmfInvalidBitmap');
        const imageSize = data.getUint32(20, true);
        if (!imageSize || offset + imageSize !== input.byteLength) throw new Error('wmfInvalidBitmap');
        return { width, height, pixels: decodeRle(input, offset, width, height, bits, paletteLength) };
    }
    const stride = Math.ceil(width * bits / 32) * 4;
    const required = offset + stride * height;
    if (!Number.isSafeInteger(required) || required > maxBytes) throw new Error('wmfLimit');
    if (required !== input.byteLength) throw new Error('wmfInvalidBitmap');
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const row = offset + (signedHeight > 0 ? height - 1 - y : y) * stride;
        for (let x = 0; x < width; x++) {
            const target = (y * width + x) * 4;
            let r; let g; let b;
            if (bits < 16) {
                const byte = input[row + Math.floor(x * bits / 8)];
                const index = bits === 8 ? byte : bits === 4 ? (byte >> (x % 2 ? 0 : 4)) & 15 : (byte >> (7 - x % 8)) & 1;
                if (index >= paletteLength) throw new Error('wmfInvalidBitmapPalette');
                const source = headerSize + index * entrySize;
                b = input[source]; g = input[source + 1]; r = input[source + 2];
            } else if (channels) {
                const value = bits === 16 ? data.getUint16(row + x * 2, true) : data.getUint32(row + x * 4, true);
                r = channels[0](value); g = channels[1](value); b = channels[2](value);
            } else if (bits === 16) {
                const value = data.getUint16(row + x * 2, true);
                r = Math.round(((value >> 10) & 31) * 255 / 31);
                g = Math.round(((value >> 5) & 31) * 255 / 31); b = Math.round((value & 31) * 255 / 31);
            } else {
                const source = row + x * bits / 8;
                b = input[source]; g = input[source + 1]; r = input[source + 2];
            }
            // BI_RGB's fourth byte is reserved, not an alpha channel.
            pixels[target] = r; pixels[target + 1] = g; pixels[target + 2] = b; pixels[target + 3] = 255;
        }
    }
    return { width, height, pixels };
}

function bitmapChannel(mask, bits) {
    if (!mask || mask >= 2 ** bits) throw new Error('wmfInvalidBitmapMasks');
    let shift = 0; let run = mask;
    while (run % 2 === 0) { run /= 2; shift++; }
    const size = Math.log2(run + 1);
    if (!Number.isInteger(size)) throw new Error('wmfInvalidBitmapMasks');
    return value => Math.round((Math.floor(value / 2 ** shift) % 2 ** size) * 255 / run);
}

/** RLE rows start at the bottom. Unwritten pixels retain transparency. */
function decodeRle(input, offset, width, height, bits, paletteLength) {
    const pixels = new Uint8Array(width * height * 4);
    let position = offset; let x = 0; let y = 0;
    const requireBytes = count => {
        if (position + count > input.length) throw new Error('wmfInvalidBitmap');
    };
    const put = index => {
        if (x >= width || y >= height) throw new Error('wmfInvalidBitmap');
        if (index >= paletteLength) throw new Error('wmfInvalidBitmapPalette');
        const target = ((height - 1 - y) * width + x++) * 4;
        const source = 40 + index * 4;
        pixels[target] = input[source + 2]; pixels[target + 1] = input[source + 1];
        pixels[target + 2] = input[source]; pixels[target + 3] = 255;
    };
    while (position < input.length) {
        requireBytes(2);
        const count = input[position++]; const value = input[position++];
        if (count) {
            for (let i = 0; i < count; i++) put(bits === 8 ? value : (value >> (i % 2 ? 0 : 4)) & 15);
        } else if (value === 0) {
            x = 0; y++;
            if (y > height) throw new Error('wmfInvalidBitmap');
        } else if (value === 1) {
            if (position !== input.length) throw new Error('wmfInvalidBitmap');
            return pixels;
        } else if (value === 2) {
            requireBytes(2);
            x += input[position++]; y += input[position++];
            if (x > width || y >= height) throw new Error('wmfInvalidBitmap');
        } else {
            const bytes = Math.ceil(value * bits / 8);
            const padded = bytes + bytes % 2;
            requireBytes(padded);
            for (let i = 0; i < value; i++) {
                const byte = input[position + Math.floor(i * bits / 8)];
                put(bits === 8 ? byte : (byte >> (i % 2 ? 0 : 4)) & 15);
            }
            position += padded;
        }
    }
    throw new Error('wmfInvalidBitmap');
}
