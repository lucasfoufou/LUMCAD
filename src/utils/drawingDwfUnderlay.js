import { normalizeDrawingDwfUnderlay } from './drawingDwfMetadata.js';
import { attachDrawingRasterUnderlay } from './drawingRasterUnderlay.js';
import { DWFX_SOURCE_MIME, drawingDwfxBytes } from './drawingDwfxSource.js';

/** Attach an already interpreted DWFx page as a source-backed native block. */
export function attachDrawingDwfUnderlay(document, page, sourceAsset, placement = {}) {
    if (sourceAsset?.mimeType !== DWFX_SOURCE_MIME) throw new Error('dwfxSource');
    drawingDwfxBytes(sourceAsset.link);
    const metadata = normalizeDrawingDwfUnderlay({ version: 1, format: 'dwfx', assetId: sourceAsset.id, name: sourceAsset.name,
        pageNumber: page.pageNumber, pageCount: page.pageCount, width: page.width, height: page.height });
    if (!metadata) throw new Error('dwfxPage');
    if (!page.preview?.link?.startsWith('data:image/png;base64,')
        || ![page.preview.width, page.preview.height].every(value => Number.isSafeInteger(value) && value > 0)
        || page.preview.width * page.preview.height > 16000000) throw new Error('dwfxImage');
    return attachDrawingRasterUnderlay(document, page, sourceAsset, 'dwfUnderlay', metadata, placement,
        key => new Error(key === 'placement' ? 'dwfxPlacement' : 'dwfxLimit'));
}
