import { drawingReportCsvCell as csvCell } from './drawingReportExport.js';
import { drawingAttributeDefinitions, drawingAttributeValues } from './drawingBlockAttributes.js';
import { drawingBlockInstanceEntities } from './drawingDynamicBlocks.js';
import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices } from './drawingAffine.js';
import { normalizeDrawingBlockReference } from './drawingBlocks.js';

const MAX_VISITS = 100000;
const MAX_OUTPUT_LENGTH = 64 * 1024 * 1024;

/** One record per attributed insertion, including repeated nested instances. */
export function extractDrawingAttributes(content, { selectedIds = null } = {}) {
    const blocks = new Map((content.blocks || []).map(block => [block.id, block]));
    const selected = selectedIds === null ? null : new Set(selectedIds);
    const records = [];
    let visits = 0;
    let size = 0;
    const visit = (entity, parentMatrix, path, ancestors, inheritedLayer) => {
        if (++visits > MAX_VISITS) throw new Error('attributeExtractionLimit');
        if (entity.type !== 'blockReference') return;
        const block = blocks.get(entity.blockId);
        if (!block || ancestors.has(block.id)) throw new Error('attributeExtractionDependency');
        if (ancestors.size >= 32) throw new Error('attributeExtractionLimit');
        const matrix = multiplyAffineMatrices(parentMatrix, normalizeDrawingBlockReference(entity).transform);
        if (!Object.values(matrix).every(Number.isFinite)) throw new Error('attributeExtractionLimit');
        const instancePath = [...path, entity.id];
        const layerId = entity.layerId === 'geometry' && inheritedLayer ? inheritedLayer : entity.layerId;
        if (drawingAttributeDefinitions(block).length) {
            const record = { path: instancePath, blockId: block.id, blockName: block.name, layerId,
                x: matrix.e, y: matrix.f, attributes: drawingAttributeValues(block, entity) };
            size += JSON.stringify(record).length;
            if (size > MAX_OUTPUT_LENGTH) throw new Error('attributeExtractionLimit');
            records.push(record);
        }
        const nextAncestors = new Set([...ancestors, block.id]);
        for (const child of drawingBlockInstanceEntities(block, entity)) visit(child, matrix, instancePath, nextAncestors, layerId);
    };
    for (const entity of content.entities) {
        if (!selected || selected.has(entity.id)) visit(entity, IDENTITY_AFFINE_MATRIX, [], new Set(), null);
    }
    return records;
}

export function serializeDrawingAttributeExtraction(records, format = 'csv') {
    if (format === 'json') {
        const text = JSON.stringify({ version: 1, units: 'm', records }, null, 2);
        if (new TextEncoder().encode(text).length > MAX_OUTPUT_LENGTH) throw new Error('attributeExtractionLimit');
        return text;
    }
    if (format !== 'csv') throw new Error('attributeExtractionFormat');
    const tags = [...new Set(records.flatMap(record => Object.keys(record.attributes)))].sort();
    const header = ['Path', 'Block ID', 'Block name', 'Layer ID', 'X (m)', 'Y (m)', ...tags.map(tag => `Attribute:${tag}`)];
    const rows = [header.map(csvCell).join(',')];
    let size = rows[0].length;
    for (const record of records) {
        const cells = [JSON.stringify(record.path), record.blockId, record.blockName, record.layerId];
        // Coordinates are trusted finite numbers; retain negative numeric cells.
        const row = [...cells.map(csvCell), String(record.x), String(record.y), ...tags.map(tag => csvCell(record.attributes[tag]))].join(',');
        size += row.length + 2;
        if (size > MAX_OUTPUT_LENGTH) throw new Error('attributeExtractionLimit');
        rows.push(row);
    }
    const text = `\uFEFF${rows.join('\r\n')}\r\n`;
    if (new TextEncoder().encode(text).length > MAX_OUTPUT_LENGTH) throw new Error('attributeExtractionLimit');
    return text;
}
