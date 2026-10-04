import { canEditEntity, createDrawingId } from './drawingDocument.js';
import { rotateEntity, translateEntity } from './drawingGeometry.js';
import { multiplyAffineMatrices, transformAffinePoint, transformDrawingEntityAffine } from './drawingBlocks.js';
import { finiteArrayPoint, inverseArrayTransform, normalizeArrayMotif, prepareArrayMotif, transformArrayPart } from './drawingArrayGeometry.js';
import { closestPointOnPath, extractEntityPaths, normalizeCurvePath, pathLength, pathPointAt, pathTangentAt, reversePath } from './drawingCurveKernel.js';
import { getDrawingEntityDependencyIds } from './drawingDimensions.js';

export function normalizePathArray(value) {
    if (value?.kind !== 'path') return null;
    const motif = normalizeArrayMotif(value);
    const path = normalizeCurvePath(value.path);
    const length = path && pathLength(path);
    if (!motif || !length || !Number.isFinite(value.offset) || value.offset < 0 || value.offset >= length
        || !['divide', 'measure'].includes(value.mode)) return null;
    let count = motif.count;
    if (value.mode === 'measure') {
        if (!Number.isFinite(value.spacing) || value.spacing <= 1e-9) return null;
        const available = length - value.offset;
        count = Math.floor((available + 1e-9) / value.spacing) + 1;
        if (path.closed && value.offset === 0 && Math.abs((count - 1) * value.spacing - length) < 1e-8) count -= 1;
        if (count < 1 || count > 100 || count * motif.seedParts.length > 100_000) return null;
    }
    return { ...motif, path, count, align: value.align !== false, reverse: Boolean(value.reverse) };
}

export function beginPathArray(content, entityIds, defaults = {}) {
    const motif = prepareArrayMotif(content, entityIds, defaults);
    return motif ? { ...motif, type: 'array', arrayKind: 'path', stage: 'array-path',
        mode: 'divide', spacing: 1, offset: 0, align: true, reverse: false } : null;
}

export function choosePathArraySource(content, operation, sourceId) {
    const source = content.entities.find(entity => entity.id === sourceId);
    if (!source || source.array || operation.entityIds.includes(sourceId)) return null;
    const path = sourcePathInFrame(source, operation.transform);
    const definition = normalizePathArray({ ...operation, kind: 'path', path, offset: 0 });
    return definition ? { ...operation, ...definition, sourceId, stage: 'array-edit' } : null;
}

export function beginPathArrayEdit(content, entityIds) {
    if (entityIds?.length !== 1) return null;
    const entity = content.entities.find(item => item.id === entityIds[0]);
    const definition = entity && canEditEntity(content, entity) && normalizePathArray(entity.array);
    return definition ? { ...definition, type: 'array', arrayKind: 'path', stage: 'array-edit',
        sourceId: entity.sourceId, editingId: entity.id, entityIds: [entity.id], appearance: entity } : null;
}

function pathArrayStations(array) {
    const path = array.reverse ? reversePath(array.path) : array.path;
    const length = pathLength(path);
    const divisor = path.closed && array.offset === 0 ? array.count : Math.max(1, array.count - 1);
    const step = array.mode === 'measure' ? array.spacing : (length - array.offset) / divisor;
    return Array.from({ length: array.count }, (_, index) => {
        const parameter = Math.min(1, (array.offset + index * step) / length);
        const point = pathPointAt(path, parameter);
        let tangent = pathTangentAt(path, parameter);
        if (!tangent && point) {
            const before = pathPointAt(path, Math.max(0, parameter - 1e-6));
            const after = pathPointAt(path, Math.min(1, parameter + 1e-6));
            const length = before && after && Math.hypot(after.x - before.x, after.y - before.y);
            if (length) tangent = { x: (after.x - before.x) / length, y: (after.y - before.y) / length };
        }
        return { point, tangent, parameter };
    });
}

export function pathArrayParts(definition) {
    const array = normalizePathArray({ ...definition, kind: 'path' });
    if (!array) return [];
    return pathArrayStations(array).flatMap(({ point, tangent }) => {
        if (!point || !tangent) return [];
        const angle = array.align ? Math.atan2(tangent.y, tangent.x) * 180 / Math.PI : 0;
        return array.seedParts.map(seed => transformArrayPart(translateEntity(
            rotateEntity(seed, angle, array.basePoint), point.x - array.basePoint.x, point.y - array.basePoint.y,
        ), array.transform));
    });
}

export function createPathArrayDraft(content, operation) {
    const parts = pathArrayParts(operation);
    if (!parts.length) return [];
    const source = operation.appearance || content.entities.find(entity => entity.id === operation.entityIds[0]);
    return [{ ...source, id: 'array-preview', type: 'polyline', parts, previewMode: 'array', array: undefined }];
}

