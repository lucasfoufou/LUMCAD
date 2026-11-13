import { currentAnnotationScale } from './drawingAnnotations.js';
import { getDimensionGeometry, getDrawingEntityDependencyIds } from './drawingDimensions.js';
import { applyDimensionStyle, DEFAULT_DIMENSION_STYLE_ID, findDimensionStyle } from './drawingDimensionStyles.js';
import { getEntityBounds } from './drawingGeometry.js';
import { isDimensionableDrawingEntity } from './drawingInteraction.js';
import { editEntityGrip } from './drawingSelection.js';
import { parseDecimalDraft } from './drawingFormValues.js';

/** Default distance between the measured object and the dimension line, on paper. */
export const DEFAULT_DIMENSION_LINE_OFFSET_MM = 6;
const PLACED_TYPES = new Set(['linearDimension', 'radialDimension', 'arcLengthDimension', 'angularDimension']);

/** Converts paper millimetres to drawing metres at the plan (annotation) scale. */
export function paperMillimetresToModel(content, millimetres) {
    return millimetres * currentAnnotationScale(content) / 1000;
}

export function modelToPaperMillimetres(content, metres) {
    return metres * 1000 / currentAnnotationScale(content);
}

export function defaultDimensionLineOffset(content) {
    return paperMillimetresToModel(content, DEFAULT_DIMENSION_LINE_OFFSET_MM);
}

/**
 * Clicking a dimensionable object dimensions it; the two-point mode is used
 * off objects or when the user explicitly chose it.
 */
export function resolveDimensionPickTarget(targetEntity, pickMode = 'object') {
    return pickMode !== 'points' && isDimensionableDrawingEntity(targetEntity) ? targetEntity : null;
}

export function dimensionNeedsPlacement(dimension) {
    return Boolean(dimension && PLACED_TYPES.has(dimension.type));
}

