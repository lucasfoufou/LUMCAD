import { importDrawingDgn } from './drawingDgnImport.js';
import { drawingDgnBytes, DGN_SOURCE_MIME } from './drawingDgnSource.js';
import { normalizeDrawingDgnUnderlay } from './drawingDgnMetadata.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference, refreshDrawingBlockBounds } from './drawingBlocks.js';

/** Build a source-backed vector reference without modifying the current document. */
export function attachDrawingDgnUnderlay(document, sourceAsset, { unit = null, x = 0, y = 0, scale = 1 } = {}) {
    if (sourceAsset?.mimeType !== DGN_SOURCE_MIME || document.assets.some(asset => asset.id === sourceAsset.id)) throw new Error('dgnInvalid');
    if (![x, y, scale].every(Number.isFinite) || scale <= 0 || scale > 1e9) throw new Error('dgnPlacement');
    const imported = importDrawingDgn(document, drawingDgnBytes(sourceAsset.link), { unit });
    const metadata = normalizeDrawingDgnUnderlay({ version: 1, format: 'v7', assetId: sourceAsset.id,
        name: sourceAsset.name, metresPerMaster: imported.report.metresPerMaster });
    if (!metadata) throw new Error('dgnInvalid');
    const selected = new Set(imported.selectedIds);
    const entities = imported.content.entities.filter(entity => selected.has(entity.id));
    if (imported.content.blocks.length >= 1024
        || imported.content.blocks.reduce((sum, block) => sum + block.entities.length, 0) + entities.length > 100000) throw new Error('dgnLimit');
    const definition = createAnonymousDrawingBlock(entities);
    const reference = { ...createAnonymousDrawingBlockReference(definition, { layerId: document.content.activeLayerId }),
        transform: { a: scale, b: 0, c: 0, d: scale, e: x, f: y }, dgnUnderlay: metadata };
    const content = refreshDrawingBlockBounds({ ...imported.content, groups: document.content.groups,
        blocks: [...imported.content.blocks, definition], entities: [...document.content.entities, reference] });
    const bounds = content.entities.at(-1).definitionBounds;
    if (!bounds || ![bounds.minX * scale + x, bounds.maxX * scale + x, bounds.minY * scale + y, bounds.maxY * scale + y]
        .every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) throw new Error('dgnPlacement');
    return { ...document, content, assets: [...document.assets, sourceAsset], selectedIds: [reference.id], report: imported.report };
}
