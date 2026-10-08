import { canEditEntity } from './drawingDocument.js';
import { refreshDrawingBlockBounds } from './drawingBlocks.js';
import { normalizeDrawingDynamicBlock, evaluateDrawingDynamicBlock } from './drawingDynamicBlocks.js';
import { resolveDrawingBlockParameterValues } from './drawingBlockParameters.js';

/** Validate every selected instance before committing any parameter changes. */
export function editDrawingDynamicBlockInstances(content, ids, patch = {}, { reset = false } = {}) {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length
        || !patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'selection' };
    const entities = new Map(content.entities.map(entity => [entity.id, entity]));
    const blocks = new Map(content.blocks.map(block => [block.id, block]));
    const replacements = new Map();
    for (const id of ids) {
        const entity = entities.get(id);
        const definition = entity?.type === 'blockReference' && blocks.get(entity.blockId);
        const dynamic = definition?.dynamic && normalizeDrawingDynamicBlock(definition.dynamic, definition.entities);
        if (!entity || !canEditEntity(content, entity) || !dynamic || entity.externalReference || entity.pdfUnderlay || entity.dwfUnderlay || entity.dgnUnderlay) return { error: 'selection' };
        let values = {};
        if (!reset) {
            values = resolveDrawingBlockParameterValues(dynamic.parameters, entity.dynamicValues || {}, { recover: true });
            if (!values) return { error: 'values' };
            const parameters = new Map(dynamic.parameters.map(parameter => [parameter.name.toLowerCase(), parameter.name]));
            const driven = new Set((dynamic.lookups || []).flatMap(table => Object.keys(table.rows[0].values)));
            const patched = new Set();
            for (const [key, value] of Object.entries(patch)) {
                const name = parameters.get(key.toLowerCase());
                if (!name || patched.has(name)) return { error: 'values' };
                if (driven.has(name)) return { error: 'driven' };
                patched.add(name); values[name] = value;
            }
        }
        const evaluated = evaluateDrawingDynamicBlock(definition, values);
        if (evaluated.error) return { error: evaluated.error };
        const { dynamicValues, ...source } = entity;
        replacements.set(id, reset ? source : { ...source, dynamicValues: evaluated.values });
    }
    if ([...replacements].every(([id, entity]) => JSON.stringify(entity) === JSON.stringify(entities.get(id)))) {
        return { changed: false, content, selectedIds: ids };
    }
    return { changed: true, content: refreshDrawingBlockBounds({ ...content,
        entities: content.entities.map(entity => replacements.get(entity.id) || entity) }), selectedIds: ids };
}
