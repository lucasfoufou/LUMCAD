import { createDrawingId } from './drawingDocument.js';
import { fitViewBox } from './drawingGeometry.js';

export const DRAWING_PAPER_FORMATS = Object.freeze({
    A4: Object.freeze({ width: 297, height: 210 }),
    A3: Object.freeze({ width: 420, height: 297 }),
    A2: Object.freeze({ width: 594, height: 420 }),
    A1: Object.freeze({ width: 841, height: 594 }),
    A0: Object.freeze({ width: 1189, height: 841 }),
});

export const DRAWING_PAPER_FORMAT_OPTIONS = Object.freeze(Object.keys(DRAWING_PAPER_FORMATS));
export const DRAWING_ORIENTATION_OPTIONS = Object.freeze(['landscape', 'portrait']);
export const DRAWING_VIEWPORT_SCALE_OPTIONS = Object.freeze([10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000]);
export const MIN_VIEWPORT_SIZE_MM = 8;

const A4_SHORT_SIDE_MM = 210;
const A4_DIMENSION_TEXT_SIZE_MM = 3;

const DEFAULT_MODEL_VIEW_BOX = Object.freeze({ x: -5, y: -3, width: 30, height: 20 });

export function createDefaultDrawingLayouts({ name = 'Layout 1' } = {}) {
    return [createDrawingLayout({ name })];
}

export function createDrawingLayout({ id, name = 'Layout', format = 'A0', orientation = 'landscape', viewports = [] } = {}) {
    const normalizedFormat = normalizePaperFormat(format);
    const normalizedOrientation = normalizePaperOrientation(orientation);
    const paper = getDrawingPaperSize(normalizedFormat, normalizedOrientation);
    return {
        id: typeof id === 'string' && id ? id : createDrawingId('layout'),
        name: String(name || '').trim() || 'Layout',
        format: normalizedFormat,
        orientation: normalizedOrientation,
        viewports: Array.isArray(viewports)
            ? viewports.map((viewport, index) => normalizeDrawingViewport(viewport, paper, index))
            : [],
    };
}

export function normalizeDrawingLayouts(layouts, { defaultName = 'Layout 1' } = {}) {
    if (!Array.isArray(layouts) || layouts.length === 0) return createDefaultDrawingLayouts({ name: defaultName });
    const normalized = layouts.flatMap((layout, index) => (
        layout && typeof layout === 'object'
            ? [createDrawingLayout({ ...layout, name: layout.name || `Layout ${index + 1}` })]
            : []
    ));
    return normalized.length ? normalized : createDefaultDrawingLayouts({ name: defaultName });
}

export function createDrawingViewport({ id, name = '', rect, modelViewBox, hiddenLayerIds = [] } = {}) {
    const normalizedRect = normalizePaperRect(rect);
    return {
        id: typeof id === 'string' && id ? id : createDrawingId('viewport'),
        name: String(name || '').trim(),
        hiddenLayerIds: normalizeHiddenLayerIds(hiddenLayerIds),
        ...normalizedRect,
        modelViewBox: fitViewBoxToAspect(
            normalizeModelViewBox(modelViewBox),
            normalizedRect.width / normalizedRect.height,
        ),
    };
}

export function createFittedDrawingViewport(content, rect) {
    const normalizedRect = normalizePaperRect(rect);
    return createDrawingViewport({
        rect: normalizedRect,
        modelViewBox: fitViewBox(content, normalizedRect.width / normalizedRect.height),
    });
}

export function getDrawingPaperSize(format, orientation = 'landscape') {
    const dimensions = DRAWING_PAPER_FORMATS[normalizePaperFormat(format)];
    return normalizePaperOrientation(orientation) === 'portrait'
        ? { width: dimensions.height, height: dimensions.width }
        : dimensions;
}

export function getDrawingLayoutDimensionTextSize(paper) {
    const shortSide = Math.min(Number(paper?.width) || A4_SHORT_SIDE_MM, Number(paper?.height) || A4_SHORT_SIDE_MM);
    return A4_DIMENSION_TEXT_SIZE_MM * shortSide / A4_SHORT_SIDE_MM;
}

export function changeDrawingLayoutFormat(layout, format) {
    const nextFormat = normalizePaperFormat(format);
    if (nextFormat === layout.format) return layout;
    return resizeDrawingLayoutPaper(layout, {
        format: nextFormat,
        orientation: layout.orientation,
    });
}

export function changeDrawingLayoutOrientation(layout, orientation) {
    const nextOrientation = normalizePaperOrientation(orientation);
    if (nextOrientation === layout.orientation) return layout;
    return resizeDrawingLayoutPaper(layout, {
        format: layout.format,
        orientation: nextOrientation,
    });
}

