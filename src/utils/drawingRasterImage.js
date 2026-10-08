/** Encode decoded RGBA pixels using the same canvas implementation as the application. */
export function drawingRasterImageDataUrl({ width, height, pixels }, crop = { x: 0, y: 0, width, height }, createCanvas = browserCanvas) {
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0) || width * height > 16000000
        || !(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) throw new Error('wmfInvalidBitmap');
    if (![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger) || crop.x < 0 || crop.y < 0
        || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > width || crop.y + crop.height > height) throw new Error('wmfInvalidBitmap');
    const canvas = createCanvas(crop.width, crop.height);
    try {
        const context = canvas.getContext('2d'); const image = context.createImageData(crop.width, crop.height);
        for (let row = 0; row < crop.height; row++) {
            const offset = ((crop.y + row) * width + crop.x) * 4;
            image.data.set(pixels.subarray(offset, offset + crop.width * 4), row * crop.width * 4);
        }
        context.putImageData(image, 0, 0);
        const link = canvas.toDataURL('image/png');
        if (!link.startsWith('data:image/png;base64,') || link.length > 32 * 1024 * 1024) throw new Error('wmfLimit');
        return { link, width: crop.width, height: crop.height, mimeType: 'image/png' };
    } finally { canvas.width = 0; canvas.height = 0; }
}

export function browserCanvas(width, height) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}

/** Exchange raster axes exactly, without interpolation or modifying the source. */
export function transposeDrawingRasterImage({ width, height, pixels }) {
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0) || width * height > 16000000
        || !(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) throw new Error('wmfInvalidBitmap');
    const result = new Uint8Array(pixels.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const source = (y * width + x) * 4; const target = (x * height + y) * 4;
        result.set(pixels.subarray(source, source + 4), target);
    }
    return { width: height, height: width, pixels: result };
}

/** Decode an embedded raster resource into an owned pixel buffer for export. */
export async function readDrawingRasterImage(link, { createCanvas = browserCanvas, loadImage = browserImage, maxPixels = 16000000 } = {}) {
    if (!Number.isSafeInteger(maxPixels) || maxPixels < 1) throw new Error('wmfLimit');
    if (typeof link !== 'string' || !/^data:image\/(png|jpeg|bmp|webp);base64,/i.test(link)) throw new Error('wmfExportUnsupported');
    if (link.length > 32 * 1024 * 1024) throw new Error('wmfLimit');
    const source = await loadImage(link);
    const width = source.naturalWidth ?? source.width; const height = source.naturalHeight ?? source.height;
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 32767)
        || width * height > maxPixels) throw new Error('wmfLimit');
    const canvas = createCanvas(width, height);
    try {
        const context = canvas.getContext('2d'); context.drawImage(source, 0, 0);
        return { width, height, pixels: new Uint8Array(context.getImageData(0, 0, width, height).data) };
    } finally { canvas.width = 0; canvas.height = 0; }
}

export function browserImage(link) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const finish = (error) => {
            clearTimeout(timer); image.onload = null; image.onerror = null;
            if (error) { image.src = ''; reject(error); } else resolve(image);
        };
        const timer = setTimeout(() => finish(new Error('wmfInvalidBitmap')), 30000);
        image.onload = () => finish(); image.onerror = () => finish(new Error('wmfInvalidBitmap')); image.src = link;
    });
}
