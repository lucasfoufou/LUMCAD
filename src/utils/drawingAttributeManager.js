import { refreshDrawingBlockBounds } from './drawingBlocks.js';
import { drawingAttributeDefinitions, drawingAttributeValues, normalizeDrawingAttributeTag, tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { findNamedDrawingBlock } from './drawingNamedBlocks.js';
import { saveDrawingBlockEdit } from './drawingBlockEditing.js';

export function manageDrawingAttributes(content, blockName, tagInput, operation, value) {
    const block = findNamedDrawingBlock(content, blockName);
    const tag = normalizeDrawingAttributeTag(tagInput);
    const attribute = drawingAttributeDefinitions(block).find(entity => entity.attributeDefinition.tag === tag);
    if (!block || !attribute) return { error: 'missing' };
    const action = String(operation || '').toUpperCase();
    let entities = block.entities;
    let newTag = tag;
    if (action === 'UP' || action === 'DOWN') {
        const ordered = drawingAttributeDefinitions(block);
        const index = ordered.indexOf(attribute);
        const other = ordered[index + (action === 'UP' ? -1 : 1)];
        if (!other) return { content, changed: false };
        entities = entities.map(entity => entity === attribute ? other : entity === other ? attribute : entity);
    } else if (action === 'DELETE') {
        entities = entities.filter(entity => entity !== attribute);
    } else {
        const patch = {};
        let text = attribute.text;
        if (action === 'TAG') {
            newTag = normalizeDrawingAttributeTag(value);
            if (!newTag) return { error: 'managerSyntax' };
            patch.tag = newTag;
        } else if (action === 'PROMPT' && typeof value === 'string' && value.length <= 256) patch.prompt = value;
        else if (action === 'DEFAULT' && typeof value === 'string' && value.length <= 16384) text = value;
        else if (['CONSTANT', 'INVISIBLE'].includes(action) && ['ON', 'OFF'].includes(String(value).toUpperCase())) patch[action.toLowerCase()] = String(value).toUpperCase() === 'ON';
        else return { error: 'managerSyntax' };
        entities = entities.map(entity => entity === attribute ? { ...entity, text,
            ...(text !== entity.text ? { runs: [{ text, marks: entity.runs?.[0]?.marks || {} }] } : {}),
            attributeDefinition: { ...entity.attributeDefinition, ...patch } } : entity);
    }
    const saved = saveDrawingBlockEdit(content, block.id, { ...content, entities });
    if (saved.error) return { error: saved.error === 'attributeTags' ? 'duplicate' : 'managerDependency' };
    const definition = saved.content.blocks.find(candidate => candidate.id === block.id);
    const migrate = entity => {
        if (entity.type !== 'blockReference' || entity.blockId !== block.id) return entity;
        const values = drawingAttributeValues(block, entity);
        if (newTag !== tag) { values[newTag] = values[tag]; delete values[tag]; }
        return { ...entity, attributeValues: drawingAttributeValues(definition, { attributeValues: values }) };
    };
    // Tag migration is structural: retain every insertion's values, including
    // references on locked layers and references nested inside other definitions.
    return { content: refreshDrawingBlockBounds({ ...saved.content, entities: saved.content.entities.map(migrate),
        blocks: saved.content.blocks.map(candidate => ({ ...candidate, entities: candidate.entities.map(migrate) })) }), changed: true };
}

export function parseDrawingAttributeManagerInput(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens || ![0, 1, 3, 4].includes(tokens.length)) return null;
    if (tokens.length <= 1) return { blockName: tokens[0] || '', open: true };
    const [blockName, tag, operation, value] = tokens;
    if (!['UP', 'DOWN', 'DELETE'].includes(operation.toUpperCase()) && tokens.length !== 4) return null;
    if (['UP', 'DOWN', 'DELETE'].includes(operation.toUpperCase()) && tokens.length !== 3) return null;
    return { blockName, tag, operation, value };
}
