import { DRAWING_LEADER_PRESENTATION, drawingLeaderGeometry, drawingLeaderTextAnnotation } from './drawingLeaders.js';
import { drawingAffineFrame, framedDrawingPoint } from './drawingAffineFrame.js';
import { resolveDrawingTextStyle } from './drawingText.js';
import { createDimensionSourceMap } from './drawingDimensionSources.js';
import { isDrawingDimensionEntity, getDimensionGeometry } from './drawingDimensions.js';
import { transformDrawingEntityAffine, refreshDrawingBlockBounds } from './drawingBlocks.js';
import { translateEntity } from './drawingPrimitives.js';
import { drawingContentWithHiddenObjects, withoutDrawingObjectVisibility } from './drawingObjectVisibility.js';

const SOURCE = Symbol('annotationSource');
const CONTENT_SOURCE = Symbol('annotationContentSource');
const LEADER_BLOCKS = Symbol('annotationLeaderBlocks');
export const ANNOTATION_HIDDEN = Symbol('annotationHidden');
export const ANNOTATION_LIMIT = Symbol('annotationLimit');
export const validAnnotationRatio = (scale, base) => scale / base >= 1e-6 && scale / base <= 1e6;
export const DEFAULT_ANNOTATION_SCALES = Object.freeze([1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]);
const DIMENSION_SIZES = ['textSize', 'arrowSize', 'extensionGap', 'extensionOverrun'];
export const validAnnotationScale = value => typeof value === 'number' && Number.isFinite(value) && value >= 0.001 && value <= 1e6;
export const currentAnnotationScale = content => validAnnotationScale(content?.settings?.annotationScale) ? content.settings.annotationScale : 100;
export const supportsDrawingAnnotation = entity => ['text', 'hatch', 'blockReference'].includes(entity?.type) || isDrawingDimensionEntity(entity);
const sameScale = (a, b) => Math.abs(a - b) <= 1e-8 * Math.max(a, b);

export function normalizeAnnotationScales(value) {
    return [...new Set((Array.isArray(value) ? value : DEFAULT_ANNOTATION_SCALES).slice(0, 128).filter(validAnnotationScale))].sort((a, b) => a - b);
}

export function normalizeDrawingAnnotation(value) {
    if (!value || !validAnnotationScale(value.baseScale)) return null;
    const scales = [];
    for (const item of (Array.isArray(value.scales) ? value.scales : []).slice(0, 64)) {
        const scale = typeof item === 'number' ? item : item?.scale;
        if (!validAnnotationScale(scale) || !validAnnotationRatio(scale, value.baseScale) || scales.some(other => sameScale(other.scale, scale))) continue;
        const x = item?.offset?.x; const y = item?.offset?.y;
        scales.push({ scale, offset: { x: Number.isFinite(x) && Math.abs(x) <= 1e9 ? x : 0, y: Number.isFinite(y) && Math.abs(y) <= 1e9 ? y : 0 } });
    }
    return scales.length ? { baseScale: value.baseScale, scales } : null;
}

/** Scale annotation appearance; dimension witnesses and hatch contours stay at model coordinates. */
export function scaleDrawingAnnotationGeometry(entity, factor, textStyles = []) {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return entity;
    if (isDrawingDimensionEntity(entity)) {
        return { ...entity, ...Object.fromEntries(DIMENSION_SIZES.filter(key => Number.isFinite(entity[key])).map(key => [key, entity[key] * factor])),
            ...(entity.dimensionStyleOverrides ? { dimensionStyleOverrides: { ...entity.dimensionStyleOverrides,
                ...Object.fromEntries(DIMENSION_SIZES.filter(key => Number.isFinite(entity.dimensionStyleOverrides[key])).map(key => [key, entity.dimensionStyleOverrides[key] * factor])) } } : {}) };
    }
    if (entity.type === 'hatch') return { ...entity, pattern: { ...entity.pattern, spacing: (entity.pattern?.spacing || 0.25) * factor } };
    const anchor = entity.type === 'blockReference' ? { x: entity.transform.e, y: entity.transform.f }
        : framedDrawingPoint(entity, { x: entity.x, y: entity.y });
    const matrix = { a: factor, b: 0, c: 0, d: factor, e: anchor.x * (1 - factor), f: anchor.y * (1 - factor) };
    if (entity.type === 'text' && !drawingAffineFrame(entity)) {
        const sizes = [resolveDrawingTextStyle(entity, textStyles).fontSize, ...(entity.runs || []).flatMap(run => run.marks?.fontSize ? [run.marks.fontSize] : [])];
        if (sizes.some(size => size * factor < 0.01 || size * factor > 1e6)) return { ...entity, affineFrame: matrix };
    }
    return transformDrawingEntityAffine(entity, matrix, { textStyles });
}

