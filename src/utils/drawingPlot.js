import { normalizeDrawingColor } from './drawingDocument.js';
import { getDrawingBounds } from './drawingGeometry.js';

export const DRAWING_PLOT_AREA_MODES = Object.freeze(['layout', 'extents', 'window']);
export const DRAWING_PLOT_SCALE_MODES = Object.freeze(['fit', 'fixed']);
export const DRAWING_PLOT_COLOR_MODES = Object.freeze(['asDisplayed', 'grayscale', 'monochrome']);
export const DRAWING_PLOT_QUALITY_MODES = Object.freeze(['vector', 'raster']);

export const DRAWING_PLOT_MIN_DPI = 72;
export const DRAWING_PLOT_MAX_DPI = 1_200;
export const DRAWING_PLOT_MIN_JPEG_QUALITY = 0.1;
export const DRAWING_PLOT_MAX_JPEG_QUALITY = 1;

const DEFAULT_WINDOW = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
const DEFAULT_OFFSET_MM = Object.freeze({ x: 0, y: 0 });
const DEFAULT_AREA = Object.freeze({ mode: 'layout', window: DEFAULT_WINDOW });
const DEFAULT_SCALE = Object.freeze({
    mode: 'fit',
    denominator: 1,
    centered: true,
    offsetMm: DEFAULT_OFFSET_MM,
});
const DEFAULT_STYLE = Object.freeze({ colorMode: 'asDisplayed', plotLineweights: true });
const DEFAULT_QUALITY = Object.freeze({
    mode: 'vector',
    rasterDpi: 300,
    imageDpi: 300,
    jpegQuality: 0.9,
});

export const DEFAULT_DRAWING_PLOT_SETTINGS = Object.freeze({
    area: DEFAULT_AREA,
    scale: DEFAULT_SCALE,
    style: DEFAULT_STYLE,
    quality: DEFAULT_QUALITY,
});

const MIN_REGION_SIZE = 1e-9;

export function normalizeDrawingPlotSettings(value) {
    const source = isRecord(value) ? value : {};
    const area = isRecord(source.area) ? source.area : {};
    const scale = isRecord(source.scale) ? source.scale : {};
    const style = isRecord(source.style) ? source.style : {};
    const quality = isRecord(source.quality) ? source.quality : {};
    return {
        area: {
            mode: acceptedValue(area.mode, DRAWING_PLOT_AREA_MODES, DEFAULT_AREA.mode),
            window: normalizePlotRect(area.window, DEFAULT_WINDOW),
        },
        scale: {
            mode: acceptedValue(scale.mode, DRAWING_PLOT_SCALE_MODES, DEFAULT_SCALE.mode),
            denominator: minimumFinite(scale.denominator, 1, DEFAULT_SCALE.denominator),
            centered: scale.centered !== false,
            offsetMm: normalizePlotOffset(scale.offsetMm),
        },
        style: {
            colorMode: acceptedValue(style.colorMode, DRAWING_PLOT_COLOR_MODES, DEFAULT_STYLE.colorMode),
            plotLineweights: style.plotLineweights !== false,
        },
        quality: {
            mode: acceptedValue(quality.mode, DRAWING_PLOT_QUALITY_MODES, DEFAULT_QUALITY.mode),
            rasterDpi: clampFinite(
                quality.rasterDpi,
                DRAWING_PLOT_MIN_DPI,
                DRAWING_PLOT_MAX_DPI,
                DEFAULT_QUALITY.rasterDpi,
            ),
            imageDpi: clampFinite(
                quality.imageDpi,
                DRAWING_PLOT_MIN_DPI,
                DRAWING_PLOT_MAX_DPI,
                DEFAULT_QUALITY.imageDpi,
            ),
            jpegQuality: clampFinite(
                quality.jpegQuality,
                DRAWING_PLOT_MIN_JPEG_QUALITY,
                DRAWING_PLOT_MAX_JPEG_QUALITY,
                DEFAULT_QUALITY.jpegQuality,
            ),
        },
    };
}

