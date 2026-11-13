import { createDrawingId } from './drawingDocument.js';
import { getDrawingBounds } from './drawingGeometry.js';
import {
    DRAWING_CUSTOM_PAPER_FORMAT,
    DRAWING_VIEWPORT_SCALE_OPTIONS,
    createDrawingLayout,
    createDrawingViewport,
    getDrawingPaperSize,
    getDrawingPrintableArea,
    getDrawingViewportScale,
    normalizeDrawingPaperEntities,
    setDrawingViewportScale,
} from './drawingLayouts.js';

// "Put the model on a sheet": one viewport, centred on the model extents, at an
// exact standard scale, optionally with a ready-made title block. Every value
// here is paper millimetres except model extents (drawing metres).

export const DRAWING_SHEET_SETUP_FIT_SCALE = 'fit';
export const DRAWING_SHEET_FRAME_INSET_MM = 10;
export const DRAWING_TITLE_BLOCK_SIZE_MM = Object.freeze({ width: 180, height: 36 });
export const DRAWING_TITLE_BLOCK_ID_PREFIX = 'paper-titleblock';
export const DRAWING_TITLE_BLOCK_FIELDS = Object.freeze(['title', 'project', 'revision', 'scale', 'format', 'date', 'designer']);

const TITLE_BLOCK_GAP_MM = 3;
const SCALE_EPSILON = 1e-6;
const FIT_MARGIN_RATIO = 0.02;

/**
 * Rounds a raw viewport denominator up to the closest standard scale, so the
 * whole view still fits (1/436.86 becomes 1/500). Beyond the list, the 1-2-5
 * series keeps the result readable.
 */
export function snapDrawingViewportScale(denominator) {
    const value = Number(denominator);
    if (!Number.isFinite(value) || value <= 0) return DRAWING_VIEWPORT_SCALE_OPTIONS[0];
    const standard = DRAWING_VIEWPORT_SCALE_OPTIONS.find(option => option >= value * (1 - SCALE_EPSILON));
    if (standard) return standard;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const step = [1, 2, 5, 10].find(factor => factor * magnitude >= value * (1 - SCALE_EPSILON));
    return step * magnitude;
}

/** Largest standard scale (smallest denominator) that fits a model extent in a paper rectangle. */
export function fitDrawingSheetScale(extent, rect) {
    const width = Math.max(1e-9, Number(extent?.width) || 0);
    const height = Math.max(1e-9, Number(extent?.height) || 0);
    const raw = Math.max(width * 1000 / Math.max(1e-9, rect.width), height * 1000 / Math.max(1e-9, rect.height));
    return snapDrawingViewportScale(raw);
}

/** Viewport with the same model centre whose scale is snapped to the standard list. */
export function snapDrawingViewportToStandardScale(viewport) {
    const scale = snapDrawingViewportScale(getDrawingViewportScale(viewport));
    const box = viewport.modelViewBox;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const width = viewport.width * scale / 1000;
    const height = viewport.height * scale / 1000;
    return { ...viewport, modelViewBox: { x: centerX - width / 2, y: centerY - height / 2, width, height } };
}

/** "1:100", "2:1" for enlargements; non-integer ratios keep two decimals. */
export function formatDrawingScaleLabel(denominator, locale = 'en') {
    const value = Number(denominator);
    if (!Number.isFinite(value) || value <= 0) return '';
    const format = number => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(number);
    return value < 1 - SCALE_EPSILON ? `${format(1 / value)}:1` : `1:${format(value)}`;
}

/** The viewport that drives the sheet scale: the largest one by paper area. */
export function getDrawingMainViewport(layout) {
    return (layout?.viewports || []).reduce((largest, viewport) => (
        !largest || viewport.width * viewport.height > largest.width * largest.height ? viewport : largest
    ), null);
}

export function getDrawingLayoutScaleDenominator(layout) {
    const viewport = getDrawingMainViewport(layout);
    return viewport ? getDrawingViewportScale(viewport) : null;
}

export function isDrawingTitleBlockEntity(entity) {
    return typeof entity?.id === 'string' && entity.id.startsWith(`${DRAWING_TITLE_BLOCK_ID_PREFIX}-`);
}

/**
 * Splits the frame (printable area inset to at least 10 mm from the paper edge)
 * into the viewport area and the title-block strip in the lower-right corner.
 */
