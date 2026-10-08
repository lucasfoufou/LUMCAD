import { drawingComparisonHighlights } from './drawingComparisonVisual.js';
import { getEntityBounds } from './drawingGeometry.js';
import { createDrawingRevision } from './drawingRevisionCommands.js';

/** Revision clouds enclose the union of each affected root's old/new bounds. */
export function createDrawingComparisonClouds(content, baseline, incoming, report, { padding = 0.25, arcLength = 0.5 } = {}) {
    if (![padding, arcLength].every(value => Number.isFinite(value) && value > 1e-6 && value <= 1e6)) return { error: 'comparisonCloudOptions' };
    const regions = new Map();
    for (const document of [baseline, incoming]) {
        const affected = new Set(drawingComparisonHighlights(document, report));
        for (const entity of document.content.entities) {
            if (!affected.has(entity.id)) continue;
            const bounds = getEntityBounds(entity);
            if (!bounds || !Object.values(bounds).every(Number.isFinite)) return { error: 'comparisonCloudBounds' };
            const previous = regions.get(entity.id);
            regions.set(entity.id, previous ? { minX: Math.min(previous.minX, bounds.minX), minY: Math.min(previous.minY, bounds.minY),
                maxX: Math.max(previous.maxX, bounds.maxX), maxY: Math.max(previous.maxY, bounds.maxY) } : bounds);
        }
    }
    if (!regions.size || regions.size > 256) return { error: 'comparisonCloudBounds' };
    let next = content; const selectedIds = [];
    for (const bounds of regions.values()) {
        const source = { type: 'polyline', closed: true, points: [
            { x: bounds.minX - padding, y: bounds.minY - padding }, { x: bounds.maxX + padding, y: bounds.minY - padding },
            { x: bounds.maxX + padding, y: bounds.maxY + padding }, { x: bounds.minX - padding, y: bounds.maxY + padding },
        ] };
        const result = createDrawingRevision(next, { kind: 'cloud', source, arcLength, reverse: false });
        if (result.error) return { error: result.error };
        next = result.content; selectedIds.push(...result.selectedIds);
    }
    return { content: next, selectedIds };
}
