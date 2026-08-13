import { canSelectEntity } from './drawingDocument.js';
import { entityMatchesSelectionWindow } from './drawingSelection.js';

export function isDrawingTextInput(target) {
    return target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target?.isContentEditable;
}

export function entityIdFromDrawingEvent(event) {
    return event.target.closest?.('[data-entity-id]')?.dataset?.entityId || null;
}

export function isDimensionableDrawingEntity(entity) {
    return ['line', 'rectangle', 'polygon', 'circle', 'arc'].includes(entity?.type);
}

export function isDimensionPointSnap(point) {
    return ['endpoint', 'midpoint', 'center', 'intersection', 'tracking', 'trackingIntersection'].includes(point?.type);
}

export function drawingSelectionCandidates(content, selectionWindow) {
    const entityMap = new Map(content.entities.map(entity => [entity.id, entity]));
    return content.entities
        .filter(entity => canSelectEntity(content, entity) && entityMatchesSelectionWindow(entity, selectionWindow, entityMap))
        .map(entity => entity.id);
}
