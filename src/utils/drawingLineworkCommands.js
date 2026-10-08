import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { canEditEntity, createDrawingId, getLayer } from './drawingDocument.js';
import { isDrawingLayerVisible } from './drawingLayers.js';
import { rebuildDrawingLinework, normalizeMultilineStyle, normalizeDrawingMultilineStyles } from './drawingLinework.js';

/** Build the entire batch before exposing a history commit to callers. */
export function createDrawingLinework(content, definitions) {
    const layer = getLayer(content, content.activeLayerId);
    if (!isDrawingLayerVisible(layer) || layer.locked) return { error: 'layer' };
    if (!Array.isArray(definitions) || !definitions.length || definitions.length > 10000) return { error: 'invalid' };
    const entities = definitions.map(linework => rebuildDrawingLinework({ id: createDrawingId('linework'), layerId: layer.id, linework }));
    if (entities.some(entity => !entity)) return { error: 'invalid' };
    return { content: { ...content, entities: [...content.entities, ...entities] }, selectedIds: entities.map(entity => entity.id) };
}

export function editDrawingLinework(content, selectedIds, edit) {
    const ids = new Set(selectedIds);
    const selected = content.entities.filter(entity => ids.has(entity.id));
    if (!selected.length || selected.some(entity => !entity.linework || !canEditEntity(content, entity))) return { error: 'selection' };
    const replacements = new Map();
    for (const entity of selected) {
        const definition = editedDefinition(entity.linework, edit);
        const replacement = definition && rebuildDrawingLinework({ ...entity, linework: definition });
        if (!replacement) return { error: 'invalid' };
        replacements.set(entity.id, replacement);
    }
    return { content: { ...content, entities: content.entities.map(entity => replacements.get(entity.id) || entity) }, selectedIds: selected.map(entity => entity.id) };
}

function editedDefinition(definition, edit) {
    if (!edit || typeof edit !== 'object') return null;
    if (edit.action === 'diameters' && definition.kind === 'donut') return { ...definition, innerDiameter: edit.innerDiameter, outerDiameter: edit.outerDiameter };
    if (edit.action === 'style' && definition.kind === 'multiline') {
        const style = normalizeMultilineStyle(edit.style);
        return style ? { ...definition, style } : null;
    }
    if (edit.action === 'scale' && definition.kind === 'multiline') return { ...definition, scale: edit.scale };
    if (edit.action === 'justify' && definition.kind === 'multiline' && ['zero', 'top', 'bottom'].includes(edit.justification)) return { ...definition, justification: edit.justification };
    if (edit.action === 'width' && definition.kind === 'wide') {
        if (edit.segment !== undefined && (!Number.isInteger(edit.segment) || edit.segment < 0 || edit.segment >= definition.widths.length)) return null;
        return { ...definition, widths: definition.widths.map((width, index) => edit.segment === undefined || edit.segment === index ? { start: edit.start, end: edit.end } : width) };
    }
    if (edit.action === 'close' && definition.points && typeof edit.closed === 'boolean') {
        if (edit.closed === definition.closed) return definition;
        return { ...definition, closed: edit.closed, ...(definition.kind === 'wide' ? {
            widths: edit.closed ? [...definition.widths, { ...definition.widths.at(-1) }] : definition.widths.slice(0, -1),
            bulges: edit.closed ? [...definition.bulges, 0] : definition.bulges.slice(0, -1),
        } : {}) };
    }
    if (edit.action === 'vertex' && definition.points && Number.isInteger(edit.index) && edit.index >= 0 && edit.index < definition.points.length) {
        return { ...definition, points: definition.points.map((point, index) => index === edit.index ? edit.point : point) };
    }
    return null;
}


/** Existing multiline objects retain their style snapshots until explicitly restyled. */
export function setDrawingMultilineStyle(content, styleInput) {
    const style = normalizeMultilineStyle(styleInput);
    if (!style) return { error: 'invalid' };
    const styles = normalizeDrawingMultilineStyles(content.multilineStyles);
    const index = styles.findIndex(entry => entry.name.toLowerCase() === style.name.toLowerCase());
    if (index < 0 && styles.length >= 128) return { error: 'limit' };
    return { content: { ...content, multilineStyles: index < 0 ? [...styles, style] : styles.map((entry, i) => i === index ? style : entry) } };
}

export function deleteDrawingMultilineStyle(content, name) {
    if (String(name).toLowerCase() === 'standard') return { error: 'standard' };
    const styles = normalizeDrawingMultilineStyles(content.multilineStyles);
    const index = styles.findIndex(entry => entry.name.toLowerCase() === String(name).toLowerCase());
    if (index < 0) return { error: 'style' };
    return { content: { ...content, multilineStyles: styles.filter((_, i) => i !== index) } };
}

