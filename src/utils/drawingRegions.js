import { buildHatchBoundaries } from './drawingHatches.js';
import { detectDrawingBoundary } from './drawingBoundaryDetection.js';
import { normalizeDrawingRegion } from './drawingAdvancedEntities.js';

/** An independent planar area whose native closed loops use even-odd interiors. */
export function createDrawingRegion(entities, layerId, id, point = null) {
    const boundaries = point ? detectDrawingBoundary(entities, point)?.boundaries : buildHatchBoundaries(entities);
    if (!boundaries?.length) return null;
    return normalizeDrawingRegion({ id, type: 'region', layerId, boundaries });
}
