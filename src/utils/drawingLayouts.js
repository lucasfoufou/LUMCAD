import {
    createDrawingId,
    normalizeDrawingColor,
    normalizeDrawingLineType,
    normalizeDrawingLineWeight,
    normalizeDrawingTransparency,
} from './drawingDocument.js';
import { isDrawingDimensionEntity, remapDrawingEntityDependencies } from './drawingDimensions.js';
import { fitViewBox } from './drawingGeometry.js';
import { normalizeDrawingPlotSettings } from './drawingPlot.js';
import { normalizeDrawingTextEntity } from './drawingText.js';
import { editEntityGrip } from './drawingSelection.js';

export const DRAWING_PAPER_FORMATS = Object.freeze({
    A4: Object.freeze({ width: 297, height: 210 }),
    A3: Object.freeze({ width: 420, height: 297 }),
    A2: Object.freeze({ width: 594, height: 420 }),
    A1: Object.freeze({ width: 841, height: 594 }),
    A0: Object.freeze({ width: 1189, height: 841 }),
});

export const DRAWING_CUSTOM_PAPER_FORMAT = 'CUSTOM';
export const DRAWING_STANDARD_PAPER_FORMAT_OPTIONS = Object.freeze(Object.keys(DRAWING_PAPER_FORMATS));
export const DRAWING_PAPER_FORMAT_OPTIONS = Object.freeze([
    ...DRAWING_STANDARD_PAPER_FORMAT_OPTIONS,
    DRAWING_CUSTOM_PAPER_FORMAT,
]);
export const DRAWING_ORIENTATION_OPTIONS = Object.freeze(['landscape', 'portrait']);
export const DRAWING_VIEWPORT_SCALE_OPTIONS = Object.freeze([10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000]);
export const DRAWING_VIEWPORT_VISUAL_STYLE_OPTIONS = Object.freeze(['normal', 'grayscale', 'monochrome']);
export const DRAWING_VIEWPORT_CLIP_PRESET_OPTIONS = Object.freeze(['rectangle', 'triangle', 'hexagon']);
export const DRAWING_VIEWPORT_ARRANGEMENT_OPTIONS = Object.freeze([
    'single',
    'twoHorizontal',
    'twoVertical',
    'four',
]);
export const DRAWING_LAYOUT_TEMPLATE_OPTIONS = Object.freeze([
    'blank',
    ...DRAWING_VIEWPORT_ARRANGEMENT_OPTIONS,
]);
export const DRAWING_PAPER_ANNOTATION_TYPE_OPTIONS = Object.freeze(['text', 'line', 'rectangle']);
export const DRAWING_PAGE_SETUP_EXPORT_FORMAT = 'lumcad-page-setups';
export const DRAWING_PAGE_SETUP_EXPORT_VERSION = 1;
export const MIN_VIEWPORT_SIZE_MM = 8;
export const MIN_PAPER_SIZE_MM = 10;
export const MAX_PAPER_SIZE_MM = 5_000;
export const MIN_PRINTABLE_SIZE_MM = 8;

const DEFAULT_CUSTOM_PAPER_SIZE = Object.freeze({ width: 420, height: 297 });
const DEFAULT_MARGINS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const DEFAULT_VIEWPORT_VISUAL_SETTINGS = Object.freeze({
    style: 'normal',
    showLineweights: true,
});
const DEFAULT_VIEWPORT_ANNOTATION_SETTINGS = Object.freeze({
    showText: true,
    showDimensions: true,
    dimensionTextSizeMm: 3,
});
const DEFAULT_MODEL_VIEW_BOX = Object.freeze({ x: -5, y: -3, width: 30, height: 20 });
const STANDARD_ARRANGEMENT_GAP_MM = 5;
const POLYGON_AREA_EPSILON = 1e-8;

export function createDefaultDrawingLayouts({ name = 'Layout 1' } = {}) {
    return [createDrawingLayout({ name })];
}

