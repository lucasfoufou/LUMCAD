import { drawingAttributeValues } from './drawingBlockAttributes.js';
import { drawingBlockInstanceEntities } from './drawingDynamicBlocks.js';
import { normalizeDrawingBlockReference, transformDrawingEntityAffine } from './drawingBlocks.js';
import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices } from './drawingAffine.js';
import { measureDrawingEntity } from './drawingInquiry.js';

import { DRAWING_DATA_FIELDS, isDrawingDataField } from './drawingDataDefinitions.js';
export { DRAWING_DATA_FIELDS } from './drawingDataDefinitions.js';
const MAX_RECORDS = 10000;
const MAX_BYTES = 16 * 1024 * 1024;
const finiteOrNull = value => Number.isFinite(value) ? value : null;

/** Native model objects, optionally including each evaluated nested block occurrence.
 * Missing measurements stay null: they must never masquerade as zero quantities.
 */
export function extractDrawingData(content, { selectedIds = null, nested = false, excludeTables = false } = {}) {
    const selected = selectedIds === null ? null : new Set(selectedIds);
    const blocks = new Map((content.blocks || []).map(block => [block.id, block]));
    const layers = new Map((content.layers || []).map(layer => [layer.id, layer.name]));
    const records = [];
    let bytes = 0;
    const visit = (entity, matrix, path, ancestors, inheritedLayer) => {
        if (excludeTables && entity.table) return;
        if (records.length >= MAX_RECORDS || ancestors.size > 32) throw new Error('dataExtractionLimit');
        const instancePath = [...path, entity.id];
        const layerId = entity.layerId === 'geometry' && inheritedLayer ? inheritedLayer : entity.layerId;
        const block = entity.type === 'blockReference' ? blocks.get(entity.blockId) : null;
        if (entity.type === 'blockReference' && (!block || ancestors.has(block.id))) throw new Error('dataExtractionDependency');
        const world = path.length ? transformDrawingEntityAffine(entity, matrix, { textStyles: content.textStyles }) : entity;
        // Insertions describe an assembly; summing its children as well would double-count geometry.
        const measure = block ? null : measureDrawingEntity(world);
        const record = { id: entity.id, rootId: instancePath[0], path: instancePath,
            type: entity.type, layerId, layer: layers.get(layerId) ?? layerId ?? '',
            blockId: block?.id ?? '', block: block?.name ?? '',
            length: finiteOrNull(measure?.perimeter), area: finiteOrNull(measure?.area),
            attributes: block ? drawingAttributeValues(block, entity) : {} };
        bytes += new TextEncoder().encode(JSON.stringify(record)).length;
        if (bytes > MAX_BYTES) throw new Error('dataExtractionLimit');
        records.push(record);
        if (!nested || !block) return;
        const nextMatrix = multiplyAffineMatrices(matrix, normalizeDrawingBlockReference(entity).transform);
        if (!Object.values(nextMatrix).every(Number.isFinite)) throw new Error('dataExtractionLimit');
        const nextAncestors = new Set([...ancestors, block.id]);
        for (const child of drawingBlockInstanceEntities(block, entity)) visit(child, nextMatrix, instancePath, nextAncestors, layerId);
    };
    for (const entity of content.entities || []) {
        if (!selected || selected.has(entity.id)) visit(entity, IDENTITY_AFFINE_MATRIX, [], new Set(), null);
    }
    return records;
}

export function drawingDataSchema(records) {
    const tags = [...new Set(records.flatMap(record => Object.keys(record.attributes || {})))].sort();
    return [...Object.entries(DRAWING_DATA_FIELDS).map(([key, type]) => ({ key, type })),
        ...tags.map(tag => ({ key: `attribute:${tag}`, type: 'string' }))];
}

export function drawingDataValue(record, field) {
    return field.startsWith('attribute:')
        ? (Object.hasOwn(record.attributes || {}, field.slice(10)) ? record.attributes[field.slice(10)] : null)
        : (Object.hasOwn(DRAWING_DATA_FIELDS, field) ? record[field] ?? null : null);
}

/** Stable first-occurrence order and typed grouping prevent delimiter/name collisions. */
export function aggregateDrawingData(records, { groupBy = ['type', 'layer', 'block'], sums = ['length', 'area'] } = {}) {
    const schema = new Map(drawingDataSchema(records).map(field => [field.key, field.type]));
    if (!Array.isArray(groupBy) || !Array.isArray(sums) || groupBy.length > 16 || sums.length > 16
        || new Set(groupBy).size !== groupBy.length || new Set(sums).size !== sums.length
        || groupBy.some(key => !isDrawingDataField(key)) || sums.some(key => schema.get(key) !== 'number')) throw new Error('dataExtractionFields');
    const groups = new Map();
    for (const record of records) {
        const values = groupBy.map(key => drawingDataValue(record, key));
        const key = JSON.stringify(values);
        let row = groups.get(key);
        if (!row) {
            if (groups.size >= MAX_RECORDS) throw new Error('dataExtractionLimit');
            row = { values, count: 0, sums: Object.fromEntries(sums.map(field => [field, null])),
                measured: Object.fromEntries(sums.map(field => [field, 0])), roots: [] };
            groups.set(key, row);
        }
        row.count++;
        if (!row.roots.includes(record.rootId)) row.roots.push(record.rootId);
        for (const field of sums) {
            const value = drawingDataValue(record, field);
            if (!Number.isFinite(value)) continue;
            const sum = (row.sums[field] ?? 0) + value;
            if (!Number.isFinite(sum)) throw new Error('dataExtractionLimit');
            row.sums[field] = sum;
            row.measured[field]++;
        }
    }
    return { version: 1, units: 'm', groupBy: [...groupBy], sumFields: [...sums], rows: [...groups.values()] };
}
