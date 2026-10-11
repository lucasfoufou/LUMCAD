import { materializeDrawingBlockReference } from './drawingBlocks.js';
import { getDimensionBreakSourceCurves } from './drawingDimensions.js';

const sourceMapCache = [];
const BLOCK_CURVE_CACHE = Symbol('dimensionBlockCurveCache');

/**
 * Shared source map of a drawing content, so the canvas and selection index
 * build one map per edit instead of one each. The map is read-only. After an
 * edit it is derived from the previous map when only a few entities changed.
 */
export function getDrawingDimensionSourceMap(content) {
    const key = [content.entities, content.blocks, content.layers, content.textStyles];
    const hit = sourceMapCache.find(entry => entry.key.every((part, index) => part === key[index]));
    if (hit) return hit.map;
    const latest = sourceMapCache[0];
    const reusable = latest && key.slice(1).every((part, index) => part === latest.key[index + 1]);
    const map = createDimensionSourceMap(content.entities, content.blocks, content,
        reusable ? { previousMap: latest.map, previousEntities: latest.key[0] } : undefined);
    sourceMapCache.unshift({ key, map });
    sourceMapCache.length = Math.min(sourceMapCache.length, 4);
    return map;
}

/** Add lazy block-obstacle resolution while preserving the normal entity-map API. */
export function createDimensionSourceMap(entities, blocks = [], { layers = [], textStyles = [] } = {}, { previousMap = null, previousEntities = null } = {}) {
    const definitions = blocks instanceof Map ? [...blocks.values()] : blocks;
    const definitionMap = new Map(definitions.map(definition => [definition.id, definition]));
    const truncated = () => Object.assign([], { truncated: true });
    const layerMap = new Map(layers.map(layer => [layer.id, layer]));
    // A derived map has the same blocks, layers and text styles, so resolved
    // block curves (keyed by reference object) remain valid.
    const derived = previousMap && previousEntities && deriveEntityMap(previousMap, previousEntities, entities);
    const cache = (derived && previousMap[BLOCK_CURVE_CACHE]) || new WeakMap();
    const map = derived || new Map(entities.map(entity => [entity.id, entity]));
    const resolveBlock = (reference, visited = new Set(), depth = 0, budget = { remaining: 10000 }) => {
        if (visited.has(reference.blockId)) return [];
        if (depth >= 16) return truncated();
        if (!depth && cache.has(reference)) return cache.get(reference);
        const count = definitionMap.get(reference.blockId)?.entities?.length || 0;
        if (count > budget.remaining) return truncated();
        const nextVisited = new Set(visited); nextVisited.add(reference.blockId);
        const children = materializeDrawingBlockReference(reference, definitions, { textStyles });
        if (children.length > budget.remaining) return truncated();
        budget.remaining -= children.length;
        const localMap = new Map(children.map(child => [child.id, child]));
        const curves = [];
        for (const child of children) {
            if ((layerMap.get(child.layerId)?.visible === false || layerMap.get(child.layerId)?.frozen)) continue;
            const parts = child.type === 'blockReference'
                ? resolveBlock(child, nextVisited, depth + 1, budget)
                : getDimensionBreakSourceCurves(child, localMap);
            if (parts.truncated) return truncated();
            curves.push(...parts.slice(0, 10001 - curves.length));
            if (curves.length > 10000) break;
        }
        if (!depth) cache.set(reference, curves);
        return curves;
    };
    Object.defineProperty(map, 'dimensionBlockCurves', { value: reference => resolveBlock(reference) });
    Object.defineProperty(map, BLOCK_CURVE_CACHE, { value: cache });
    return map;
}

// Copies the previous ID map and applies the replaced, removed and appended
// entities. Returns null (full rebuild) for large edits or ambiguous IDs.
function deriveEntityMap(previousMap, before, after) {
    const limit = Math.max(64, after.length >> 6);
    if (Math.abs(after.length - before.length) > limit) return null;
    const removed = [];
    const added = [];
    const common = Math.min(before.length, after.length);
    for (let index = 0; index < common; index += 1) {
        if (before[index] === after[index]) continue;
        removed.push(before[index]);
        added.push(after[index]);
        if (added.length > limit) return null;
    }
    for (let index = common; index < before.length; index += 1) removed.push(before[index]);
    for (let index = common; index < after.length; index += 1) added.push(after[index]);
    const map = new Map(previousMap);
    for (const entity of removed) {
        if (map.get(entity?.id) !== entity) return null;
        map.delete(entity.id);
    }
    for (const entity of added) {
        if (map.has(entity?.id)) return null;
        map.set(entity.id, entity);
    }
    return map;
}