export function createDrawingLayout({
    id,
    name = 'Layout',
    format = 'A0',
    orientation = 'landscape',
    customPaperSize = DEFAULT_CUSTOM_PAPER_SIZE,
    margins = DEFAULT_MARGINS,
    plotSettings,
    pageSetupId = null,
    viewports = [],
    paperEntities = [],
} = {}) {
    const normalizedFormat = normalizePaperFormat(format);
    const normalizedOrientation = normalizePaperOrientation(orientation);
    const normalizedCustomPaperSize = normalizeCustomPaperSize(customPaperSize);
    const paper = getDrawingPaperSize(normalizedFormat, normalizedOrientation, normalizedCustomPaperSize);
    return {
        id: typeof id === 'string' && id ? id : createDrawingId('layout'),
        name: String(name || '').trim() || 'Layout',
        format: normalizedFormat,
        orientation: normalizedOrientation,
        customPaperSize: normalizedCustomPaperSize,
        margins: normalizeDrawingPaperMargins(margins, paper),
        plotSettings: normalizeDrawingPlotSettings(plotSettings),
        pageSetupId: typeof pageSetupId === 'string' && pageSetupId ? pageSetupId : null,
        viewports: Array.isArray(viewports)
            ? viewports.map((viewport, index) => normalizeDrawingViewport(viewport, paper, index))
            : [],
        paperEntities: normalizeDrawingPaperEntities(paperEntities, paper),
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

export function createDrawingPageSetup({
    id,
    name = 'Page setup',
    format = 'A0',
    orientation = 'landscape',
    customPaperSize = DEFAULT_CUSTOM_PAPER_SIZE,
    margins = DEFAULT_MARGINS,
    plotSettings,
} = {}) {
    const normalizedFormat = normalizePaperFormat(format);
    const normalizedOrientation = normalizePaperOrientation(orientation);
    const normalizedCustomPaperSize = normalizeCustomPaperSize(customPaperSize);
    const paper = getDrawingPaperSize(normalizedFormat, normalizedOrientation, normalizedCustomPaperSize);
    return {
        id: typeof id === 'string' && id ? id : createDrawingId('page-setup'),
        name: String(name || '').trim() || 'Page setup',
        format: normalizedFormat,
        orientation: normalizedOrientation,
        customPaperSize: normalizedCustomPaperSize,
        margins: normalizeDrawingPaperMargins(margins, paper),
        plotSettings: normalizeDrawingPlotSettings(plotSettings),
    };
}

export function createDrawingPageSetupFromLayout(layout, { id, name = layout?.name } = {}) {
    return createDrawingPageSetup({
        id,
        name,
        format: layout?.format,
        orientation: layout?.orientation,
        customPaperSize: layout?.customPaperSize,
        margins: layout?.margins,
        plotSettings: layout?.plotSettings,
    });
}

export function normalizeDrawingPageSetups(pageSetups) {
    if (!Array.isArray(pageSetups)) return [];
    const ids = new Set();
    return pageSetups.flatMap(pageSetup => {
        if (!pageSetup || typeof pageSetup !== 'object') return [];
        const normalized = createDrawingPageSetup(pageSetup);
        if (ids.has(normalized.id)) normalized.id = createDrawingId('page-setup');
        ids.add(normalized.id);
        return [normalized];
    });
}

export function importDrawingPageSetups(currentPageSetups, importedPageSetups) {
    const pageSetups = normalizeDrawingPageSetups(currentPageSetups);
    const usedIds = new Set(pageSetups.map(pageSetup => pageSetup.id));
    const usedNames = pageSetups.map(pageSetup => pageSetup.name);
    const importedIds = [];
    normalizeDrawingPageSetups(importedPageSetups).forEach(pageSetup => {
        const duplicate = pageSetups.find(existing => pageSetupsEqual(existing, pageSetup));
        if (duplicate) {
            importedIds.push(duplicate.id);
            return;
        }
        const id = usedIds.has(pageSetup.id) ? createDrawingId('page-setup') : pageSetup.id;
        const name = getUniqueDrawingName(pageSetup.name, usedNames);
        const imported = { ...pageSetup, id, name };
        pageSetups.push(imported);
        importedIds.push(id);
        usedIds.add(id);
        usedNames.push(name);
    });
    return { pageSetups, importedIds };
}

/**
 * Creates a small, portable page-setup document. The payload intentionally uses
 * the same normalized setup objects as an .lcad document so it can be embedded
 * in other archive/import workflows without a second representation.
 */
export function createDrawingPageSetupExport(pageSetups, { sourceName = '' } = {}) {
    return {
        format: DRAWING_PAGE_SETUP_EXPORT_FORMAT,
        version: DRAWING_PAGE_SETUP_EXPORT_VERSION,
        sourceName: String(sourceName || '').trim(),
        pageSetups: normalizeDrawingPageSetups(pageSetups),
    };
}

export function serializeDrawingPageSetups(pageSetups, options = {}) {
    return JSON.stringify(createDrawingPageSetupExport(pageSetups, options), null, 2);
}

/**
 * Reads either the dedicated JSON payload or the document/envelope shape used
 * by .lcad. Layout paper snapshots are a fallback for older drawings that do
 * not contain named page-setup profiles.
 */
export function parseDrawingPageSetups(value) {
    let source = value;
    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            throw new TypeError('Invalid page-setup JSON.');
        }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError('Invalid page-setup document.');
    }
    if (source.format === DRAWING_PAGE_SETUP_EXPORT_FORMAT
        && Number(source.version) !== DRAWING_PAGE_SETUP_EXPORT_VERSION) {
        throw new TypeError('Unsupported page-setup document version.');
    }
    const document = source.document && typeof source.document === 'object'
        ? source.document
        : source.envelope?.document && typeof source.envelope.document === 'object'
            ? source.envelope.document
            : source;
    const pageSetups = Array.isArray(document.pageSetups) && document.pageSetups.length
        ? document.pageSetups
        : Array.isArray(document.layouts)
            ? document.layouts.map(layout => createDrawingPageSetupFromLayout(layout))
            : [];
    return normalizeDrawingPageSetups(pageSetups);
}

export function applyDrawingPageSetup(layout, pageSetup) {
    if (!pageSetup) return layout;
    const normalized = createDrawingPageSetup(pageSetup);
    return resizeDrawingLayoutPaper(layout, {
        format: normalized.format,
        orientation: normalized.orientation,
        customPaperSize: normalized.customPaperSize,
        margins: normalized.margins,
        plotSettings: normalized.plotSettings,
        pageSetupId: normalized.id,
    });
}

export function duplicateDrawingLayout(layout, layouts = [], { name } = {}) {
    const source = createDrawingLayout(layout);
    const paperEntityIds = new Map(source.paperEntities.map(entity => [entity.id, createDrawingId(entity.type || 'paper-entity')]));
    const nextName = getUniqueDrawingLayoutName(name || source.name, layouts);
    return createDrawingLayout({
        ...source,
        id: createDrawingId('layout'),
        name: nextName,
        viewports: source.viewports.map(viewport => ({ ...viewport, id: createDrawingId('viewport') })),
        paperEntities: source.paperEntities.map(entity => ({
            ...remapDrawingEntityDependencies(cloneSerializable(entity), paperEntityIds),
            id: paperEntityIds.get(entity.id) || createDrawingId(entity.type || 'paper-entity'),
        })),
    });
}

