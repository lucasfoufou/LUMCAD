import { refreshDrawingBlockBounds } from './drawingBlocks.js';
import { canEditEntity, createDrawingId, getLayer } from './drawingDocument.js';
import { buildDrawingEntity } from './drawingEntityFactory.js';
import { drawingAttributeDefinitions, drawingAttributeValues, normalizeDrawingAttributeTag, tokenizeDrawingAttributeInput, validateDrawingAttributeTags } from './drawingBlockAttributes.js';

export function defineDrawingAttribute(content, input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    const tag = tokens && normalizeDrawingAttributeTag(tokens[0]);
    if (!tag || tokens.length < 4) return { error: 'defineSyntax' };
    const [unused, text, rawX, rawY, ...options] = tokens;
    const x = Number(rawX); const y = Number(rawY);
    let fontSize = 0.35; let prompt = tag; let invisible = false; let constant = false;
    for (let index = 0; index < options.length; index++) {
        const token = options[index].toUpperCase();
        if (token === 'INVISIBLE') invisible = true;
        else if (token === 'CONSTANT') constant = true;
        else if (token === 'PROMPT' && index + 1 < options.length) prompt = options[++index];
        else if (token === 'HEIGHT' && index + 1 < options.length) fontSize = Number(options[++index]);
        else return { error: 'defineSyntax' };
    }
    if (![x, y, fontSize].every(Number.isFinite) || Math.abs(x) > 1e12 || Math.abs(y) > 1e12
        || fontSize < 0.01 || fontSize > 1000000 || text.length > 16384 || prompt.length > 256) return { error: 'defineSyntax' };
    const layer = getLayer(content, content.activeLayerId);
    if (!layer?.visible || layer.locked) return { error: 'layer' };
    const entity = buildDrawingEntity('text', { x, y }, { x: x + Math.max(4, text.length * fontSize * 0.7), y: y + fontSize * 1.6 }, layer.id, createDrawingId('attribute'), {
        options: { text, textMode: 'singleLine', fontSize, textStyleId: content.activeTextStyleId },
    });
    entity.attributeDefinition = { tag, prompt, invisible, constant };
    if (!validateDrawingAttributeTags([...content.entities, entity])) return { error: 'duplicate' };
    return { content: { ...content, entities: [...content.entities, entity] }, entity };
}

export function editDrawingAttribute(content, selectedIds, tagInput, value) {
    const tag = normalizeDrawingAttributeTag(tagInput);
    if (!tag || typeof value !== 'string' || value.length > 16384) return { error: 'editSyntax' };
    const selected = new Set(selectedIds);
    const references = content.entities.filter(entity => selected.has(entity.id));
    if (!references.length || references.length !== selected.size || references.some(entity => entity.type !== 'blockReference' || !canEditEntity(content, entity))) return { error: 'selection' };
    const blockMap = new Map(content.blocks.map(block => [block.id, block]));
    for (const reference of references) {
        const definition = drawingAttributeDefinitions(blockMap.get(reference.blockId)).find(entity => entity.attributeDefinition.tag === tag);
        if (!definition) return { error: 'missing' };
        if (definition.attributeDefinition.constant) return { error: 'constant' };
    }
    return { content: refreshDrawingBlockBounds({ ...content, entities: content.entities.map(entity => selected.has(entity.id)
        ? { ...entity, attributeValues: { ...drawingAttributeValues(blockMap.get(entity.blockId), entity), [tag]: value } } : entity) }) };
}

export function syncDrawingAttributes(content, selectedIds, name = '') {
    const requested = new Set(selectedIds);
    const blockMap = new Map(content.blocks.map(block => [block.id, block]));
    const named = name && content.blocks.find(block => block.id === name || block.name.toLowerCase() === name.toLowerCase());
    if (name && !named) return { error: 'missing' };
    const targetIds = named ? new Set([named.id]) : new Set(content.entities.filter(entity => requested.has(entity.id) && entity.type === 'blockReference').map(entity => entity.blockId));
    if (!targetIds.size) return { error: 'selection' };
    const sync = entity => entity.type === 'blockReference' && targetIds.has(entity.blockId)
        ? { ...entity, attributeValues: drawingAttributeValues(blockMap.get(entity.blockId), entity) } : entity;
    return { content: refreshDrawingBlockBounds({ ...content,
        entities: content.entities.map(entity => canEditEntity(content, entity) ? sync(entity) : entity),
        blocks: content.blocks.map(block => ({ ...block, entities: block.entities.map(entity => entity.locked ? entity : sync(entity)) })),
    }) };
}
