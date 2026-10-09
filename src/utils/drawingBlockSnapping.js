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
    const result = [];
    visitDrawingSnapGeometry(content, {
        limit,
        skipRoot: entity => excluded.has(entity.id) || isDrawingObjectHidden(content, entity.id),
        visibleLayer: layerId => isDrawingLayerVisible(layers.get(layerId)),
    }, entity => result.push(entity));
    return result;
}

/**
 * Snap geometry of every layer and object, each with the layer chain that must
 * stay visible for it to snap. Cached indexes use it so that layer visibility
 * and session hiding can change without re-expanding block references.
 */
export function drawingSnapEntityEntries(content, limit, roots = content.entities) {
    const entries = [];
    visitDrawingSnapGeometry(content, { limit, roots, skipRoot: () => false, visibleLayer: () => true },
        (entity, layerIds) => entries.push({ entity, layerIds }));
    return entries;
}

function visitDrawingSnapGeometry(content, { limit, roots = content.entities, skipRoot, visibleLayer }, emit) {
    const blocks = new Map((content.blocks || []).map(block => [block.id, block]));
    let remaining = limit;
    const clipBudget = { checks: 100000 };
    const visit = (entity, matrix, rootId, visiting, clips, layerIds) => {
        if (!entity || isDrawingReferenceUnloaded(entity) || entity[ANNOTATION_HIDDEN] || remaining-- <= 0 || !visibleLayer(entity.layerId)) return;
        const chain = [...layerIds, entity.layerId];
        if (entity.type !== 'blockReference') {
            let parts = [matrix === IDENTITY_AFFINE_MATRIX ? entity : { ...transformDrawingEntityAffine(entity, matrix), id: rootId }];
            for (const clip of clips) parts = parts.flatMap(part => clipDrawingSnapEntity(part, clip, clipBudget));
            parts.forEach(part => emit(part, chain));
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
                visit({ ...child, layerId: entity.layerId }, transform, rootId, next, childClips, chain);
            }
            return;
        }
        for (const child of drawingBlockInstanceEntities(block, entity)) {
            if (remaining <= 0) break;
            visit(resolveDrawingBlockChild(child, entity, content.settings?.attributeDisplay), transform, rootId, next, childClips, chain);
        }
    };
    for (const entity of roots) {
        if (skipRoot(entity)) continue;
        if (entity.type !== 'blockReference') {
            if (visibleLayer(entity.layerId)) emit(entity, [entity.layerId]);
        } else visit(entity, IDENTITY_AFFINE_MATRIX, entity.id, new Set(), [], []);
    }
}
