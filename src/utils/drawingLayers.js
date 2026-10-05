import { isProtectedDrawingLayer, normalizeDrawingColor, normalizeDrawingLineType, normalizeDrawingLineWeight, normalizeDrawingTransparency } from './drawingDocument.js';

export function isDrawingLayerVisible(layer) {
    return Boolean(layer && layer.visible !== false && !layer.frozen);
}

export function drawingLayerSnapshot(layer) {
    return { id: layer.id, visible: layer.visible !== false, frozen: Boolean(layer.frozen), locked: Boolean(layer.locked),
        newViewportFrozen: Boolean(layer.newViewportFrozen), plot: layer.plot !== false,
        color: normalizeDrawingColor(layer.color) || '#172033', lineType: normalizeDrawingLineType(layer.lineType) || 'continuous',
        lineWeight: normalizeDrawingLineWeight(layer.lineWeight) || 1, transparency: normalizeDrawingTransparency(layer.transparency) ?? 0 };
}

export function normalizeDrawingLayerStates(value) {
    const names = new Set();
    return (Array.isArray(value) ? value : []).slice(0, 128).flatMap(state => {
        const name = typeof state?.name === 'string' ? state.name.trim() : '';
        if (!name || name.length > 128 || names.has(name.toLowerCase()) || !Array.isArray(state.layers)) return [];
        names.add(name.toLowerCase());
        const ids = new Set();
        return [{ name, activeLayerId: String(state.activeLayerId || ''), layers: state.layers.slice(0, 2048).flatMap(layer => {
            if (typeof layer?.id !== 'string' || !layer.id || ids.has(layer.id)) return [];
            ids.add(layer.id); return [drawingLayerSnapshot(layer)];
        }) }];
    });
}

export function saveDrawingLayerState(content, name) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 128 || content.layers.length > 2048) return { error: 'invalid' };
    const states = normalizeDrawingLayerStates(content.layerStates);
    const existing = states.find(state => state.name.toLowerCase() === name.trim().toLowerCase());
    if (!existing && states.length >= 128) return { error: 'invalid' };
    const state = { name: name.trim(), activeLayerId: content.activeLayerId, layers: content.layers.map(drawingLayerSnapshot) };
    return { content: { ...content, layerStates: existing ? states.map(item => item === existing ? state : item) : [...states, state] } };
}

export function restoreDrawingLayerState(content, state) {
    const normalized = normalizeDrawingLayerStates([state])[0];
    if (!normalized) return { error: 'invalid' };
    const byId = new Map(normalized.layers.map(layer => [layer.id, layer]));
    return { content: { ...content, layers: content.layers.map(layer => ({ ...layer, ...byId.get(layer.id) })),
        activeLayerId: content.layers.some(layer => layer.id === normalized.activeLayerId) ? normalized.activeLayerId : content.activeLayerId } };
}

/** Merge remaps nested entities, saved states and viewport references without changing entity identity. */
export function mergeDrawingLayers(content, sourceIds, targetId, layouts = []) {
    const sources = new Set(sourceIds);
    const target = content.layers.find(layer => layer.id === targetId);
    if (!sources.size || sources.has(targetId) || !target || target.locked || !isDrawingLayerVisible(target)
        || [...sources].some(id => isProtectedDrawingLayer(id) || !content.layers.some(layer => layer.id === id && !layer.locked))) return { error: 'invalid' };
    const mapId = id => sources.has(id) ? targetId : id;
    const entity = item => ({ ...item, layerId: mapId(item.layerId), ...(Array.isArray(item.parts) ? { parts: item.parts.map(entity) } : {}) });
    const remapOverrides = overrides => (overrides || []).filter(item => !sources.has(item.layerId));
    return { content: { ...content,
        activeLayerId: mapId(content.activeLayerId), layers: content.layers.filter(layer => !sources.has(layer.id)),
        entities: content.entities.map(entity), blocks: (content.blocks || []).map(block => ({ ...block, entities: block.entities.map(entity) })),
        layerStates: normalizeDrawingLayerStates(content.layerStates).map(state => ({ ...state, activeLayerId: mapId(state.activeLayerId), layers: state.layers.filter(layer => !sources.has(layer.id)) })),
    }, layouts: layouts.map(layout => ({ ...layout, viewports: layout.viewports.map(viewport => ({ ...viewport,
            hiddenLayerIds: [...new Set((viewport.hiddenLayerIds || []).map(mapId))], layerOverrides: remapOverrides(viewport.layerOverrides),
        })), paperEntities: layout.paperEntities?.map(entity) })),
    };
}

export function filterDrawingLayers(layers, query = '') {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return layers.filter(layer => tokens.every(token => {
        if (token === 'locked') return layer.locked;
        if (token === 'frozen') return layer.frozen;
        if (token === 'visible') return isDrawingLayerVisible(layer);
        if (token === 'hidden') return !isDrawingLayerVisible(layer);
        if (token === 'noplot') return layer.plot === false;
        return layer.name.toLowerCase().includes(token);
    }));
}
