import { repairDrawingGroupCatalog } from './drawingGroupAudit.js';
import { validRawDimensionGeometry } from './drawingDimensionAudit.js';
import { normalizeDrawingAffineFrame } from './drawingAffineFrame.js';
import { validateDrawingBlockGraph } from './drawingBlockEditing.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { normalizeCurvePrimitive } from './drawingCurveKernel.js';
import { getDrawingEntityDependencyIds, isDrawingDimensionEntity } from './drawingDimensions.js';
import { normalizeDrawingGeometricConstraints } from './drawingConstraintDefinition.js';
import { normalizeDrawingDimensionalConstraints } from './drawingDimensionalConstraints.js';

const finite = value => Number.isFinite(value) && Math.abs(value) <= 1e12;
const point = value => value && finite(value.x) && finite(value.y);

function validBlockTransform(entity) {
    if (Object.hasOwn(entity, 'transform')) {
        const matrix = entity.transform;
        return Array.isArray(matrix)
            ? matrix.length === 6 && matrix.every(finite)
            : matrix && typeof matrix === 'object' && ['a', 'b', 'c', 'd', 'e', 'f'].every(key => finite(matrix[key]));
    }
    // Omitted legacy components intentionally use their established defaults.
    return ['x', 'y', 'scaleX', 'scaleY', 'rotation'].every(key => !Object.hasOwn(entity, key) || finite(entity[key]));
}

/** Read raw data before normalization can hide defects. Never mutates or repairs input. */
export function auditDrawingDocument(document, { maxObjects = 100000, maxIssues = 10000 } = {}) {
    if (!document?.content || !Number.isInteger(maxObjects) || maxObjects < 1 || !Number.isInteger(maxIssues) || maxIssues < 1) return { error: 'invalid' };
    const issues = []; let examined = 0;
    const issue = (code, path, entityId = null, reference = null) => {
        issues.push({ code, path, entityId, reference });
        if (issues.length > maxIssues) throw new Error('limit');
    };
    const content = document.content;
    const catalog = (values, path) => {
        const ids = new Set();
        if (!Array.isArray(values)) { issue('invalidCatalog', path); return ids; }
        for (const [index, value] of values.entries()) {
            if (++examined > maxObjects) throw new Error('limit');
            if (!value || typeof value.id !== 'string' || !value.id) issue('missingId', `${path}[${index}]`);
            else if (ids.has(value.id)) issue('duplicateId', `${path}[${index}]`, value.id);
            else ids.add(value.id);
        }
        return ids;
    };
    try {
        const layerIds = catalog(content.layers, 'content.layers');
        const blockIds = catalog(content.blocks || [], 'content.blocks');
        const assetIds = catalog(document.assets || [], 'assets');
        if (content.groups !== undefined) {
            if (!Array.isArray(content.groups)) issue('invalidCatalog', 'content.groups');
            else {
                if (content.groups.length > 10000) issue('invalidCatalog', 'content.groups');
                for (const group of content.groups) {
                    examined += 1 + (Array.isArray(group?.entityIds) ? group.entityIds.length : 0);
                    if (examined > maxObjects) throw new Error('limit');
                }
                if (Array.isArray(content.entities)) for (const repair of repairDrawingGroupCatalog(content).repairs) issue('invalidGroup', repair.path, repair.previous?.id || null);
            }
        }
        const scopes = [{ value: content, path: 'content', collection: 'entities', entities: content.entities }];
        for (const [index, block] of (content.blocks || []).entries()) scopes.push({ value: block, path: `content.blocks[${index}]`, collection: 'entities', entities: block?.entities });
        for (const [index, layout] of (document.layouts || []).entries()) scopes.push({ value: {}, path: `layouts[${index}]`, collection: 'paperEntities', entities: layout?.paperEntities || [] });
        for (const scope of scopes) {
            const entityIds = catalog(scope.entities, `${scope.path}.${scope.collection}`);
            for (const [index, entity] of (Array.isArray(scope.entities) ? scope.entities : []).entries()) {
                const path = `${scope.path}.${scope.collection}[${index}]`;
                if (!entity || typeof entity !== 'object') { issue('invalidEntity', path); continue; }
                if (!layerIds.has(entity.layerId)) issue('missingLayer', path, entity.id, entity.layerId);
                if (entity.type === 'blockReference' && !blockIds.has(entity.blockId)) issue('missingBlock', path, entity.id, entity.blockId);
                if (entity.type === 'image' && entity.assetId && !assetIds.has(entity.assetId)) issue('missingAsset', path, entity.id, entity.assetId);
                for (const id of getDrawingEntityDependencyIds(entity)) if (!entityIds.has(id)) issue('missingSource', path, entity.id, id);
                const pending = [{ geometry: entity, path, depth: 0 }];
                while (pending.length) {
                    const current = pending.pop(); const geometry = current.geometry;
                    if (++examined > maxObjects || current.depth > 64) throw new Error('limit');
                    if (!geometry || typeof geometry !== 'object') { issue('invalidGeometry', current.path, entity.id); continue; }
                    const type = geometry.type;
                    if (isDrawingDimensionEntity(geometry) && !validRawDimensionGeometry(geometry)) issue('invalidGeometry', current.path, entity.id);
                    if (type === 'blockReference' && !validBlockTransform(geometry)) issue('invalidGeometry', current.path, entity.id);
                    if (['image', 'text'].includes(type) && Object.hasOwn(geometry, 'affineFrame') && !normalizeDrawingAffineFrame(geometry.affineFrame)) issue('invalidGeometry', current.path, entity.id);
                    if (['line', 'circle', 'arc', 'ellipse', 'spline'].includes(type)) {
                        if (!normalizeCurvePrimitive(geometry) || ['circle', 'arc'].includes(type) && !(geometry.r > 0)
                            || type === 'ellipse' && (!(geometry.rx > 0) || !(geometry.ry > 0))) issue('invalidGeometry', current.path, entity.id);
                    } else if (['point', 'rectangle', 'text', 'image'].includes(type)) {
                        if (!point(geometry) || ['rectangle', 'image'].includes(type) && (!finite(geometry.width) || !finite(geometry.height) || geometry.width <= 0 || geometry.height <= 0)) issue('invalidGeometry', current.path, entity.id);
                    } else if (['xline', 'ray'].includes(type)) {
                        if (![geometry.x1, geometry.y1, geometry.x2, geometry.y2].every(finite) || Math.hypot(geometry.x2 - geometry.x1, geometry.y2 - geometry.y1) <= 1e-9) issue('invalidGeometry', current.path, entity.id);
                    } else if (type === 'polygon') {
                        if (![geometry.cx, geometry.cy, geometry.r].every(finite) || geometry.r <= 0 || !Number.isInteger(geometry.sides) || geometry.sides < 3) issue('invalidGeometry', current.path, entity.id);
                    } else if (type === 'polyline' && !geometry.parts?.length) {
                        if (!Array.isArray(geometry.points) || geometry.points.length < 2 || !geometry.points.every(point)) issue('invalidGeometry', current.path, entity.id);
                    } else if (!['polyline', 'path', 'hatch', 'region', 'blockReference'].includes(type) && !isDrawingDimensionEntity(geometry)) issue('unknownEntityType', current.path, entity.id, type);
                    for (const key of ['parts', 'boundaries']) if (Array.isArray(geometry[key])) {
                        if (pending.length + geometry[key].length + examined > maxObjects) throw new Error('limit');
                        geometry[key].forEach((part, partIndex) => pending.push({ geometry: part, path: `${current.path}.${key}[${partIndex}]`, depth: current.depth + 1 }));
                    }
                }
            }
            if (Array.isArray(scope.entities)) {
                if (!normalizeDrawingGeometricConstraints(scope.value.geometricConstraints, scope.entities.filter(Boolean))) issue('invalidGeometricConstraints', scope.path);
                if (normalizeDrawingDimensionalConstraints(scope.value.dimensionalConstraints, scope.entities.filter(Boolean), scope.value.parameters).error) issue('invalidDimensionalConstraints', scope.path);
            }
        }
        if (Array.isArray(content.blocks) && content.blocks.every(block => block && Array.isArray(block.entities) && block.entities.every(Boolean))) {
            const graphError = validateDrawingBlockGraph(content.blocks);
            if (graphError) issue('invalidBlockGraph', 'content.blocks', null, graphError);
        }
        return { issues, examined, valid: issues.length === 0 };
    } catch (error) { return { error: error.message === 'limit' ? 'limit' : 'invalid' }; }
}


