import { canEditEntity, canSelectEntity } from './drawingDocument.js';
import { isDrawingDimensionEntity } from './drawingDimensions.js';

export function parseDrawingOrderInput(input) {
    const tokens = String(input || 'FRONT').trim().toUpperCase().split(/\s+/);
    const aliases = { F: 'front', FRONT: 'front', B: 'back', BACK: 'back', FORWARD: 'forward', BACKWARD: 'backward', ABOVE: 'above', BELOW: 'below' };
    const mode = aliases[tokens[0]];
    return mode && tokens.length === 1 ? mode : null;
}

/** Painter order: the first entity is at the back; relative order is stable. */
export function reorderDrawingEntities(content, ids, mode, referenceId = null) {
    if (!Array.isArray(content?.entities)) return content;
    const requested = new Set(ids);
    const movingIds = new Set(content.entities.filter(entity => requested.has(entity.id) && canEditEntity(content, entity)).map(entity => entity.id));
    if (!movingIds.size) return content;
    const moving = content.entities.filter(entity => movingIds.has(entity.id));
    const rest = content.entities.filter(entity => !movingIds.has(entity.id));
    let entities;
    if (mode === 'front') entities = [...rest, ...moving];
    else if (mode === 'back') entities = [...moving, ...rest];
    else if (mode === 'above' || mode === 'below') {
        const index = rest.findIndex(entity => entity.id === referenceId && canSelectEntity(content, entity));
        if (index < 0) return content;
        const insertion = index + (mode === 'above' ? 1 : 0);
        entities = [...rest.slice(0, insertion), ...moving, ...rest.slice(insertion)];
    } else if (mode === 'forward' || mode === 'backward') {
        entities = [...content.entities];
        const step = mode === 'forward' ? -1 : 1;
        for (let index = step < 0 ? entities.length - 2 : 1; index >= 0 && index < entities.length; index += step) {
            const neighbor = index - step;
            if (neighbor < 0 || neighbor >= entities.length) continue;
            if (movingIds.has(entities[index].id) && !movingIds.has(entities[neighbor].id)) {
                [entities[index], entities[neighbor]] = [entities[neighbor], entities[index]];
            }
        }
    } else return content;
    return entities.every((entity, index) => entity === content.entities[index]) ? content : { ...content, entities };
}

export function drawingAnnotationIds(content, mode = 'all') {
    return content.entities.filter(entity => (mode !== 'dimensions' && entity.type === 'text')
        || (mode !== 'text' && isDrawingDimensionEntity(entity))).map(entity => entity.id);
}