/** A context is derived, never serialized. Symbols carry the inverse edit transform. */
export function resolveDrawingAnnotationContent(input, scale = currentAnnotationScale(input), { showAll = input.settings?.annotationShowAll === true } = {}) {
    const content = input[CONTENT_SOURCE] ? restoreDrawingAnnotationContent(input) : input;
    if (!validAnnotationScale(scale)) return content;
    let annotated = false;
    const sources = createDimensionSourceMap(content.entities, content.blocks, content);
    const definitions = new Map((content.blocks || []).map(block => [block.id, block]));
    const leaderDefinitions = new Map();
    let generatedEntities = 0;
    let limited = false;
    const resolve = entity => {
        const annotation = supportsDrawingAnnotation(entity) && normalizeDrawingAnnotation(entity.annotation);
        if (!annotation) return entity;
        annotated = true;
        const representation = annotation.scales.find(item => sameScale(item.scale, scale));
        const offset = representation?.offset || { x: 0, y: 0 };
        const factor = scale / annotation.baseScale;
        const record = { source: entity, factor, offset, textStyles: content.textStyles,
            labelAnchor: isDrawingDimensionEntity(entity) ? entity.dimensionTextPosition || getDimensionGeometry(entity, sources)?.label?.point : null };
        const unavailable = () => {
            limited = true;
            return { ...entity, [SOURCE]: { ...record, factor: 1, offset: { x: 0, y: 0 } }, [ANNOTATION_HIDDEN]: true };
        };
        if (!validAnnotationRatio(scale, annotation.baseScale)) return unavailable();
        let next;
        const leaderDefinition = entity.leader && definitions.get(entity.blockId);
        if (leaderDefinition) {
            let id = `${entity.blockId}::annotation:${factor}:${offset.x}:${offset.y}`;
            while (definitions.has(id)) id += ':';
            const positioned = offset.x || offset.y ? offsetAnnotation(entity, offset.x, offset.y) : entity;
            const leader = { ...positioned.leader, style: scaleLeaderStyle(entity.leader.style, factor) };
            const last = leaderDefinition.entities.at(-1);
            const tail = scaleLeaderContent(last, factor, content.textStyles);
            if (!leaderDefinitions.has(id)) {
                if (leaderDefinitions.size >= 1024 || generatedEntities + leaderDefinition.entities.length > 100000) return unavailable();
                const entities = drawingLeaderGeometry(leader, tail);
                generatedEntities += entities.length;
                leaderDefinitions.set(id, { ...leaderDefinition, id, entities });
            }
            record.leaderDefinition = leaderDefinition;
            record.derivedBlockId = id;
            next = { ...positioned, blockId: id, leader, [DRAWING_LEADER_PRESENTATION]: true };
        } else next = scaleDrawingAnnotationGeometry(entity, factor, content.textStyles);
        if (!leaderDefinition && (offset.x || offset.y)) next = offsetAnnotation(next, offset.x, offset.y, record.labelAnchor);
        next = { ...next, [SOURCE]: record, [ANNOTATION_HIDDEN]: !representation && !showAll };
        return next;
    };
    let result = { ...content, entities: content.entities.map(resolve), blocks: (content.blocks || []).map(block => ({ ...block, entities: block.entities.map(resolve) })) };
    if (!annotated) return content;
    result.blocks.push(...leaderDefinitions.values());
    result = refreshDrawingBlockBounds(result);
    for (const entity of [...result.entities, ...result.blocks.flatMap(block => block.entities)]) {
        if (entity[SOURCE]) {
            entity[SOURCE].rendered = entity;
            if (entity[SOURCE].derivedBlockId) entity[SOURCE].renderedDefinition = result.blocks.find(block => block.id === entity.blockId);
        }
    }
    result = drawingContentWithHiddenObjects(result, result.entities.filter(entity => entity[ANNOTATION_HIDDEN]).map(entity => entity.id));
    return { ...result, [CONTENT_SOURCE]: content, [LEADER_BLOCKS]: new Set(leaderDefinitions.keys()), [ANNOTATION_LIMIT]: limited };
}