/** Repair missing layer ownership without removing objects or guessing their geometry. */
export function repairDrawingDocument(document, { recoveredLayerName = 'Recovered layer', ...limits } = {}) {
    const before = auditDrawingDocument(document, limits);
    if (before.error) return before;
    if (!Array.isArray(document.content.layers)) return { error: 'invalid' };
    const defaults = createDefaultDrawingContent();
    const existing = new Set(document.content.layers.map(layer => layer?.id));
    const names = new Set(document.content.layers.map(layer => String(layer?.name || '').toLowerCase()));
    const missing = new Set(before.issues.filter(issue => issue.code === 'missingLayer').map(issue => issue.reference));
    const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
    const additions = [];
    const repairs = [];
    const ensureLayer = id => {
        if (existing.has(id)) return;
        let name = `${recoveredLayerName} ${id}`.slice(0, 120); const base = name;
        for (let suffix = 2; names.has(name.toLowerCase()); suffix += 1) name = `${base} ${suffix}`;
        const standard = defaults.layers.find(layer => layer.id === id);
        const layer = standard || { ...defaults.layers[0], id, name };
        additions.push(layer); existing.add(id); names.add(layer.name.toLowerCase());
        repairs.push({ code: 'restoredLayer', id, name: layer.name });
    };
    for (const id of missing) ensureLayer(validId(id) ? id : defaults.activeLayerId);
    const repairEntities = (entities, path) => {
        if (!Array.isArray(entities)) return entities;
        let changed = false;
        const next = entities.map((entity, index) => {
            if (!entity || validId(entity.layerId)) return entity;
            changed = true;
            repairs.push({ code: 'reassignedLayer', path: `${path}[${index}]`, entityId: entity.id || null, id: defaults.activeLayerId });
            return { ...entity, layerId: defaults.activeLayerId };
        });
        return changed ? next : entities;
    };
    const content = { ...document.content,
        layers: additions.length ? [...document.content.layers, ...additions] : document.content.layers,
        entities: repairEntities(document.content.entities, 'content.entities'),
        blocks: (document.content.blocks || []).map((block, index) => block && ({ ...block, entities: repairEntities(block.entities, `content.blocks[${index}].entities`) })),
    };
    if (Array.isArray(content.groups) && Array.isArray(content.entities)) {
        const groupRepair = repairDrawingGroupCatalog(content);
        content.groups = groupRepair.groups;
        repairs.push(...groupRepair.repairs);
    }
    const layouts = (document.layouts || []).map((layout, index) => layout && ({ ...layout, paperEntities: repairEntities(layout.paperEntities, `layouts[${index}].paperEntities`) }));
    const next = repairs.length ? { ...document, content, layouts } : document;
    const after = auditDrawingDocument(next, limits);
    if (after.error) return after;
    return { document: next, changed: repairs.length > 0, repairs, before, ...after };
}
