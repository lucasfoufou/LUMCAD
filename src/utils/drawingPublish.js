import { flattenDrawingSvgGroups } from './drawingSvgGroups.js';
import { applyImageAdjustmentsToPixels, hasImageAdjustments } from './drawingImageAdjustments.js';
import { invoke } from '@tauri-apps/api/core';
import { save } from '../utils/nativeDialogs.js';
import { strToU8, unzipSync, zipSync } from 'fflate';

import { getDrawingPaperSize } from './drawingLayouts.js';
import { isTauriRuntime } from './lcadStorage.js';

const XPS_UNITS_PER_MM = 96 / 25.4;
const CSS_MILLIMETRES_PER_PIXEL = 25.4 / 96;
const MAX_RASTER_DIMENSION = 16_384;
const MAX_RASTER_PIXELS = 64_000_000;
const ZIP_TIMESTAMP = new Date('2000-01-01T00:00:00.000Z');
const PDF_FILE_ID = '4C554D4341442D5044462D4558504F52';
const DWFX_LOGICAL_UNITS_PER_MM = 1_000;
const DWFX_LOGICAL_UNITS_PER_INCH = DWFX_LOGICAL_UNITS_PER_MM * 25.4;
const DWFX_DOCUMENT_ID = '4C554D43-4144-4000-8000-000000000001';
const DWFX_EPLOT_INTERFACE_ID = '715941D4-1AC2-4545-8185-BC40E053B551';
const SVG_STYLE_PROPERTIES = Object.freeze([
    'color',
    'display',
    'fill',
    'fill-opacity',
    'fill-rule',
    'filter',
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'letter-spacing',
    'opacity',
    'paint-order',
    'shape-rendering',
    'stroke',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-opacity',
    'stroke-width',
    'text-anchor',
    'text-decoration',
    'visibility',
    'vector-effect',
    'word-spacing',
]);

export const DRAWING_PUBLISH_FORMATS = Object.freeze(['pdf', 'dwfx']);

export async function createDrawingPdf(pages, { title = 'LUMCAD drawing', plotSettings = null } = {}) {
    const normalizedPages = normalizeRenderedPages(pages);
    if (!normalizedPages.length) throw new TypeError('A PDF export requires at least one rendered page.');
    const [{ jsPDF }] = await Promise.all([
        import('jspdf'),
        import('svg2pdf.js'),
    ]);
    const firstPaper = normalizedPages[0].paper;
    const pdf = new jsPDF({
        compress: true,
        format: pdfPageFormat(firstPaper),
        orientation: pdfPageOrientation(firstPaper),
        precision: 12,
        putOnlyUsedFonts: true,
        unit: 'mm',
    });
    pdf.setCreationDate(new Date('2000-01-01T00:00:00.000Z'));
    pdf.setFileId(PDF_FILE_ID);
    pdf.setProperties({
        author: 'LUMCAD',
        creator: 'LUMCAD',
        producer: 'LUMCAD',
        subject: '2D drawing publication',
        title: String(title || 'LUMCAD drawing'),
    });

    for (let index = 0; index < normalizedPages.length; index += 1) {
        const page = normalizedPages[index];
        if (index > 0) pdf.addPage(pdfPageFormat(page.paper), pdfPageOrientation(page.paper));
        const quality = normalizePublishQuality(page.plotSettings?.quality || plotSettings?.quality);
        if (quality.mode === 'raster') {
            const image = await rasterizeDrawingSvg(page.svg, page.paper, quality);
            pdf.addImage(image.dataUrl, image.format, 0, 0, page.paper.width, page.paper.height, undefined, 'FAST');
        } else {
            const prepared = await prepareStandaloneDrawingSvg(page.svg, page.paper, quality);
            try {
                await pdf.svg(prepared.svg, {
                    x: 0,
                    y: 0,
                    width: page.paper.width,
                    height: page.paper.height,
                    loadExternalStyleSheets: false,
                });
            } finally {
                prepared.host.remove();
            }
        }
    }
    return new Uint8Array(pdf.output('arraybuffer'));
}

export async function createDrawingDwfx(pages, { title = 'LUMCAD drawing', plotSettings = null } = {}) {
    const normalizedPages = normalizeRenderedPages(pages);
    if (!normalizedPages.length) throw new TypeError('A DWFx export requires at least one rendered page.');
    const rendered = [];
    for (const page of normalizedPages) {
        const quality = normalizePublishQuality({
            ...(plotSettings?.quality || {}),
            ...(page.plotSettings?.quality || {}),
            mode: 'raster',
        });
        const image = await rasterizeDrawingSvg(page.svg, page.paper, quality, { forcePng: true });
        rendered.push({
            id: page.layout.id,
            name: page.layout.name,
            paper: page.paper,
            png: dataUrlBytes(image.dataUrl),
        });
    }
    return createDrawingDwfxPackage(rendered, { title });
}