/**
 * Resolves the source rectangle for one plot. Extents and windows use the
 * coordinate unit of `content`; callers plotting a layout therefore use paper
 * millimetres, while model-space callers use drawing metres.
 */
export function resolveDrawingPlotArea(content, settings, { layoutRegion = null } = {}) {
    const normalized = normalizeDrawingPlotSettings(settings);
    if (normalized.area.mode === 'window') return { ...normalized.area.window };
    if (normalized.area.mode === 'layout') {
        const region = normalizePlotRect(layoutRegion, null);
        if (region) return region;
    }
    const safeContent = isRecord(content) ? {
        ...content,
        layers: Array.isArray(content.layers) ? content.layers : [],
        entities: Array.isArray(content.entities) ? content.entities : [],
    } : { layers: [], entities: [] };
    const bounds = getDrawingBounds(safeContent, { printableOnly: true });
    return normalizePlotRect({
        x: bounds.minX,
        y: bounds.minY,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
    }, DEFAULT_WINDOW);
}

/**
 * Converts a physical paper size and its margins into the available paper
 * rectangle. Every returned value is expressed in paper millimetres.
 */
export function resolveDrawingPlotPaperRegion(paper, margins = paper?.margins) {
    const width = positiveFinite(paper?.width, 1);
    const height = positiveFinite(paper?.height, 1);
    const horizontal = normalizeMarginPair(margins?.left, margins?.right, width);
    const vertical = normalizeMarginPair(margins?.top, margins?.bottom, height);
    return {
        x: horizontal.first,
        y: vertical.first,
        width: Math.max(MIN_REGION_SIZE, width - horizontal.first - horizontal.second),
        height: Math.max(MIN_REGION_SIZE, height - vertical.first - vertical.second),
    };
}

/**
 * Returns an affine transform from source coordinates to paper millimetres.
 * Fixed scales treat source coordinates as metres by default; pass
 * `{ sourceUnit: 'mm' }` for a paper-space source rectangle.
 */
export function resolveDrawingPlotTransform(
    sourceRegion,
    paperRegion,
    scaleSettings,
    { sourceUnit = 'm' } = {},
) {
    const source = normalizePlotRect(sourceRegion, DEFAULT_WINDOW);
    const paper = normalizePlotRect(paperRegion, DEFAULT_WINDOW);
    const normalized = normalizeDrawingPlotSettings({ scale: scaleSettings }).scale;
    const sourceUnitMillimetres = sourceUnit === 'mm' ? 1 : 1_000;
    const scaleFactor = normalized.mode === 'fixed'
        ? sourceUnitMillimetres / normalized.denominator
        : Math.min(paper.width / source.width, paper.height / source.height);
    const outputWidth = source.width * scaleFactor;
    const outputHeight = source.height * scaleFactor;
    const outputX = paper.x
        + (normalized.centered ? (paper.width - outputWidth) / 2 : 0)
        + normalized.offsetMm.x;
    const outputY = paper.y
        + (normalized.centered ? (paper.height - outputHeight) / 2 : 0)
        + normalized.offsetMm.y;
    const translateX = outputX - source.x * scaleFactor;
    const translateY = outputY - source.y * scaleFactor;
    return {
        scaleFactor,
        denominator: sourceUnitMillimetres / scaleFactor,
        translateX,
        translateY,
        matrix: {
            a: scaleFactor,
            b: 0,
            c: 0,
            d: scaleFactor,
            e: translateX,
            f: translateY,
        },
        sourceRegion: source,
        paperRegion: paper,
        outputRegion: {
            x: outputX,
            y: outputY,
            width: outputWidth,
            height: outputHeight,
        },
    };
}

/**
 * Applies global plot appearance without mutating the drawing. Raster-image
 * colour conversion remains the responsibility of the output renderer.
 */
