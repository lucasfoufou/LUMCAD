import { readDrawingDwfxPackage } from './drawingDwfxPackage.js';
import { readDrawingXpsScene, drawingXpsSceneSvg } from './drawingXpsScene.js';
import { browserCanvas, browserImage } from './drawingRasterImage.js';

/** Prepare an owned, inert page snapshot at bounded preview resolution. */
export function prepareDrawingDwfxPage(bytes, { pageNumber = 1, maxPreviewPixels = 4 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000) throw new Error('dwfxPage');
    if (!Number.isSafeInteger(maxPreviewPixels) || maxPreviewPixels < 1 || maxPreviewPixels > 16000000) throw new Error('dwfxLimit');
    const pkg = readDrawingDwfxPackage(bytes);
    const page = pkg.pages[pageNumber - 1];
    if (!page) throw new Error('dwfxPage');
    const scene = readDrawingXpsScene(pkg.files, page);
    const scale = Math.min(2, 8192 / Math.max(page.width, page.height), Math.sqrt(maxPreviewPixels / (page.width * page.height)));
    const width = Math.max(1, Math.floor(page.width * scale));
    const height = Math.max(1, Math.floor(page.height * scale));
    if (width * height > maxPreviewPixels) throw new Error('dwfxLimit');
    return { pageNumber, pageCount: pkg.pages.length, width: page.widthMetres, height: page.heightMetres,
        scene, previewSize: { width, height }, svg: drawingXpsSceneSvg(scene, { width, height }) };
}

/** Render the selected DWFx page for a portable underlay without changing a drawing. */
export async function readDrawingDwfxPage(bytes, { createCanvas = browserCanvas, loadImage = browserImage, ...options } = {}) {
    const prepared = prepareDrawingDwfxPage(bytes, options);
    const encoded = new TextEncoder().encode(prepared.svg);
    if (encoded.length > 24 * 1024 * 1024) throw new Error('dwfxLimit');
    let binary = '';
    for (let i = 0; i < encoded.length; i += 32768) binary += String.fromCharCode(...encoded.subarray(i, i + 32768));
    const source = await loadImage(`data:image/svg+xml;base64,${btoa(binary)}`);
    const { width, height } = prepared.previewSize;
    const canvas = createCanvas(width, height);
    try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('dwfxRender');
        context.drawImage(source, 0, 0, width, height);
        const link = canvas.toDataURL('image/png');
        if (!link.startsWith('data:image/png;base64,') || link.length > 32 * 1024 * 1024) throw new Error('dwfxLimit');
        return { pageNumber: prepared.pageNumber, pageCount: prepared.pageCount, width: prepared.width, height: prepared.height,
            scene: prepared.scene, preview: { width, height, link } };
    } finally { canvas.width = 0; canvas.height = 0; }
}
