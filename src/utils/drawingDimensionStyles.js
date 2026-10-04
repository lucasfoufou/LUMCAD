import { refreshDrawingBlockBounds } from './drawingBlocks.js';
import { isDrawingDimensionEntity, normalizeDrawingDimensionFormat } from './drawingDimensions.js';

export const DEFAULT_DIMENSION_STYLE_ID = 'dimension-style-standard';
export const DIMENSION_ARROW_TYPES = Object.freeze(['tick', 'closed', 'open', 'none']);
export const DEFAULT_DIMENSION_STYLE = Object.freeze({
    id: DEFAULT_DIMENSION_STYLE_ID, name: 'Standard', textSize: 0.35, arrowSize: 0.245,
    arrowType: 'tick', extensionGap: 0, extensionOverrun: 0,
});
const NUMERIC_FIELDS = Object.freeze({ textSize: [0.01, 1e6, 0.35], arrowSize: [0, 1e6, 0.245], extensionGap: [0, 1e6, 0], extensionOverrun: [0, 1e6, 0] });

export function normalizeDimensionStyleValues(source = {}) {
    const values = Object.fromEntries(Object.entries(NUMERIC_FIELDS).map(([key, [min, max, fallback]]) => {
        const value = source?.[key];
        return [key, typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback];
    }));
    return { ...values, arrowType: DIMENSION_ARROW_TYPES.includes(source?.arrowType) ? source.arrowType : 'tick',
        dimensionFormat: normalizeDrawingDimensionFormat(source?.dimensionFormat) };
}

export function normalizeDimensionStyles(input) {
    const styles = [];
    const ids = new Set(); const names = new Set();
    for (const value of Array.isArray(input) ? input.slice(0, 128) : []) {
        const name = typeof value?.name === 'string' ? value.name.trim().slice(0, 128) : '';
        if (!name || /[\u0000-\u001f]/.test(name) || typeof value.id !== 'string' || !value.id || value.id.length > 128
            || ids.has(value.id) || names.has(name.toLowerCase())) continue;
        ids.add(value.id); names.add(name.toLowerCase());
        styles.push({ id: value.id, name, ...normalizeDimensionStyleValues(value) });
    }
    if (!ids.has(DEFAULT_DIMENSION_STYLE_ID)) {
        let name = 'Standard';
        for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `Standard ${suffix}`;
        styles.unshift({ id: DEFAULT_DIMENSION_STYLE_ID, name, ...normalizeDimensionStyleValues() });
    }
    return styles.slice(0, 128);
}

export function findDimensionStyle(content, nameOrId) {
    return normalizeDimensionStyles(content.dimensionStyles).find(style => style.id === nameOrId || style.name.toLowerCase() === String(nameOrId || '').toLowerCase()) || null;
}

/** Resolved values are snapshots: portable dimensions keep their last appearance. */
export function applyDimensionStyle(entity, style, { keepOverrides = false } = {}) {
    if (!isDrawingDimensionEntity(entity)) return entity;
    const overrides = keepOverrides ? normalizeDimensionStyleOverrides(entity.dimensionStyleOverrides) : {};
    return { ...entity, ...normalizeDimensionStyleValues({ ...style, ...overrides }), dimensionStyleId: style.id, dimensionStyleOverrides: overrides };
}

export function normalizeDimensionStyleOverrides(input) {
    if (!input || typeof input !== 'object') return {};
    const normalized = normalizeDimensionStyleValues(input);
    return Object.fromEntries(Object.keys(normalized).filter(key => Object.hasOwn(input, key)).map(key => [key, normalized[key]]));
}

export function saveDimensionStyle(content, { id, name, values = {} }) {
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    if (!normalizedName || normalizedName.length > 128 || /[\u0000-\u001f]/.test(normalizedName)) return { error: 'name' };
    const styles = normalizeDimensionStyles(content.dimensionStyles);
    const original = styles.find(style => style.id === id);
    if (!id || typeof id !== 'string' || id.length > 128 || (!original && styles.length >= 128)) return { error: 'limit' };
    if (styles.some(style => style.id !== id && style.name.toLowerCase() === normalizedName.toLowerCase())) return { error: 'duplicate' };
    const style = { id, name: normalizedName, ...normalizeDimensionStyleValues({ ...original, ...values }) };
    const update = entity => entity.dimensionStyleId === id ? applyDimensionStyle(entity, style, { keepOverrides: true }) : entity;
    return { content: refreshDrawingBlockBounds({ ...content, dimensionStyles: original ? styles.map(candidate => candidate.id === id ? style : candidate) : [...styles, style],
        entities: content.entities.map(update), blocks: (content.blocks || []).map(block => ({ ...block, entities: block.entities.map(update) })) }), style };
}

export function deleteDimensionStyle(content, nameOrId) {
    const style = findDimensionStyle(content, nameOrId);
    if (!style) return { error: 'missing' };
    if (style.id === DEFAULT_DIMENSION_STYLE_ID || style.id === content.activeDimensionStyleId) return { error: 'active' };
    const entities = [...content.entities, ...(content.blocks || []).flatMap(block => block.entities)];
    if (entities.some(entity => entity.dimensionStyleId === style.id)) return { error: 'used' };
    return { content: { ...content, dimensionStyles: normalizeDimensionStyles(content.dimensionStyles).filter(candidate => candidate.id !== style.id) } };
}

export function applyCurrentStyleToNewDimensions(content, previous) {
    const previousIds = new Set((previous?.entities || []).map(entity => entity.id));
    const style = findDimensionStyle(content, content.activeDimensionStyleId) || findDimensionStyle(content, DEFAULT_DIMENSION_STYLE_ID);
    let changed = false;
    const entities = content.entities.map(entity => {
        if (!isDrawingDimensionEntity(entity) || entity.dimensionStyleId || entity.previewMode === 'copy' || previousIds.has(entity.id)) return entity;
        changed = true;
        const overrides = normalizeDimensionStyleOverrides(entity);
        return applyDimensionStyle({ ...entity, dimensionStyleOverrides: overrides }, style, { keepOverrides: true });
    });
    return changed ? { ...content, entities } : content;
}

export function retainDimensionStyleOverrides(entity, patch) {
    if (!entity.dimensionStyleId) return entity;
    return { ...entity, dimensionStyleOverrides: { ...normalizeDimensionStyleOverrides(entity.dimensionStyleOverrides), ...normalizeDimensionStyleOverrides(patch) } };
}
