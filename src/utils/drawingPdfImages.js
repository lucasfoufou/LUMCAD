import { createI18nError } from '../i18n/translator.js';

// Resolve PDF.js decoded image objects before its document is destroyed. Each
// unique source/crop is encoded once; repeated placements share the same PNG.
export function readDrawingPdfImages(records, { getImage, createCanvas }) {
    const cache = new Map();
    let pixels = 0; let encodedBytes = 0;
    return records.map(record => {
        if (!record.visible || record.alpha <= 0) return { ...record, source: undefined };
        const source = typeof record.source === 'string' ? getImage(record.source) : record.source;
        if (!source) throw createI18nError('pdf.imageUnsupported');
        let variants = cache.get(source);
        if (!variants) { variants = new Map(); cache.set(source, variants); }
        const key = JSON.stringify([record.crop, record.maskColor]);
        if (!variants.has(key)) {
            const { width, height } = source;
            if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 8192)
                || width * height > 4 * 1024 * 1024) throw createI18nError('pdf.limit');
            pixels += width * height;
            if (pixels > 16 * 1024 * 1024 || cache.size > 512) throw createI18nError('pdf.limit');
            const canvas = createCanvas(width, height);
            let cropped;
            try {
                const context = canvas.getContext('2d');
                if (source.bitmap) context.drawImage(source.bitmap, 0, 0);
                else {
                    const rgba = context.createImageData(width, height);
                    const data = source.data;
                    const kind = record.maskColor ? 1 : source.kind;
                    const bytes = kind === 1 ? Math.ceil(width / 8) * height : width * height * (kind === 2 ? 3 : 4);
                    if (![1, 2, 3].includes(kind) || !data || data.length < bytes) throw createI18nError('pdf.imageUnsupported');
                    for (let i = 0; i < width * height; i++) {
                        const offset = i * 4;
                        if (kind === 1) {
                            const value = (data[Math.floor(i / width) * Math.ceil(width / 8) + Math.floor((i % width) / 8)] >> (7 - i % width % 8) & 1) * 255;
                            rgba.data.set(record.maskColor ? [0, 0, 0, 255 - value] : [value, value, value, 255], offset);
                        } else if (kind === 2) rgba.data.set([data[i * 3], data[i * 3 + 1], data[i * 3 + 2], 255], offset);
                        else rgba.data.set(data.subarray(offset, offset + 4), offset);
                    }
                    context.putImageData(rgba, 0, 0);
                }
                if (record.maskColor) {
                    if (!/^#[0-9a-f]{6}$/i.test(record.maskColor)) throw createI18nError('pdf.imageUnsupported');
                    context.globalCompositeOperation = 'source-in';
                    context.fillStyle = record.maskColor;
                    context.fillRect(0, 0, width, height);
                }
                let output = canvas;
                if (record.crop) {
                    const crop = record.crop;
                    if (![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger)
                        || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0
                        || crop.x + crop.width > width || crop.y + crop.height > height) throw createI18nError('pdf.imageUnsupported');
                    cropped = createCanvas(crop.width, crop.height);
                    cropped.getContext('2d').drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
                    output = cropped;
                }
                const link = output.toDataURL('image/png');
                encodedBytes += link.length;
                if (encodedBytes > 64 * 1024 * 1024) throw createI18nError('pdf.limit');
                variants.set(key, { link, width: output.width, height: output.height });
            } finally {
                canvas.width = 0; canvas.height = 0;
                if (cropped) { cropped.width = 0; cropped.height = 0; }
            }
        }
        return { ...record, source: undefined, interpolate: source.interpolate === true, image: variants.get(key) };
    });
}
