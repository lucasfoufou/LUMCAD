import { createDefaultDrawingContent } from './drawingDocument.js';
import { exportDrawingWmfWithAssets } from './drawingWmfExport.js';

/** Package an explicitly composited model render in an opaque WMF bitmap. */
export async function exportDrawingWmfRaster(raster, options = {}) {
    const { viewBox } = raster;
    if (!viewBox || ![viewBox.x, viewBox.y, viewBox.width, viewBox.height].every(Number.isFinite)
        || viewBox.width <= 0 || viewBox.height <= 0) throw new Error('wmfPlacement');
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'raster', type: 'image', assetId: 'raster', layerId: content.activeLayerId,
        x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height, opacity: 1 }];
    const result = await exportDrawingWmfWithAssets(content, [{ id: 'raster', link: raster.dataUrl }], options);
    result.report.warnings = ['fullRaster', 'coordinateQuantization', 'rasterResampling'];
    result.report.raster = { width: raster.width, height: raster.height, background: raster.background };
    return result;
}
