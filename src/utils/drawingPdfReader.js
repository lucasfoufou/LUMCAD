import { readDrawingPdfImages } from './drawingPdfImages.js';
import { createI18nError } from '../i18n/translator.js';
import { extractDrawingPdfPaths } from './drawingPdfOperators.js';
import { decodeDrawingPdfPath, PDF_POINT_METRES } from './drawingPdfGeometry.js';

export const MAX_PDF_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_PREVIEW_PIXELS = 4 * 1024 * 1024;

export function drawingPdfBytes(link) {
    if (typeof link !== 'string' || !link.startsWith('data:application/pdf;base64,')
        || link.length > Math.ceil(MAX_PDF_SOURCE_BYTES / 3) * 4 + 32) throw createI18nError('pdf.invalid');
    try {
        const binary = atob(link.slice(link.indexOf(',') + 1));
        return validateBytes(Uint8Array.from(binary, char => char.charCodeAt(0)));
    } catch { throw createI18nError('pdf.invalid'); }
}

export function drawingPdfDataUrl(bytes) {
    validateBytes(bytes);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return `data:application/pdf;base64,${btoa(binary)}`;
}

// The caller supplies PDF.js and a canvas factory, keeping the document reader
// testable without a browser and avoiding a heavyweight import at app startup.
export async function readDrawingPdfPage(bytes, {
    pdfjs, createCanvas, pageNumber = 1, hiddenLayerIds = [], layerVisibility = {}, resourceOptions = {}, readImages = false, timeoutMs = 25000,
} = {}) {
    validateBytes(bytes);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000) throw createI18nError('pdf.pageInvalid');
    if (!pdfjs?.getDocument || typeof createCanvas !== 'function') throw createI18nError('pdf.unavailable');
    const task = pdfjs.getDocument({ ...resourceOptions, data: bytes.slice(), isEvalSupported: false,
        stopAtErrors: true, enableXfa: false, maxImageSize: MAX_PREVIEW_PIXELS, useSystemFonts: false, fontExtraProperties: true });
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(createI18nError('pdf.timeout')), timeoutMs); });
    const run = async () => {
        const document = await task.promise;
        if (pageNumber > document.numPages || document.numPages > 10000) throw createI18nError('pdf.pageInvalid');
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        if (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0 && value <= 1e7)) throw createI18nError('pdf.pageInvalid');
        const optionalContent = await document.getOptionalContentConfig({ intent: 'display' });
        const hidden = new Set(hiddenLayerIds);
        const layers = [];
        for (const [id, group] of optionalContent) {
            if (layers.length >= 2048) throw createI18nError('pdf.limit');
            if (typeof layerVisibility[id] === 'boolean') optionalContent.setVisibility(id, layerVisibility[id], false);
            else if (hidden.has(id)) optionalContent.setVisibility(id, false, false);
            layers.push({ id, name: String(group.name || id).slice(0, 256), visible: group.visible });
        }
        // PDF.js display rendering waits for animation frames, which WebKit can
        // suspend in an inactive desktop window. Print rendering runs to completion
        // without frames; explicitly copy display visibility to retain view layers.
        const renderContent = await document.getOptionalContentConfig({ intent: 'print' });
        for (const layer of layers) renderContent.setVisibility(layer.id, layer.visible, false);
        const [operators, text, annotations] = await Promise.all([
            page.getOperatorList({ intent: 'print', annotationMode: pdfjs.AnnotationMode.DISABLE }),
            readPdfText(page),
            page.getAnnotations({ intent: 'display' }),
        ]);
        if (text.items.length > 100000 || annotations.length > 100000) throw createI18nError('pdf.limit');
        const scale = Math.min(2, 8192 / Math.max(viewport.width, viewport.height), Math.sqrt(MAX_PREVIEW_PIXELS / (viewport.width * viewport.height)));
        const previewViewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.max(1, Math.floor(previewViewport.width)), Math.max(1, Math.floor(previewViewport.height)));
        try {
            const fontIds = new Set();
            operators.fnArray.forEach((operation,index) => {
                const args = operators.argsArray[index] || [];
                if (operation === pdfjs.OPS.setFont) fontIds.add(args[0]);
                else if (operation === pdfjs.OPS.setGState) for (const [key,value] of args[0] || []) if (key === 'Font') fontIds.add(value[0]);
            });
            for (const id of fontIds) await new Promise(resolve => page.commonObjs.get(id, resolve));
            const getFont = id => page.commonObjs.has(id) ? page.commonObjs.get(id) : null;
            const getGlyphPath = (id,character) => {
                const font = getFont(id); const key = font && `${font.loadedName}_path_${character}`;
                return key && page.commonObjs.has(key) ? page.commonObjs.get(key).path : null;
            };
            // Print rendering can release page objects on completion. Retain the
            // decoded images while their operator-list dependencies are alive.
            const imageObjects = new Map();
            let decodedImages = [];
            if (readImages) {
                const preliminary = extractDrawingPdfPaths(operators, pdfjs.OPS, viewport, { isVisible: group => optionalContent.isVisible(group), getFont, getGlyphPath });
                for (const record of preliminary.images) {
                    const id = record.source;
                    if (typeof id !== 'string' || imageObjects.has(id)) continue;
                    const objects = id.startsWith('g_') ? page.commonObjs : page.objs;
                    imageObjects.set(id, await new Promise(resolve => objects.get(id, resolve)));
                }
                decodedImages = readDrawingPdfImages(preliminary.images, { createCanvas, getImage: id => imageObjects.get(id) });
            }
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: previewViewport,
                intent: 'print', annotationMode: pdfjs.AnnotationMode.DISABLE, optionalContentConfigPromise: Promise.resolve(renderContent),
                background: 'rgba(0,0,0,0)',
            }).promise;
            const paths = extractDrawingPdfPaths(operators, pdfjs.OPS, viewport, { isVisible: group => optionalContent.isVisible(group), getFont, getGlyphPath });
            // The preview canvas clips to the rotated crop box. Apply the same page
            // boundary to extracted geometry so off-page paths cannot produce snaps.
            const width = viewport.width * PDF_POINT_METRES;
            const height = viewport.height * PDF_POINT_METRES;
            const pageClip = { rule: 'nonzero', paths: decodeDrawingPdfPath([0, 0, 0, 1, width, 0, 1, width, height, 1, 0, height, 4]) };
            paths.records = paths.records.map(record => ({ ...record, clips: [pageClip, ...record.clips] }));
            paths.texts = paths.texts.map(record => ({ ...record, clips: [pageClip, ...record.clips] }));
            paths.images = paths.images.map(record => ({ ...record, clips: [pageClip, ...record.clips] }));
            if (readImages) paths.images = paths.images.map((record, index) => ({ ...record, source: undefined, interpolate: decodedImages[index].interpolate, image: decodedImages[index].image }));
            else paths.images = [];
            const preview = canvas.toDataURL('image/png');
            return { pageNumber, pageCount: document.numPages, width: viewport.width * PDF_POINT_METRES,
                height: viewport.height * PDF_POINT_METRES, viewport: { width: viewport.width, height: viewport.height, transform: [...viewport.transform] },
                layers, paths, text, annotations, preview: { link: preview, width: canvas.width, height: canvas.height },
            };
        } finally { canvas.width = 0; canvas.height = 0; }
    };
    try { return await Promise.race([run(), timeout]); }
    finally { clearTimeout(timer); await task.destroy(); }
}

function validateBytes(bytes) {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_PDF_SOURCE_BYTES
        || !new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw createI18nError('pdf.invalid');
    return bytes;
}

async function readPdfText(page) {
    // WKWebView does not always expose ReadableStream's async iterator. Reading
    // chunks explicitly also enforces the text limit before buffering the page.
    const reader = page.streamTextContent({ includeMarkedContent: true }).getReader();
    const result = { items: [], styles: Object.create(null), lang: null };
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) return result;
            if (result.items.length + value.items.length > 100000) throw createI18nError('pdf.limit');
            result.items.push(...value.items);
            Object.assign(result.styles, value.styles);
            result.lang ??= value.lang;
        }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
