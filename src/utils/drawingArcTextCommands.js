import { canEditEntity, createDrawingId, getLayer } from './drawingDocument.js';
import { isDrawingLayerVisible } from './drawingLayers.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { normalizeDrawingArcText, rebuildDrawingArcTextEntity } from './drawingArcText.js';
import { resolveDrawingTextStyle } from './drawingText.js';

export function parseDrawingArcText(input, fallback = {}) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens?.length) return null;
    const editing = tokens[0].toUpperCase() === 'EDIT';
    if (editing) tokens.shift();
    if (tokens.length === 1 && tokens[0].toUpperCase() === 'DETACH') return { detach: true };
    if (!tokens.length) return null;
    const definition = { ...fallback, version: 1, text: tokens.shift(), style: { ...fallback.style } };
    const seen = new Set();
    while (tokens.length) {
        const key = tokens.shift().toUpperCase(); const value = tokens.shift();
        if (value === undefined || seen.has(key)) return null;
        seen.add(key);
        if (['HEIGHT', 'OFFSET', 'SPACING'].includes(key)) {
            const number = Number(value.replace(',', '.'));
            if (!value.trim() || !Number.isFinite(number)) return null;
            if (key === 'HEIGHT') { if (number < 0.01 || number > 1e6) return null; definition.style.fontSize = number; }
            else definition[key.toLowerCase()] = number;
        } else if (key === 'ALIGN' && ['START', 'CENTER', 'END'].includes(value.toUpperCase())) definition.align = value.toLowerCase();
        else if (key === 'DIRECTION' && ['FORWARD', 'REVERSE'].includes(value.toUpperCase())) definition.reverse = value.toUpperCase() === 'REVERSE';
        else return null;
    }
    return { editing, definition };
}

export function runDrawingArcText(content, ids, input) {
    const source = ids.length === 1 && content.entities.find(entity => entity.id === ids[0]);
    const fallback = source?.arcText || { style: resolveDrawingTextStyle({ textStyleId: content.currentTextStyleId }, content.textStyles) };
    const parsed = parseDrawingArcText(input, fallback);
    if (!parsed) return { error: 'syntax' };
    if (parsed.detach || parsed.editing) {
        if (!source?.arcText || !canEditEntity(content, source)) return { error: 'selection' };
        let entity;
        if (parsed.detach) {
            const { sourceId, ...rest } = source;
            if (!sourceId) return { content, selectedIds: ids };
            entity = { ...rest, arcText: { ...rest.arcText, status: 'current' } };
        } else entity = rebuildDrawingArcTextEntity({ ...source, arcText: parsed.definition });
        return entity ? { content: { ...content, entities: content.entities.map(item => item.id === entity.id ? entity : item) }, selectedIds: ids }
            : { error: 'invalid' };
    }
    if (source?.type !== 'arc') return { error: 'arcRequired' };
    const layer = getLayer(content, content.activeLayerId);
    if (!isDrawingLayerVisible(layer) || layer.locked) return { error: 'layer' };
    const arcText = normalizeDrawingArcText({ ...parsed.definition, arc: source });
    const entity = arcText && rebuildDrawingArcTextEntity({ id: createDrawingId('arc-text'), sourceId: source.id, layerId: layer.id, arcText });
    return entity ? { content: { ...content, entities: [...content.entities, entity] }, selectedIds: [entity.id] } : { error: 'invalid' };
}
