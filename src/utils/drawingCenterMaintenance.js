import { canEditEntity } from './drawingDocument.js';
import { normalizeDrawingDimension } from './drawingDimensions.js';
import { applyDimensionStyle, findDimensionStyle, DEFAULT_DIMENSION_STYLE_ID } from './drawingDimensionStyles.js';
import { beginDimensionReassociation, disassociateDrawingDimensions, reassociateDrawingDimensions } from './drawingDimensionAssociations.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';

export function maintainDrawingCenters(content, selectedIds, command, input = '') {
    const ids = new Set(selectedIds);
    const entities = content.entities.filter(entity => ids.has(entity.id));
    if (!entities.length || entities.length !== ids.size || entities.some(entity => !['centerMark', 'centerLine'].includes(entity.type) || !canEditEntity(content, entity))) return { error: 'selection' };
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens || command !== 'centerReassociate' && tokens.length) return { error: 'syntax' };
    if (command === 'centerReassociate') return tokens.length
        ? reassociateDrawingDimensions(content, selectedIds, tokens)
        : beginDimensionReassociation(content, selectedIds);
    if (command === 'centerDisassociate') return disassociateDrawingDimensions(content, selectedIds);
    if (command !== 'centerReset') return { error: 'syntax' };
    const style = findDimensionStyle(content, content.activeDimensionStyleId) || findDimensionStyle(content, DEFAULT_DIMENSION_STYLE_ID);
    return { content: { ...content, entities: content.entities.map(entity => ids.has(entity.id)
        ? normalizeDrawingDimension({ ...applyDimensionStyle(entity, style), size: undefined, extension: undefined, ...(entity.type === 'centerLine' ? { alternateBisector: false } : {}) })
        : entity) } };
}