export function commitPathArray(content, operation) {
    const { count, basePoint, seedParts, transform, path, mode, spacing, offset, align, reverse } = operation;
    const array = normalizePathArray({ kind: 'path', count, basePoint, seedParts, transform, path, mode, spacing, offset, align, reverse });
    if (!array) return { changed: false, content };
    const selected = new Set(operation.entityIds);
    const sources = content.entities.filter(entity => selected.has(entity.id));
    if (!sources.length || sources.some(entity => !canEditEntity(content, entity))) return { changed: false, content };
    const original = sources[0];
    const appearance = Object.fromEntries(['layerId', 'color', 'lineWeight', 'lineWidth', 'lineType', 'transparency']
        .filter(key => Object.hasOwn(original, key)).map(key => [key, original[key]]));
    const parts = pathArrayParts(array);
    if (parts.length !== array.seedParts.length * array.count) return { changed: false, content };
    const entity = { ...appearance, id: operation.editingId || createDrawingId('polyline'), type: 'polyline',
        parts, array, ...(operation.sourceId ? { sourceId: operation.sourceId } : {}) };
    const entities = operation.editingId
        ? content.entities.map(item => item.id === operation.editingId ? entity : item)
        : [...content.entities.filter(item => !selected.has(item.id)
            && !getDrawingEntityDependencyIds(item).some(id => selected.has(id))), entity];
    return { changed: true, entity, selectedIds: [entity.id], content: { ...content, entities } };
}

export function transformPathArrayEntity(entity, matrix) {
    const array = normalizePathArray(entity.array);
    if (!array) return transformDrawingEntityAffine({ ...entity, array: undefined }, matrix);
    const transformed = { ...array, transform: multiplyAffineMatrices(matrix, array.transform) };
    return { ...entity, array: transformed, parts: pathArrayParts(transformed) };
}

export function pathArrayControlGeometry(operation) {
    if (operation?.arrayKind !== 'path' || operation.stage !== 'array-edit') return null;
    const array = normalizePathArray({ ...operation, kind: 'path' });
    if (!array) return null;
    const stations = pathArrayStations(array);
    return {
        start: transformAffinePoint(stations[0].point, array.transform),
        spacing: stations.length > 1 ? transformAffinePoint(stations[1].point, array.transform) : null,
    };
}

export function editPathArrayPoint(operation, handle, worldPoint) {
    const array = normalizePathArray({ ...operation, kind: 'path' });
    const inverse = array && inverseArrayTransform(array.transform);
    if (!inverse || !finiteArrayPoint(worldPoint)) return operation;
    const point = transformAffinePoint(worldPoint, inverse);
    if (handle === 'base') return { ...operation, basePoint: point, stage: 'array-edit' };
    const path = array.reverse ? reversePath(array.path) : array.path;
    const hit = closestPointOnPath(path, point);
    if (!hit) return operation;
    const distance = hit.pathT * pathLength(path);
    const changes = handle === 'offset' ? { offset: distance } : handle === 'spacing'
        ? { spacing: distance - array.offset, mode: 'measure' } : {};
    const next = normalizePathArray({ ...array, ...changes });
    return next ? { ...operation, ...next, stage: 'array-edit' } : operation;
}

export function refreshPathArrays(content, previous = null) {
    if (!content?.entities?.some(entity => entity.array?.kind === 'path' && entity.sourceId)) return content;
    const entitiesById = new Map(content.entities.map(entity => [entity.id, entity]));
    const previousById = new Map((previous?.entities || []).map(entity => [entity.id, entity]));
    let changed = false;
    const entities = content.entities.map(entity => {
        if (entity.array?.kind !== 'path' || !entity.sourceId) return entity;
        const source = entitiesById.get(entity.sourceId);
        const oldEntity = previousById.get(entity.id);
        const oldSource = previousById.get(entity.sourceId);
        const movedAlone = oldEntity && JSON.stringify(oldEntity.array?.transform) !== JSON.stringify(entity.array.transform)
            && source === oldSource;
        if (!source || source.array || movedAlone) {
            changed = true;
            const { sourceId, ...detached } = entity;
            return detached;
        }
        if (previous && source === oldSource) return entity;
        const path = sourcePathInFrame(source, entity.array.transform);
        if (JSON.stringify(path) === JSON.stringify(entity.array.path)) return entity;
        const array = normalizePathArray({ ...entity.array, path });
        changed = true;
        if (!array) {
            const { sourceId, ...detached } = entity;
            return detached;
        }
        const parts = pathArrayParts(array);
        if (parts.length !== array.count * array.seedParts.length) {
            const { sourceId, ...detached } = entity;
            return detached;
        }
        return { ...entity, array, parts };
    });
    return changed ? { ...content, entities } : content;
}

function sourcePathInFrame(source, transform) {
    const paths = extractEntityPaths(source);
    const inverse = inverseArrayTransform(transform);
    if (paths.length !== 1 || !inverse) return null;
    return normalizeCurvePath({ ...paths[0], parts: paths[0].parts.map(part => transformArrayPart(part, inverse)) });
}
