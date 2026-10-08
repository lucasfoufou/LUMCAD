import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference } from './drawingBlocks.js';

/** Preserve cell hierarchy as reusable definitions alongside the editable imported geometry. */
export function drawingDgnCellBlocks(existing, cells, entities, matrix) {
    if (existing.length + cells.length > 1024) throw new Error('dgnLimit');
    const byId = new Map(entities.map(entity => [entity.id, entity]));
    const names = new Set(existing.map(block => block.name.toLowerCase()));
    const children = new Map(); const results = new Map();
    let count = existing.reduce((sum, block) => sum + block.entities.length, 0);
    for (const cell of cells) {
        if (!children.has(cell.parent)) children.set(cell.parent, []);
        children.get(cell.parent).push(cell);
    }
    for (const cell of [...cells].reverse()) {
        const nested = children.get(cell) || [];
        const replacements = new Map();
        for (const child of nested) {
            const result = results.get(child);
            const reference = createAnonymousDrawingBlockReference(result.definition, {
                insertionPoint: result.origin, layerId: child.layerId,
            });
            child.entityIds.forEach(id => replacements.set(id, reference));
        }
        const members = [...new Set(cell.entityIds.map(id => replacements.get(id) || byId.get(id)))];
        count += members.length;
        if (count > 100000) throw new Error('dgnLimit');
        let name = cell.name; let suffix = 2;
        while (names.has(name.toLowerCase())) name = `${cell.name} (${suffix++})`;
        names.add(name.toLowerCase());
        const origin = { x: matrix.a * cell.origin.x + matrix.c * cell.origin.y + matrix.e,
            y: matrix.b * cell.origin.x + matrix.d * cell.origin.y + matrix.f };
        if (!Object.values(origin).every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) throw new Error('dgnPlacement');
        const definition = createAnonymousDrawingBlock(members, { name, basePoint: origin });
        if (!definition.bounds || !Object.values(definition.bounds).every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) throw new Error('dgnPlacement');
        results.set(cell, { definition, origin });
    }
    const replacements = new Map();
    for (const cell of cells.filter(cell => !cell.parent)) {
        const result = results.get(cell);
        const reference = createAnonymousDrawingBlockReference(result.definition, {
            insertionPoint: result.origin, layerId: cell.layerId,
        });
        cell.entityIds.forEach(id => replacements.set(id, reference));
    }
    return { blocks: [...existing, ...cells.map(cell => results.get(cell).definition)], replacements };
}