export function createDrawingDwfxPackage(pages, { title = 'LUMCAD drawing' } = {}) {
    if (!Array.isArray(pages) || !pages.length) {
        throw new TypeError('A DWFx package requires at least one page.');
    }
    const normalized = pages.map((page, index) => {
        const paper = normalizePaper(page?.paper);
        const png = page?.png instanceof Uint8Array ? page.png : new Uint8Array(page?.png || []);
        if (!isPng(png)) throw new TypeError(`DWFx page ${index + 1} is not a PNG image.`);
        return {
            id: String(page?.id || `page-${index + 1}`),
            name: String(page?.name || `Page ${index + 1}`),
            paper,
            png,
            pngSize: getPngSize(png, index + 1),
            logicalSize: {
                width: Math.round(paper.width * DWFX_LOGICAL_UNITS_PER_MM),
                height: Math.round(paper.height * DWFX_LOGICAL_UNITS_PER_MM),
            },
            resourceId: `dwfresource_${index + 1}`,
            sectionId: dwfxUuid(0x100 + index),
        };
    });
    const documentPath = `dwf/documents/${DWFX_DOCUMENT_ID}`;
    const files = {};
    addZipText(files, '[Content_Types].xml', dwfxContentTypes(normalized));
    addZipText(files, '_rels/.rels', dwfxRootRelationships());
    addZipText(files, 'CoreProperties.xml', dwfxCoreProperties(title));
    addZipText(files, 'FixedDocumentSequence.fdseq', dwfxDocumentSequence());
    addZipText(files, 'DWFDocumentSequence.dwfseq', dwfxDwfDocumentSequence());
    addZipText(files, '_rels/DWFDocumentSequence.dwfseq.rels', dwfxDwfDocumentSequenceRelationships());
    addZipText(files, `${documentPath}/FixedDocument.fdoc`, dwfxFixedDocument(normalized));
    addZipText(files, `${documentPath}/manifest.xml`, dwfxManifest(normalized, title));
    addZipText(files, `${documentPath}/_rels/manifest.xml.rels`, dwfxManifestRelationships(normalized));
    addZipText(files, `${documentPath}/DWFProperties.xml`, dwfxDwfProperties());
    normalized.forEach((page, index) => {
        const number = index + 1;
        const sectionPath = dwfxSectionPath(page);
        addZipText(files, `${sectionPath}/FixedPage.fpage`, dwfxFixedPage(page));
        addZipText(files, `${sectionPath}/_rels/FixedPage.fpage.rels`, dwfxPageRelationships(page));
        addZipText(files, `${sectionPath}/graphics.w2x.xml`, dwfxGraphicsExtension(page, number));
        addZipText(files, `${sectionPath}/dictionary.xml`, dwfxGraphicsDictionary(page));
        addZipText(files, `${sectionPath}/descriptor.xml`, dwfxSectionDescriptor(page, number));
        addZipText(files, `${sectionPath}/_rels/descriptor.xml.rels`, dwfxDescriptorRelationships(page, number));
        addZipBytes(files, `${sectionPath}/page.png`, page.png, 0);
    });
    return zipSync(files, { level: 9 });
}

export function inspectDrawingDwfxPackage(bytes) {
    const files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []));
    return {
        files: Object.keys(files).sort(),
        pageCount: Object.keys(files).filter(path => /\/sections\/com[.]autodesk[.]dwf[.]ePlot_[^/]+\/FixedPage[.]fpage$/.test(path)).length,
    };
}

export async function writeDrawingPublishFile({
    bytes,
    defaultName,
    explicitPath = null,
    format,
    filterName = 'Drawing export',
}) {
    const normalizedFormat = normalizePublishFormat(format);
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!data.length) throw new TypeError('The drawing export is empty.');
    const safeName = safeDrawingPublishFilename(defaultName, normalizedFormat);
    if (isTauriRuntime()) {
        const path = explicitPath || await save({
            defaultPath: safeName,
            filters: [{ name: filterName, extensions: [normalizedFormat] }],
        });
        if (!path) return null;
        return invoke('publish_plot_file', {
            path,
            bytes: Array.from(data),
            format: normalizedFormat,
        });
    }
    if (explicitPath) throw new TypeError('Unattended publishing requires the desktop application.');
    downloadDrawingPublishFile(data, safeName, normalizedFormat);
    return { path: null, format: normalizedFormat, bytesWritten: data.length };
}

export function getAutomaticDrawingPublishPath(filePath, format = 'pdf') {
    const normalizedFormat = normalizePublishFormat(format);
    const path = String(filePath || '').trim();
    if (!path || !/[.]lcad$/i.test(path)) return null;
    return path.replace(/[.]lcad$/i, `.${normalizedFormat}`);
}

export function safeDrawingPublishFilename(value, format = 'pdf') {
    const normalizedFormat = normalizePublishFormat(format);
    const extension = new RegExp(`[.]${normalizedFormat}$`, 'i');
    const stem = String(value || 'Drawing')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 180) || 'Drawing';
    return extension.test(stem) ? stem : `${stem}.${normalizedFormat}`;
}

export function getDrawingRasterSize(paperOrLayout, requestedDpi = 300) {
    const paper = normalizePaper(getDrawingPaperSize(paperOrLayout));
    const dpi = clampFinite(requestedDpi, 72, 1_200, 300);
    const requestedWidth = paper.width / 25.4 * dpi;
    const requestedHeight = paper.height / 25.4 * dpi;
    const dimensionScale = Math.min(1, MAX_RASTER_DIMENSION / Math.max(requestedWidth, requestedHeight));
    const pixelScale = Math.min(1, Math.sqrt(MAX_RASTER_PIXELS / (requestedWidth * requestedHeight)));
    const scale = Math.min(dimensionScale, pixelScale);
    return {
        dpi: dpi * scale,
        height: Math.max(1, Math.round(requestedHeight * scale)),
        requestedDpi: dpi,
        width: Math.max(1, Math.round(requestedWidth * scale)),
    };
}