export function applyDrawingPlotStyle(content, styleSettings) {
    if (!isRecord(content)) return content;
    const style = normalizeDrawingPlotSettings({ style: styleSettings }).style;
    if (style.colorMode === 'asDisplayed' && style.plotLineweights) return content;
    return {
        ...content,
        layers: mapDrawingCollection(content.layers, layer => applyPlotAppearance(layer, style)),
        entities: mapDrawingCollection(content.entities, entity => applyPlotEntityStyle(entity, style)),
        blocks: mapDrawingCollection(content.blocks, block => ({
            ...block,
            entities: mapDrawingCollection(block.entities, entity => applyPlotEntityStyle(entity, style)),
        })),
    };
}

function applyPlotEntityStyle(entity, style) {
    const preservesPartAppearance = entity?.type === 'polyline'
        && Array.isArray(entity.parts)
        && !hasExplicitAppearance(entity);
    let next = applyPlotAppearance(entity, style, { includeLineweight: !preservesPartAppearance });
    if (Array.isArray(entity?.parts)) {
        next = {
            ...next,
            parts: entity.parts.map(part => applyPlotEntityStyle(part, style)),
        };
    }
    if (Array.isArray(entity?.runs)) {
        next = {
            ...next,
            runs: entity.runs.map(run => isRecord(run?.marks) ? {
                ...run,
                marks: applyPlotAppearance(run.marks, style, { includeLineweight: false }),
            } : run),
        };
    }
    return next;
}

function hasExplicitAppearance(value) {
    return Boolean(value?.color || value?.lineWeight || value?.lineWidth || value?.lineType)
        || Object.hasOwn(value || {}, 'transparency');
}

function applyPlotAppearance(value, style, { includeLineweight = true } = {}) {
    if (!isRecord(value)) return value;
    const next = { ...value };
    const color = normalizeDrawingColor(value.color);
    if (color && style.colorMode !== 'asDisplayed') next.color = plotColor(color, style.colorMode);
    if (includeLineweight && !style.plotLineweights) {
        next.lineWeight = 1;
        delete next.lineWidth;
    }
    return next;
}

function plotColor(color, mode) {
    if (mode === 'monochrome') return '#000000';
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    const luminance = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
    const channel = luminance.toString(16).padStart(2, '0');
    return `#${channel}${channel}${channel}`;
}

function normalizePlotRect(value, fallback) {
    if (!isRecord(value)) return fallback ? { ...fallback } : null;
    const rawX = Number(value.x);
    const rawY = Number(value.y);
    const rawWidth = Number(value.width);
    const rawHeight = Number(value.height);
    if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite)
        || Math.abs(rawWidth) < MIN_REGION_SIZE || Math.abs(rawHeight) < MIN_REGION_SIZE) {
        return fallback ? { ...fallback } : null;
    }
    return {
        x: rawWidth < 0 ? rawX + rawWidth : rawX,
        y: rawHeight < 0 ? rawY + rawHeight : rawY,
        width: Math.abs(rawWidth),
        height: Math.abs(rawHeight),
    };
}

function normalizePlotOffset(value) {
    return {
        x: finiteOr(value?.x, DEFAULT_OFFSET_MM.x),
        y: finiteOr(value?.y, DEFAULT_OFFSET_MM.y),
    };
}

function normalizeMarginPair(firstValue, secondValue, size) {
    let first = clampFinite(firstValue, 0, size, 0);
    let second = clampFinite(secondValue, 0, size, 0);
    if (first + second >= size) {
        const scale = Math.max(0, size - MIN_REGION_SIZE) / (first + second || 1);
        first *= scale;
        second *= scale;
    }
    return { first, second };
}

function mapDrawingCollection(value, mapper) {
    return Array.isArray(value) ? value.map(mapper) : value;
}

function acceptedValue(value, options, fallback) {
    return options.includes(value) ? value : fallback;
}

function minimumFinite(value, minimum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, number) : fallback;
}

function clampFinite(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function positiveFinite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
