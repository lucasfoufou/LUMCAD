import { canSelectEntity } from './drawingDocument.js';
import { isDrawingLayerVisible } from './drawingLayers.js';
import { getDrawingBlockDefinition, materializeDrawingBlockReference } from './drawingBlocks.js';
import { drawingBlockClipShape } from './drawingBlockClip.js';

/** Resolve visible instances for flat output while retaining the source drawing intact. */
export function drawingExportEntities(content, { maxEntities = 100000, maxDepth = 16 } = {}) {
    const items = drawingExportItems(content, { maxEntities, maxDepth, includeClips: false });
    return items.map(item => item.entity);
}

/** Keep inherited world-space clips beside flattened geometry for format-specific output. */
export function drawingExportItems(content, { maxEntities = 100000, maxDepth = 16, includeClips = true } = {}) {
    if (![maxEntities, maxDepth].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('wmfLimit');
    const result = []; const layers = new Map(content.layers.map(layer => [layer.id, layer]));
    let visited = 0;
    const walk = (entity, ancestors, clips, pdfUnderlay = false) => {
        if (++visited > maxEntities) throw new Error('wmfLimit');
        if (!isDrawingLayerVisible(layers.get(entity.layerId))) return;
        if (entity.type !== 'blockReference') { result.push({ entity, clips, pdfUnderlay }); return; }
        if (entity.externalReference?.loaded === false) return;
        if (ancestors.has(entity.blockId)) throw new Error('wmfExportBlockCycle');
        if (ancestors.size >= maxDepth) throw new Error('wmfLimit');
        if (!getDrawingBlockDefinition(content.blocks, entity.blockId)) throw new Error('wmfExportMissingBlock');
        const clip = drawingBlockClipShape(entity, { world: true });
        if (clip && !includeClips) throw new Error('wmfExportUnsupported');
        const inherited = clip ? [...clips, clip] : clips;
        const next = new Set(ancestors); next.add(entity.blockId);
        const children = materializeDrawingBlockReference(entity, content.blocks, {
            textStyles: content.textStyles, attributeDisplay: content.settings?.attributeDisplay || 'normal',
            includeLoadedReferences: true,
            includeClipped: true,
            includePdfUnderlays: true,
        });
        for (const child of children) walk(child, next, inherited, pdfUnderlay || Boolean(entity.pdfUnderlay));
    };
    for (const entity of content.entities) if (canSelectEntity(content, entity)) walk(entity, new Set(), []);
    return result;
}
