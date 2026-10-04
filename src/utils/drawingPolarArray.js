import { finiteArrayPoint, normalizeArrayMotif, prepareArrayMotif, transformArrayPart } from './drawingArrayGeometry.js';
import { canEditEntity, createDrawingId } from './drawingDocument.js';
import { rotateEntity, rotatePoint, translateEntity } from './drawingGeometry.js';
import {
    IDENTITY_AFFINE_MATRIX,
    multiplyAffineMatrices,
    transformAffinePoint,
    transformDrawingEntityAffine,
} from './drawingBlocks.js';
import { getDrawingEntityDependencyIds } from './drawingDimensions.js';

export function normalizePolarArray(value) {
    if (value?.kind !== 'polar' || !Number.isFinite(value.angle) || Math.abs(value.angle) < 1e-6 || Math.abs(value.angle) > 360
        || !finiteArrayPoint(value.center)) return null;
    const motif = normalizeArrayMotif(value);
    return motif ? { ...motif, rotateItems: value.rotateItems !== false } : null;
}

export function beginPolarArray(content, entityIds, defaults = {}) {
    const motif = prepareArrayMotif(content, entityIds, defaults);
    return motif ? { ...motif, type: 'array', arrayKind: 'polar', stage: 'array-center', angle: 360, rotateItems: true } : null;
}

export function beginPolarArrayEdit(content, entityIds) {
    if (entityIds?.length !== 1) return null;
    const entity = content.entities.find(item => item.id === entityIds[0]);
    const definition = entity && canEditEntity(content, entity) && normalizePolarArray(entity.array);
    if (!definition) return null;
    return {
        ...definition, type: 'array', arrayKind: 'polar', stage: 'array-edit',
        editingId: entity.id, entityIds: [entity.id], appearance: entity,
    };
}

export function polarArrayParts(definition) {
    const array = normalizePolarArray({ ...definition, kind: 'polar' });
    if (!array) return [];
    const divisor = Math.abs(array.angle) === 360 ? array.count : Math.max(1, array.count - 1);
    const parts = [];
    for (let index = 0; index < array.count; index += 1) {
        const angle = array.angle * index / divisor;
        const destination = rotatePoint(array.basePoint, array.center, angle);
        for (const seed of array.seedParts) {
            const placed = array.rotateItems
                ? rotateEntity(seed, angle, array.center)
                : translateEntity(seed, destination.x - array.basePoint.x, destination.y - array.basePoint.y);
            parts.push(transformArrayPart(placed, array.transform));
        }
    }
    return parts;
}

export function createPolarArrayDraft(content, operation, livePoint = null) {
    if (operation?.arrayKind !== 'polar') return [];
    const center = operation.stage === 'array-center' ? livePoint : operation.center;
    const parts = polarArrayParts({ ...operation, center });
    if (!parts.length) return [];
    const source = operation.appearance || content.entities.find(entity => entity.id === operation.entityIds[0]);
    return [{ ...source, id: 'array-preview', type: 'polyline', parts, previewMode: 'array', array: undefined }];
}

export function commitPolarArray(content, operation) {
    const { count, angle, rotateItems, center, basePoint, seedParts, transform } = operation;
    const array = normalizePolarArray({ kind: 'polar', count, angle, rotateItems, center, basePoint, seedParts, transform });
    if (!array) return { changed: false, content };
    const selected = new Set(operation.entityIds);
    const sources = content.entities.filter(entity => selected.has(entity.id));
    if (!sources.length || sources.some(entity => !canEditEntity(content, entity))) return { changed: false, content };
    const original = sources[0];
    const appearance = Object.fromEntries(['layerId', 'color', 'lineWeight', 'lineWidth', 'lineType', 'transparency']
        .filter(key => Object.hasOwn(original, key)).map(key => [key, original[key]]));
    const entity = {
        ...appearance, id: operation.editingId || createDrawingId('polyline'), type: 'polyline',
        parts: polarArrayParts(array), array,
    };
    const entities = operation.editingId
        ? content.entities.map(item => item.id === operation.editingId ? entity : item)
        : [...content.entities.filter(item => !selected.has(item.id)
            && !getDrawingEntityDependencyIds(item).some(id => selected.has(id))), entity];
    return { changed: true, entity, selectedIds: [entity.id], content: { ...content, entities } };
}

export function polarArrayControlGeometry(operation) {
    if (operation?.arrayKind !== 'polar' || operation.stage !== 'array-edit' || !operation.center) return null;
    const matrix = operation.transform || IDENTITY_AFFINE_MATRIX;
    return {
        center: transformAffinePoint(operation.center, matrix),
        base: transformAffinePoint(operation.basePoint, matrix),
        end: transformAffinePoint(rotatePoint(operation.basePoint, operation.center, operation.angle), matrix),
    };
}

export function editPolarArrayPoint(operation, handle, worldPoint) {
    const matrix = operation.transform || IDENTITY_AFFINE_MATRIX;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (!finiteArrayPoint(worldPoint) || Math.abs(determinant) < 1e-12) return operation;
    const dx = worldPoint.x - matrix.e;
    const dy = worldPoint.y - matrix.f;
    const point = { x: (matrix.d * dx - matrix.c * dy) / determinant, y: (-matrix.b * dx + matrix.a * dy) / determinant };
    if (handle === 'center') return { ...operation, center: point, stage: 'array-edit' };
    if (handle === 'angle' && operation.center) {
        const start = Math.atan2(operation.basePoint.y - operation.center.y, operation.basePoint.x - operation.center.x);
        const end = Math.atan2(point.y - operation.center.y, point.x - operation.center.x);
        const magnitude = ((end - start) * 180 / Math.PI + 360) % 360;
        const angle = magnitude < 1e-6 ? 360 : magnitude;
        return { ...operation, angle: operation.angle < 0 ? angle - 360 || -360 : angle };
    }
    return operation;
}

export function transformPolarArrayEntity(entity, matrix) {
    const array = normalizePolarArray(entity.array);
    if (!array) return transformDrawingEntityAffine({ ...entity, array: undefined }, matrix);
    const transformed = { ...array, transform: multiplyAffineMatrices(matrix, array.transform) };
    return { ...entity, array: transformed, parts: polarArrayParts(transformed) };
}