export function reorderDrawingLayouts(layouts, layoutId, toIndex) {
    if (!Array.isArray(layouts)) return [];
    const fromIndex = layouts.findIndex(layout => layout.id === layoutId);
    if (fromIndex < 0) return layouts;
    const targetIndex = clamp(Math.round(Number(toIndex) || 0), 0, layouts.length - 1);
    if (targetIndex === fromIndex) return layouts;
    const next = [...layouts];
    const [layout] = next.splice(fromIndex, 1);
    next.splice(targetIndex, 0, layout);
    return next;
}

export function renameDrawingLayout(layouts, layoutId, name) {
    if (!Array.isArray(layouts)) return [];
    const current = layouts.find(layout => layout.id === layoutId);
    if (!current) return layouts;
    const trimmed = String(name || '').trim();
    if (!trimmed) return layouts;
    const unique = getUniqueDrawingName(trimmed, layouts.filter(layout => layout.id !== layoutId).map(layout => layout.name));
    if (unique === current.name) return layouts;
    return layouts.map(layout => layout.id === layoutId ? { ...layout, name: unique } : layout);
}

export function getUniqueDrawingLayoutName(name, layouts = []) {
    return getUniqueDrawingName(String(name || '').trim() || 'Layout', layouts.map(layout => layout.name));
}

export function createDrawingLayoutFromTemplate({
    template = 'blank',
    modelViewBox = DEFAULT_MODEL_VIEW_BOX,
    ...layoutOptions
} = {}) {
    const layout = createDrawingLayout(layoutOptions);
    return template === 'blank'
        ? layout
        : createStandardViewportArrangement(layout, template, modelViewBox);
}

export function createStandardViewportArrangement(layout, arrangement = 'single', modelViewBox = DEFAULT_MODEL_VIEW_BOX) {
    const normalizedArrangement = DRAWING_VIEWPORT_ARRANGEMENT_OPTIONS.includes(arrangement) ? arrangement : 'single';
    const printable = getDrawingPrintableArea(layout);
    const gap = Math.min(STANDARD_ARRANGEMENT_GAP_MM, printable.width / 10, printable.height / 10);
    const halfWidth = (printable.width - gap) / 2;
    const halfHeight = (printable.height - gap) / 2;
    const rects = {
        single: [printable],
        twoHorizontal: [
            { x: printable.x, y: printable.y, width: printable.width, height: halfHeight },
            { x: printable.x, y: printable.y + halfHeight + gap, width: printable.width, height: halfHeight },
        ],
        twoVertical: [
            { x: printable.x, y: printable.y, width: halfWidth, height: printable.height },
            { x: printable.x + halfWidth + gap, y: printable.y, width: halfWidth, height: printable.height },
        ],
        four: [
            { x: printable.x, y: printable.y, width: halfWidth, height: halfHeight },
            { x: printable.x + halfWidth + gap, y: printable.y, width: halfWidth, height: halfHeight },
            { x: printable.x, y: printable.y + halfHeight + gap, width: halfWidth, height: halfHeight },
            { x: printable.x + halfWidth + gap, y: printable.y + halfHeight + gap, width: halfWidth, height: halfHeight },
        ],
    }[normalizedArrangement];
    return {
        ...layout,
        viewports: rects.map(rect => createDrawingViewport({
            rect,
            modelViewBox: fitViewBoxToAspect(modelViewBox, rect.width / rect.height),
        })),
    };
}

export function createDrawingPaperAnnotation(layoutOrPaper, type = 'text', options = {}) {
    const source = type && typeof type === 'object'
        ? type
        : { ...options, type };
    const paper = resolveDrawingPaperSize(layoutOrPaper);
    const printable = layoutOrPaper?.format || layoutOrPaper?.margins
        ? getDrawingPrintableArea(layoutOrPaper)
        : { x: 0, y: 0, ...paper };
    const inset = Math.min(5, printable.width / 8, printable.height / 8);
    const x = printable.x + inset;
    const y = printable.y + inset;
    const normalizedType = DRAWING_PAPER_ANNOTATION_TYPE_OPTIONS.includes(source.type) ? source.type : 'text';
    const defaults = normalizedType === 'line'
        ? {
            x1: x,
            y1: y + Math.min(15, Math.max(0, printable.height - inset * 2)),
            x2: Math.min(printable.x + printable.width - inset, x + 60),
            y2: y + Math.min(15, Math.max(0, printable.height - inset * 2)),
        }
        : normalizedType === 'rectangle'
            ? {
                x,
                y,
                width: Math.min(80, Math.max(1, printable.width - inset * 2)),
                height: Math.min(40, Math.max(1, printable.height - inset * 2)),
                rotation: 0,
                cornerStyle: 'square',
                cornerValue: 0,
            }
        : {
            x,
            y,
            width: Math.min(80, Math.max(1, printable.width - inset * 2)),
            height: Math.min(15, Math.max(1, printable.height - inset * 2)),
            fontSize: 3,
            text: '',
            textMode: 'multiline',
            wrapMode: 'word',
            horizontalAlign: 'left',
            verticalAlign: 'top',
        };
    return normalizeDrawingPaperEntity({
        ...defaults,
        ...source,
        id: typeof source.id === 'string' && source.id ? source.id : createDrawingId(`paper-${normalizedType}`),
        type: normalizedType,
    }, paper);
}

