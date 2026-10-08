import { isDrawingLayerVisible } from './drawingLayers.js';
import { drawingAttributeValues, validateDrawingAttributeTags } from './drawingBlockAttributes.js';
import { canEditEntity, createDrawingId, getLayer } from './drawingDocument.js';
import { getDrawingEntityDependencyIds } from './drawingDimensions.js';
import { remapDrawingGeometricConstraints } from './drawingConstraintDefinition.js';
import { collectDrawingDimensionalCatalog, includeDrawingDrivingAnnotations, mergeDrawingDimensionalCatalog } from './drawingDimensionalTransfer.js';
import {
    collectDrawingBlockDependencies, createAnonymousDrawingBlock, createAnonymousDrawingBlockReference,
    getDrawingBlockDefinitionBounds, multiplyAffineMatrices, rotationAffineMatrix, scaleAffineMatrix,
    translationAffineMatrix, refreshDrawingBlockBounds,
} from './drawingBlocks.js';

export function normalizeDrawingBlockName(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    return name && name.length <= 128 && !/[\u0000-\u001f<>/\\":;?*|=]/.test(name) ? name : null;
}

export function findNamedDrawingBlock(content, name) {
    const key = String(name || '').trim().toLowerCase();
    return (content.blocks || []).find(block => block.id === name || block.name.toLowerCase() === key) || null;
}

export function defineNamedDrawingBlock(content, ids, { name, basePoint, redefine = false, keepSources = false } = {}) {
    const normalizedName = normalizeDrawingBlockName(name);
    if (!normalizedName) return { error: 'name' };
    if (!validPoint(basePoint)) return { error: 'point' };
    const existing = findNamedDrawingBlock(content, normalizedName);
    if (existing && !redefine) return { error: 'duplicate' };
    const requested = new Set(ids);
    const entityMap = new Map(content.entities.map(entity => [entity.id, entity]));
    const pending = [...requested];
    if (!pending.length) return { error: 'selection' };
    // Include local dependencies so dimensions, hatches and arrays retain their sources.
    while (pending.length) {
        const entity = entityMap.get(pending.pop());
        if (!entity || !canEditEntity(content, entity)) return { error: 'selection' };
        for (const id of getDrawingEntityDependencyIds(entity)) {
            if (!entityMap.has(id)) return { error: 'dependency' };
            if (!requested.has(id)) { requested.add(id); pending.push(id); }
        }
    }
    const entities = includeDrawingDrivingAnnotations(content, content.entities.filter(entity => requested.has(entity.id)));
    for (const entity of entities) {
        if (!canEditEntity(content, entity)) return { error: 'selection' };
        requested.add(entity.id);
    }
    const constraints = content.geometricConstraints || [];
    if (!keepSources && [...constraints, ...(content.dimensionalConstraints || [])].some(constraint => constraint.refs.some(ref => requested.has(ref.entityId))
        && constraint.refs.some(ref => !requested.has(ref.entityId)))) return { error: 'dependent' };
    const localConstraints = remapDrawingGeometricConstraints(constraints,
        new Map(entities.map(entity => [entity.id, entity.id])), () => createDrawingId('constraint'));
    const catalog = collectDrawingDimensionalCatalog(content, requested);
    if (catalog.error) return { error: 'dependent' };
    const dimensional = mergeDrawingDimensionalCatalog({ entities: [], geometricConstraints: localConstraints }, { ...catalog, entities },
        new Map(entities.map(entity => [entity.id, entity.id])), entities, () => createDrawingId('constraint'));
    if (dimensional.error) return { error: dimensional.error === 'limit' ? 'limit' : 'dependent' };
    if (!keepSources && content.entities.some(entity => !requested.has(entity.id)
        && getDrawingEntityDependencyIds(entity).some(id => requested.has(id)))) return { error: 'dependent' };
    const nested = collectDrawingBlockDependencies(content.blocks, entities.filter(entity => entity.type === 'blockReference').map(entity => entity.blockId));
    if (existing && nested.some(block => block.id === existing.id)) return { error: 'cycle' };
    const blocks = content.blocks || [];
    const count = blocks.filter(block => block.id !== existing?.id).reduce((sum, block) => sum + block.entities.length, 0);
    if ((!existing && blocks.length >= 1024) || count + entities.length > 100000) return { error: 'limit' };
    if (!validateDrawingAttributeTags(entities)) return { error: 'attributeTags' };
    const definition = createAnonymousDrawingBlock(entities, { id: existing?.id || createDrawingId('block'), name: normalizedName, basePoint,
        geometricConstraints: localConstraints,
        ...(dimensional.dimensionalConstraints.length || dimensional.parameters.length
            ? { dimensionalConstraints: dimensional.dimensionalConstraints, parameters: dimensional.parameters } : {}) });
    const updatedBlocks = existing ? blocks.map(block => block.id === existing.id ? definition : block) : [...blocks, definition];
    definition.bounds = getDrawingBlockDefinitionBounds(definition, updatedBlocks);
    const layerId = content.activeLayerId;
    const layer = getLayer(content, layerId);
    if (!keepSources && (!isDrawingLayerVisible(layer) || layer.locked)) return { error: 'layer' };
    const reference = keepSources ? null : createAnonymousDrawingBlockReference(definition, { insertionPoint: basePoint, layerId });
    // Place the replacement at the first selected object's painter position.
    let inserted = false;
    const nextEntities = keepSources ? content.entities : content.entities.flatMap(entity => {
        if (!requested.has(entity.id)) return [entity];
        if (inserted) return [];
        inserted = true;
        return [reference];
    });
    const remaining = !keepSources && content.dimensionalConstraints !== undefined
        ? collectDrawingDimensionalCatalog(content, content.entities.filter(entity => !requested.has(entity.id)).map(entity => entity.id),
            { parameterNames: (content.parameters || []).map(item => item.name) }) : null;
    if (remaining?.error) return { error: 'dependent' };
    const next = refreshDrawingBlockBounds({ ...content, blocks: updatedBlocks, entities: nextEntities,
        ...(remaining ? { dimensionalConstraints: remaining.dimensionalConstraints,
            parameters: [...(content.parameters || []), ...remaining.parameters.filter(item => !(content.parameters || []).some(existing => existing.name === item.name))] } : {}),
        ...(content.geometricConstraints !== undefined && !keepSources ? { geometricConstraints: constraints
            .filter(constraint => !constraint.refs.some(ref => requested.has(ref.entityId))) } : {}) });
    return { content: next, definition: next.blocks.find(block => block.id === definition.id), reference: reference && next.entities.find(entity => entity.id === reference.id) };
}

export function prepareNamedDrawingBlockInsertion(content, name, point, { scale = 1, angle = 0, id = createDrawingId('blockReference'), attributeValues } = {}) {
    const definition = findNamedDrawingBlock(content, name);
    if (!definition) return { error: 'missing' };
    if (!validPoint(point) || !Number.isFinite(scale) || scale <= 1e-9 || scale > 1e9 || !Number.isFinite(angle)) return { error: 'transform' };
    const layer = getLayer(content, content.activeLayerId);
    if (!isDrawingLayerVisible(layer) || layer.locked) return { error: 'layer' };
    const reference = createAnonymousDrawingBlockReference(definition, { id, insertionPoint: point, layerId: layer.id });
    if (attributeValues) reference.attributeValues = drawingAttributeValues(definition, { attributeValues });
    reference.definitionBounds = getDrawingBlockDefinitionBounds(definition, content.blocks, reference);
    reference.transform = multiplyAffineMatrices(translationAffineMatrix(point.x, point.y), multiplyAffineMatrices(rotationAffineMatrix(angle % 360), scaleAffineMatrix(scale)));
    return { reference };
}

export function insertNamedDrawingBlock(content, name, point, options = {}) {
    const result = prepareNamedDrawingBlockInsertion(content, name, point, options);
    if (result.error) return result;
    return { content: { ...content, entities: [...content.entities, result.reference] }, reference: result.reference };
}

export function parseNamedBlockInput(input, kind) {
    const match = String(input || '').trim().match(/^(?:"([^"]+)"|(\S+))(?:\s+([\s\S]*))?$/);
    if (!match) return null;
    const name = match[1] || match[2];
    if (!normalizeDrawingBlockName(name)) return null;
    const tokens = (match[3] || '').trim().split(/\s+/).filter(Boolean);
    if (kind === 'define') {
        const options = { name, keepSources: false, redefine: false };
        const values = [];
        for (const token of tokens) {
            if (token.toUpperCase() === 'KEEP') options.keepSources = true;
            else if (token.toUpperCase() === 'REDEFINE') options.redefine = true;
            else values.push(Number(token.replace(',', '.')));
        }
        if (values.some(value => !Number.isFinite(value)) || ![0, 2].includes(values.length)) return null;
        return { ...options, basePoint: values.length ? { x: values[0], y: values[1] } : null };
    }
    const values = tokens.map(token => Number(token.replace(',', '.')));
    if (values.some(value => !Number.isFinite(value)) || ![0, 2, 3, 4].includes(values.length)) return null;
    return { name, point: values.length ? { x: values[0], y: values[1] } : null, scale: values[2] ?? 1, angle: values[3] ?? 0 };
}

function validPoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1e12 && Math.abs(point.y) <= 1e12;
}
