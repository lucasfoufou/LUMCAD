import { canEditEntity, createDrawingId } from './drawingDocument.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference, refreshDrawingBlockBounds } from './drawingBlocks.js';
import { createI18nError } from '../i18n/translator.js';

/** Shared portable preview/block placement for document underlays. */
export function attachDrawingRasterUnderlay(document, page, sourceAsset, descriptor, metadata, placement, error) {
    const { x = 0, y = 0, scale = 1, layerId = document.content.activeLayerId } = placement;
    if (![x, y, scale].every(Number.isFinite) || scale <= 0 || scale > 1e9
        || ![x, y, x + page.width * scale, y + page.height * scale].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) throw error('placement');
    if (!canEditEntity(document.content, { layerId })) throw createI18nError('block.error.layer');
    if (document.content.blocks.length >= 1024 || document.content.blocks.reduce((sum, block) => sum + block.entities.length, 0) >= 100000) throw error('limit');
    const preview = { id: createDrawingId('asset'), name: `${sourceAsset.name} — ${page.pageNumber}`, mimeType: 'image/png', ...page.preview };
    const image = { id: createDrawingId('image'), type: 'image', layerId: 'geometry', assetId: preview.id,
        x: 0, y: 0, width: page.width, height: page.height, opacity: 1, includeInPdf: true };
    const definition = createAnonymousDrawingBlock([image]);
    const reference = { ...createAnonymousDrawingBlockReference(definition, { layerId }),
        transform: { a: scale, b: 0, c: 0, d: scale, e: x, f: y }, [descriptor]: metadata };
    return { ...document, assets: [...document.assets.filter(asset => asset.id !== sourceAsset.id), sourceAsset, preview],
        content: refreshDrawingBlockBounds({ ...document.content, blocks: [...document.content.blocks, definition], entities: [...document.content.entities, reference] }),
        selectedIds: [reference.id] };
}
