import { canEditEntity, createDrawingId } from './drawingDocument.js';
import { getDimensionGeometry, normalizeDrawingDimension } from './drawingDimensions.js';
import { resolveDimensionLayerId } from './drawingDimensionCommands.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';

export function beginCenterLine(content, selectedIds = [], input = '') {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens || tokens.length && (tokens.length !== 1 || tokens[0].toUpperCase() !== 'ALTERNATE')) return { error: 'syntax' };
    const ids = [...new Set(selectedIds)];
    if (ids.length > 2 || ids.some(id => !validSource(content.entities.find(entity => entity.id === id)))) return { error: 'geometry' };
    const layerId = resolveDimensionLayerId(content);
    if (!canEditEntity(content, { layerId })) return { error: 'selection' };
    const operation = { type: 'centerLineCreation', stage: 'source', sourceIds: ids, alternateBisector: tokens.length === 1 };
    return ids.length === 2 ? finishCenterLine(content, operation) : { operation };
}

export function pickCenterLineSource(content, operation, targetId) {
    if (operation?.type !== 'centerLineCreation' || operation.sourceIds.includes(targetId)
        || !validSource(content.entities.find(entity => entity.id === targetId))) return { error: 'geometry' };
    const next = { ...operation, sourceIds: [...operation.sourceIds, targetId] };
    return next.sourceIds.length === 2 ? finishCenterLine(content, next) : { operation: next };
}

function finishCenterLine(content, operation) {
    const layerId = resolveDimensionLayerId(content);
    if (!canEditEntity(content, { layerId })) return { error: 'selection' };
    const entity = normalizeDrawingDimension({ id: createDrawingId('centerLine'), type: 'centerLine', layerId,
        sourceIds: operation.sourceIds, alternateBisector: operation.alternateBisector });
    if (!getDimensionGeometry(entity, new Map(content.entities.map(source => [source.id, source])))) return { error: 'geometry' };
    return { content: { ...content, entities: [...content.entities, entity] }, selectedIds: [entity.id] };
}

function validSource(entity) {
    return entity?.type === 'line' && [entity.x1, entity.y1, entity.x2, entity.y2].every(Number.isFinite)
        && Math.hypot(entity.x2 - entity.x1, entity.y2 - entity.y1) > 1e-9;
}
