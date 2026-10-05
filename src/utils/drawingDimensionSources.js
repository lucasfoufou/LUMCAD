import { materializeDrawingBlockReference } from './drawingBlocks.js';
import { getDimensionBreakSourceCurves } from './drawingDimensions.js';

/** Add lazy block-obstacle resolution while preserving the normal entity-map API. */
export function createDimensionSourceMap(entities, blocks = [], { layers = [], textStyles = [] } = {}) {
    const definitions = blocks instanceof Map ? [...blocks.values()] : blocks;
    const definitionMap = new Map(definitions.map(definition => [definition.id, definition]));
    const truncated = () => Object.assign([], { truncated: true });
    const layerMap = new Map(layers.map(layer => [layer.id, layer]));
    const cache = new WeakMap();
    const map = new Map(entities.map(entity => [entity.id, entity]));
    const resolveBlock = (reference, visited = new Set(), depth = 0, budget = { remaining: 10000 }) => {
        if (visited.has(reference.blockId)) return [];
        if (depth >= 16) return truncated();
        if (!depth && cache.has(reference)) return cache.get(reference);
        const count = definitionMap.get(reference.blockId)?.entities?.length || 0;
        if (count > budget.remaining) return truncated();
        budget.remaining -= count;
        const nextVisited = new Set(visited); nextVisited.add(reference.blockId);
        const children = materializeDrawingBlockReference(reference, definitions, { textStyles });
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
    return map;
}
