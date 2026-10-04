import { canEditEntity } from './drawingDocument.js';
import { getEntityBounds } from './drawingGeometry.js';
import { IDENTITY_AFFINE_MATRIX, transformDrawingEntityAffine } from './drawingBlocks.js';
import { transformAdvancedCurveAffine } from './drawingAdvancedEntities.js';
import { extractEntityPaths } from './drawingCurveKernel.js';

const MAX_PARTS = 100_000;
const SOURCE_TYPES = new Set(['line', 'rectangle', 'circle', 'polygon', 'arc', 'polyline', 'ellipse', 'spline']);
export const finiteArrayPoint = point => point && [point.x, point.y].every(Number.isFinite);

export function normalizeArrayMotif(value) {
    if (!value || !Number.isInteger(value.count) || value.count < 1 || value.count > 100
        || !finiteArrayPoint(value.basePoint) || !Array.isArray(value.seedParts) || !value.seedParts.length
        || value.seedParts.length * value.count > MAX_PARTS) return null;
    const matrix = value.transform || IDENTITY_AFFINE_MATRIX;
    if (!['a', 'b', 'c', 'd', 'e', 'f'].every(key => Number.isFinite(matrix[key]))
        || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-12) return null;
    if (value.seedParts.some(part => !SOURCE_TYPES.has(part?.type) || part.array || part.parts
        || !validBounds(getEntityBounds(part)))) return null;
    return { ...value, transform: { ...matrix } };
}

export function prepareArrayMotif(content, entityIds, defaults = {}) {
    const ids = new Set(entityIds);
    const sources = content.entities.filter(entity => ids.has(entity.id) && SOURCE_TYPES.has(entity.type) && canEditEntity(content, entity));
    const seedParts = sources.flatMap(seedPartsOf);
    if (seedParts.some(part => !part)) return null;
    const bounds = seedParts.map(part => getEntityBounds(part));
    if (!sources.length || !seedParts.length || bounds.some(bound => !validBounds(bound))) return null;
    const basePoint = { x: Math.min(...bounds.map(bound => bound.minX)), y: Math.min(...bounds.map(bound => bound.minY)) };
    const count = Number.isInteger(defaults.count) && defaults.count >= 1 && defaults.count <= 100 ? defaults.count : 6;
    if (seedParts.length * count > MAX_PARTS) return null;
    return { entityIds: sources.map(entity => entity.id), basePoint, seedParts, count, transform: { ...IDENTITY_AFFINE_MATRIX } };
}

export function inverseArrayTransform(matrix) {
    const { a, b, c, d, e, f } = matrix || IDENTITY_AFFINE_MATRIX;
    const determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
    return { a: d / determinant, b: -b / determinant, c: -c / determinant, d: a / determinant,
        e: (c * f - d * e) / determinant, f: (b * e - a * f) / determinant };
}

export function transformArrayPart(part, matrix) {
    if (Object.keys(IDENTITY_AFFINE_MATRIX).every(key => matrix[key] === IDENTITY_AFFINE_MATRIX[key])) return part;
    if (part.type === 'circle' || part.type === 'arc') {
        return transformAdvancedCurveAffine({
            ...part, type: 'ellipse', rx: Math.abs(part.r), ry: Math.abs(part.r), rotation: 0,
            fullEllipse: part.type === 'circle',
        }, matrix);
    }
    if (part.type === 'rectangle' || part.type === 'polygon') {
        const paths = extractEntityPaths(part);
        return { ...part, type: 'polyline', closed: true, parts: paths.flatMap(path => path.parts.map(curve => transformArrayPart(curve, matrix))) };
    }
    if (part.type === 'polyline' && part.parts) return { ...part, parts: part.parts.map(child => transformArrayPart(child, matrix)) };
    return transformDrawingEntityAffine(part, matrix);
}

function seedPartsOf(entity) {
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) return entity.parts.flatMap(seedPartsOf);
    const { id, layerId, locked, array, sourceId, sourceIds, previewMode, ...part } = entity;
    return SOURCE_TYPES.has(part.type) ? [part] : [null];
}

function validBounds(bounds) {
    return bounds && Object.values(bounds).every(Number.isFinite);
}
