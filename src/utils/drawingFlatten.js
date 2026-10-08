import { canEditEntity } from './drawingDocument.js';

const ELEVATION_KEYS = ['z', 'z1', 'z2', 'cz', 'elevation', 'thickness'];
const POINT_LISTS = ['points', 'controlPoints', 'fitPoints'];
const POINT_KEYS = ['p0', 'p1', 'p2', 'p3', 'center', 'origin', 'basePoint', 'insertionPoint'];

export function parseDrawingFlattenInput(input = '') {
    const tokens = String(input).trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (new Set(tokens).size !== tokens.length || tokens.some(token => !['ALL', 'PREVIEW'].includes(token))) return null;
    return { all: tokens.includes('ALL'), preview: tokens.includes('PREVIEW') };
}

/** Orthographic XY projection of native 2D geometry carrying optional elevation data. */
function flattenGeometry(value, budget, pointOnly = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    if (--budget.remaining < 0) throw new Error('limit');
    const next = { ...value };
    for (const key of pointOnly ? ['z'] : ELEVATION_KEYS) {
        if (value[key] === undefined) continue;
        if (!Number.isFinite(value[key])) throw new Error('invalid');
        if (value[key] !== 0) next[key] = 0;
    }
    // Native coordinates are already XY. An OCS normal requires an importer to
    // establish world coordinates first; silently ignoring it would distort geometry.
    for (const key of pointOnly ? [] : ['normal', 'extrusion']) {
        if (value[key] === undefined) continue;
        const normal = value[key];
        if (!normal || normal.x !== 0 || normal.y !== 0 || normal.z !== 1) throw new Error('orientation');
    }
    if (!pointOnly) {
        for (const key of POINT_LISTS) if (Array.isArray(value[key])) next[key] = value[key].map(point => flattenGeometry(point, budget, true));
        for (const key of POINT_KEYS) if (value[key]) next[key] = flattenGeometry(value[key], budget, true);
        for (const key of ['parts', 'boundaries']) if (Array.isArray(value[key])) next[key] = value[key].map(part => flattenGeometry(part, budget));
        for (const key of ['splineDefinition', 'linework', 'revisionSymbol']) if (value[key]) next[key] = flattenGeometry(value[key], budget);
    }
    return next;
}

/** One atomic proposal; native planar drawings remain unchanged and create no undo step. */
export function flattenDrawingEntities(content, selectedIds, { maxVisits = 500000 } = {}) {
    if (!Array.isArray(content?.entities) || !Array.isArray(selectedIds) || !Number.isInteger(maxVisits) || maxVisits < 1) return { error: 'invalid' };
    const selected = new Set(selectedIds); const replacements = new Map();
    const report = { examined: 0, flattened: 0, planar: 0, protected: 0 };
    const budget = { remaining: maxVisits };
    try {
        for (const entity of content.entities) {
            if (!selected.has(entity.id)) continue;
            report.examined += 1;
            // Definitions are shared. Flatten their native contents explicitly in BEDIT.
            if (!canEditEntity(content, entity) || entity.type === 'blockReference' || entity.externalReference) { report.protected += 1; continue; }
            const next = flattenGeometry(entity, budget);
            if (JSON.stringify(next) === JSON.stringify(entity)) report.planar += 1;
            else { replacements.set(entity.id, next); report.flattened += 1; }
        }
    } catch (error) { return { error: error.message }; }
    return { changed: replacements.size > 0, content: replacements.size
        ? { ...content, entities: content.entities.map(entity => replacements.get(entity.id) || entity) } : content, report };
}