export function addDrawingPaperAnnotation(layout, annotation) {
    const paper = getDrawingPaperSize(layout);
    return {
        ...layout,
        paperEntities: normalizeDrawingPaperEntities([
            ...(Array.isArray(layout?.paperEntities) ? layout.paperEntities : []),
            annotation,
        ], paper),
    };
}

export function updateDrawingPaperAnnotation(layout, annotationId, updater) {
    if (!annotationId || !Array.isArray(layout?.paperEntities)) return layout;
    const paper = getDrawingPaperSize(layout);
    let changed = false;
    const paperEntities = layout.paperEntities.map(annotation => {
        if (annotation.id !== annotationId) return annotation;
        const updated = typeof updater === 'function'
            ? updater(annotation)
            : { ...annotation, ...updater };
        if (!updated || typeof updated !== 'object') return annotation;
        changed = true;
        return normalizeDrawingPaperEntity({ ...updated, id: annotation.id }, paper) || annotation;
    });
    return changed ? { ...layout, paperEntities } : layout;
}

export function translateDrawingPaperAnnotation(layout, annotationId, dx, dy) {
    const paper = getDrawingPaperSize(layout);
    return updateDrawingPaperAnnotation(layout, annotationId, annotation => {
        const delta = constrainPaperAnnotationTranslation(
            annotation,
            finiteOr(dx, 0),
            finiteOr(dy, 0),
            paper,
        );
        if (annotation.type === 'line') return {
            ...annotation,
            x1: annotation.x1 + delta.x,
            y1: annotation.y1 + delta.y,
            x2: annotation.x2 + delta.x,
            y2: annotation.y2 + delta.y,
        };
        return { ...annotation, x: annotation.x + delta.x, y: annotation.y + delta.y };
    });
}

export function editDrawingPaperAnnotationGrip(layout, annotationId, gripId, point) {
    const paper = getDrawingPaperSize(layout);
    const boundedPoint = {
        x: clamp(finiteOr(point?.x, 0), 0, paper.width),
        y: clamp(finiteOr(point?.y, 0), 0, paper.height),
    };
    return updateDrawingPaperAnnotation(layout, annotationId, annotation => (
        editEntityGrip(annotation, gripId, boundedPoint)
    ));
}

export function removeDrawingPaperAnnotation(layout, annotationId) {
    if (!annotationId || !Array.isArray(layout?.paperEntities)) return layout;
    const paperEntities = layout.paperEntities.filter(annotation => annotation.id !== annotationId);
    return paperEntities.length === layout.paperEntities.length ? layout : { ...layout, paperEntities };
}

export function normalizeDrawingPaperEntities(entities, layoutOrPaper) {
    if (!Array.isArray(entities)) return [];
    const paper = resolveDrawingPaperSize(layoutOrPaper);
    const ids = new Set();
    return entities.flatMap(entity => {
        if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return [];
        let normalized = normalizeDrawingPaperEntity(entity, paper);
        if (!normalized) return [];
        if (ids.has(normalized.id)) normalized = {
            ...normalized,
            id: createDrawingId(`paper-${normalized.type || 'entity'}`),
        };
        ids.add(normalized.id);
        return [normalized];
    });
}

export function normalizeDrawingPaperEntity(entity, layoutOrPaper) {
    const source = entity && typeof entity === 'object' && !Array.isArray(entity) ? entity : {};
    const paper = resolveDrawingPaperSize(layoutOrPaper);
    const id = typeof source.id === 'string' && source.id
        ? source.id
        : createDrawingId(`paper-${source.type || 'entity'}`);
    if (source.type === 'text') {
        const x = clamp(finiteOr(source.x, 0), 0, Math.max(0, paper.width - 1));
        const y = clamp(finiteOr(source.y, 0), 0, Math.max(0, paper.height - 1));
        const normalized = normalizeDrawingTextEntity({
            ...source,
            id,
            x,
            y,
            width: clamp(Math.abs(finiteOr(source.width, 80)), 1, Math.max(1, paper.width - x)),
            height: clamp(Math.abs(finiteOr(source.height, 15)), 1, Math.max(1, paper.height - y)),
            fontSize: clamp(Math.abs(finiteOr(source.fontSize, 3)), 0.5, 50),
        });
        return normalizeDrawingPaperAppearance(normalized);
    }
    if (source.type === 'line') {
        return normalizeDrawingPaperAppearance({
            ...cloneSerializable(source),
            id,
            type: 'line',
            x1: clamp(finiteOr(source.x1, 0), 0, paper.width),
            y1: clamp(finiteOr(source.y1, 0), 0, paper.height),
            x2: clamp(finiteOr(source.x2, Math.min(60, paper.width)), 0, paper.width),
            y2: clamp(finiteOr(source.y2, 0), 0, paper.height),
        });
    }
    if (source.type === 'rectangle') {
        const x = clamp(finiteOr(source.x, 0), 0, Math.max(0, paper.width - 1));
        const y = clamp(finiteOr(source.y, 0), 0, Math.max(0, paper.height - 1));
        return normalizeDrawingPaperAppearance({
            ...cloneSerializable(source),
            id,
            type: 'rectangle',
            x,
            y,
            width: clamp(Math.abs(finiteOr(source.width, 80)), 1, Math.max(1, paper.width - x)),
            height: clamp(Math.abs(finiteOr(source.height, 40)), 1, Math.max(1, paper.height - y)),
            rotation: normalizeDegrees(source.rotation),
            cornerStyle: ['square', 'fillet', 'chamfer'].includes(source.cornerStyle)
                ? source.cornerStyle
                : 'square',
            cornerValue: Math.max(0, finiteOr(source.cornerValue ?? source.cornerSize, 0)),
        });
    }
    return null;
}