function resizeDrawingLayoutPaper(layout, { format, orientation }) {
    const previousPaper = getDrawingPaperSize(layout.format, layout.orientation);
    const nextPaper = getDrawingPaperSize(format, orientation);
    const scaleX = nextPaper.width / previousPaper.width;
    const scaleY = nextPaper.height / previousPaper.height;
    return {
        ...layout,
        format,
        orientation,
        viewports: layout.viewports.map(viewport => constrainViewportToPaper({
            ...viewport,
            x: viewport.x * scaleX,
            y: viewport.y * scaleY,
            width: viewport.width * scaleX,
            height: viewport.height * scaleY,
        }, nextPaper)),
    };
}

export function updateDrawingLayout(layouts, layoutId, updater) {
    return layouts.map(layout => layout.id === layoutId
        ? (typeof updater === 'function' ? updater(layout) : { ...layout, ...updater })
        : layout);
}

export function updateDrawingViewport(layout, viewportId, updater) {
    const paper = getDrawingPaperSize(layout.format, layout.orientation);
    return {
        ...layout,
        viewports: layout.viewports.map(viewport => {
            if (viewport.id !== viewportId) return viewport;
            const updated = typeof updater === 'function' ? updater(viewport) : { ...viewport, ...updater };
            return constrainViewportToPaper({
                ...updated,
                modelViewBox: fitViewBoxToAspect(
                    normalizeModelViewBox(updated.modelViewBox),
                    Math.max(MIN_VIEWPORT_SIZE_MM, Number(updated.width) || viewport.width)
                        / Math.max(MIN_VIEWPORT_SIZE_MM, Number(updated.height) || viewport.height),
                ),
            }, paper);
        }),
    };
}

export function resizeDrawingViewport(layout, viewportId, rectUpdates) {
    const paper = getDrawingPaperSize(layout.format, layout.orientation);
    return {
        ...layout,
        viewports: layout.viewports.map(viewport => viewport.id === viewportId
            ? resizeDrawingViewportKeepingScale(viewport, { ...viewport, ...rectUpdates }, paper)
            : viewport),
    };
}

export function resizeDrawingViewportKeepingScale(viewport, rect, paper) {
    const scale = getDrawingViewportScale(viewport);
    const centerX = viewport.modelViewBox.x + viewport.modelViewBox.width / 2;
    const centerY = viewport.modelViewBox.y + viewport.modelViewBox.height / 2;
    const constrained = constrainViewportToPaper({ ...viewport, ...rect }, paper);
    const width = constrained.width * scale / 1000;
    const height = constrained.height * scale / 1000;
    return {
        ...constrained,
        modelViewBox: {
            x: centerX - width / 2,
            y: centerY - height / 2,
            width,
            height,
        },
    };
}

export function scaleDrawingViewport(layout, viewportId, factor, basePoint) {
    const scaleFactor = Number(factor);
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0 || !basePoint) return layout;
    const paper = getDrawingPaperSize(layout.format, layout.orientation);
    return {
        ...layout,
        viewports: layout.viewports.map(viewport => {
            if (viewport.id !== viewportId) return viewport;
            return resizeDrawingViewportKeepingScale(viewport, {
                x: basePoint.x + (viewport.x - basePoint.x) * scaleFactor,
                y: basePoint.y + (viewport.y - basePoint.y) * scaleFactor,
                width: viewport.width * scaleFactor,
                height: viewport.height * scaleFactor,
            }, paper);
        }),
    };
}

export function removeDrawingViewport(layout, viewportId) {
    return { ...layout, viewports: layout.viewports.filter(viewport => viewport.id !== viewportId) };
}

export function constrainViewportToPaper(viewport, paper) {
    const width = clamp(Math.abs(Number(viewport.width) || MIN_VIEWPORT_SIZE_MM), MIN_VIEWPORT_SIZE_MM, paper.width);
    const height = clamp(Math.abs(Number(viewport.height) || MIN_VIEWPORT_SIZE_MM), MIN_VIEWPORT_SIZE_MM, paper.height);
    const x = clamp(Number(viewport.x) || 0, 0, Math.max(0, paper.width - width));
    const y = clamp(Number(viewport.y) || 0, 0, Math.max(0, paper.height - height));
    const constrainedWidth = Math.min(width, paper.width - x);
    const constrainedHeight = Math.min(height, paper.height - y);
    return {
        ...viewport,
        hiddenLayerIds: normalizeHiddenLayerIds(viewport.hiddenLayerIds),
        x,
        y,
        width: constrainedWidth,
        height: constrainedHeight,
        modelViewBox: fitViewBoxToAspect(
            normalizeModelViewBox(viewport.modelViewBox),
            constrainedWidth / constrainedHeight,
        ),
    };
}

