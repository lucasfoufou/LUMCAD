import { canEditEntity, createDrawingId } from './drawingDocument.js';
import { getDimensionGeometry } from './drawingDimensions.js';
import { drawingConvertedDimensionType, drawingConvertedDimensionSources } from './drawingDimensionalConstraints.js';
import { drawingConstraintCoordinates } from './drawingConstraintEntities.js';

/** Retain associative annotations and add drivers using their exact native measurement. */
export function convertDrawingDimensions(content, selectedIds, prefix = 'd') {
    if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length) return { error: 'selection' };
    if (typeof prefix !== 'string' || !/^[a-z_][a-z0-9_]{0,49}$/i.test(prefix)) return { error: 'syntax' };
    const entities = new Map(content.entities.map(entity => [entity.id, entity]));
    const existing = content.dimensionalConstraints || [];
    const used = new Set([...(content.parameters || []), ...existing].map(item => item.name.toLowerCase()));
    const additions = []; let counter = 1;
    for (const id of selectedIds) {
        const dimension = entities.get(id); const type = drawingConvertedDimensionType(dimension);
        if (!type || !canEditEntity(content, dimension)) return { error: 'selection' };
        if (existing.some(item => item.dimensionId === id)) continue;
        const sources = drawingConvertedDimensionSources(dimension, entities);
        if (!sources || sources.some(source => !drawingConstraintCoordinates(entities.get(source)))) return { error: 'selection' };
        const geometry = getDimensionGeometry(dimension, entities);
        const value = geometry && (type === 'angular' ? geometry.value * 180 / Math.PI : geometry.value);
        if (!Number.isFinite(value) || value <= 1e-9 || type === 'angular' && value >= 360) return { error: 'definition' };
        while (used.has(`${prefix.toLowerCase()}${counter}`)) counter += 1;
        const name = `${prefix.toLowerCase()}${counter++}`; used.add(name);
        additions.push({ id: createDrawingId('dimension-constraint'), name, type, expression: String(value),
            dimensionId: id, refs: sources.map(entityId => ({ entityId })) });
    }
    return { content: additions.length ? { ...content, dimensionalConstraints: [...existing, ...additions] } : content, count: additions.length };
}
