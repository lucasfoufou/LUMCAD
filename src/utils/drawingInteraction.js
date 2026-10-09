import { createDimensionSourceMap } from './drawingDimensionSources.js';
import { canSelectEntity, getLayer } from './drawingDocument.js';
import { isDrawingLayerVisible } from './drawingLayers.js';
import { entityHitsPoint, entityMatchesSelectionWindow, getDrawingDimensionSelectionBounds } from './drawingSelection.js';
import { isDrawingObjectHidden } from './drawingObjectVisibility.js';
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

function selectionIndex(content) {
    return selectionIndexCache([content.entities, content.blocks, content.layers, content.textStyles], () => {
        const sources = createDimensionSourceMap(content.entities, content.blocks, content);
        return { entityMap: sources, index: createDrawingSpatialIndex(content.entities, entity => selectionEntityBounds(entity, sources)) };
    });
}

/**
 * Topmost rendered entity under a world point, replacing DOM hit testing: the
 * scene takes no pointer events, so the browser never hit-tests thousands of
 * shapes. Later entities paint above earlier ones, so the search runs backwards.
 * `hiddenIds` are not rendered unless also listed in `hitOnlyIds`.
 */
export function pickDrawingEntity(content, point, tolerance, { hiddenIds = null, hitOnlyIds = null } = {}) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || !(tolerance >= 0)) return null;
    const { entityMap, index } = selectionIndex(content);
    const positions = index.query({ minX: point.x - tolerance, minY: point.y - tolerance, maxX: point.x + tolerance, maxY: point.y + tolerance });
    for (let cursor = positions.length - 1; cursor >= 0; cursor--) {
        const entity = content.entities[positions[cursor]];
        if (getDrawingEntityRenderMode(entity.id, hiddenIds, hitOnlyIds) === 'hidden' || isDrawingObjectHidden(content, entity.id)) continue;
        if (!isDrawingLayerVisible(getLayer(content, entity.layerId))) continue;
        if (entityHitsPoint(entity, point, tolerance, entityMap)) return entity.id;
    }
    return null;
}

export function drawingSelectionCandidates(content, selectionWindow) {
    const { entityMap, index } = selectionIndex(content);
    return index.query(selectionWindow)
        .map(position => content.entities[position])
        .filter(entity => canSelectEntity(content, entity) && entityMatchesSelectionWindow(entity, selectionWindow, entityMap))
        .map(entity => entity.id);
}

function selectionEntityBounds(entity, entityMap) {
    if (isConstructionLine(entity)) return null;
    if (!isDrawingDimensionEntity(entity)) return getEntityBounds(entity, entityMap);
    // Dimensions are indexed by every part they can be hit by, plus their presentation extent.
    const parts = getDrawingDimensionSelectionBounds(entity, entityMap);
    const presentation = getEntityBounds(entity, entityMap);
    if (!parts || !presentation) return parts || presentation;
    return { minX: Math.min(parts.minX, presentation.minX), minY: Math.min(parts.minY, presentation.minY),
        maxX: Math.max(parts.maxX, presentation.maxX), maxY: Math.max(parts.maxY, presentation.maxY) };
}

function collectionHas(collection, value) {
    return collection instanceof Set ? collection.has(value) : Array.isArray(collection) && collection.includes(value);
}