export function getDrawingSheetSetupRects(layout, { titleBlock = false } = {}) {
    const paper = getDrawingPaperSize(layout);
    const printable = getDrawingPrintableArea(layout);
    const left = Math.max(printable.x, Math.min(DRAWING_SHEET_FRAME_INSET_MM, paper.width / 8));
    const top = Math.max(printable.y, Math.min(DRAWING_SHEET_FRAME_INSET_MM, paper.height / 8));
    const right = Math.min(printable.x + printable.width, paper.width - Math.min(DRAWING_SHEET_FRAME_INSET_MM, paper.width / 8));
    const bottom = Math.min(printable.y + printable.height, paper.height - Math.min(DRAWING_SHEET_FRAME_INSET_MM, paper.height / 8));
    const frame = { x: left, y: top, width: Math.max(8, right - left), height: Math.max(8, bottom - top) };
    if (!titleBlock) return { frame, viewport: frame, titleBlock: null };
    const width = Math.min(DRAWING_TITLE_BLOCK_SIZE_MM.width, frame.width);
    const height = Math.min(DRAWING_TITLE_BLOCK_SIZE_MM.height, frame.height / 3);
    const block = { x: frame.x + frame.width - width, y: frame.y + frame.height - height, width, height };
    const viewport = { ...frame, height: Math.max(8, frame.height - height - TITLE_BLOCK_GAP_MM) };
    return { frame, viewport, titleBlock: block };
}

/**
 * Paper entities of a standard design-office title block. Labels and values
 * are plain editable texts (2.5 mm captions, 3.5 mm values, 5 mm title).
 */
export function createDrawingTitleBlockEntities(rect, { labels = {}, values = {}, layerId = 'geometry' } = {}) {
    const { x, y, width: w, height: h } = rect;
    const row = h / 3;
    const id = () => createDrawingId(DRAWING_TITLE_BLOCK_ID_PREFIX);
    const line = (x1, y1, x2, y2) => ({ id: id(), type: 'line', layerId, x1, y1, x2, y2 });
    const cells = [
        { field: 'title', x, y, width: w, valueSize: 5 },
        { field: 'project', x, y: y + row, width: w * 2 / 3, valueSize: 3.5 },
        { field: 'revision', x: x + w * 2 / 3, y: y + row, width: w / 3, valueSize: 3.5 },
        { field: 'scale', x, y: y + row * 2, width: w * 0.2, valueSize: 3.5 },
        { field: 'format', x: x + w * 0.2, y: y + row * 2, width: w * 0.2, valueSize: 3.5 },
        { field: 'date', x: x + w * 0.4, y: y + row * 2, width: w * 0.25, valueSize: 3.5 },
        { field: 'designer', x: x + w * 0.65, y: y + row * 2, width: w * 0.35, valueSize: 3.5 },
    ];
    const text = (cellX, cellY, width, height, fontSize, value) => ({
        id: id(), type: 'text', layerId, x: cellX, y: cellY, width, height, fontSize,
        text: String(value ?? ''), textMode: 'singleLine', wrapMode: 'none',
        horizontalAlign: 'left', verticalAlign: 'top',
    });
    const pad = Math.min(1.5, w / 60);
    return [
        { id: id(), type: 'rectangle', layerId, x, y, width: w, height: h, rotation: 0, cornerStyle: 'square', cornerValue: 0, lineWeight: 2 },
        line(x, y + row, x + w, y + row),
        line(x, y + row * 2, x + w, y + row * 2),
        line(x + w * 2 / 3, y + row, x + w * 2 / 3, y + row * 2),
        ...[0.2, 0.4, 0.65].map(ratio => line(x + w * ratio, y + row * 2, x + w * ratio, y + h)),
        ...cells.flatMap(cell => [
            text(cell.x + pad, cell.y + pad * 0.7, Math.max(1, cell.width - pad * 2), 3.2, 2.5, labels[cell.field]),
            text(cell.x + pad, cell.y + row * 0.4, Math.max(1, cell.width - pad * 2), Math.max(1, row * 0.6 - pad * 0.5),
                Math.min(cell.valueSize, row * 0.45), values[cell.field]),
        ]),
    ];
}

/** Replaces any previous title block of the layout with a fresh one. */
export function insertDrawingTitleBlock(layout, options = {}) {
    const { titleBlock } = getDrawingSheetSetupRects(layout, { titleBlock: true });
    const kept = (layout.paperEntities || []).filter(entity => !isDrawingTitleBlockEntity(entity));
    return {
        ...layout,
        paperEntities: normalizeDrawingPaperEntities([
            ...kept,
            ...createDrawingTitleBlockEntities(titleBlock, options),
        ], getDrawingPaperSize(layout)),
    };
}

/**
 * Puts the model extent on a sheet in one document change: paper format and
 * orientation, one locked viewport centred on the extents at an exact scale
 * (a standard scale, or the largest standard one that fits), and optionally
 * a title block. The main viewport keeps its id when the layout had one.
 */
