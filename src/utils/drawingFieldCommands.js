import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { normalizeDrawingField } from './drawingFieldDefinition.js';
import { refreshDrawingFields } from './drawingFields.js';
import { normalizeDrawingTextEntity } from './drawingText.js';
import { canEditEntity, createDrawingId, getLayer } from './drawingDocument.js';
import { isDrawingLayerVisible } from './drawingLayers.js';

export function parseDrawingFieldInput(input, depth = 0) {
    if (depth > 8) return null;
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens?.length) return null;
    const action = tokens.shift().toUpperCase();
    if (['SHOW', 'REMOVE'].includes(action)) return !tokens.length ? { action: action.toLowerCase() } : null;
    let field;
    if (action === 'META') field = { kind: 'metadata', key: tokens.shift() };
    else if (action === 'DOCUMENT') field = { kind: 'document', property: tokens.shift() };
    else if (action === 'OBJECT') field = { kind: 'object', entityId: tokens.shift(), property: tokens.shift()?.toLowerCase() };
    else if (action === 'CELL') field = { kind: 'table', entityId: tokens.shift(), address: tokens.shift() };
    else if (action === 'REF') field = { kind: 'field', entityId: tokens.shift() };
    else if (action === 'DATE') field = { kind: 'date', format: tokens.shift()?.toLowerCase() };
    else if (action === 'PAGE') field = { kind: 'page', property: tokens.shift()?.toLowerCase() };
    else if (action === 'FORMULA') field = { kind: 'formula', expression: tokens.shift(), bindings: {} };
    else return null;
    const used = new Set();
    while (tokens.length) {
        const key = tokens.shift().toUpperCase();
        if (key === 'BIND' && field.kind === 'formula') {
            const name = tokens.shift(); const definition = parseDrawingFieldInput(tokens.shift(), depth + 1)?.field;
            if (!name || !definition || Object.hasOwn(field.bindings, name) || ['__proto__', 'constructor', 'prototype'].includes(name)) return null;
            field.bindings[name] = definition;
            continue;
        }
        if (used.has(key)) return null;
        used.add(key);
        const value = tokens.shift();
        if (value === undefined) return null;
        if (key === 'PREFIX' || key === 'SUFFIX') field[key.toLowerCase()] = value;
        else if (key === 'PRECISION' && /^\d+$/.test(value)) field.precision = Number(value);
        else if (key === 'LAYOUT' && field.kind === 'page') field.layoutId = value;
        else return null;
    }
    field = normalizeDrawingField(field);
    return field ? { action: 'set', field } : null;
}

function fieldTargets(document, ids, layoutId) {
    const source = layoutId ? document.layouts.find(layout => layout.id === layoutId)?.paperEntities || [] : document.content.entities;
    return ids.map(id => source.find(entity => entity.id === id));
}

export function editDrawingField(document, ids, request, { layoutId = null, evaluationLayoutId = layoutId, now } = {}) {
    const targets = fieldTargets(document, ids, layoutId);
    if (targets.length !== 1 || !targets[0] || targets[0].type !== 'text') return { error: 'selection' };
    const target = targets[0];
    if (request.action === 'show') return target.field ? { definition: target.field } : { error: 'selection' };
    if (layoutId ? target.locked : !canEditEntity(document.content, target)) return { error: 'locked' };
    const update = entity => {
        if (entity.id !== target.id) return entity;
        const next = { ...entity };
        if (request.action === 'remove') delete next.field;
        else next.field = request.field;
        return normalizeDrawingTextEntity(next);
    };
    let next = layoutId ? { ...document, layouts: document.layouts.map(layout => layout.id === layoutId ? { ...layout, paperEntities: layout.paperEntities.map(update) } : layout) }
        : { ...document, content: { ...document.content, entities: document.content.entities.map(update) } };
    if (request.action !== 'remove') next = refreshDrawingFields(next, { selectedIds: ids, layoutId: evaluationLayoutId, now });
    return { document: next, selectedIds: ids };
}

export function createDrawingFieldText(document, field, point, { layoutId = null, now } = {}) {
    const normalized = normalizeDrawingField(field);
    const layer = getLayer(document.content, document.content.activeLayerId);
    if (!normalized || ![point?.x, point?.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) return { error: 'syntax' };
    if (!isDrawingLayerVisible(layer) || layer.locked) return { error: 'locked' };
    const entity = normalizeDrawingTextEntity({ id: createDrawingId('field'), type: 'text', layerId: layer.id,
        x: point.x, y: point.y, width: 8, height: 1, fontSize: 0.35, text: '', field: normalized });
    const next = { ...document, content: { ...document.content, entities: [...document.content.entities, entity] } };
    return { document: refreshDrawingFields(next, { selectedIds: [entity.id], layoutId, now }), selectedIds: [entity.id] };
}

export function updateDrawingFields(document, { selectedIds = null, layoutId = null, evaluationLayoutId = layoutId, now } = {}) {
    const candidates = selectedIds ? fieldTargets(document, selectedIds, layoutId).map(entity => ({ entity, paper: Boolean(layoutId) }))
        : [...document.content.entities.map(entity => ({ entity, paper: false })), ...document.layouts.flatMap(layout => (layout.paperEntities || []).map(entity => ({ entity, paper: true })))];
    const targets = candidates.filter(({ entity }) => entity?.type === 'text' && entity.field);
    if (!targets.length || selectedIds && targets.length !== selectedIds.length) return { error: 'selection' };
    if (targets.some(({ entity, paper }) => paper ? entity.locked : !canEditEntity(document.content, entity))) return { error: 'locked' };
    const ids = targets.map(({ entity }) => entity.id);
    return { document: refreshDrawingFields(document, { selectedIds: ids, layoutId: evaluationLayoutId, now }), selectedIds: ids };
}
