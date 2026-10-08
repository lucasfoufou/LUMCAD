import { drawingBlockClipShape, clipDrawingSnapEntity } from './drawingBlockClip.js';
import { drawingBlockInstanceEntities } from './drawingDynamicBlocks.js';
import { isDrawingReferenceUnloaded } from './drawingReferenceMetadata.js';
import { transformDrawingClipShape } from './drawingClipPaths.js';
import { ANNOTATION_HIDDEN } from './drawingAnnotations.js';
import { isDrawingLayerVisible } from './drawingLayers.js';
import { isDrawingObjectHidden } from './drawingObjectVisibility.js';
import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices, transformDrawingEntityAffine, resolveDrawingBlockChild } from './drawingBlocks.js';

// Bound expansion independently of archive size: a small definition graph can
// instantiate exponentially many children through nested references.
export function drawingSnapEntities(content, excluded = new Set(), limit = 10000) {
    const layers = new Map(content.layers.map(layer => [layer.id, layer]));
    const blocks = new Map((content.blocks || []).map(block => [block.id, block]));
    const result = [];
    let remaining = limit;
    const clipBudget = { checks: 100000 };
    const visit = (entity, matrix, rootId, visiting, clips = []) => {
        if (!entity || isDrawingReferenceUnloaded(entity) || entity[ANNOTATION_HIDDEN] || remaining-- <= 0 || !isDrawingLayerVisible(layers.get(entity.layerId))) return;
        if (entity.type !== 'blockReference') {
            let parts = [matrix === IDENTITY_AFFINE_MATRIX ? entity : { ...transformDrawingEntityAffine(entity, matrix), id: rootId }];
            for (const clip of clips) parts = parts.flatMap(part => clipDrawingSnapEntity(part, clip, clipBudget));
            result.push(...parts);
            return;
        }
        if (visiting.has(entity.blockId) || visiting.size >= 32) return;
        const block = blocks.get(entity.blockId);
        if (!block) return;
        const next = new Set(visiting);
        next.add(entity.blockId);
        const transform = multiplyAffineMatrices(matrix, entity.transform);
        const clip = drawingBlockClipShape(entity);
        const childClips = clip ? [...clips, transformDrawingClipShape(clip, transform)] : clips;
        if (entity.pdfUnderlay) {
            if (entity.pdfUnderlay.snapsEnabled !== false) for (const child of entity.pdfUnderlay.snapEntities || []) {
                if (remaining <= 0) break;
                visit({ ...child, layerId: entity.layerId }, transform, rootId, next, childClips);
            }
            return;
        }
        for (const child of drawingBlockInstanceEntities(block, entity)) {
            if (remaining <= 0) break;
            visit(resolveDrawingBlockChild(child, entity, content.settings?.attributeDisplay), transform, rootId, next, childClips);
        }
    };
    for (const entity of content.entities) {
        if (excluded.has(entity.id) || isDrawingObjectHidden(content, entity.id)) continue;
        if (entity.type !== 'blockReference') {
            if (isDrawingLayerVisible(layers.get(entity.layerId))) result.push(entity);
        } else visit(entity, IDENTITY_AFFINE_MATRIX, entity.id, new Set());
    }
    return result;
}
