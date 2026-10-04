import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices, transformDrawingEntityAffine, resolveDrawingBlockChild } from './drawingBlocks.js';

// Bound expansion independently of archive size: a small definition graph can
// instantiate exponentially many children through nested references.
export function drawingSnapEntities(content, excluded = new Set(), limit = 10000) {
    const layers = new Map(content.layers.map(layer => [layer.id, layer]));
    const blocks = new Map((content.blocks || []).map(block => [block.id, block]));
    const result = [];
    let remaining = limit;
    const visit = (entity, matrix, rootId, visiting) => {
        if (!entity || remaining-- <= 0 || !layers.get(entity.layerId)?.visible) return;
        if (entity.type !== 'blockReference') {
            result.push(matrix === IDENTITY_AFFINE_MATRIX ? entity : { ...transformDrawingEntityAffine(entity, matrix), id: rootId });
            return;
        }
        if (visiting.has(entity.blockId) || visiting.size >= 32) return;
        const block = blocks.get(entity.blockId);
        if (!block) return;
        const next = new Set(visiting);
        next.add(entity.blockId);
        const transform = multiplyAffineMatrices(matrix, entity.transform);
        for (const child of block.entities) {
            if (remaining <= 0) break;
            visit(resolveDrawingBlockChild(child, entity, content.settings?.attributeDisplay), transform, rootId, next);
        }
    };
    for (const entity of content.entities) {
        if (excluded.has(entity.id)) continue;
        if (entity.type !== 'blockReference') {
            if (layers.get(entity.layerId)?.visible) result.push(entity);
        } else visit(entity, IDENTITY_AFFINE_MATRIX, entity.id, new Set());
    }
    return result;
}
