import { canEditEntity, canSelectEntity, createDrawingId, getLayer } from './drawingDocument.js';
import { isDrawingLayerVisible } from './drawingLayers.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { prepareNamedDrawingBlockInsertion } from './drawingNamedBlocks.js';
import { buildDrawingEntity } from './drawingEntityFactory.js';
import { DRAWING_POINT_STYLES, normalizeDrawingPointStyle } from './drawingPoints.js';
import { drawingPlacementStations } from './drawingPointPlacement.js';

export function parseDrawingPlacementInput(input, mode) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens?.length || !['divide', 'measure'].includes(mode)) return null;
    const value = Number(tokens.shift());
    if (!Number.isFinite(value) || value <= 0 || mode === 'divide' && (!Number.isInteger(value) || value < 2)) return null;
    const options = { mode, ...(mode === 'divide' ? { count: value } : { spacing: value }), align: true, scale: 1, reverse: false };
    const seen = new Set();
    while (tokens.length) {
        const key = tokens.shift().toUpperCase();
        if (seen.has(key)) return null;
        seen.add(key);
        if (key === 'REVERSE') options.reverse = true;
        else if (key === 'BLOCK') {
            options.block = tokens.shift();
            if (!options.block) return null;
        } else if (key === 'ALIGN') {
            const value = tokens.shift()?.toUpperCase();
            if (!['ON', 'OFF'].includes(value)) return null;
            options.align = value === 'ON';
        } else if (key === 'SCALE') {
            options.scale = Number(tokens.shift());
            if (!Number.isFinite(options.scale) || options.scale <= 1e-9 || options.scale > 1e9) return null;
        } else return null;
    }
    if (!options.block && (seen.has('ALIGN') || seen.has('SCALE'))) return null;
    return options;
}

export function placeDrawingPoints(content, sourceId, options) {
    const source = content.entities.find(entity => entity.id === sourceId);
    if (!source || !canSelectEntity(content, source)) return { error: 'source' };
    const layer = getLayer(content, content.activeLayerId);
    if (!isDrawingLayerVisible(layer) || layer.locked) return { error: 'layer' };
    const stations = drawingPlacementStations(source, options);
    if (!stations) return { error: 'invalid' };
    if (!stations.length) return { error: 'empty' };
    // Build against one immutable base so a failed insertion never leaves partial results.
    const entities = [];
    for (const station of stations) {
        if (options.block) {
            const result = prepareNamedDrawingBlockInsertion(content, options.block, station.point,
                { scale: options.scale, angle: options.align ? station.rotation : 0 });
            if (result.error) return { error: 'block' };
            entities.push(result.reference);
        } else {
            const entity = buildDrawingEntity('point', station.point, station.point, layer.id, createDrawingId('point'),
                { options: { pointStyle: content.settings?.pointStyle } });
            if (!entity) return { error: 'invalid' };
            entities.push(entity);
        }
    }
    return { content: { ...content, entities: [...content.entities, ...entities] }, selectedIds: entities.map(entity => entity.id) };
}

export function setDrawingPointStyle(content, selectedIds, input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    const symbol = tokens?.[0]?.toLowerCase();
    const size = Number(tokens?.[1]);
    if (tokens?.length !== 2 || !DRAWING_POINT_STYLES.includes(symbol) || !Number.isFinite(size) || size < 1e-6 || size > 1e6) return { error: 'styleSyntax' };
    const pointStyle = normalizeDrawingPointStyle({ symbol, size });
    const selected = new Set(selectedIds);
    return { content: { ...content, settings: { ...content.settings, pointStyle },
        entities: content.entities.map(entity => entity.type === 'point' && canEditEntity(content, entity)
            && (!selected.size || selected.has(entity.id)) ? { ...entity, pointStyle: { ...pointStyle } } : entity) } };
}