export function getDrawingImageTargetSize({ heightMm, sourceHeight, sourceWidth, widthMm }, requestedDpi = 300) {
    const dpi = clampFinite(requestedDpi, 72, 1_200, 300);
    const source = {
        height: Math.max(1, Math.floor(Number(sourceHeight) || 1)),
        width: Math.max(1, Math.floor(Number(sourceWidth) || 1)),
    };
    const requestedWidth = Math.min(source.width, Math.max(1, Math.round(Number(widthMm) / 25.4 * dpi)));
    const requestedHeight = Math.min(source.height, Math.max(1, Math.round(Number(heightMm) / 25.4 * dpi)));
    const dimensionScale = Math.min(1, MAX_RASTER_DIMENSION / Math.max(requestedWidth, requestedHeight));
    const pixelScale = Math.min(1, Math.sqrt(MAX_RASTER_PIXELS / (requestedWidth * requestedHeight)));
    const scale = Math.min(dimensionScale, pixelScale);
    return {
        height: Math.max(1, Math.round(requestedHeight * scale)),
        width: Math.max(1, Math.round(requestedWidth * scale)),
    };
}

export function resolveDrawingNonScalingStroke({ dashArray = 'none', dashOffset = 0, strokeWidth, transformScale = 1, unitsPerPixel = CSS_MILLIMETRES_PER_PIXEL }) {
    const scale = Math.abs(Number(transformScale));
    const width = Number.parseFloat(strokeWidth);
    if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(width) || width < 0) return null;
    const localPixelsToUnits = unitsPerPixel / scale;
    const dashValues = String(dashArray || '').toLowerCase() === 'none'
        ? []
        : String(dashArray || '').match(/[-+]?(?:\d+\.?\d*|[.]\d+)(?:e[-+]?\d+)?/gi)?.map(Number) || [];
    return {
        dashArray: dashValues.length ? dashValues.map(value => decimal(value * localPixelsToUnits)).join(' ') : 'none',
        dashOffset: decimal((Number.parseFloat(dashOffset) || 0) * localPixelsToUnits),
        strokeWidth: decimal(width * localPixelsToUnits),
    };
}

export function normalizePublishQuality(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        mode: source.mode === 'raster' ? 'raster' : 'vector',
        rasterDpi: clampFinite(source.rasterDpi, 72, 1_200, 300),
        imageDpi: clampFinite(source.imageDpi, 72, 1_200, 300),
        jpegQuality: clampFinite(source.jpegQuality, 0.1, 1, 0.9),
    };
}

