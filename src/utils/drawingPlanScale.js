import {
    currentAnnotationScale,
    normalizeAnnotationScales,
    normalizeDrawingAnnotation,
    scaleDrawingAnnotationGeometry,
    validAnnotationRatio,
    validAnnotationScale,
} from './drawingAnnotations.js';
import { isDrawingDimensionEntity } from './drawingDimensions.js';
import { normalizeDimensionStyles } from './drawingDimensionStyles.js';

/** Plan scales offered first in the status bar; any valid denominator can be typed. */
export const DRAWING_PLAN_SCALE_PRESETS = Object.freeze([1, 5, 10, 20, 25, 50, 100, 200, 500, 1000]);
const STYLE_SIZES = ['textSize', 'arrowSize', 'extensionGap', 'extensionOverrun'];
const MAX_OBJECT_SCALES = 64;

/** Parses "50", "1:50" or "1/50" as a plan-scale denominator. */
export function parseDrawingPlanScale(value) {
    const raw = String(value ?? '').trim().replace(',', '.');
    const match = /^(?:1\s*[:/]\s*)?(\d+(?:\.\d+)?|\.\d+)$/.exec(raw);
    const scale = match ? Number(match[1]) : NaN;
    return validAnnotationScale(scale) ? scale : null;
}

/** Non-annotative dimensions and texts whose size was set for the current scale. */
export function countDrawingPlanScaleAnnotations(content) {
    let dimensions = 0;
    let texts = 0;
    for (const entity of content?.entities || []) {
        if (entity.annotation) continue;
        if (isDrawingDimensionEntity(entity) && !['centerMark', 'centerLine'].includes(entity.type)) dimensions++;
        else if (entity.type === 'text') texts++;
    }
    return { dimensions, texts };
}

/**
 * Changes the plan scale in one document revision. Dimension styles keep their
 * paper size; annotative objects gain the new scale; existing dimensions and
 * texts are resized only when `rescaleExisting` is requested.
 */
export function changeDrawingPlanScale(content, scale, { rescaleExisting = false } = {}) {
    if (!validAnnotationScale(scale)) return content;
    const previous = currentAnnotationScale(content);
    const factor = scale / previous;
    const catalog = normalizeAnnotationScales([...(content.annotationScales || normalizeAnnotationScales()), scale]);
    const next = {
        ...content,
        settings: { ...content.settings, annotationScale: scale },
        annotationScales: catalog,
    };
    if (factor === 1) return next;
    next.dimensionStyles = normalizeDimensionStyles(content.dimensionStyles).map(style => ({
        ...style,
        ...Object.fromEntries(STYLE_SIZES.map(key => [key, style[key] * factor])),
    }));
    next.entities = content.entities.map(entity => {
        const annotation = normalizeDrawingAnnotation(entity.annotation);
        if (annotation) return withAnnotationScale(entity, annotation, scale);
        if (!rescaleExisting) return entity;
        if (isDrawingDimensionEntity(entity) && !['centerMark', 'centerLine'].includes(entity.type)) {
            return scaleDrawingAnnotationGeometry(entity, factor, content.textStyles);
        }
        if (entity.type === 'text') return scaleDrawingAnnotationGeometry(entity, factor, content.textStyles);
        return entity;
    });
    return next;
}

/** ANNOAUTOSCALE: an annotative object stays visible at the new current scale. */
function withAnnotationScale(entity, annotation, scale) {
    if (annotation.scales.some(item => Math.abs(item.scale - scale) <= 1e-8 * Math.max(item.scale, scale))) return entity;
    if (annotation.scales.length >= MAX_OBJECT_SCALES || !validAnnotationRatio(scale, annotation.baseScale)) return entity;
    return { ...entity, annotation: { ...annotation, scales: [...annotation.scales, { scale, offset: { x: 0, y: 0 } }] } };
}
