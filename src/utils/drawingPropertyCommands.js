import { isDrawingLayerVisible } from './drawingLayers.js';
import { canEditEntity, canSelectEntity, copySelectedEntities } from './drawingDocument.js';

const APPEARANCE_KEYS = ['color', 'lineWeight', 'lineWidth', 'lineType', 'transparency'];

export function matchDrawingProperties(content, selectedIds, sourceId, { layerOnly = false } = {}) {
    const source = content.entities.find(entity => entity.id === sourceId);
    if (!source || !canSelectEntity(content, source)) return { error: 'source' };
    const selected = new Set(selectedIds);
    const targets = content.entities.filter(entity => selected.has(entity.id) && entity.id !== sourceId && canEditEntity(content, entity));
    if (!targets.length) return { error: 'selection' };
    const layer = content.layers.find(item => item.id === source.layerId);
    if (layer.locked) return { error: 'layer' };
    const targetIds = new Set(targets.map(entity => entity.id));
    const entities = content.entities.map(entity => {
        if (!targetIds.has(entity.id)) return entity;
        const next = { ...entity, layerId: source.layerId };
        if (!layerOnly) {
            for (const key of APPEARANCE_KEYS) {
                if (source[key] === undefined) delete next[key];
                else next[key] = source[key];
            }
        }
        return next;
    });
    return { content: { ...content, entities }, selectedIds: [...targetIds] };
}

export function makeDrawingLayerCurrent(content, sourceId) {
    const source = content.entities.find(entity => entity.id === sourceId);
    if (!source || !canSelectEntity(content, source)) return { error: 'source' };
    if (content.layers.find(layer => layer.id === source.layerId)?.locked) return { error: 'layer' };
    return { content: source.layerId === content.activeLayerId ? content : { ...content, activeLayerId: source.layerId } };
}

export function copyDrawingSelectionToLayer(content, selectedIds, nameOrId) {
    const layer = content.layers.find(item => item.id === nameOrId || item.name.toLowerCase() === nameOrId.toLowerCase());
    if (!layer || !isDrawingLayerVisible(layer) || layer.locked) return { error: 'layer' };
    const result = copySelectedEntities(content, selectedIds, { x: 0, y: 0 });
    if (!result.selectedIds.length) return { error: 'selection' };
    const copied = new Set(result.selectedIds);
    return { ...result, content: { ...result.content, entities: result.content.entities.map(entity => copied.has(entity.id) ? { ...entity, layerId: layer.id } : entity) } };
}