export function createStandaloneDrawingSvg(svg) {
    if (!svg?.cloneNode || !svg.ownerDocument) throw new TypeError('A rendered SVG page is required.');
    const clone = svg.cloneNode(true);
    const originals = [svg, ...svg.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    originals.forEach((source, index) => {
        const target = copies[index];
        const style = svg.ownerDocument.defaultView?.getComputedStyle?.(source);
        if (!style || !target?.style) return;
        SVG_STYLE_PROPERTIES.forEach(property => {
            const value = style.getPropertyValue(property);
            if (value) target.style.setProperty(property, value);
        });
    });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    normalizeSvgIds(clone);
    return clone;
}

/** Standalone vector model output through the publication resource/style pipeline. */
export async function serializeDrawingModelSvg(svg, frame) {
    const prepared = await prepareStandaloneDrawingSvg(svg, null, { imageDpi: 1200, jpegQuality: 1 }, frame, true);
    try {
        if (frame.background !== 'transparent') {
            const rect = prepared.svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
            for (const [key, value] of Object.entries(frame.viewBox)) rect.setAttribute(key, String(value));
            rect.setAttribute('fill', frame.background);
            prepared.svg.insertBefore(rect, prepared.svg.firstChild);
        }
        return new XMLSerializer().serializeToString(prepared.svg);
    } finally { prepared.host.remove(); }
}

export async function rasterizeDrawingSvg(svg, paper, quality, { forcePng = false, pixelSize = null, background = '#ffffff' } = {}) {
    const size = pixelSize || getDrawingRasterSize(paper, quality.rasterDpi);
    if (![size.width, size.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= MAX_RASTER_DIMENSION)
        || size.width * size.height > MAX_RASTER_PIXELS || !(forcePng && background === 'transparent') && !/^#[0-9a-f]{6}$/i.test(background)) throw new Error('wmfLimit');
    const prepared = await prepareStandaloneDrawingSvg(svg, paper, quality, size, Boolean(pixelSize));
    let xml;
    try {
        if (pixelSize) {
            // WebKit may render an SVG image with a sub-unit viewBox as empty.
            // Use pixel viewport units while retaining every child and its world transform.
            const root = prepared.svg;
            const box = root.viewBox.baseVal;
            const scale = size.width / box.width;
            const group = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.setAttribute('transform', `matrix(${scale} 0 0 ${scale} ${-box.x * scale} ${-box.y * scale})`);
            while (root.firstChild) group.appendChild(root.firstChild);
            root.appendChild(group);
            root.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
            flattenDrawingSvgGroups(root);
        }
        xml = new XMLSerializer().serializeToString(prepared.svg);
    } finally {
        prepared.host.remove();
    }
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
        const image = await loadImage(url);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d', { alpha: background === 'transparent' });
        if (!context) throw new Error('The drawing raster canvas is unavailable.');
        if (background !== 'transparent') {
            context.fillStyle = background;
            context.fillRect(0, 0, size.width, size.height);
        }
        context.drawImage(image, 0, 0, size.width, size.height);
        const format = forcePng ? 'PNG' : 'JPEG';
        return {
            dataUrl: canvas.toDataURL(forcePng ? 'image/png' : 'image/jpeg', quality.jpegQuality),
            dpi: size.dpi,
            format,
            height: size.height,
            width: size.width,
        };
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function prepareStandaloneDrawingSvg(svg, paper, quality, intrinsicSize = paper, modelRender = false) {
    await waitForDrawingSvgResources(svg);
    const standalone = createStandaloneDrawingSvg(svg);
    standalone.setAttribute('width', String(intrinsicSize.width));
    standalone.setAttribute('height', String(intrinsicSize.height));
    const host = attachHiddenSvg(standalone);
    try {
        const unitsPerPixel = modelRender ? standalone.viewBox.baseVal.width / intrinsicSize.width : CSS_MILLIMETRES_PER_PIXEL;
        // Model bitmaps render at their final pixel size. Preserve pixel-space strokes:
        // WebKit can drop straight segments when materialized widths are tiny world values.
        // Paper/vector publication still needs physical stroke conversion.
        if (!modelRender) materializeDrawingSvgStrokes(standalone, unitsPerPixel);
        await downsampleDrawingSvgImages(standalone, modelRender ? 96 : quality.imageDpi, quality.jpegQuality,
            modelRender ? CSS_MILLIMETRES_PER_PIXEL / unitsPerPixel : 1);
        return { host, svg: standalone };
    } catch (error) {
        host.remove();
        throw error;
    }
}

function materializeDrawingSvgStrokes(svg, unitsPerPixel) {
    [svg, ...svg.querySelectorAll('*')].forEach(element => {
        const style = svg.ownerDocument.defaultView?.getComputedStyle?.(element);
        const vectorEffect = style?.getPropertyValue('vector-effect') || element.getAttribute('vector-effect');
        if (vectorEffect !== 'non-scaling-stroke') return;
        const stroke = style?.getPropertyValue('stroke') || element.getAttribute('stroke');
        if (!stroke || stroke === 'none') return;
        const metrics = resolveDrawingNonScalingStroke({
            dashArray: style?.getPropertyValue('stroke-dasharray') || element.getAttribute('stroke-dasharray'),
            dashOffset: style?.getPropertyValue('stroke-dashoffset') || element.getAttribute('stroke-dashoffset'),
            strokeWidth: style?.getPropertyValue('stroke-width') || element.getAttribute('stroke-width'),
            transformScale: getSvgElementScale(element, svg),
            unitsPerPixel,
        });
        if (!metrics) return;
        element.style.setProperty('stroke-width', metrics.strokeWidth);
        element.style.setProperty('stroke-dashoffset', metrics.dashOffset);
        if (metrics.dashArray !== 'none') element.style.setProperty('stroke-dasharray', metrics.dashArray);
        element.style.setProperty('vector-effect', 'none');
        element.removeAttribute('vector-effect');
    });
}

async function downsampleDrawingSvgImages(svg, imageDpi, jpegQuality, millimetresPerUnit = 1) {
    await Promise.all([...svg.querySelectorAll('image')].map(async element => {
        const href = element.getAttribute('href') || element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (!href || /^data:image\/svg[+]xml/i.test(href)) return;
        const image = await loadImage(href);
        const matrix = getDrawingSvgRelativeMatrix(element, svg);
        if (!matrix) return;
        const localWidth = getSvgLength(element, 'width');
        const localHeight = getSvgLength(element, 'height');
        const widthMm = Math.abs(localWidth) * Math.hypot(matrix.a, matrix.b) * millimetresPerUnit;
        const heightMm = Math.abs(localHeight) * Math.hypot(matrix.c, matrix.d) * millimetresPerUnit;
        if (!(widthMm > 0) || !(heightMm > 0)) return;
        const target = getDrawingImageTargetSize({
            heightMm,
            sourceHeight: image.naturalHeight || image.height,
            sourceWidth: image.naturalWidth || image.width,
            widthMm,
        }, imageDpi);
        const sourceWidth = image.naturalWidth || image.width;
        const sourceHeight = image.naturalHeight || image.height;
        const adjustments = {
            brightness: Number(element.getAttribute('data-image-brightness') ?? 100),
            contrast: Number(element.getAttribute('data-image-contrast') ?? 100),
            monochrome: element.getAttribute('data-image-monochrome') === 'true',
            transparentColor: element.getAttribute('data-image-key'),
            colorTolerance: Number(element.getAttribute('data-image-key-tolerance') ?? 0),
        };
        const adjusted = hasImageAdjustments(adjustments);
        if (target.width >= sourceWidth && target.height >= sourceHeight && !adjusted) return;
        let canvas = document.createElement('canvas');
        const keyBeforeResize = Boolean(adjustments.transparentColor);
        if (keyBeforeResize && sourceWidth * sourceHeight > MAX_RASTER_PIXELS) throw new Error('The colour-key source image exceeds the pixel-processing limit.');
        canvas.width = keyBeforeResize ? sourceWidth : target.width;
        canvas.height = keyBeforeResize ? sourceHeight : target.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('The drawing image canvas is unavailable.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        if (adjusted) {
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            applyImageAdjustmentsToPixels(pixels.data, adjustments);
            context.putImageData(pixels, 0, 0);
            element.removeAttribute('filter');
            element.style.setProperty('filter', 'none');
        }
        if (keyBeforeResize && (canvas.width !== target.width || canvas.height !== target.height)) {
            const resized = document.createElement('canvas');
            resized.width = target.width;
            resized.height = target.height;
            const resizedContext = resized.getContext('2d');
            if (!resizedContext) throw new Error('The drawing image canvas is unavailable.');
            resizedContext.drawImage(canvas, 0, 0, target.width, target.height);
            canvas = resized;
        }
        const sourceMime = /^data:(image\/[a-z0-9.+-]+)/i.exec(href)?.[1]?.toLowerCase();
        const mime = !adjustments.transparentColor && (sourceMime === 'image/jpeg' || sourceMime === 'image/jpg') ? 'image/jpeg' : 'image/png';
        const nextHref = canvas.toDataURL(mime, jpegQuality);
        element.setAttribute('href', nextHref);
        if (element.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')) {
            element.setAttributeNS('http://www.w3.org/1999/xlink', 'href', nextHref);
        }
    }));
}

function getSvgElementScale(element, svg) {
    const matrix = getDrawingSvgRelativeMatrix(element, svg);
    if (!matrix) return 1;
    return Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
}

export function getDrawingSvgRelativeMatrix(element, svg) {
    const screenMatrix = resolveRelativeSvgMatrix(element.getScreenCTM?.(), svg.getScreenCTM?.());
    if (screenMatrix) return screenMatrix;
    return resolveRelativeSvgMatrix(element.getCTM?.(), svg.getCTM?.());
}

function resolveRelativeSvgMatrix(elementMatrix, rootMatrix) {
    if (!elementMatrix || !rootMatrix) return null;
    try {
        return rootMatrix.inverse().multiply(elementMatrix);
    } catch {
        return null;
    }
}

function getSvgLength(element, name) {
    const baseValue = element?.[name]?.baseVal?.value;
    if (Number.isFinite(baseValue)) return baseValue;
    return Number.parseFloat(element.getAttribute(name)) || 0;
}

async function waitForDrawingSvgResources(svg) {
    if (svg.ownerDocument?.fonts?.ready) await svg.ownerDocument.fonts.ready;
    const images = [...svg.querySelectorAll('image')].map(element => {
        const href = element.getAttribute('href') || element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        return href ? loadImage(href).catch(() => null) : null;
    }).filter(Boolean);
    await Promise.all(images);
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('A drawing image could not be decoded for publication.'));
        image.src = url;
    });
}