export function restoreDrawingAnnotationContent(content) {
    if (!content?.[CONTENT_SOURCE] && !content?.entities?.some(entity => entity[SOURCE])) return content;
    const definitions = new Map((content.blocks || []).map(block => [block.id, block]));
    const replacements = new Map();
    const restore = entity => {
        const record = entity[SOURCE];
        if (!record) return entity;
        if (record.rendered === entity) return record.source;
        const { [SOURCE]: ignoredSource, [ANNOTATION_HIDDEN]: ignoredHidden, [DRAWING_LEADER_PRESENTATION]: ignoredLeader, ...plain } = entity;
        const unshifted = record.offset.x || record.offset.y ? offsetAnnotation(plain, -record.offset.x, -record.offset.y, record.labelAnchor) : plain;
        if (!record.source.dimensionTextPosition && record.labelAnchor && unshifted.dimensionTextPosition
            && Math.hypot(unshifted.dimensionTextPosition.x - record.labelAnchor.x, unshifted.dimensionTextPosition.y - record.labelAnchor.y) < 1e-8) delete unshifted.dimensionTextPosition;
        if (record.leaderDefinition) {
            const blockId = plain.blockId === record.derivedBlockId ? record.leaderDefinition.id : plain.blockId;
            const style = Object.fromEntries(Object.entries(unshifted.leader.style).map(([key, value]) => [key,
                ['textSize', 'arrowSize', 'landingLength'].includes(key) ? value === record.rendered.leader.style[key]
                    ? record.source.leader.style[key] : value / record.factor : value]));
            const leader = { ...unshifted.leader, style };
            const definition = definitions.get(plain.blockId);
            if (definition && JSON.stringify(definition.entities) !== JSON.stringify(record.renderedDefinition.entities)) {
                const last = definition.entities.at(-1);
                const tail = last.type === 'text' ? drawingLeaderTextAnnotation(last.text, leader.style, last.id)
                    : scaleLeaderContent(last, 1 / record.factor, record.textStyles);
                replacements.set(blockId, { ...definition, id: blockId, entities: drawingLeaderGeometry(leader, tail) });
            }
            return { ...unshifted, blockId, leader };
        }
        const restored = scaleDrawingAnnotationGeometry(unshifted, 1 / record.factor, record.textStyles);
        if (!record.source.affineFrame && restored.affineFrame && ['a', 'b', 'c', 'd', 'e', 'f'].every(key =>
            Math.abs(restored.affineFrame[key] - (key === 'a' || key === 'd' ? 1 : 0)) < 1e-8)) delete restored.affineFrame;
        return restored;
    };
    const { [CONTENT_SOURCE]: ignored, [LEADER_BLOCKS]: derivedIds, [ANNOTATION_LIMIT]: ignoredLimit, ...plain } = content;
    const entities = content.entities.map(restore);
    const blocks = (content.blocks || []).filter(block => !derivedIds?.has(block.id)).map(block => ({ ...block, entities: block.entities.map(restore) }));
    const existingIds = new Set(blocks.map(block => block.id));
    return refreshDrawingBlockBounds(withoutDrawingObjectVisibility({ ...plain, entities,
        blocks: [...blocks.map(block => replacements.get(block.id) || block), ...[...replacements.values()].filter(block => !existingIds.has(block.id))] }));
}

