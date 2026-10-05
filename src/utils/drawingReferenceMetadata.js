const MAX_PATH = 4096;
const RESOURCE_LIMITS = { blocks: 1024, layers: 2048, assets: 512, textStyles: 256, dimensionStyles: 256 };

function identifier(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value);
}

export function normalizeDrawingReference(value) {
    if (!value || value.version !== 1 || !identifier(value.sourceDocumentId)) return null;
    const path = typeof value.path === 'string' && value.path.length <= MAX_PATH && !/[\u0000-\u001f]/.test(value.path)
        ? value.path || null : null;
    const sourceMaps = {};
    const owned = {};
    for (const [key, limit] of Object.entries(RESOURCE_LIMITS)) {
        sourceMaps[key] = Object.fromEntries(Object.entries(value.sourceMaps?.[key] || {})
            .filter(([from, to]) => identifier(from) && identifier(to)).slice(0, limit));
        owned[key] = [...new Set((Array.isArray(value.owned?.[key]) ? value.owned[key] : []).filter(identifier))].slice(0, limit);
    }
    return {
        version: 1, path, name: String(value.name || '').slice(0, 256),
        mode: value.mode === 'overlay' ? 'overlay' : 'attach', loaded: value.loaded !== false,
        sourceDocumentId: value.sourceDocumentId,
        revision: typeof value.revision === 'string' && /^[a-f0-9]{64}$/.test(value.revision) ? value.revision : null,
        basePoint: value.basePoint && Number.isFinite(value.basePoint.x) && Number.isFinite(value.basePoint.y)
            && Math.abs(value.basePoint.x) <= 1e12 && Math.abs(value.basePoint.y) <= 1e12
            ? { x: value.basePoint.x, y: value.basePoint.y } : { x: 0, y: 0 },
        sourceMaps, owned,
    };
}

export function isDrawingReferenceUnloaded(entity) {
    return entity?.type === 'blockReference' && entity.externalReference?.loaded === false;
}

export function remapDrawingReferenceResources(reference, mappings = {}) {
    const normalized = normalizeDrawingReference(reference);
    if (!normalized) return null;
    const sourceMaps = {}; const owned = {};
    for (const key of Object.keys(RESOURCE_LIMITS)) {
        const mapping = mappings[key] || new Map();
        sourceMaps[key] = Object.fromEntries(Object.entries(normalized.sourceMaps[key]).map(([source, host]) => [source, mapping.get(host) || host]));
        owned[key] = [...new Set(normalized.owned[key].map(id => mapping.get(id) || id))];
    }
    return { ...normalized, sourceMaps, owned };
}
