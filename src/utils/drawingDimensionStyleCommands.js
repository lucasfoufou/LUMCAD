import { canEditEntity, createDrawingId } from './drawingDocument.js';
import { isDrawingDimensionEntity, DRAWING_DIMENSION_TOLERANCE_MODES, DRAWING_DIMENSION_UNITS } from './drawingDimensions.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { applyDimensionStyle, deleteDimensionStyle, findDimensionStyle, normalizeDimensionStyles, saveDimensionStyle } from './drawingDimensionStyles.js';

export function runDimensionStyleCommand(content, selectedIds, input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return { error: 'syntax' };
    if (!tokens.length) return { list: normalizeDimensionStyles(content.dimensionStyles).map(style => style.name).join(', ') };
    const [rawAction, name, rawField, value] = tokens;
    const action = rawAction.toUpperCase();
    if (action === 'SAVE' && tokens.length === 2) {
        if (findDimensionStyle(content, name)) return { error: 'duplicate' };
        const selectedIdSet = new Set(selectedIds);
        const selected = content.entities.filter(entity => selectedIdSet.has(entity.id));
        const source = selected.length === 1 && isDrawingDimensionEntity(selected[0]) ? selected[0]
            : findDimensionStyle(content, content.activeDimensionStyleId);
        return saveDimensionStyle(content, { id: createDrawingId('dimension-style'), name, values: source || {} });
    }
    const style = findDimensionStyle(content, name);
    if (!style) return { error: 'missing' };
    if (action === 'RENAME' && tokens.length === 3) return saveDimensionStyle(content, { id: style.id, name: rawField });
    if (action === 'DELETE' && tokens.length === 2) return deleteDimensionStyle(content, style.id);
    if (action === 'CURRENT' && tokens.length === 2) return { content: { ...content, activeDimensionStyleId: style.id } };
    if (action === 'APPLY' && tokens.length === 2) {
        const ids = new Set(selectedIds);
        const entities = content.entities.filter(entity => ids.has(entity.id));
        if (!entities.length || entities.length !== ids.size || entities.some(entity => !isDrawingDimensionEntity(entity) || !canEditEntity(content, entity))) return { error: 'selection' };
        return { content: { ...content, entities: content.entities.map(entity => ids.has(entity.id) ? applyDimensionStyle(entity, style) : entity) } };
    }
    if (action === 'SET' && tokens.length === 4) {
        const field = rawField.toUpperCase();
        const numeric = { TEXT: 'textSize', ARROWSIZE: 'arrowSize', GAP: 'extensionGap', OVERRUN: 'extensionOverrun' }[field];
        let values;
        if (numeric) {
            const number = Number(value);
            if (!value.trim() || !Number.isFinite(number) || number < (field === 'TEXT' ? 0.01 : 0) || number > 1e6) return { error: 'syntax' };
            values = { [numeric]: number };
        } else if (field === 'ARROW' && ['tick', 'closed', 'open', 'none'].includes(value.toLowerCase())) values = { arrowType: value.toLowerCase() };
        else if (field === 'PRECISION' && /^[0-8]$/.test(value)) values = { dimensionFormat: { ...style.dimensionFormat, precision: Number(value) } };
        else if (['PREFIX', 'SUFFIX'].includes(field) && value.length <= 256) values = { dimensionFormat: { ...style.dimensionFormat, [field.toLowerCase()]: value } };
        else {
            const dimensionFormat = editStyleFormat(style.dimensionFormat, field, value);
            if (!dimensionFormat) return { error: 'syntax' };
            values = { dimensionFormat };
        }
        return saveDimensionStyle(content, { id: style.id, name: style.name, values });
    }
    return { error: 'syntax' };
}


function editStyleFormat(format, field, value) {
    const fields = {
        TOLERANCE: ['tolerance', 'mode', DRAWING_DIMENSION_TOLERANCE_MODES],
        TOLUPPER: ['tolerance', 'upper', 'distance'], TOLLOWER: ['tolerance', 'lower', 'distance'],
        TOLPRECISION: ['tolerance', 'precision', 'precision'],
        ALTERNATE: ['alternateUnits', 'enabled', 'boolean'], ALTUNIT: ['alternateUnits', 'unit', DRAWING_DIMENSION_UNITS],
        ALTPRECISION: ['alternateUnits', 'precision', 'precision'],
        INSPECTION: ['inspection', 'enabled', 'boolean'], INSPECTLABEL: ['inspection', 'label', 'text'], INSPECTRATE: ['inspection', 'rate', 'text'],
    };
    const entry = fields[field];
    if (!entry) return null;
    const [group, key, type] = entry;
    let parsed;
    if (Array.isArray(type)) {
        parsed = value.toLowerCase();
        if (!type.includes(parsed)) return null;
    } else if (type === 'boolean') {
        if (!['ON', 'OFF'].includes(value.toUpperCase())) return null;
        parsed = value.toUpperCase() === 'ON';
    } else if (type === 'text') {
        if (value.length > 256) return null;
        parsed = value;
    } else {
        parsed = Number(value);
        if (!value.trim() || !Number.isFinite(parsed) || parsed < 0
            || type === 'precision' && (!Number.isInteger(parsed) || parsed > 8)
            || type === 'distance' && parsed > 1e6) return null;
    }
    return { ...format, [group]: { ...format[group], [key]: parsed } };
}
