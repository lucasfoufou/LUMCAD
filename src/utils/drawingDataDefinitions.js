const FIELD_TYPES = Object.freeze({ id: 'string', rootId: 'string', type: 'string', layerId: 'string', layer: 'string',
    blockId: 'string', block: 'string', length: 'number', area: 'number' });
export const DRAWING_DATA_FIELDS = FIELD_TYPES;
export function isDrawingDataField(key) {
    return typeof key === 'string' && (Object.hasOwn(FIELD_TYPES, key)
        || /^attribute:[^\u0000-\u001f]{1,256}$/.test(key));
}

export function normalizeDrawingDataDefinition(value) {
    if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 256
        || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 128
        || typeof value.nested !== 'boolean' || !Array.isArray(value.groupBy) || value.groupBy.length > 16
        || value.groupBy.some(key => !isDrawingDataField(key)) || new Set(value.groupBy).size !== value.groupBy.length
        || !Array.isArray(value.sums) || value.sums.length > 2 || value.sums.some(key => !['length', 'area'].includes(key))
        || new Set(value.sums).size !== value.sums.length) return null;
    const selectedIds = value.selectedIds;
    if (selectedIds !== null && (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > 10000
        || selectedIds.some(id => typeof id !== 'string' || !id || id.length > 256)
        || new Set(selectedIds).size !== selectedIds.length)) return null;
    return { id: value.id, name: value.name.trim(), nested: value.nested, groupBy: [...value.groupBy], sums: [...value.sums],
        selectedIds: selectedIds === null ? null : [...selectedIds] };
}

export function normalizeDrawingDataDefinitions(values) {
    const result = []; const ids = new Set(); const names = new Set();
    for (const value of Array.isArray(values) ? values.slice(0, 128) : []) {
        const definition = normalizeDrawingDataDefinition(value);
        if (!definition || ids.has(definition.id) || names.has(definition.name.toLowerCase())) continue;
        result.push(definition); ids.add(definition.id); names.add(definition.name.toLowerCase());
    }
    return result;
}

/** A quantity table owns its query snapshot; renaming/deleting saved queries cannot retarget it. */
export function normalizeDrawingQuantityLink(value) {
    const definition = normalizeDrawingDataDefinition(value?.definition);
    const width = definition && definition.groupBy.length + 1 + definition.sums.length * 2;
    if (!definition || !Array.isArray(value.headers) || value.headers.length !== width
        || value.headers.some(header => typeof header !== 'string' || header.length > 4096)) return null;
    return { definition, headers: [...value.headers],
        status: ['current', 'empty', 'dependency', 'limit'].includes(value.status) ? value.status : 'current' };
}
