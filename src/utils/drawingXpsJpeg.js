const invalid = () => { throw new Error('dwfxImage'); };

function exifMetadata(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 8) invalid();
    const order = view.getUint16(0); const little = order === 0x4949;
    if (![0x4949, 0x4d4d].includes(order) || view.getUint16(2, little) !== 42) invalid();
    const offset = view.getUint32(4, little);
    if (offset < 8 || offset + 2 > bytes.length) invalid();
    const count = view.getUint16(offset, little);
    if (count > 1024 || offset + 2 + count * 12 + 4 > bytes.length) invalid();
    const values = new Map();
    let orientationOffset = null;
    for (let i = 0; i < count; i++) {
        const entry = offset + 2 + i * 12; const tag = view.getUint16(entry, little);
        if (![0x112, 0x11a, 0x11b, 0x128].includes(tag)) continue;
        if (values.has(tag) || view.getUint32(entry + 4, little) !== 1) invalid();
        const type = view.getUint16(entry + 2, little);
        if (tag === 0x112 || tag === 0x128) {
            if (type !== 3) invalid();
            values.set(tag, view.getUint16(entry + 8, little));
            if (tag === 0x112) orientationOffset = entry + 8;
        } else {
            const data = view.getUint32(entry + 8, little);
            if (type !== 5 || data < 8 || data + 8 > bytes.length) invalid();
            const denominator = view.getUint32(data + 4, little);
            const value = view.getUint32(data, little) / denominator;
            if (!denominator || !(value > 0)) invalid();
            values.set(tag, value);
        }
    }
    if (values.has(0x112) && (values.get(0x112) < 1 || values.get(0x112) > 8)) invalid();
    const unit = values.get(0x128) ?? 2;
    if (![1, 2, 3].includes(unit)) invalid();
    const factor = unit === 3 ? 2.54 : 1;
    const resolution = unit !== 1 && values.has(0x11a) && values.has(0x11b)
        ? [values.get(0x11a) * factor, values.get(0x11b) * factor] : null;
    return { resolution, orientationOffset, little };
}

/** Inspect JPEG framing and XPS resolution precedence before handing pixels to the image codec. */
export function readDrawingXpsJpeg(bytes, { maxPixels = 16000000 } = {}) {
    if (!Number.isSafeInteger(maxPixels) || maxPixels < 1) throw new Error('dwfxLimit');
    if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let cursor = 2; let width; let height; let scan = false; let ended = false; let markers = 0;
    let jfif = null; let exif = null; let sawJfif = false; let sawExif = false;
    let previewBytes = bytes;
    while (cursor < bytes.length) {
        if (bytes[cursor++] !== 255) invalid();
        while (bytes[cursor] === 255) cursor++;
        const marker = bytes[cursor++];
        if (++markers > 10000) throw new Error('dwfxLimit');
        if (marker === 217) { if (cursor !== bytes.length || !scan || !width) invalid(); ended = true; break; }
        if (!marker || marker === 216 || marker >= 208 && marker <= 215 || cursor + 2 > bytes.length) invalid();
        const length = view.getUint16(cursor); const start = cursor + 2; const end = cursor + length;
        if (length < 2 || end > bytes.length) invalid();
        const signature = name => [...name].every((character, i) => start + i < end && bytes[start + i] === character.charCodeAt(0));
        if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
            if (![192, 193, 194].includes(marker)) throw new Error('dwfxUnsupported');
            if (width || length < 8) invalid();
            const components = bytes[start + 5];
            if (bytes[start] !== 8 || ![1, 3].includes(components)) throw new Error('dwfxUnsupported');
            if (length !== 8 + 3 * components) invalid();
            height = view.getUint16(start + 1); width = view.getUint16(start + 3);
            if (!width || !height || width > 16384 || height > 16384 || width * height > maxPixels) throw new Error('dwfxLimit');
        } else if (marker === 224 && signature('JFIF\0')) {
            if (sawJfif || length < 16) invalid(); sawJfif = true;
            const unit = bytes[start + 7]; const x = view.getUint16(start + 8); const y = view.getUint16(start + 10);
            if (unit > 2 || !x || !y || length !== 16 + 3 * bytes[start + 12] * bytes[start + 13]) invalid();
            if (unit) jfif = [x * (unit === 2 ? 2.54 : 1), y * (unit === 2 ? 2.54 : 1)];
        } else if (marker === 225 && signature('Exif\0\0')) {
            if (sawExif) invalid(); sawExif = true;
            const metadata = exifMetadata(bytes.subarray(start + 6, end));
            exif = metadata.resolution;
            if (metadata.orientationOffset !== null) {
                // XPS places raw pixels with ImageBrush transforms. Prevent browser EXIF auto-rotation
                // in the preview only; the original embedded package must remain byte-for-byte intact.
                previewBytes = bytes.slice();
                new DataView(previewBytes.buffer).setUint16(start + 6 + metadata.orientationOffset, 1, metadata.little);
            }
        }
        cursor = end;
        if (marker === 218) {
            if (!width || length < 6 || length !== 6 + 2 * bytes[start]) invalid();
            scan = true;
            // Entropy bytes use FF00 stuffing and may contain restart markers.
            while (cursor < bytes.length) {
                if (bytes[cursor] !== 255) { cursor++; continue; }
                let next = cursor + 1; while (bytes[next] === 255) next++;
                if (bytes[next] === 0 || bytes[next] >= 208 && bytes[next] <= 215) cursor = next + 1;
                else break;
            }
        }
    }
    if (!ended) invalid();
    const [dpiX, dpiY] = exif || jfif || [96, 96];
    let binary = '';
    for (let i = 0; i < previewBytes.length; i += 32768) binary += String.fromCharCode(...previewBytes.subarray(i, i + 32768));
    return { width, height, widthUnits: width * 96 / dpiX, heightUnits: height * 96 / dpiY,
        link: `data:image/jpeg;base64,${btoa(binary)}` };
}
