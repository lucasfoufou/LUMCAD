// Share only static, viewport-independent geometry. Complex/dynamic blocks,
// clipping, attributes and external references retain the normal renderer.
const SYMBOL_TYPES = new Set(['line', 'rectangle', 'polygon', 'arc', 'ellipse', 'spline']);

export function drawingBlockSymbolKey(reference, block) {
    if (reference.type !== 'blockReference' || !block || block.dynamic || reference.externalReference
        || reference.clip || reference.blockClip || !block.entities.length
        || !block.entities.every(entity => SYMBOL_TYPES.has(entity.type) && !entity.attributeDefinition)) return null;
    return JSON.stringify([block.id, reference.layerId, reference.plotStyleName]);
}

export function createDrawingBlockSymbols(entities, blocks, prefix) {
    const definitions = new Map();
    const references = new Map();
    for (const reference of entities) {
        const block = blocks.get(reference.blockId);
        const key = drawingBlockSymbolKey(reference, block);
        if (key === null) continue;
        if (!definitions.has(key)) definitions.set(key, {
            id: `${prefix}-${definitions.size}`, block,
            reference: { ...reference, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
        });
        references.set(reference.id, definitions.get(key).id);
    }
    return { definitions: [...definitions.values()], references };
}
