import { createDimensionSourceMap } from './drawingDimensionSources.js';
import { canSelectEntity } from './drawingDocument.js';
import { entityMatchesSelectionWindow } from './drawingSelection.js';
import { isConstructionLine } from './drawingConstructionLines.js';
import { isDrawingDimensionEntity } from './drawingDimensions.js';
import { getEntityBounds } from './drawingGeometry.js';
import { createDrawingIndexCache, createDrawingSpatialIndex } from './drawingSpatialIndex.js';

export function isDrawingTextInput(target) {
    return target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target?.isContentEditable;
}

export function entityIdFromDrawingEvent(event) {
    return event.target.closest?.('[data-entity-id]')?.dataset?.entityId || null;
}

export function getTrimExtendPointMode(type, {
    shift = false,
    targetId = null,
    fence = false,
} = {}) {
    if (!['trim', 'extend'].includes(type)) return 'snap';
    const effectiveType = shift ? type === 'trim' ? 'extend' : 'trim' : type;
    return effectiveType === 'trim' && Boolean(targetId) && !fence ? 'raw' : 'snap';
}

export function getInteractiveOperationPointMode(type, options = {}) {
    if (['fillet', 'chamfer', 'blend', 'hatch', 'boundary', 'region', 'drawOrder', 'matchProperties'].includes(type)) return 'raw';
    return getTrimExtendPointMode(type, options);
}

export function getDrawingEntityRenderMode(entityId, hiddenIds, hitOnlyIds) {
    const hidden = collectionHas(hiddenIds, entityId);
    if (!hidden) return 'visible';
    return collectionHas(hitOnlyIds, entityId) ? 'hit-only' : 'hidden';
}

export function isDimensionableDrawingEntity(entity) {
    return ['line', 'rectangle', 'polygon', 'circle', 'arc', 'ellipse'].includes(entity?.type);
}

export function isDimensionPointSnap(point) {
    return ['endpoint', 'midpoint', 'center', 'intersection', 'tracking', 'trackingIntersection'].includes(point?.type);
}

// Window and crossing matches always overlap the entity bounds, so only
// entities found by the cached spatial index need the exact geometric test.
const selectionIndexCache = createDrawingIndexCache();

export function drawingSelectionCandidates(content, selectionWindow) {
    const { entityMap, index } = selectionIndexCache([content.entities, content.blocks, content.layers, content.textStyles], () => {
        const sources = createDimensionSourceMap(content.entities, content.blocks, content);
        return { entityMap: sources, index: createDrawingSpatialIndex(content.entities, entity => selectionEntityBounds(entity, sources)) };
    });
    return index.query(selectionWindow)
        .map(position => content.entities[position])
        .filter(entity => canSelectEntity(content, entity) && entityMatchesSelectionWindow(entity, selectionWindow, entityMap))
        .map(entity => entity.id);
}

function selectionEntityBounds(entity, entityMap) {
    if (isConstructionLine(entity) || isDrawingDimensionEntity(entity)) return null;
    return getEntityBounds(entity, entityMap);
}

function collectionHas(collection, value) {
    return collection instanceof Set ? collection.has(value) : Array.isArray(collection) && collection.includes(value);
}