export function parseDrawingLineworkEdit(input) {
    const tokens = String(input).trim().split(/\s+/);
    const action = tokens.shift()?.toUpperCase();
    const numbers = tokens.map(Number);
    if (action === 'CLOSE' || action === 'OPEN') return tokens.length ? null : { action: 'close', closed: action === 'CLOSE' };
    if (action === 'JUSTIFY') return tokens.length === 1 && ['zero', 'top', 'bottom'].includes(tokens[0].toLowerCase()) ? { action: 'justify', justification: tokens[0].toLowerCase() } : null;
    if (!numbers.every(Number.isFinite)) return null;
    if (action === 'SCALE' && numbers.length === 1 && numbers[0] > 0) return { action: 'scale', scale: numbers[0] };
    if (action === 'DIAMETERS' && numbers.length === 2) return { action: 'diameters', innerDiameter: numbers[0], outerDiameter: numbers[1] };
    if (action === 'WIDTH' && [2, 3].includes(numbers.length)) {
        const [start, end, segment] = numbers;
        if (start < 0 || end < 0 || segment !== undefined && (!Number.isInteger(segment) || segment < 1)) return null;
        return { action: 'width', start, end, ...(segment === undefined ? {} : { segment: segment - 1 }) };
    }
    if (action === 'VERTEX' && numbers.length === 3 && Number.isInteger(numbers[0]) && numbers[0] >= 1) return { action: 'vertex', index: numbers[0] - 1, point: { x: numbers[1], y: numbers[2] } };
    return null;
}

export function parseMultilineCreation(input, styles) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return null;
    const options = { style: normalizeDrawingMultilineStyles(styles)[0], scale: 1, justification: 'zero' };
    const seen = new Set();
    while (tokens.length) {
        const key = tokens.shift().toUpperCase();
        if (seen.has(key) || !tokens.length) return null;
        seen.add(key);
        const value = tokens.shift();
        if (key === 'STYLE') options.style = normalizeDrawingMultilineStyles(styles).find(style => style.name.toLowerCase() === value.toLowerCase());
        else if (key === 'SCALE') options.scale = Number(value);
        else if (key === 'JUSTIFY') options.justification = value.toLowerCase();
        else return null;
    }
    return options.style && Number.isFinite(options.scale) && options.scale > 1e-8 && options.scale <= 1e6
        && ['zero', 'top', 'bottom'].includes(options.justification) ? options : null;
}

export function runDrawingMultilineStyle(content, input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return { error: 'styleSyntax' };
    const action = (tokens.shift() || 'LIST').toUpperCase();
    if (action === 'LIST' && !tokens.length) return { names: normalizeDrawingMultilineStyles(content.multilineStyles).map(style => style.name) };
    const name = tokens.shift();
    if (!name) return { error: 'styleSyntax' };
    if (action === 'DELETE' && !tokens.length) return deleteDrawingMultilineStyle(content, name);
    if (action !== 'SET') return { error: 'styleSyntax' };
    const style = { name, elements: [], startCap: 'line', endCap: 'line', fill: false };
    while (tokens.length) {
        const key = tokens.shift().toUpperCase();
        if (key === 'ELEMENT') {
            const offset = Number(tokens.shift());
            if (!Number.isFinite(offset)) return { error: 'styleSyntax' };
            style.elements.push({ offset });
        } else if (key === 'COLOR' || key === 'LINETYPE') {
            const value = tokens.shift();
            const element = style.elements.at(-1);
            if (!element || !value || key === 'COLOR' && !/^#[0-9a-f]{6}$/i.test(value)
                || key === 'LINETYPE' && !['continuous', 'dashed', 'dotted'].includes(value.toLowerCase())) return { error: 'styleSyntax' };
            element[key === 'COLOR' ? 'color' : 'lineType'] = value.toLowerCase();
        } else if (key === 'START' || key === 'END') {
            const cap = tokens.shift()?.toLowerCase();
            if (!['none', 'line', 'arc'].includes(cap)) return { error: 'styleSyntax' };
            style[key === 'START' ? 'startCap' : 'endCap'] = cap;
        } else if (key === 'FILL') {
            const value = tokens.shift()?.toUpperCase();
            if (!['ON', 'OFF'].includes(value)) return { error: 'styleSyntax' };
            style.fill = value === 'ON';
        } else return { error: 'styleSyntax' };
    }
    return setDrawingMultilineStyle(content, style);
}
