import { decodeDrawingTiff } from './drawingTiff.js';
import { encodeDrawingRasterPng } from './drawingRasterPng.js';
import { crc32 } from './boundedZip.js';
import { readDrawingXpsJpeg } from './drawingXpsJpeg.js';

export function readDrawingXpsImage(bytes, options) {
    if (bytes?.[0] === 73 && bytes?.[1] === 73 || bytes?.[0] === 77 && bytes?.[1] === 77) return readDrawingXpsTiff(bytes, options);
    return bytes?.[0] === 255 && bytes?.[1] === 216 ? readDrawingXpsJpeg(bytes, options) : readDrawingXpsPng(bytes, options);
}

/** PNG metadata needed to map XPS viewboxes (1/96 inch) into source pixels. */
export function readDrawingXpsPng(bytes, { maxPixels = 16000000 } = {}) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 33
        || ![137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) throw new Error('dwfxImage');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8; let width; let height; let dpiX = 96; let dpiY = 96; let ended = false; let data = false; let physical = false;
    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset); const end = offset + 12 + length;
        if (end > bytes.length) throw new Error('dwfxImage');
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) throw new Error('dwfxImage');
        if (offset === 8 && type !== 'IHDR') throw new Error('dwfxImage');
        if (type === 'IHDR') {
            if (width !== undefined || length !== 13) throw new Error('dwfxImage');
            width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
            if (!width || !height || width > 16384 || height > 16384 || width * height > maxPixels) throw new Error('dwfxLimit');
        } else if (type === 'pHYs') {
            if (physical || data || length !== 9) throw new Error('dwfxImage');
            physical = true;
            if (bytes[offset + 16] === 1) {
                dpiX = view.getUint32(offset + 8) * .0254; dpiY = view.getUint32(offset + 12) * .0254;
                if (!(dpiX > 0 && dpiY > 0)) throw new Error('dwfxImage');
            } else if (bytes[offset + 16] !== 0) throw new Error('dwfxImage');
        } else if (type === 'IDAT') data = true;
        else if (type === 'IEND') {
            if (length || end !== bytes.length || !data) throw new Error('dwfxImage');
            ended = true; break;
        }
        offset = end;
    }
    if (!ended) throw new Error('dwfxImage');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { width, height, widthUnits: width * 96 / dpiX, heightUnits: height * 96 / dpiY,
        link: `data:image/png;base64,${btoa(binary)}` };
}


function readDrawingXpsTiff(bytes, options) {
    let image;
    try { image = decodeDrawingTiff(bytes, options); }
    catch (error) {
        throw new Error(error.message === 'tiffLimit' ? 'dwfxLimit' : error.message === 'tiffUnsupported' ? 'dwfxUnsupported' : 'dwfxImage');
    }
    const png = encodeDrawingRasterPng(image);
    if (png.length > 24 * 1024 * 1024) throw new Error('dwfxLimit');
    const result = readDrawingXpsPng(png, options);
    // XPS treats unitless TIFF density as pixels per inch, and ignores subsequent IFDs/orientation.
    const factor = image.resolutionUnit === 3 ? 2.54 : 1;
    return { ...result, widthUnits: image.width * 96 / (image.xResolution * factor),
        heightUnits: image.height * 96 / (image.yResolution * factor) };
}