export function createDrawingViewport({
    id,
    name = '',
    rect,
    modelViewBox,
    hiddenLayerIds = [],
    locked = false,
    viewRotation = 0,
    clipBoundary = null,
    visualSettings = DEFAULT_VIEWPORT_VISUAL_SETTINGS,
    annotationSettings = DEFAULT_VIEWPORT_ANNOTATION_SETTINGS,
    layerOverrides = [],
} = {}) {
    const normalizedRect = normalizePaperRect(rect);
    return {
        id: typeof id === 'string' && id ? id : createDrawingId('viewport'),
        name: String(name || '').trim(),
        hiddenLayerIds: normalizeHiddenLayerIds(hiddenLayerIds),
        locked: Boolean(locked),
        viewRotation: normalizeDegrees(viewRotation),
        clipBoundary: normalizeViewportClipBoundary(clipBoundary),
        visualSettings: normalizeViewportVisualSettings(visualSettings),
        annotationSettings: normalizeViewportAnnotationSettings(annotationSettings),
        layerOverrides: normalizeViewportLayerOverrides(layerOverrides),
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

export function getDrawingPaperSize(formatOrLayout, orientation = 'landscape', customPaperSize = DEFAULT_CUSTOM_PAPER_SIZE) {
    const source = formatOrLayout && typeof formatOrLayout === 'object' ? formatOrLayout : null;
    const format = normalizePaperFormat(source?.format ?? formatOrLayout);
    const normalizedOrientation = normalizePaperOrientation(source?.orientation ?? orientation);
    const custom = normalizeCustomPaperSize(source?.customPaperSize ?? customPaperSize);
    const dimensions = format === DRAWING_CUSTOM_PAPER_FORMAT ? custom : DRAWING_PAPER_FORMATS[format];
    return normalizedOrientation === 'portrait'
        ? { width: Math.min(dimensions.width, dimensions.height), height: Math.max(dimensions.width, dimensions.height) }
        : { width: Math.max(dimensions.width, dimensions.height), height: Math.min(dimensions.width, dimensions.height) };
}

export function getDrawingPrintableArea(layoutOrPageSetup) {
    const paper = getDrawingPaperSize(layoutOrPageSetup);
    const margins = normalizeDrawingPaperMargins(layoutOrPageSetup?.margins, paper);
    return {
        x: margins.left,
        y: margins.top,
        width: paper.width - margins.left - margins.right,
        height: paper.height - margins.top - margins.bottom,
    };
}

export function getDrawingLayoutDimensionTextSize(_paper, viewport = null) {
    return normalizeViewportAnnotationSettings(viewport?.annotationSettings).dimensionTextSizeMm;
}

export function changeDrawingLayoutFormat(layout, format) {
    const nextFormat = normalizePaperFormat(format);
    if (nextFormat === layout.format) return layout;
    return resizeDrawingLayoutPaper(layout, {
        format: nextFormat,
        orientation: layout.orientation,
        customPaperSize: layout.customPaperSize,
        margins: layout.margins,
        pageSetupId: null,
    });
}

export function changeDrawingLayoutOrientation(layout, orientation) {
    const nextOrientation = normalizePaperOrientation(orientation);
    if (nextOrientation === layout.orientation) return layout;
    return resizeDrawingLayoutPaper(layout, {
        format: layout.format,
        orientation: nextOrientation,
        customPaperSize: layout.customPaperSize,
        margins: layout.margins,
        pageSetupId: null,
    });
}

export function changeDrawingLayoutCustomPaperSize(layout, customPaperSize) {
    const nextCustomPaperSize = normalizeCustomPaperSize(customPaperSize);
    if (layout.format === DRAWING_CUSTOM_PAPER_FORMAT
        && pageSizesEqual(layout.customPaperSize, nextCustomPaperSize)) return layout;
    return resizeDrawingLayoutPaper(layout, {
        format: DRAWING_CUSTOM_PAPER_FORMAT,
        orientation: layout.orientation,
        customPaperSize: nextCustomPaperSize,
        margins: layout.margins,
        pageSetupId: null,
    });
}

export function changeDrawingLayoutMargins(layout, margins) {
    const normalizedMargins = normalizeDrawingPaperMargins(margins, getDrawingPaperSize(layout));
    if (paperMarginsEqual(layout.margins, normalizedMargins)) return layout;
    return resizeDrawingLayoutPaper(layout, {
        format: layout.format,
        orientation: layout.orientation,
        customPaperSize: layout.customPaperSize,
        margins: normalizedMargins,
        pageSetupId: null,
    });
}

function resizeDrawingLayoutPaper(layout, {
    format,
    orientation,
    customPaperSize,
    margins,
    plotSettings = layout.plotSettings,
    pageSetupId,
}) {
    const previousPrintable = getDrawingPrintableArea(layout);
    const nextPaper = getDrawingPaperSize(format, orientation, customPaperSize);
    const nextMargins = normalizeDrawingPaperMargins(margins, nextPaper);
    const nextPrintable = getDrawingPrintableArea({
        format,
        orientation,
        customPaperSize,
        margins: nextMargins,
    });
    const scaleX = nextPrintable.width / previousPrintable.width;
    const scaleY = nextPrintable.height / previousPrintable.height;
    return {
        ...layout,
        format,
        orientation,
        customPaperSize: normalizeCustomPaperSize(customPaperSize),
        margins: nextMargins,
        plotSettings: normalizeDrawingPlotSettings(plotSettings),
        pageSetupId: typeof pageSetupId === 'string' && pageSetupId ? pageSetupId : null,
        viewports: layout.viewports.map(viewport => resizeDrawingViewportKeepingScale(viewport, {
            x: nextPrintable.x + (viewport.x - previousPrintable.x) * scaleX,
            y: nextPrintable.y + (viewport.y - previousPrintable.y) * scaleY,
            width: viewport.width * scaleX,
            height: viewport.height * scaleY,
        }, nextPaper)),
        paperEntities: normalizeDrawingPaperEntities(layout.paperEntities, nextPaper),
    };
}

export function updateDrawingLayout(layouts, layoutId, updater) {
    return layouts.map(layout => layout.id === layoutId
        ? (typeof updater === 'function' ? updater(layout) : { ...layout, ...updater })
        : layout);
}

export function updateDrawingViewport(layout, viewportId, updater) {
    const paper = getDrawingPaperSize(layout);
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
    const paper = getDrawingPaperSize(layout);
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
    const paper = getDrawingPaperSize(layout);
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
        locked: Boolean(viewport.locked),
        viewRotation: normalizeDegrees(viewport.viewRotation),
        clipBoundary: normalizeViewportClipBoundary(viewport.clipBoundary),
        visualSettings: normalizeViewportVisualSettings(viewport.visualSettings),
        annotationSettings: normalizeViewportAnnotationSettings(viewport.annotationSettings),
        layerOverrides: normalizeViewportLayerOverrides(viewport.layerOverrides),
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
    if (viewport?.locked) return viewport;
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

export function setDrawingViewportRotation(viewport, rotation) {
    return viewport?.locked ? viewport : { ...viewport, viewRotation: normalizeDegrees(rotation) };
}

export function createDrawingViewportClipPreset(preset) {
    if (preset === 'triangle') {
        return { type: 'polygon', points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
    }
    if (preset === 'hexagon') {
        return {
            type: 'polygon',
            points: [
                { x: 0.25, y: 0 }, { x: 0.75, y: 0 }, { x: 1, y: 0.5 },
                { x: 0.75, y: 1 }, { x: 0.25, y: 1 }, { x: 0, y: 0.5 },
            ],
        };
    }
    return null;
}

export function viewportClipBoundaryFromPaperPoints(viewport, points) {
    if (!viewport || !Array.isArray(points)) return null;
    return normalizeViewportClipBoundary({
        type: 'polygon',
        points: points.map(point => ({
            x: (Number(point.x) - viewport.x) / viewport.width,
            y: (Number(point.y) - viewport.y) / viewport.height,
        })),
    });
}

export function getDrawingViewportClipPoints(viewport) {
    const boundary = normalizeViewportClipBoundary(viewport?.clipBoundary);
    if (!boundary) return [
        { x: viewport.x, y: viewport.y },
        { x: viewport.x + viewport.width, y: viewport.y },
        { x: viewport.x + viewport.width, y: viewport.y + viewport.height },
        { x: viewport.x, y: viewport.y + viewport.height },
    ];
    return boundary.points.map(point => ({
        x: viewport.x + point.x * viewport.width,
        y: viewport.y + point.y * viewport.height,
    }));
}

export function setDrawingViewportClipPoint(viewport, index, paperPoint) {
    const boundary = normalizeViewportClipBoundary(viewport?.clipBoundary);
    if (!boundary || !boundary.points[index]) return viewport;
    const points = boundary.points.map((point, pointIndex) => pointIndex === index ? {
        x: clamp((Number(paperPoint?.x) - viewport.x) / viewport.width, 0, 1),
        y: clamp((Number(paperPoint?.y) - viewport.y) / viewport.height, 0, 1),
    } : point);
    const clipBoundary = normalizeViewportClipBoundary({ type: 'polygon', points });
    return clipBoundary ? { ...viewport, clipBoundary } : viewport;
}

export function setDrawingViewportLayerOverride(viewport, layerId, patch) {
    const overrides = normalizeViewportLayerOverrides(viewport?.layerOverrides);
    const current = overrides.find(override => override.layerId === layerId) || { layerId };
    const next = normalizeViewportLayerOverrides([
        ...overrides.filter(override => override.layerId !== layerId),
        { ...current, ...patch, layerId },
    ]);
    return { ...viewport, layerOverrides: next };
}

export function clearDrawingViewportLayerOverride(viewport, layerId) {
    return {
        ...viewport,
        layerOverrides: normalizeViewportLayerOverrides(viewport?.layerOverrides)
            .filter(override => override.layerId !== layerId),
    };
}

export function applyDrawingViewportDisplaySettings(content, viewport) {
    const overrides = new Map(normalizeViewportLayerOverrides(viewport?.layerOverrides)
        .map(override => [override.layerId, override]));
    const annotationSettings = normalizeViewportAnnotationSettings(viewport?.annotationSettings);
    return {
        ...content,
        layers: content.layers.map(layer => {
            const override = overrides.get(layer.id);
            if (!override) return layer;
            const { layerId: _layerId, ...appearance } = override;
            return { ...layer, ...appearance };
        }),
        entities: content.entities.filter(entity => {
            if (!annotationSettings.showText && entity.type === 'text') return false;
            if (!annotationSettings.showDimensions && isDrawingDimensionEntity(entity)) return false;
            return true;
        }),
    };
}

export function paperPointToViewportModelPoint(viewport, paperPoint) {
    const viewBox = normalizeModelViewBox(viewport?.modelViewBox);
    const paperX = Number(paperPoint?.x);
    const paperY = Number(paperPoint?.y);
    if (!Number.isFinite(paperX) || !Number.isFinite(paperY)) return null;
    const viewPoint = {
        x: viewBox.x + (paperX - viewport.x) / viewport.width * viewBox.width,
        y: viewBox.y + (paperY - viewport.y) / viewport.height * viewBox.height,
    };
    return rotatePoint(viewPoint, viewBoxCenter(viewBox), -normalizeDegrees(viewport.viewRotation));
}

export function viewportModelPointToPaperPoint(viewport, modelPoint) {
    const viewBox = normalizeModelViewBox(viewport?.modelViewBox);
    const modelX = Number(modelPoint?.x);
    const modelY = Number(modelPoint?.y);
    if (!Number.isFinite(modelX) || !Number.isFinite(modelY)) return null;
    const viewPoint = rotatePoint({ x: modelX, y: modelY }, viewBoxCenter(viewBox), normalizeDegrees(viewport.viewRotation));
    return {
        x: viewport.x + (viewPoint.x - viewBox.x) / viewBox.width * viewport.width,
        y: viewport.y + (viewPoint.y - viewBox.y) / viewBox.height * viewport.height,
    };
}

export function normalizeDrawingPaperMargins(margins, paper) {
    const width = Math.max(MIN_PAPER_SIZE_MM, Number(paper?.width) || DRAWING_PAPER_FORMATS.A0.width);
    const height = Math.max(MIN_PAPER_SIZE_MM, Number(paper?.height) || DRAWING_PAPER_FORMATS.A0.height);
    const horizontal = constrainMarginPair(margins?.left, margins?.right, width);
    const vertical = constrainMarginPair(margins?.top, margins?.bottom, height);
    return {
        top: vertical.first,
        right: horizontal.second,
        bottom: vertical.second,
        left: horizontal.first,
    };
}

export function normalizeViewportClipBoundary(boundary) {
    if (!boundary || boundary.type !== 'polygon' || !Array.isArray(boundary.points)) return null;
    const points = boundary.points.flatMap(point => {
        const x = Number(point?.x);
        const y = Number(point?.y);
        return Number.isFinite(x) && Number.isFinite(y) ? [{ x: clamp(x, 0, 1), y: clamp(y, 0, 1) }] : [];
    }).filter((point, index, values) => index === 0 || !pointsEqual(point, values[index - 1]));
    if (points.length > 1 && pointsEqual(points[0], points.at(-1))) points.pop();
    if (points.length < 3 || Math.abs(polygonArea(points)) < POLYGON_AREA_EPSILON) return null;
    return { type: 'polygon', points };
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

export function normalizePaperFormat(value) {
    const format = String(value || '').trim().toUpperCase();
    return DRAWING_PAPER_FORMAT_OPTIONS.includes(format) ? format : 'A0';
}

export function normalizePaperOrientation(value) {
    const orientation = String(value || '').trim().toLowerCase();
    return DRAWING_ORIENTATION_OPTIONS.includes(orientation) ? orientation : 'landscape';
}

function normalizeCustomPaperSize(value) {
    const rawWidth = Number(value?.width);
    const rawHeight = Number(value?.height);
    const width = Number.isFinite(rawWidth)
        ? clamp(Math.abs(rawWidth), MIN_PAPER_SIZE_MM, MAX_PAPER_SIZE_MM)
        : DEFAULT_CUSTOM_PAPER_SIZE.width;
    const height = Number.isFinite(rawHeight)
        ? clamp(Math.abs(rawHeight), MIN_PAPER_SIZE_MM, MAX_PAPER_SIZE_MM)
        : DEFAULT_CUSTOM_PAPER_SIZE.height;
    return { width: Math.max(width, height), height: Math.min(width, height) };
}

function normalizeHiddenLayerIds(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(layerId => typeof layerId === 'string' && layerId))];
}

function normalizeViewportVisualSettings(value) {
    return {
        style: DRAWING_VIEWPORT_VISUAL_STYLE_OPTIONS.includes(value?.style) ? value.style : 'normal',
        showLineweights: value?.showLineweights !== false,
    };
}

function normalizeViewportAnnotationSettings(value) {
    const dimensionTextSizeMm = Number(value?.dimensionTextSizeMm);
    return {
        showText: value?.showText !== false,
        showDimensions: value?.showDimensions !== false,
        dimensionTextSizeMm: Number.isFinite(dimensionTextSizeMm)
            ? clamp(dimensionTextSizeMm, 0.5, 50)
            : DEFAULT_VIEWPORT_ANNOTATION_SETTINGS.dimensionTextSizeMm,
    };
}

function normalizeViewportLayerOverrides(value) {
    if (!Array.isArray(value)) return [];
    const overrides = new Map();
    value.forEach(override => {
        const layerId = typeof override?.layerId === 'string' ? override.layerId : '';
        if (!layerId) return;
        const color = normalizeDrawingColor(override.color);
        const lineType = normalizeDrawingLineType(override.lineType);
        const lineWeight = normalizeDrawingLineWeight(override.lineWeight);
        const normalized = {
            layerId,
            ...(color ? { color } : {}),
            ...(lineType ? { lineType } : {}),
            ...(lineWeight ? { lineWeight } : {}),
        };
        if (Object.keys(normalized).length > 1) overrides.set(layerId, normalized);
        else overrides.delete(layerId);
    });
    return [...overrides.values()];
}

function normalizeDrawingPaperAppearance(entity) {
    const normalized = { ...entity };
    normalized.layerId = typeof entity.layerId === 'string' && entity.layerId ? entity.layerId : 'geometry';
    const color = normalizeDrawingColor(entity.color);
    const lineType = normalizeDrawingLineType(entity.lineType);
    const lineWeight = normalizeDrawingLineWeight(entity.lineWeight);
    const transparency = normalizeDrawingTransparency(entity.transparency);
    if (color) normalized.color = color;
    else delete normalized.color;
    if (lineType) normalized.lineType = lineType;
    else delete normalized.lineType;
    if (lineWeight) normalized.lineWeight = lineWeight;
    else delete normalized.lineWeight;
    if (transparency !== null) normalized.transparency = transparency;
    else delete normalized.transparency;
    return normalized;
}

function resolveDrawingPaperSize(layoutOrPaper) {
    const width = Number(layoutOrPaper?.width);
    const height = Number(layoutOrPaper?.height);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return {
            width: clamp(width, MIN_PAPER_SIZE_MM, MAX_PAPER_SIZE_MM),
            height: clamp(height, MIN_PAPER_SIZE_MM, MAX_PAPER_SIZE_MM),
        };
    }
    return getDrawingPaperSize(layoutOrPaper);
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

function constrainMarginPair(firstValue, secondValue, paperSize) {
    let first = clamp(Number(firstValue) || 0, 0, Math.max(0, paperSize - MIN_PRINTABLE_SIZE_MM));
    let second = clamp(Number(secondValue) || 0, 0, Math.max(0, paperSize - MIN_PRINTABLE_SIZE_MM));
    const maximumTotal = Math.max(0, paperSize - MIN_PRINTABLE_SIZE_MM);
    if (first + second > maximumTotal) {
        const ratio = maximumTotal / (first + second);
        first *= ratio;
        second *= ratio;
    }
    return { first, second };
}

function pageSetupsEqual(left, right) {
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) === 0
        && left.format === right.format
        && left.orientation === right.orientation
        && pageSizesEqual(left.customPaperSize, right.customPaperSize)
        && paperMarginsEqual(left.margins, right.margins)
        && plotSettingsEqual(left.plotSettings, right.plotSettings);
}

function plotSettingsEqual(left, right) {
    return JSON.stringify(normalizeDrawingPlotSettings(left))
        === JSON.stringify(normalizeDrawingPlotSettings(right));
}

function pageSizesEqual(left, right) {
    return left?.width === right?.width && left?.height === right?.height;
}

function paperMarginsEqual(left, right) {
    return ['top', 'right', 'bottom', 'left'].every(side => Number(left?.[side]) === Number(right?.[side]));
}

function getUniqueDrawingName(name, existingNames) {
    const used = new Set(existingNames.map(value => String(value || '').trim().toLocaleLowerCase()));
    if (!used.has(name.toLocaleLowerCase())) return name;
    const suffixMatch = /^(.*?)(?:\s+(\d+))$/.exec(name);
    const baseName = suffixMatch ? suffixMatch[1].trim() : name;
    let suffix = suffixMatch ? Math.max(2, Number(suffixMatch[2]) + 1) : 2;
    while (used.has(`${baseName} ${suffix}`.toLocaleLowerCase())) suffix += 1;
    return `${baseName} ${suffix}`;
}

function constrainPaperAnnotationTranslation(annotation, dx, dy, paper) {
    if (annotation.type === 'line') {
        const minX = Math.min(annotation.x1, annotation.x2);
        const maxX = Math.max(annotation.x1, annotation.x2);
        const minY = Math.min(annotation.y1, annotation.y2);
        const maxY = Math.max(annotation.y1, annotation.y2);
        return {
            x: clamp(dx, -minX, paper.width - maxX),
            y: clamp(dy, -minY, paper.height - maxY),
        };
    }
    const width = Math.abs(finiteOr(annotation.width, 1));
    const height = Math.abs(finiteOr(annotation.height, 1));
    return {
        x: clamp(dx, -annotation.x, paper.width - annotation.x - width),
        y: clamp(dy, -annotation.y, paper.height - annotation.y - height),
    };
}

function cloneSerializable(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function polygonArea(points) {
    return points.reduce((area, point, index) => {
        const next = points[(index + 1) % points.length];
        return area + point.x * next.y - next.x * point.y;
    }, 0) / 2;
}

function pointsEqual(left, right) {
    return Math.abs(left.x - right.x) < 1e-9 && Math.abs(left.y - right.y) < 1e-9;
}

function normalizeDegrees(value) {
    const degrees = Number(value);
    if (!Number.isFinite(degrees)) return 0;
    const normalized = degrees % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

function rotatePoint(point, center, degrees) {
    if (!degrees) return { ...point };
    const radians = degrees * Math.PI / 180;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
        x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
        y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
    };
}

function viewBoxCenter(viewBox) {
    return { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
