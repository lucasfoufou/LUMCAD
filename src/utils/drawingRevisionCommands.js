import { canEditEntity, createDrawingId, getLayer } from './drawingDocument.js';
import { isDrawingLayerVisible } from './drawingLayers.js';
import { rebuildDrawingRevisionSymbol } from './drawingRevisionSymbols.js';

export function createDrawingRevision(content, definition, sourceId = null) {
    const source = sourceId ? content.entities.find(entity => entity.id === sourceId) : null;
    if (sourceId && (!source || !canEditEntity(content, source))) return { error: 'selection' };
    const layer = getLayer(content, source?.layerId || content.activeLayerId);
    if (!isDrawingLayerVisible(layer) || layer.locked) return { error: 'layer' };
    const entity = rebuildDrawingRevisionSymbol({ ...(source || {}), id: source?.id || createDrawingId('revision'), layerId: layer.id,
        revisionSymbol: { ...definition, ...(source ? { source } : {}) } });
    if (!entity) return { error: 'invalid' };
    return { content: { ...content, entities: source ? content.entities.map(value => value.id === sourceId ? entity : value) : [...content.entities, entity] }, selectedIds: [entity.id] };
}

export function editDrawingRevision(content, ids, patch) {
    const idSet = new Set(ids);
    const selected = content.entities.filter(entity => idSet.has(entity.id));
    if (!selected.length || selected.some(entity => entity.revisionSymbol?.kind !== 'cloud' || !canEditEntity(content, entity))) return { error: 'selection' };
    const replacements = new Map();
    for (const entity of selected) {
        const next = rebuildDrawingRevisionSymbol({ ...entity, revisionSymbol: { ...entity.revisionSymbol, ...patch } });
        if (!next) return { error: 'invalid' };
        replacements.set(entity.id, next);
    }
    return { content: { ...content, entities: content.entities.map(entity => replacements.get(entity.id) || entity) }, selectedIds: selected.map(entity => entity.id) };
}
