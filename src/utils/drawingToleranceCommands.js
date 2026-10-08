import { canEditEntity, createDrawingId, getLayer } from './drawingDocument.js';
import { isDrawingLayerVisible } from './drawingLayers.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { normalizeDrawingTableStyles } from './drawingTables.js';
import { DRAWING_TOLERANCE_SYMBOLS, normalizeDrawingTolerance, rebuildDrawingToleranceEntity } from './drawingTolerances.js';

export function parseDrawingTolerance(input, styles, fallbackStyle) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens?.length) return null;
    const definition = { rows: [], style: fallbackStyle };
    let row = null; let value = null;
    while (tokens.length) {
        const token = tokens.shift(); const key = token.toUpperCase();
        const symbol = DRAWING_TOLERANCE_SYMBOLS.find(symbol => symbol.toUpperCase() === key);
        if (symbol) {
            value = { value: tokens.shift() }; row = { symbol, values: [value], datums: [] }; definition.rows.push(row);
        } else if (key === 'SECOND' && row && row.values.length === 1) { value = { value: tokens.shift() }; row.values.push(value); }
        else if (key === 'DIAMETER' && value) value.diameter = true;
        else if (key === 'MATERIAL' && value) { value.material = tokens.shift()?.toUpperCase(); if (!value.material) return null; }
        else if (key === 'DATUM' && row) {
            const datum = tokens.shift()?.toUpperCase().split(':');
            if (!datum || datum.length > 2) return null;
            row.datums.push({ label: datum[0], material: datum[1] || '' });
        } else if (key === 'PROJECTED') { definition.projectedHeight = tokens.shift(); if (!definition.projectedHeight) return null; }
        else if (key === 'IDENTIFIER') { definition.datumIdentifier = tokens.shift()?.toUpperCase(); if (!definition.datumIdentifier) return null; }
        else if (key === 'STYLE') {
            const name = tokens.shift();
            const style = normalizeDrawingTableStyles(styles).find(style => style.name.toLowerCase() === name?.toLowerCase());
            if (!style) return null;
            definition.style = style;
        } else return null;
    }
    return normalizeDrawingTolerance(definition);
}

export function createDrawingTolerance(content, tolerance, point) {
    const layer = getLayer(content, content.activeLayerId);
    if (!isDrawingLayerVisible(layer) || layer.locked) return { error: 'layer' };
    if (![point?.x, point?.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) return { error: 'invalid' };
    const entity = rebuildDrawingToleranceEntity({ id: createDrawingId('tolerance'), layerId: layer.id,
        tolerance: { ...tolerance, transform: { a: 1, b: 0, c: 0, d: 1, e: point.x, f: point.y } } });
    return entity ? { content: { ...content, entities: [...content.entities, entity] }, selectedIds: [entity.id] } : { error: 'invalid' };
}

export function editDrawingTolerance(content, ids, tolerance) {
    if (ids.length !== 1) return { error: 'selection' };
    const source = content.entities.find(entity => entity.id === ids[0]);
    if (!source?.tolerance || !canEditEntity(content, source)) return { error: 'selection' };
    const entity = rebuildDrawingToleranceEntity({ ...source, tolerance: { ...tolerance, transform: source.tolerance.transform } });
    return entity ? { content: { ...content, entities: content.entities.map(item => item.id === source.id ? entity : item) }, selectedIds: ids } : { error: 'invalid' };
}