export function applyDrawingSheetSetup(layout, content, {
    format,
    orientation,
    scale = DRAWING_SHEET_SETUP_FIT_SCALE,
    titleBlock = false,
    titleBlockLabels = {},
    titleBlockValues = {},
    layerId = content?.activeLayerId || 'geometry',
} = {}) {
    const sized = createDrawingLayout({
        ...layout,
        format: format || layout.format,
        orientation: orientation || layout.orientation,
        viewports: [],
        paperEntities: [],
    });
    const rects = getDrawingSheetSetupRects(sized, { titleBlock });
    const extent = getDrawingSheetModelExtent(content);
    const denominator = resolveDrawingSheetScale(scale, extent, rects.viewport);
    const width = rects.viewport.width * denominator / 1000;
    const height = rects.viewport.height * denominator / 1000;
    const main = getDrawingMainViewport(layout);
    const viewport = createDrawingViewport({
        ...(main || {}),
        id: main?.id,
        rect: rects.viewport,
        modelViewBox: { x: extent.centerX - width / 2, y: extent.centerY - height / 2, width, height },
        hiddenLayerIds: main ? main.hiddenLayerIds : (content?.layers || []).filter(layer => layer.newViewportFrozen).map(layer => layer.id),
        clipBoundary: null,
        viewRotation: 0,
        locked: true,
    });
    const paperEntities = (layout.paperEntities || []).filter(entity => !isDrawingTitleBlockEntity(entity));
    let next = {
        ...sized,
        viewports: [viewport, ...(layout.viewports || []).filter(item => item.id !== main?.id)],
        paperEntities: normalizeDrawingPaperEntities(paperEntities, getDrawingPaperSize(sized)),
    };
    if (titleBlock) {
        next = insertDrawingTitleBlock(next, {
            labels: titleBlockLabels,
            values: { ...titleBlockValues, scale: formatDrawingScaleLabel(denominator), format: drawingPaperFormatLabel(next) },
            layerId,
        });
    }
    return { layout: next, viewportId: viewport.id, scale: denominator };
}

export function resolveDrawingSheetScale(scale, extent, rect) {
    const fixed = Number(scale);
    if (scale !== DRAWING_SHEET_SETUP_FIT_SCALE && Number.isFinite(fixed) && fixed > 0) return fixed;
    return fitDrawingSheetScale({
        width: extent.width * (1 + FIT_MARGIN_RATIO * 2),
        height: extent.height * (1 + FIT_MARGIN_RATIO * 2),
    }, rect);
}

export function getDrawingSheetModelExtent(content) {
    const bounds = content?.entities?.length
        ? getDrawingBounds({ layers: [], ...content }, { printableOnly: true })
        : { minX: -5, minY: -3, maxX: 25, maxY: 17 };
    return {
        width: Math.max(1e-6, bounds.maxX - bounds.minX),
        height: Math.max(1e-6, bounds.maxY - bounds.minY),
        centerX: (bounds.minX + bounds.maxX) / 2,
        centerY: (bounds.minY + bounds.maxY) / 2,
    };
}

/** Reads "100", "1:100", "1/100" or "2:1" as a viewport scale denominator. */
export function parseDrawingViewportScaleInput(input) {
    const text = String(input ?? '').trim().replace(/,/g, '.');
    const ratio = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(text);
    const value = ratio ? Number(ratio[2]) / Number(ratio[1]) : /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
    return Number.isFinite(value) && value > 0 && value <= 1_000_000 ? value : null;
}

/**
 * VPSCALE: sets the scale of the selected viewport, or of the only viewport of
 * the layout. Returns the next layout, or a message key explaining the refusal.
 */
export function applyDrawingViewportScaleCommand(layout, selectedViewportId, input) {
    const viewport = layout?.viewports.find(item => item.id === selectedViewportId)
        || (layout?.viewports.length === 1 ? layout.viewports[0] : null);
    if (!viewport) return { messageKey: 'layout.viewportSelectionRequired' };
    const denominator = parseDrawingViewportScaleInput(input);
    if (!denominator) return { messageKey: 'layout.viewportScaleSyntax', scale: getDrawingViewportScale(viewport) };
    if (viewport.locked) return { messageKey: 'layout.viewportScaleLockedHint' };
    return {
        layout: { ...layout, viewports: layout.viewports.map(item => item.id === viewport.id ? setDrawingViewportScale(item, denominator) : item) },
        messageKey: 'layout.viewportScaleSet',
        scale: denominator,
        viewportId: viewport.id,
    };
}

/** "A3", or "420 × 297" for a custom sheet. */
export function drawingPaperFormatLabel(layout) {
    if (layout?.format !== DRAWING_CUSTOM_PAPER_FORMAT) return layout?.format || '';
    const paper = getDrawingPaperSize(layout);
    return `${Math.round(paper.width)} × ${Math.round(paper.height)}`;
}