/** Rebase a selected visible representation without changing its size at any scale. */
export function rebaseDrawingAnnotation(entity, scale, textStyles = []) {
    const annotation = normalizeDrawingAnnotation(entity.annotation);
    if (!annotation) return entity;
    const next = scaleDrawingAnnotationGeometry(entity, scale / annotation.baseScale, textStyles);
    return { ...next, annotation: { ...annotation, baseScale: scale } };
}

function offsetAnnotation(entity, dx, dy, labelAnchor) {
    if (entity.leader && entity.type === 'blockReference') {
        const m = entity.transform;
        const determinant = m.a * m.d - m.b * m.c;
        const local = { x: (m.d * dx - m.c * dy) / determinant, y: (-m.b * dx + m.a * dy) / determinant };
        return { ...translateEntity(entity, dx, dy), leader: { ...entity.leader,
            branches: entity.leader.branches.map(branch => branch.map(point => ({ x: point.x - local.x, y: point.y - local.y }))) } };
    }
    if (isDrawingDimensionEntity(entity)) {
        const point = entity.dimensionTextPosition || labelAnchor;
        return point ? { ...entity, dimensionTextPosition: { x: point.x + dx, y: point.y + dy } } : entity;
    }
    if (entity.type === 'hatch') return { ...entity, pattern: { ...entity.pattern, origin: {
        x: (entity.pattern?.origin?.x || 0) + dx, y: (entity.pattern?.origin?.y || 0) + dy,
    } } };
    return translateEntity(entity, dx, dy);
}

function scaleLeaderStyle(style, factor) {
    return { ...style, ...Object.fromEntries(['textSize', 'arrowSize', 'landingLength'].map(key => [key, style[key] * factor])) };
}

function scaleLeaderContent(entity, factor, textStyles) {
    if (!entity) return entity;
    const anchor = entity.type === 'blockReference' ? { x: entity.transform.e, y: entity.transform.f } : framedDrawingPoint(entity, { x: entity.x, y: entity.y });
    return translateEntity(scaleDrawingAnnotationGeometry(entity, factor, textStyles), anchor.x * (factor - 1), anchor.y * (factor - 1));
}

/** Commit an explicit current-scale snapshot, retaining portable generated leader definitions. */
export function commitDrawingAnnotationRepresentation(content, ids, scale, { detach = false } = {}) {
    const selected = new Set(ids);
    const originals = new Map(content.entities.map(entity => [entity.id, entity]));
    const source = detach ? content : { ...content, entities: content.entities.map(entity => selected.has(entity.id) && entity.annotation
        ? { ...entity, annotation: { ...entity.annotation, scales: normalizeDrawingAnnotation(entity.annotation).scales.map(item => ({ ...item, offset: { x: 0, y: 0 } })) } } : entity) };
    const display = resolveDrawingAnnotationContent(source, scale, { showAll: true });
    if (display[ANNOTATION_LIMIT] && display.entities.some(entity => selected.has(entity.id) && entity[ANNOTATION_HIDDEN])) return null;
    const keptBlocks = new Set();
    const entities = display.entities.map(entity => {
        if (!selected.has(entity.id)) return entity;
        const next = JSON.parse(JSON.stringify(entity));
        if (detach) delete next.annotation;
        else if (next.annotation) next.annotation = { ...normalizeDrawingAnnotation(originals.get(entity.id).annotation), baseScale: scale };
        if (display[LEADER_BLOCKS]?.has(next.blockId)) keptBlocks.add(next.blockId);
        return next;
    });
    return restoreDrawingAnnotationContent({ ...display, entities,
        [LEADER_BLOCKS]: new Set([...(display[LEADER_BLOCKS] || [])].filter(id => !keptBlocks.has(id))) });
}