function attachHiddenSvg(svg) {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
        height: '1px',
        left: '-100000px',
        overflow: 'hidden',
        position: 'fixed',
        top: '0',
        width: '1px',
    });
    host.appendChild(svg);
    document.body.appendChild(host);
    return host;
}

function normalizeRenderedPages(pages) {
    if (!Array.isArray(pages)) return [];
    return pages.flatMap(page => {
        if (!page?.svg || !page?.layout) return [];
        return [{
            ...page,
            paper: normalizePaper(page.paper || getDrawingPaperSize(page.layout)),
        }];
    });
}

function normalizeSvgIds(svg) {
    const idMap = new Map();
    svg.querySelectorAll('[id]').forEach((element, index) => {
        const previous = element.id;
        const next = `lumcad-export-${index + 1}`;
        idMap.set(previous, next);
        element.id = next;
    });
    if (!idMap.size) return;
    [svg, ...svg.querySelectorAll('*')].forEach(element => {
        [...element.attributes].forEach(attribute => {
            let value = attribute.value;
            idMap.forEach((next, previous) => {
                value = value
                    .replaceAll(`url(#${previous})`, `url(#${next})`)
                    .replaceAll(`#${previous}`, `#${next}`);
            });
            if (value !== attribute.value) element.setAttribute(attribute.name, value);
        });
    });
}

function pdfPageFormat(paper) {
    return paper.width >= paper.height
        ? [paper.height, paper.width]
        : [paper.width, paper.height];
}

function pdfPageOrientation(paper) {
    return paper.width >= paper.height ? 'landscape' : 'portrait';
}

function normalizePublishFormat(value) {
    const format = String(value || '').toLowerCase();
    if (!DRAWING_PUBLISH_FORMATS.includes(format)) throw new TypeError(`Unsupported drawing publish format: ${format || 'empty'}.`);
    return format;
}

function normalizePaper(value) {
    const width = Number(value?.width);
    const height = Number(value?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)
        || width < 10 || height < 10 || width > 5_000 || height > 5_000) {
        throw new TypeError('Invalid drawing paper dimensions.');
    }
    return { width, height };
}