/** Moves the dimension line (or leader/arc) through `point`, like its position grip. */
export function placeDimensionAtPoint(dimension, point, sources) {
    if (!dimension || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return dimension;
    const placed = editEntityGrip(dimension, 'dimension-position', point, sources);
    return getDimensionGeometry(placed, sources) ? placed : dimension;
}

/**
 * Gives a new linear or arc-length dimension the default offset at the plan
 * scale, on the side away from the contour the measured points belong to.
 */
export function withDefaultDimensionPlacement(content, dimension, sources) {
    if (!dimension || !['linearDimension', 'arcLengthDimension'].includes(dimension.type)) return dimension;
    const distance = defaultDimensionLineOffset(content);
    if (dimension.type === 'arcLengthDimension') return { ...dimension, offset: distance };
    const { linePoint: ignored, ...base } = dimension;
    const positive = { ...base, offset: distance };
    const negative = { ...base, offset: -distance };
    const positiveGeometry = getDimensionGeometry(positive, sources);
    const negativeGeometry = getDimensionGeometry(negative, sources);
    if (!positiveGeometry || !negativeGeometry) return positiveGeometry ? positive : dimension;
    const reference = contourReferencePoint(content, dimension, positiveGeometry);
    if (!reference) return positive;
    const lineCenter = geometry => {
        const [first, second] = geometry.points;
        return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    };
    const distanceTo = point => Math.hypot(point.x - reference.x, point.y - reference.y);
    return distanceTo(lineCenter(negativeGeometry)) > distanceTo(lineCenter(positiveGeometry)) + 1e-9 ? negative : positive;
}

/** Offset typed during placement: on the side of the cursor when known. */
export function dimensionWithTypedOffset(dimension, distance, sources, cursor = null) {
    if (!dimension || !Number.isFinite(distance) || distance <= 0) return null;
    if (dimension.type === 'arcLengthDimension') return { ...dimension, offset: distance };
    if (dimension.type !== 'linearDimension') return null;
    const { linePoint: ignored, ...base } = dimension;
    const current = Number(dimension.offset) || 0;
    let sign = current < 0 ? -1 : 1;
    if (cursor) {
        const placed = placeDimensionAtPoint(base, cursor, sources);
        if (Number.isFinite(placed.offset) && Math.abs(placed.offset) > 1e-9) sign = Math.sign(placed.offset);
    }
    const candidate = { ...base, offset: sign * distance };
    return getDimensionGeometry(candidate, sources) ? candidate : null;
}

/**
 * Command-line input while the dimension tool waits: Enter accepts the
 * default position, a number is a dimension-line distance, POINTS/OBJECT
 * choose the two-point or object mode.
 */
export function parseDimensionToolInput(rawValue) {
    const value = String(rawValue ?? '').trim();
    if (!value) return { kind: 'accept' };
    const upper = value.toUpperCase();
    // Single letters are command aliases (P = PAN, O = OFFSET): options use words.
    if (['POINTS', '2P'].includes(upper)) return { kind: 'pickMode', mode: 'points' };
    if (['OBJECT', 'OBJET'].includes(upper)) return { kind: 'pickMode', mode: 'object' };
    const parsed = parseDecimalDraft(value);
    if (parsed.kind === 'complete') return { kind: 'offset', value: Math.abs(parsed.value) };
    return null;
}

/** The dimension draft shown while placing, styled like the committed result. */
export function styledDimensionDraft(content, dimension) {
    if (!dimension) return null;
    const style = findDimensionStyle(content, content.activeDimensionStyleId) || findDimensionStyle(content, DEFAULT_DIMENSION_STYLE_ID);
    return style ? applyDimensionStyle(dimension, style) : dimension;
}

function contourReferencePoint(content, dimension, geometry) {
    const ids = getDrawingEntityDependencyIds(dimension);
    const entityMap = new Map(content.entities.map(entity => [entity.id, entity]));
    const source = ids.length === 1 ? entityMap.get(ids[0]) : null;
    if (source && ['rectangle', 'polygon', 'ellipse', 'circle'].includes(source.type)) return boundsCenter(getEntityBounds(source, entityMap));
    // Open linework: use the contour formed by the objects touching the measured points.
    const [, , sourceFirst, sourceSecond] = geometry.points;
    const tolerance = Math.max(1e-6, Math.hypot(sourceSecond.x - sourceFirst.x, sourceSecond.y - sourceFirst.y) * 1e-6);
    let combined = null;
    for (const entity of content.entities) {
        if (!isDimensionableDrawingEntity(entity) && entity.type !== 'polyline') continue;
        const bounds = getEntityBounds(entity, entityMap);
        if (!bounds || (!touches(bounds, sourceFirst, tolerance) && !touches(bounds, sourceSecond, tolerance))) continue;
        combined = combined ? {
            minX: Math.min(combined.minX, bounds.minX), minY: Math.min(combined.minY, bounds.minY),
            maxX: Math.max(combined.maxX, bounds.maxX), maxY: Math.max(combined.maxY, bounds.maxY),
        } : bounds;
    }
    const center = boundsCenter(combined);
    if (!center) return null;
    // A lone straight object has no inside: keep the conventional side.
    const span = Math.hypot(sourceSecond.x - sourceFirst.x, sourceSecond.y - sourceFirst.y);
    const cross = (sourceSecond.x - sourceFirst.x) * (center.y - sourceFirst.y) - (sourceSecond.y - sourceFirst.y) * (center.x - sourceFirst.x);
    return Math.abs(cross) / Math.max(span, 1e-12) > span * 1e-3 ? center : null;
}

function touches(bounds, point, tolerance) {
    return point.x >= bounds.minX - tolerance && point.x <= bounds.maxX + tolerance
        && point.y >= bounds.minY - tolerance && point.y <= bounds.maxY + tolerance;
}

function boundsCenter(bounds) {
    return bounds && Number.isFinite(bounds.minX)
        ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
        : null;
}

/** Places the linear dimensions a command just created at the default plan-scale position. */
export function withDefaultCommandPlacements(result) {
    if (!result?.changed) return result;
    const created = new Set(result.entities.map(entity => entity.id));
    const sourceMap = new Map(result.content.entities.map(entity => [entity.id, entity]));
    const replacements = new Map(result.entities
        .filter(entity => ['linearDimension', 'arcLengthDimension'].includes(entity.type) && !entity.seriesId && !entity.linePoint)
        .map(entity => [entity.id, withDefaultDimensionPlacement(result.content, entity, sourceMap)]));
    if (!replacements.size) return result;
    const replace = entity => (created.has(entity.id) && replacements.get(entity.id)) || entity;
    return { ...result, content: { ...result.content, entities: result.content.entities.map(replace) }, entities: result.entities.map(replace) };
}

/** Each dimension command announces what it expects instead of the generic DIMENSION prompt. */
export function dimensionToolPromptKey(mode) {
    const value = typeof mode === 'object' && mode ? String(mode.mode || 'auto') : String(mode || 'auto');
    if (['horizontal', 'vertical', 'aligned', 'rotated', 'linear'].includes(value)) return 'messages.linearDimensionPrompt';
    if (['radius', 'diameter', 'joggedRadius'].includes(value)) return 'messages.radialDimensionPrompt';
    if (value === 'arcLength') return 'messages.arcDimensionPrompt';
    if (value === 'angular') return 'messages.angularDimensionPrompt';
    if (value === 'ordinate') return 'messages.ordinateDimensionPrompt';
    if (value === 'centerMark') return 'messages.centerMarkPrompt';
    return 'messages.dimensionPrompt';
}