export function paperRectFromPoints(first, second) {
    return {
        x: Math.min(first.x, second.x),
        y: Math.min(first.y, second.y),
        width: Math.abs(second.x - first.x),
        height: Math.abs(second.y - first.y),
    };
}

export function fitViewBoxToAspect(viewBox, aspectRatio) {
    const normalized = normalizeModelViewBox(viewBox);
    const aspect = Math.max(0.000001, Number(aspectRatio) || 1);
    let width = normalized.width;
    let height = normalized.height;
    if (width / height > aspect) height = width / aspect;
    else width = height * aspect;
    const centerX = normalized.x + normalized.width / 2;
    const centerY = normalized.y + normalized.height / 2;
    return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

export function modelViewBoxFromViewport(viewport, aspectRatio) {
    const width = Math.max(0.000001, Number(viewport?.width) || DEFAULT_MODEL_VIEW_BOX.width);
    const height = Math.max(0.000001, Number(viewport?.height) || width / (Number(aspectRatio) || 1));
    const centerX = Number.isFinite(Number(viewport?.x)) ? Number(viewport.x) : DEFAULT_MODEL_VIEW_BOX.x + DEFAULT_MODEL_VIEW_BOX.width / 2;
    const centerY = Number.isFinite(Number(viewport?.y)) ? Number(viewport.y) : DEFAULT_MODEL_VIEW_BOX.y + DEFAULT_MODEL_VIEW_BOX.height / 2;
    return fitViewBoxToAspect({ x: centerX - width / 2, y: centerY - height / 2, width, height }, aspectRatio);
}

export function getDrawingViewportScale(viewport) {
    const paperWidth = Math.max(0.000001, Number(viewport?.width) || MIN_VIEWPORT_SIZE_MM);
    const modelWidth = Math.max(0.000001, Number(viewport?.modelViewBox?.width) || DEFAULT_MODEL_VIEW_BOX.width);
    return modelWidth * 1000 / paperWidth;
}

export function setDrawingViewportScale(viewport, denominator) {
    const scale = Math.max(0.000001, Number(denominator) || getDrawingViewportScale(viewport));
    const centerX = viewport.modelViewBox.x + viewport.modelViewBox.width / 2;
    const centerY = viewport.modelViewBox.y + viewport.modelViewBox.height / 2;
    const width = viewport.width * scale / 1000;
    const height = viewport.height * scale / 1000;
    return {
        ...viewport,
        modelViewBox: {
            x: centerX - width / 2,
            y: centerY - height / 2,
            width,
            height,
        },
    };
}

function normalizeDrawingViewport(viewport, paper, index) {
    const fallbackWidth = Math.max(MIN_VIEWPORT_SIZE_MM, paper.width - 20);
    const fallbackHeight = Math.max(MIN_VIEWPORT_SIZE_MM, paper.height - 20);
    const normalized = createDrawingViewport({
        ...viewport,
        id: viewport?.id || createDrawingId(`viewport-${index + 1}`),
        rect: {
            x: viewport?.x ?? 10,
            y: viewport?.y ?? 10,
            width: viewport?.width ?? fallbackWidth,
            height: viewport?.height ?? fallbackHeight,
        },
    });
    return constrainViewportToPaper(normalized, paper);
}

function normalizePaperFormat(value) {
    const format = String(value || '').trim().toUpperCase();
    return Object.hasOwn(DRAWING_PAPER_FORMATS, format) ? format : 'A0';
}

function normalizePaperOrientation(value) {
    const orientation = String(value || '').trim().toLowerCase();
    return DRAWING_ORIENTATION_OPTIONS.includes(orientation) ? orientation : 'landscape';
}

function normalizeHiddenLayerIds(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(layerId => typeof layerId === 'string' && layerId))];
}

function normalizePaperRect(rect) {
    return {
        x: Number(rect?.x) || 0,
        y: Number(rect?.y) || 0,
        width: Math.max(0.000001, Math.abs(Number(rect?.width) || MIN_VIEWPORT_SIZE_MM)),
        height: Math.max(0.000001, Math.abs(Number(rect?.height) || MIN_VIEWPORT_SIZE_MM)),
    };
}

function normalizeModelViewBox(viewBox) {
    const x = Number(viewBox?.x);
    const y = Number(viewBox?.y);
    const width = Number(viewBox?.width);
    const height = Number(viewBox?.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return { ...DEFAULT_MODEL_VIEW_BOX };
    return { x, y, width, height };
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
