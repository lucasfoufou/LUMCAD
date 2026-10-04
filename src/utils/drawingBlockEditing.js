import { validateDrawingAttributeTags } from './drawingBlockAttributes.js';
import { normalizeDrawingContent } from './drawingDocument.js';
import { refreshDrawingBlockBounds } from './drawingBlocks.js';
import { getDrawingEntityDependencyIds } from './drawingDimensions.js';
import { findNamedDrawingBlock } from './drawingNamedBlocks.js';

export function createDrawingBlockEditDraft(content, nameOrId) {
    const definition = findNamedDrawingBlock(content, nameOrId);
    if (!definition) return { error: 'missing' };
    const draft = normalizeDrawingContent(JSON.parse(JSON.stringify({ ...content, entities: definition.entities })));
    return { blockId: definition.id, name: definition.name, content: draft };
}

export function saveDrawingBlockEdit(root, blockId, draft) {
    const original = root.blocks.find(block => block.id === blockId);
    if (!original) return { error: 'missing' };
    if (!Array.isArray(draft?.entities) || !Array.isArray(draft?.blocks)) return { error: 'dependency' };
    const blocks = draft.blocks.map(block => block.id === blockId ? { ...original, entities: draft.entities } : block);
    if (!blocks.some(block => block.id === blockId)) blocks.push({ ...original, entities: draft.entities });
    if (blocks.length > 1024 || blocks.reduce((total, block) => total + block.entities.length, 0) > 100000) return { error: 'limit' };
    const error = validateDrawingBlockGraph(blocks);
    if (error) return { error };
    // A layer used only by model-space objects cannot be lost from an isolated editor.
    const layers = [...draft.layers, ...root.layers.filter(layer => !draft.layers.some(candidate => candidate.id === layer.id))];
    const content = refreshDrawingBlockBounds(normalizeDrawingContent({
        ...root, blocks, layers, textStyles: draft.textStyles,
    }));
    return { content, changed: JSON.stringify(content) !== JSON.stringify(root) };
}

export function validateDrawingBlockGraph(blocks) {
    const blockMap = new Map(blocks.map(block => [block.id, block]));
    const visited = new Set();
    const visiting = new Set();
    const visit = id => {
        if (visiting.has(id)) return 'cycle';
        if (visited.has(id)) return null;
        const block = blockMap.get(id);
        if (!block) return 'dependency';
        visiting.add(id);
        if (!validateDrawingAttributeTags(block.entities)) return 'attributeTags';
        const entityIds = new Set(block.entities.map(entity => entity.id));
        if (entityIds.size !== block.entities.length) return 'dependency';
        for (const entity of block.entities) {
            if (getDrawingEntityDependencyIds(entity).some(sourceId => !entityIds.has(sourceId))) return 'dependency';
            if (entity.type === 'blockReference') {
                const error = visit(entity.blockId);
                if (error) return error;
            }
        }
        visiting.delete(id);
        visited.add(id);
        return null;
    };
    // Validate the whole draft graph: the session may have created nested definitions.
    for (const block of blocks) {
        const error = visit(block.id);
        if (error) return error;
    }
    return null;
}
