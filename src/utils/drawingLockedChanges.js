import { drawingComparisonValue } from './drawingComparison.js';
import { canEditEntity } from './drawingDocument.js';

const same = (a, b) => JSON.stringify(drawingComparisonValue(a)) === JSON.stringify(drawingComparisonValue(b));

/** Catalog edits must not bypass locks through shared or nested block definitions. */
export function drawingChangesAffectLockedEntities(before, after) {
    const oldBlocks = new Map((before.content.blocks || []).map(block => [block.id, block]));
    const newBlocks = new Map((after.content.blocks || []).map(block => [block.id, block]));
    const changed = new Set([...oldBlocks].filter(([id, block]) => !same(block, newBlocks.get(id))).map(([id]) => id));
    const memo = new Map(); let visits = 0;
    const limit = depth => { if (++visits > 100000 || depth > 32) throw new Error('comparisonLimit'); };
    const affectedBlock = (id, ancestors = new Set()) => {
        limit(ancestors.size);
        if (changed.has(id)) return true;
        if (memo.has(id)) return memo.get(id);
        if (ancestors.has(id)) throw new Error('comparisonInvalid');
        const block = oldBlocks.get(id);
        const nextAncestors = new Set([...ancestors, id]);
        const referencesChangedBlock = entity => {
            limit(nextAncestors.size);
            return entity.type === 'blockReference' && affectedBlock(entity.blockId, nextAncestors)
                || (entity.parts || []).some(referencesChangedBlock);
        };
        const result = Boolean(block?.entities.some(referencesChangedBlock));
        memo.set(id, result);
        return result;
    };
    const checkCollection = (oldEntities = [], newEntities = [], depth = 0) => {
        const byId = new Map(newEntities.filter(entity => entity.id).map(entity => [entity.id, entity]));
        return oldEntities.some((entity, index) => {
            limit(depth);
            const next = entity.id ? byId.get(entity.id) : newEntities[index];
            const changedEntity = !same(entity, next) || entity.type === 'blockReference' && affectedBlock(entity.blockId);
            if (changedEntity && !canEditEntity(before.content, entity)) return true;
            return checkCollection(entity.parts, next?.parts, depth + 1);
        });
    };
    if (checkCollection(before.content.entities, after.content.entities)) return true;
    for (const [id, block] of oldBlocks) if (checkCollection(block.entities, newBlocks.get(id)?.entities)) return true;
    const layouts = new Map((after.layouts || []).map(layout => [layout.id, layout]));
    return (before.layouts || []).some(layout => checkCollection(layout.paperEntities, layouts.get(layout.id)?.paperEntities));
}
