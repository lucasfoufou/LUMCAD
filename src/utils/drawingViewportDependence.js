import { inverseAffineViewBox } from './drawingAffine.js';
import { isConstructionLine } from './drawingConstructionLines.js';
import { getCircleViewportGeometry } from './drawingCurves.js';
import { drawingBlockInstanceEntities } from './drawingDynamicBlocks.js';
import { isDrawingDimensionEntity } from './drawingDimensions.js';
import { getEntityBounds } from './drawingGeometry.js';

const MAX_BLOCK_DEPTH = 16;
const blockDependence = new WeakMap();
const renderBounds = new WeakMap();

/**
 * Describes how an entity's rendered output depends on the viewport. Two
 * viewBoxes yielding the same key produce identical SVG for the entity, so the
 * scene can skip re-rendering it while panning or zooming. Entities whose
 * geometry never depends on the viewport return an empty key.
 */
export function drawingEntityViewportKey(entity, viewBox, blockMap = new Map(), depth = 0) {
    if (!entity || typeof entity !== 'object' || depth > MAX_BLOCK_DEPTH) return '';
    if (isConstructionLine(entity)) return `x:${viewBoxKey(viewBox)}`;
    if (entity.type === 'circle') return circleKey(entity, viewBox);
    if (Array.isArray(entity.parts)) return partsKey(entity.parts, viewBox);
    if (entity.type !== 'blockReference') return '';
    const block = blockMap.get(entity.blockId);
    if (!block || !blockDependsOnViewport(block, blockMap)) return '';
    const local = inverseAffineViewBox(viewBox, entity.transform);
    return drawingBlockInstanceEntities(block, entity)
        .map(child => drawingEntityViewportKey(child, local, blockMap, depth + 1))
        .join('|');
}

export function drawingEntityViewportChanged(entity, previousViewBox, nextViewBox, blockMap) {
    if (previousViewBox === nextViewBox) return false;
    return drawingEntityViewportKey(entity, previousViewBox, blockMap) !== drawingEntityViewportKey(entity, nextViewBox, blockMap);
}

function blockDependsOnViewport(block, blockMap, visiting = new Set()) {
    if (blockDependence.has(block)) return blockDependence.get(block);
    if (visiting.has(block.id) || visiting.size > MAX_BLOCK_DEPTH) return true;
    visiting.add(block.id);
    const dependent = (block.entities || []).some(child => entityTypeDependsOnViewport(child, blockMap, visiting));
    visiting.delete(block.id);
    blockDependence.set(block, dependent);
    return dependent;
}

function entityTypeDependsOnViewport(entity, blockMap, visiting) {
    if (!entity) return false;
    if (isConstructionLine(entity) || entity.type === 'circle') return true;
    if (Array.isArray(entity.parts) && entity.parts.some(part => entityTypeDependsOnViewport(part, blockMap, visiting))) return true;
    if (entity.type !== 'blockReference') return false;
    const nested = blockMap.get(entity.blockId);
    return Boolean(nested) && blockDependsOnViewport(nested, blockMap, visiting);
}

function partsKey(parts, viewBox) {
    let key = '';
    for (const part of parts) {
        if (part?.type === 'circle') key += circleKey(part, viewBox);
        else if (Array.isArray(part?.parts)) key += `(${partsKey(part.parts, viewBox)})`;
    }
    return key;
}

function circleKey(circle, viewBox) {
    const geometry = getCircleViewportGeometry(circle, viewBox);
    if (!geometry) return 'n';
    return geometry.kind === 'circle' ? 'c' : `p:${viewBoxKey(viewBox)}`;
}

function viewBoxKey(viewBox) {
    return viewBox ? `${viewBox.x},${viewBox.y},${viewBox.width},${viewBox.height}` : '-';
}

/**
 * Conservative model-space extent of an entity's drawn output, used to skip
 * entities outside the viewport. Returns null when the extent is not reliably
 * known (dimensions, leaders, infinite lines, unknown kinds): those always render.
 * Results are cached per immutable entity object.
 */
export function drawingEntityRenderBounds(entity) {
    if (!entity || typeof entity !== 'object') return null;
    if (!renderBounds.has(entity)) renderBounds.set(entity, computeRenderBounds(entity));
    return renderBounds.get(entity);
}

function computeRenderBounds(entity) {
    if (isConstructionLine(entity) || isDrawingDimensionEntity(entity) || entity.leader) return null;
    const bounds = getEntityBounds(entity);
    if (!bounds) return null;
    const padding = Math.max(0, Number(entity.lineWidth) || 0, overflowPadding(entity, bounds));
    return { minX: bounds.minX - padding, minY: bounds.minY - padding, maxX: bounds.maxX + padding, maxY: bounds.maxY + padding };
}

// Single-line text may overflow its frame (at most about one font size per
// character), and block attributes may overflow the definition extents.
function overflowPadding(entity, bounds) {
    if (entity.type === 'text') return String(entity.text || '').length * (Number(entity.fontSize) || 0);
    if (entity.type === 'blockReference') return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
    return 0;
}
