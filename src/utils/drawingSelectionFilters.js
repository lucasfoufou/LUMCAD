import { getEntityBounds } from './drawingGeometry.js';
import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices, transformDrawingEntityAffine, resolveDrawingBlockChild } from './drawingBlocks.js';
import { drawingBlockInstanceEntities } from './drawingDynamicBlocks.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { canSelectEntity, getEntityAppearance } from './drawingDocument.js';

export const DRAWING_FILTER_FIELDS = ['TYPE', 'LAYER', 'COLOR', 'LINETYPE', 'WEIGHT', 'TRANSPARENCY', 'BLOCK', 'LOCKED'];
const OPERATORS = ['=', '!=', '>', '<', '>=', '<='];
const NUMERIC = new Set(['WEIGHT', 'TRANSPARENCY']);

export function parseDrawingSelectionFilter(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens?.length) return null;
    const criteria = [];
    for (let i = 0; i < tokens.length;) {
        const field = tokens[i++].toUpperCase();
        const operator = OPERATORS.includes(tokens[i]) ? tokens[i++] : '=';
        const value = tokens[i++];
        if (!DRAWING_FILTER_FIELDS.includes(field) || value === undefined || value.length > 256
            || !NUMERIC.has(field) && !['=', '!='].includes(operator)
            || NUMERIC.has(field) && !Number.isFinite(Number(value))) return null;
        criteria.push({ field, operator, value });
        if (criteria.length > 16) return null;
    }
    return criteria;
}

export function normalizeDrawingSelectionFilters(input) {
    const ids = new Set(); const names = new Set();
    return (Array.isArray(input) ? input : []).slice(0, 128).flatMap(filter => {
        const name = typeof filter?.name === 'string' ? filter.name.trim() : '';
        if (!name || name.length > 128 || typeof filter.id !== 'string' || !filter.id || ids.has(filter.id) || names.has(name.toLowerCase())
            || !Array.isArray(filter.criteria) || !filter.criteria.length || filter.criteria.length > 16) return [];
        const criteria = filter.criteria;
        if (criteria.some(item => !item || !DRAWING_FILTER_FIELDS.includes(item.field) || !OPERATORS.includes(item.operator)
            || typeof item.value !== 'string' || item.value.length > 256
            || NUMERIC.has(item.field) && !Number.isFinite(Number(item.value))
            || !NUMERIC.has(item.field) && !['=', '!='].includes(item.operator))) return [];
        ids.add(filter.id); names.add(name.toLowerCase());
        return [{ id: filter.id, name, criteria: criteria.map(({ field, operator, value }) => ({ field, operator, value })) }];
    });
}

function propertyValue(content, entity, field) {
    const appearance = getEntityAppearance(content, entity);
    switch (field) {
        case 'TYPE': return entity.type;
        case 'LAYER': return content.layers.find(layer => layer.id === entity.layerId)?.name || entity.layerId;
        case 'COLOR': return appearance.color;
        case 'LINETYPE': return appearance.lineType;
        case 'WEIGHT': return appearance.lineWeight;
        case 'TRANSPARENCY': return appearance.transparency;
        case 'BLOCK': return content.blocks?.find(block => block.id === entity.blockId)?.name || '';
        case 'LOCKED': return entity.locked || content.layers.find(layer => layer.id === entity.layerId)?.locked ? 'YES' : 'NO';
        default: return null;
    }
}

export function filterDrawingSelection(content, criteria) {
    return content.entities.filter(entity => canSelectEntity(content, entity) && criteria.every(({ field, operator, value }) => {
        let actual = propertyValue(content, entity, field);
        if (field === 'LAYER' && entity.layerId === value) actual = value;
        if (field === 'BLOCK' && entity.blockId === value) actual = value;
        const left = NUMERIC.has(field) ? Number(actual) : String(actual).toLowerCase();
        const right = NUMERIC.has(field) ? Number(value) : value.toLowerCase();
        return { '=': left === right, '!=': left !== right, '>': left > right, '<': left < right, '>=': left >= right, '<=': left <= right }[operator];
    })).map(entity => entity.id);
}

export function selectSimilarDrawingEntities(content, selectedIds, fields = ['TYPE', 'LAYER', 'BLOCK']) {
    if (!fields.length || fields.some(field => !DRAWING_FILTER_FIELDS.includes(field))) return null;
    const selectedIdSet = new Set(selectedIds);
    const selected = content.entities.filter(entity => selectedIdSet.has(entity.id) && canSelectEntity(content, entity));
    if (!selected.length) return null;
    const signatures = new Set(selected.map(entity => JSON.stringify(fields.map(field => propertyValue(content, entity, field)))));
    return content.entities.filter(entity => canSelectEntity(content, entity)
        && signatures.has(JSON.stringify(fields.map(field => propertyValue(content, entity, field))))).map(entity => entity.id);
}

export function countDrawingEntities(content, ids, { nestedBlocks = false } = {}) {
    const selected = new Set(ids);
    const rows = new Map(); const rootIds = new Set(); const occurrences = [];
    const blocks = new Map((content.blocks || []).map(block => [block.id, block]));
    let remaining = 10000;
    const visit = (entity, rootId, visiting, matrix, path) => {
        if (--remaining < 0) return false;
        if (!entity || !canSelectEntity(content, entity)) return true;
        const block = entity.type === 'blockReference' ? blocks.get(entity.blockId) : null;
        if (!nestedBlocks || block) {
            const layer = content.layers.find(item => item.id === entity.layerId)?.name || entity.layerId;
            const key = JSON.stringify([entity.type, layer, block?.name || '']);
            if (!rows.has(key)) rows.set(key, { type: entity.type, layer, block: block?.name || '', count: 0 });
            rows.get(key).count += 1; rootIds.add(rootId);
            const world = path.length ? transformDrawingEntityAffine(entity, matrix, { textStyles: content.textStyles }) : entity;
            const bounds = getEntityBounds(world);
            occurrences.push({ rootId, path: [...path, entity.id], type: entity.type, layer, block: block?.name || '',
                bounds: bounds && Object.values(bounds).every(Number.isFinite) ? bounds : null });
        }
        if (!nestedBlocks || !block) return true;
        if (visiting.has(block.id) || visiting.size >= 32) return false;
        const next = new Set(visiting); next.add(block.id);
        return drawingBlockInstanceEntities(block, entity).every(child => visit(resolveDrawingBlockChild(child, entity, content.settings?.attributeDisplay), rootId, next, multiplyAffineMatrices(matrix, entity.transform), [...path, entity.id]));
    };
    for (const entity of content.entities) {
        if (selected.has(entity.id) && canSelectEntity(content, entity) && !visit(entity, entity.id, new Set(), IDENTITY_AFFINE_MATRIX, [])) return null;
    }
    const values = [...rows.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { mode: 'countObjects', occurrences, rows: values, total: values.reduce((sum, row) => sum + row.count, 0), selectedIds: [...rootIds] };
}