function clampFinite(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function downloadDrawingPublishFile(bytes, filename, format) {
    const mimeType = format === 'pdf' ? 'application/pdf' : 'model/vnd.dwfx+xps';
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function dataUrlBytes(value) {
    const match = /^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
    if (!match) throw new TypeError('The rendered drawing image is not base64 encoded.');
    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function isPng(bytes) {
    return bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a;
}

function getPngSize(bytes, pageNumber) {
    if (bytes.length < 24
        || bytes[12] !== 0x49
        || bytes[13] !== 0x48
        || bytes[14] !== 0x44
        || bytes[15] !== 0x52) {
        throw new TypeError(`DWFx page ${pageNumber} has no valid PNG header.`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (!width || !height || width > 100_000 || height > 100_000) {
        throw new TypeError(`DWFx page ${pageNumber} has invalid PNG dimensions.`);
    }
    return { height, width };
}

function addZipText(files, path, value) {
    addZipBytes(files, path, strToU8(value), 9);
}

function addZipBytes(files, path, bytes, level) {
    files[path] = [bytes, { level, mtime: ZIP_TIMESTAMP }];
}

function dwfxContentTypes(pages) {
    const dictionaries = pages.map(page => `<Override PartName="/${dwfxSectionPath(page)}/dictionary.xml" ContentType="application/vnd.ms-package.xps-resourcedictionary+xml"/>`).join('');
    return xmlDocument('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="dwfseq" ContentType="application/vnd.adsk-package.dwfx-dwfdocumentsequence+xml"/><Default Extension="fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml"/><Default Extension="fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml"/><Default Extension="fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="text/xml"/><Override PartName="/CoreProperties.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' + dictionaries + '</Types>');
}

function dwfxRootRelationships() {
    return xmlDocument('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="R-core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="/CoreProperties.xml"/><Relationship Id="R-dwf" Type="http://schemas.autodesk.com/dwfx/2007/relationships/documentsequence" Target="/DWFDocumentSequence.dwfseq"/><Relationship Id="R-fixed" Type="http://schemas.microsoft.com/xps/2005/06/fixedrepresentation" Target="/FixedDocumentSequence.fdseq"/></Relationships>');
}

function dwfxCoreProperties(title) {
    return xmlDocument(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>LUMCAD</dc:creator><cp:lastModifiedBy>LUMCAD</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>`);
}

function dwfxDocumentSequence() {
    return xmlDocument(`<FixedDocumentSequence xmlns="http://schemas.microsoft.com/xps/2005/06"><DocumentReference Source="/dwf/documents/${DWFX_DOCUMENT_ID}/FixedDocument.fdoc"/></FixedDocumentSequence>`);
}

function dwfxDwfDocumentSequence() {
    return xmlDocument(`<DWFDocumentSequence xmlns="http://schemas.dwf.autodesk.com/dwfx/2006/11"><ManifestReference Source="/dwf/documents/${DWFX_DOCUMENT_ID}/manifest.xml"/></DWFDocumentSequence>`);
}

function dwfxDwfDocumentSequenceRelationships() {
    return xmlDocument(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="R-document" Type="http://schemas.autodesk.com/dwfx/2007/relationships/document" Target="/dwf/documents/${DWFX_DOCUMENT_ID}/manifest.xml"/></Relationships>`);
}

function dwfxFixedDocument(pages) {
    const contents = pages.map(page => {
        const size = xpsPaperSize(page.paper);
        return `<PageContent Source="/${dwfxSectionPath(page)}/FixedPage.fpage" Width="${decimal(size.width)}" Height="${decimal(size.height)}"/>`;
    }).join('');
    return xmlDocument(`<FixedDocument xmlns="http://schemas.microsoft.com/xps/2005/06">${contents}</FixedDocument>`);
}

function dwfxManifest(pages, title) {
    const sections = pages.map(page => {
        const sectionPath = `/${dwfxSectionPath(page)}`;
        return `<dwf:Section type="com.autodesk.dwf.ePlot" name="com.autodesk.dwf.ePlot_${page.sectionId}" title="${escapeXml(page.name)}"><dwf:Source provider="LUMCAD"/><dwf:Toc><dwf:Resource role="2d graphics dictionary" mime="application/vnd.ms-package.xps-resourcedictionary+xml" href="${sectionPath}/dictionary.xml"/><dwf:Resource role="2d graphics extension" mime="text/xml" href="${sectionPath}/graphics.w2x.xml"/><dwf:Resource role="2d streaming graphics" mime="application/vnd.adsk-package.dwfx-fixedpage+xml" href="${sectionPath}/FixedPage.fpage?${page.resourceId}"/><dwf:Resource role="raster reference" mime="image/png" href="${sectionPath}/page.png"/><dwf:Resource role="descriptor" mime="text/xml" href="${sectionPath}/descriptor.xml"/></dwf:Toc></dwf:Section>`;
    }).join('');
    return xmlDocument(`<dwf:Manifest xmlns:dwf="DWF-Manifest:6.0" version="6.0" objectId="${DWFX_DOCUMENT_ID}"><dwf:Interfaces><dwf:Interface objectId="${DWFX_EPLOT_INTERFACE_ID}" name="ePlot" href="http://www.autodesk.com/viewers"/></dwf:Interfaces><dwf:Properties><dwf:Property name="Title" value="${escapeXml(title)}" category="LUMCAD"/></dwf:Properties><dwf:Sections>${sections}</dwf:Sections></dwf:Manifest>`);
}

function dwfxManifestRelationships(pages) {
    const sections = pages.map((page, index) => `<Relationship Id="R-section-${index + 1}" Type="http://schemas.autodesk.com/dwfx/2007/relationships/section" Target="/${dwfxSectionPath(page)}/descriptor.xml"/>`).join('');
    return xmlDocument(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="R-properties" Type="http://schemas.autodesk.com/dwfx/2007/relationships/dwfproperties" Target="/dwf/documents/${DWFX_DOCUMENT_ID}/DWFProperties.xml"/>${sections}</Relationships>`);
}

function dwfxDwfProperties() {
    return xmlDocument('<DWFProperties><Property name="SourceProductVendor" value="LUMCAD"/><Property name="SourceProductName" value="LUMCAD"/><Property name="DWFProductVendor" value="LUMCAD"/><Property name="DWFProductVersion" value="1"/><Property name="DWFToolkitVersion" value="7.7"/><Property name="DWFFormatVersion" value="7.00"/></DWFProperties>');
}

function dwfxFixedPage(page) {
    const size = xpsPaperSize(page.paper);
    const scale = 96 / DWFX_LOGICAL_UNITS_PER_INCH;
    return xmlDocument(`<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="${decimal(size.width)}" Height="${decimal(size.height)}" xml:lang="und"><Canvas Name="${page.resourceId}" RenderTransform="${scale},0,0,${scale},0,0">${dwfxGraphicsFragment(page)}</Canvas></FixedPage>`);
}

function dwfxGraphicsFragment(page) {
    const { width, height } = page.logicalSize;
    const prefix = dwfxNamePrefix(page);
    // Autodesk extracts the children of the dwfresource Canvas as an independent
    // XML stream. Its root must declare its own namespace and must not carry a
    // drawable name: named canvases participate in W2X object materialization.
    // The WHIP parser treats a space before Z as another coordinate pair.
    // A named dictionary brush also lets its W2X image shell consume the path.
    return `<Canvas xmlns="http://schemas.microsoft.com/xps/2005/06" RenderTransform="1,0,0,1,0,0"><Canvas.Resources><ResourceDictionary Source="dictionary.xml"/></Canvas.Resources><Path Name="${prefix}1" Fill="{StaticResource LUMCAD_IMAGE}" Data="M0,0L${width},0 ${width},${height} 0,${height}Z"/></Canvas>`;
}

function dwfxGraphicsDictionary(page) {
    const { width, height } = page.pngSize;
    const scaleX = page.logicalSize.width / width;
    const scaleY = page.logicalSize.height / height;
    return xmlDocument(`<ResourceDictionary xmlns="http://schemas.microsoft.com/xps/2005/06" xmlns:x="http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key"><ImageBrush x:Key="LUMCAD_IMAGE" ImageSource="page.png" Transform="${scaleX},0,0,${scaleY},0,0" Viewbox="0,0,${width},${height}" ViewboxUnits="Absolute" Viewport="0,0,${width},${height}" ViewportUnits="Absolute" TileMode="None"/></ResourceDictionary>`);
}

// An XPS ImageBrush alone is insufficient for the WHIP/XAML materializer.
// The W2X image opcode identifies the PNG resource and its logical extents,
// matching Autodesk's WT_XAML_PNG_Group4_Image serialization contract.
function dwfxGraphicsExtension(page, number) {
    const prefix = dwfxNamePrefix(page);
    const { width, height } = page.logicalSize;
    // Keep a uniform paper coordinate system: Autodesk's cloud image placement
    // drifts/clips with independent pixel-to-paper scales in the resource matrix.
    // Only the image brush maps raster pixels to this shared logical grid.
    const scale = DWFX_LOGICAL_UNITS_PER_INCH;
    const transform = `${scale},0,0,0,0,${scale},0,0,0,0,1,0,0,0,0,1`;
    return xmlDocument(`<W2X VersionMajor="7" VersionMinor="0" NamePrefix="${prefix}"><Units refName="${prefix}0" Label="inches" Transform="${transform}"/><Named_View refName="${prefix}0" Name="${escapeXml(page.name)}" Area="0 0 ${width} ${height}"/><PNG_Group4_Image refName="${prefix}1" Format="12" Ref="page.png" Width="${page.pngSize.width}" Height="${page.pngSize.height}" Area="0,0,${width},${height}"/></W2X>`);
}

function dwfxPageRelationships(page) {
    return xmlDocument(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="R-dictionary" Type="http://schemas.microsoft.com/xps/2005/06/required-resource" Target="/${dwfxSectionPath(page)}/dictionary.xml"/><Relationship Id="R-image" Type="http://schemas.microsoft.com/xps/2005/06/required-resource" Target="/${dwfxSectionPath(page)}/page.png"/></Relationships>`);
}

function dwfxSectionDescriptor(page, number) {
    const widthInches = page.paper.width / 25.4;
    const heightInches = page.paper.height / 25.4;
    const graphicObjectId = dwfxObjectId(0x300 + number);
    const imageObjectId = dwfxObjectId(0x500 + number);
    const extensionObjectId = dwfxObjectId(0x700 + number);
    const dictionaryObjectId = dwfxObjectId(0x900 + number);
    const imageScale = 1 / DWFX_LOGICAL_UNITS_PER_INCH;
    const transform = `${imageScale} 0 0 0 0 ${imageScale} 0 0 0 0 1 0 0 0 0 1`;
    const extensionHref = `/${dwfxSectionPath(page)}/graphics.w2x.xml`;
    return xmlDocument(`<ePlot:Page xmlns:ePlot="DWF-ePlot:1.2" version="1.2" name="${escapeXml(page.name)}" plotOrder="${number}" color="255 255 255"><ePlot:Paper units="in" width="${decimal(widthInches)}" height="${decimal(heightInches)}" color="255 255 255" clip="0 0 ${decimal(widthInches)} ${decimal(heightInches)}"/>${dwfxSectionProperties()}<ePlot:Resources><ePlot:Resource role="2d graphics dictionary" mime="application/vnd.ms-package.xps-resourcedictionary+xml" href="/${dwfxSectionPath(page)}/dictionary.xml" size="${strToU8(dwfxGraphicsDictionary(page)).length}" objectId="${dictionaryObjectId}"/><ePlot:Resource role="2d graphics extension" mime="text/xml" href="${extensionHref}" title="W2X Resource" size="${strToU8(dwfxGraphicsExtension(page, number)).length}" internalId="dwfresource_ext_${number}" objectId="${extensionObjectId}"/><ePlot:GraphicResource role="2d streaming graphics" mime="application/vnd.adsk-package.dwfx-fixedpage+xml" href="/${dwfxSectionPath(page)}/FixedPage.fpage?${page.resourceId}" title="${escapeXml(page.name)}" size="${strToU8(dwfxGraphicsFragment(page)).length}" internalId="${page.resourceId}" objectId="${graphicObjectId}" transform="${transform}"><ePlot:Relationships><ePlot:Relationship objectId="${dictionaryObjectId}" type="http://schemas.autodesk.com/dwfx/2007/relationships/graphics2ddictionaryresource"/><ePlot:Relationship objectId="${extensionObjectId}" type="http://schemas.autodesk.com/dwfx/2007/relationships/graphics2dextensionresource"/><ePlot:Relationship objectId="${imageObjectId}" type="http://schemas.autodesk.com/dwfx/2007/relationships/rasterreferenceresource"/></ePlot:Relationships></ePlot:GraphicResource><ePlot:Resource role="raster reference" mime="image/png" href="/${dwfxSectionPath(page)}/page.png" title="${escapeXml(page.name)}" size="${page.png.length}" internalId="image_${number}" objectId="${imageObjectId}"/></ePlot:Resources></ePlot:Page>`);
}

// Autodesk's cloud extractor requires sheet unit properties even for raster-only
// publication. The XPS/WHIP readers accept their absence, so local rendering alone
// does not catch this requirement. These are paper units, matching W2X Units and
// the GraphicResource placement, rather than the source model's metre units.
function dwfxSectionProperties() {
    return '<ePlot:Properties><ePlot:Property name="_UnitAngular" value="degree"/><ePlot:Property name="_UnitArea" value="square_inch"/><ePlot:Property name="_UnitLinear" value="inch"/><ePlot:Property name="_UnitVolume" value="cubic_inch"/></ePlot:Properties>';
}

function dwfxDescriptorRelationships(page, number) {
    const target = `/${dwfxSectionPath(page)}/page.png`;
    const extensionTarget = `/${dwfxSectionPath(page)}/graphics.w2x.xml`;
    return xmlDocument(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="R-dictionary-required-${number}" Type="http://schemas.autodesk.com/dwfx/2007/relationships/requiredresource" Target="/${dwfxSectionPath(page)}/dictionary.xml"/><Relationship Id="R-dictionary-${number}" Type="http://schemas.autodesk.com/dwfx/2007/relationships/graphics2ddictionaryresource" Target="/${dwfxSectionPath(page)}/dictionary.xml"/><Relationship Id="R-extension-required-${number}" Type="http://schemas.autodesk.com/dwfx/2007/relationships/requiredresource" Target="${extensionTarget}"/><Relationship Id="R-extension-${number}" Type="http://schemas.autodesk.com/dwfx/2007/relationships/graphics2dextensionresource" Target="${extensionTarget}"/><Relationship Id="R-required-${number}" Type="http://schemas.autodesk.com/dwfx/2007/relationships/requiredresource" Target="${target}"/><Relationship Id="R-raster-${number}" Type="http://schemas.autodesk.com/dwfx/2007/relationships/rasterreferenceresource" Target="${target}"/></Relationships>`);
}

function dwfxNamePrefix(page) {
    return `LUMCAD_${page.resourceId.slice('dwfresource_'.length)}_`;
}

function dwfxSectionPath(page) {
    return `dwf/documents/${DWFX_DOCUMENT_ID}/sections/com.autodesk.dwf.ePlot_${page.sectionId}`;
}

function dwfxUuid(value) {
    return `4C554D43-4144-4000-8000-${Math.max(0, Number(value) || 0).toString(16).padStart(12, '0').toUpperCase()}`;
}

function dwfxObjectId(value) {
    const hex = dwfxUuid(value).replaceAll('-', '');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let output = '';
    for (let index = 0; index < hex.length; index += 6) {
        const chunk = hex.slice(index, index + 6);
        const byteCount = chunk.length / 2;
        const bits = Number.parseInt(chunk.padEnd(6, '0'), 16);
        output += alphabet[(bits >>> 18) & 63];
        output += alphabet[(bits >>> 12) & 63];
        if (byteCount > 1) output += alphabet[(bits >>> 6) & 63];
        if (byteCount > 2) output += alphabet[bits & 63];
    }
    return output;
}

function xpsPaperSize(paper) {
    return { width: paper.width * XPS_UNITS_PER_MM, height: paper.height * XPS_UNITS_PER_MM };
}

function xmlDocument(body) {
    return `<?xml version="1.0" encoding="UTF-8"?>${body}`;
}

function escapeXml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function decimal(value) {
    return String(Math.round(Number(value) * 1_000_000) / 1_000_000);
}
