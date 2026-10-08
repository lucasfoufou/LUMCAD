import { ANNOTATION_HIDDEN } from './drawingAnnotations.js';
import { canSelectEntity } from './drawingDocument.js';
import { drawingBlockInstanceEntities } from './drawingDynamicBlocks.js';
import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices, transformDrawingEntityAffine, resolveDrawingBlockChild } from './drawingBlocks.js';
import { drawingBlockClipShape } from './drawingBlockClip.js';
import { isDrawingReferenceUnloaded } from './drawingReferenceMetadata.js';

/** Preserve occurrence paths even when the same definition is instantiated repeatedly. */
export function drawingCountOccurrences(content, ids, { nested = false, maxOccurrences = 10000 } = {}) {
    const selected = new Set(ids);
    const blocks = new Map((content.blocks || []).map(block => [block.id, block]));
    const occurrences = []; const unsupportedPaths = [];
    let visited = 0;
    const visit = (entity, matrix, path, ancestors) => {
        if (++visited > maxOccurrences || ancestors.size > 32) throw new Error('limit');
        if (!entity || entity[ANNOTATION_HIDDEN] || !canSelectEntity(content, entity) || isDrawingReferenceUnloaded(entity)) return;
        const nextPath = [...path, entity.id];
        const world = path.length ? transformDrawingEntityAffine(entity, matrix, { textStyles: content.textStyles }) : entity;
        const id = nested ? JSON.stringify(nextPath) : entity.id;
        occurrences.push({ id, rootId: nextPath[0], path: nextPath, entity: world });
        if (!nested || entity.type !== 'blockReference') return;
        if (drawingBlockClipShape(entity) || entity.pdfUnderlay || entity.dwfUnderlay || entity.dgnUnderlay || entity.externalReference) {
            unsupportedPaths.push(nextPath); return;
        }
        const block = blocks.get(entity.blockId);
        if (!block || ancestors.has(block.id)) throw new Error('dependency');
        const transform = multiplyAffineMatrices(matrix, entity.transform);
        if (!Object.values(transform).every(Number.isFinite)) throw new Error('limit');
        const next = new Set([...ancestors, block.id]);
        for (const child of drawingBlockInstanceEntities(block, entity)) {
            visit(resolveDrawingBlockChild(child, entity, content.settings?.attributeDisplay), transform, nextPath, next);
        }
    };
    try {
        for (const entity of content.entities) if (selected.has(entity.id)) visit(entity, IDENTITY_AFFINE_MATRIX, [], new Set());
        return { occurrences, unsupportedPaths };
    } catch (error) { return { error: error.message === 'dependency' ? 'dependency' : 'limit' }; }
}
