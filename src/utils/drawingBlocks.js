import { normalizeDrawingBlockClip, clippedDrawingBlockBounds, drawingBlockClipShape } from './drawingBlockClip.js';
import { normalizeDrawingPdfUnderlay } from './drawingPdfMetadata.js';
import { normalizeDrawingReference, isDrawingReferenceUnloaded, remapDrawingReferenceResources } from './drawingReferenceMetadata.js';
import { DRAWING_LEADER_PRESENTATION, normalizeDrawingLeader } from './drawingLeaders.js';
import { drawingDimensionPresentationPoints } from './drawingDimensionPresentation.js';
import { drawingAttributeValues, resolveDrawingAttributeText, normalizeDrawingAttributeValues } from './drawingBlockAttributes.js';
import { drawingAffineFrame, transformDrawingAffineFrame, framedDrawingPoint } from './drawingAffineFrame.js';
import { IDENTITY_AFFINE_MATRIX, normalizeAffineMatrix, multiplyAffineMatrices, translationAffineMatrix, rotationAffineMatrix, scaleAffineMatrix, mirrorAffineMatrix, transformAffinePoint, affineMatrixToSvg, inverseAffineViewBox } from './drawingAffine.js';
export { IDENTITY_AFFINE_MATRIX, normalizeAffineMatrix, multiplyAffineMatrices, translationAffineMatrix, rotationAffineMatrix, scaleAffineMatrix, mirrorAffineMatrix, transformAffinePoint, affineMatrixToSvg, inverseAffineViewBox } from './drawingAffine.js';
import { getDrawingTextLayout, resolveDrawingTextStyle } from './drawingText.js';
import { transformDefinedSpline } from './drawingSplineCreation.js';
import { transformPathArrayEntity } from './drawingPathArray.js';
import { transformPolarArrayEntity } from './drawingPolarArray.js';
import {
    arcPoint,
    getArcBounds,
    getRectangleOutlinePoints,
    getRegularPolygonVertices,
} from './drawingCurves.js';
import {
    getAdvancedEntityBounds,
    getHatchBoundaryEntities,
    transformAdvancedCurveAffine,
    transformHatchPatternAffine,
} from './drawingAdvancedEntities.js';
import {
    getDimensionGeometry,
    isDrawingDimensionEntity,
    remapDrawingEntityDependencies,
} from './drawingDimensions.js';

const EPSILON = 1e-9;
const MAX_BLOCK_DEFINITIONS = 1_024;
const MAX_BLOCK_ENTITIES = 100_000;

export const DRAWING_BLOCK_REFERENCE_TYPE = 'blockReference';
export function normalizeDrawingBlockReference(entity) {
    if (!entity || entity.type !== DRAWING_BLOCK_REFERENCE_TYPE) return entity;
    const { leader: rawLeader, blockClip: rawClip, externalReference: rawReference, pdfUnderlay: rawPdf, spaceTransfer, ...source } = entity;
    const pdfUnderlay = normalizeDrawingPdfUnderlay(rawPdf);
    const externalReference = normalizeDrawingReference(rawReference);
    const blockClip = normalizeDrawingBlockClip(rawClip);
    const leader = normalizeDrawingLeader(rawLeader, Boolean(entity[DRAWING_LEADER_PRESENTATION]));
    const legacyTransform = legacyBlockReferenceMatrix(entity);
    const definitionBounds = normalizeBounds(entity.definitionBounds);
    return {
        ...source,
        ...(externalReference ? { externalReference } : {}),
        ...(pdfUnderlay ? { pdfUnderlay } : {}),
        ...(leader ? { leader } : {}),
        ...(blockClip ? { blockClip } : {}),
        ...(spaceTransfer === true ? { spaceTransfer: true } : {}),
        type: DRAWING_BLOCK_REFERENCE_TYPE,
        blockId: typeof entity.blockId === 'string' ? entity.blockId : '',
        transform: normalizeAffineMatrix(entity.transform, legacyTransform),
        ...(entity.attributeValues ? { attributeValues: normalizeDrawingAttributeValues(entity.attributeValues) } : {}),
        ...(definitionBounds ? { definitionBounds } : {}),
    };
}

export function transformDrawingBlockReference(entity, matrix) {
    const reference = normalizeDrawingBlockReference(entity);
    if (!reference || reference.type !== DRAWING_BLOCK_REFERENCE_TYPE) return entity;
    return {
        ...reference,
        transform: multiplyAffineMatrices(matrix, reference.transform),
    };
}

export function getDrawingBlockReferenceInsertionPoint(entity) {
    const reference = normalizeDrawingBlockReference(entity);
    return reference?.type === DRAWING_BLOCK_REFERENCE_TYPE
        ? transformAffinePoint({ x: 0, y: 0 }, reference.transform)
        : null;
}

export function moveDrawingBlockReferenceInsertion(entity, point) {
    const current = getDrawingBlockReferenceInsertionPoint(entity);
    if (!current || !isFinitePoint(point)) return entity;
    return transformDrawingBlockReference(entity, translationAffineMatrix(point.x - current.x, point.y - current.y));
}

export function normalizeDrawingBlocks(blocks, { normalizeEntity = entity => ({ ...entity }) } = {}) {
    if (!Array.isArray(blocks)) return [];
    const seen = new Set();
    let entityCount = 0;
    return blocks.slice(0, MAX_BLOCK_DEFINITIONS).flatMap((candidate, index) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const id = typeof candidate.id === 'string' && candidate.id ? candidate.id : createBlockId('block');
        if (seen.has(id)) return [];
        seen.add(id);
        const sourceEntities = Array.isArray(candidate.entities) ? candidate.entities : [];
        const remaining = Math.max(0, MAX_BLOCK_ENTITIES - entityCount);
        const entities = sourceEntities.slice(0, remaining).flatMap(entity => {
            if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return [];
            const normalized = normalizeEntity({
                ...entity,
                id: typeof entity.id === 'string' && entity.id ? entity.id : createBlockId(entity.type || 'entity'),
            });
            return normalized ? [normalized] : [];
        });
        entityCount += entities.length;
        const block = {
            ...candidate,
            id,
            name: typeof candidate.name === 'string' && candidate.name ? candidate.name : `*U${index + 1}`,
            basePoint: normalizePoint(candidate.basePoint) || { x: 0, y: 0 },
            entities,
        };
        const bounds = getDrawingBlockDefinitionBounds(block, blocks);
        return [{ ...block, ...(bounds ? { bounds } : {}) }];
    });
}

export function createAnonymousDrawingBlock(entities, {
    basePoint = { x: 0, y: 0 },
    id = createBlockId('block'),
    name = null,
} = {}) {
    const base = normalizePoint(basePoint) || { x: 0, y: 0 };
    const localEntities = (Array.isArray(entities) ? entities : [])
        .filter(entity => entity && typeof entity === 'object' && !Array.isArray(entity))
        .map(entity => translateDrawingBlockEntity(cloneJson(entity), -base.x, -base.y));
    const definition = {
        id,
        name: name || `*U${id.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}`,
        basePoint: { x: 0, y: 0 },
        entities: localEntities,
    };
    const bounds = getDrawingBlockDefinitionBounds(definition);
    return { ...definition, ...(bounds ? { bounds } : {}) };
}

export function createAnonymousDrawingBlockReference(definition, {
    insertionPoint = { x: 0, y: 0 },
    layerId = 'geometry',
    id = createBlockId(DRAWING_BLOCK_REFERENCE_TYPE),
} = {}) {
    const insertion = normalizePoint(insertionPoint) || { x: 0, y: 0 };
    const bounds = normalizeBounds(definition?.bounds) || getDrawingBlockDefinitionBounds(definition);
    return {
        id,
        type: DRAWING_BLOCK_REFERENCE_TYPE,
        layerId,
        blockId: definition?.id || '',
        ...(Object.keys(drawingAttributeValues(definition)).length ? { attributeValues: drawingAttributeValues(definition) } : {}),
        transform: translationAffineMatrix(insertion.x, insertion.y),
        ...(bounds ? { definitionBounds: bounds } : {}),
    };
}

export function getDrawingBlockDefinition(blocks, blockId) {
    return (Array.isArray(blocks) ? blocks : []).find(block => block?.id === blockId) || null;
}

export function getDrawingBlockDefinitionBounds(definition, blocks = [], reference = {}) {
    if (!definition || !Array.isArray(definition.entities)) return null;
    const blockMap = new Map((Array.isArray(blocks) ? blocks : []).map(block => [block.id, block]));
    if (definition.id) blockMap.set(definition.id, definition);
    const entityMap = new Map(definition.entities.map(entity => [entity.id, entity]));
    return definition.entities.reduce((combined, entity) => (
        combineBounds(combined, getDrawingBlockEntityBounds(resolveDrawingAttributeText(entity, reference, 'all'), blockMap, entityMap, new Set([definition.id])))
    ), null);
}

export function getDrawingBlockReferenceBounds(reference, blocks = []) {
    if (isDrawingReferenceUnloaded(reference)) return null;
    if (reference?.type !== DRAWING_BLOCK_REFERENCE_TYPE) return null;
    const definition = getDrawingBlockDefinition(blocks, reference.blockId);
    const localBounds = clippedDrawingBlockBounds(getDrawingBlockDefinitionBounds(definition, blocks, reference)
        || normalizeBounds(reference.definitionBounds), reference);
    if (!localBounds) return null;
    const corners = boundsCorners(localBounds).map(point => transformAffinePoint(point, reference.transform));
    return boundsFromPoints(corners);
}

export function materializeDrawingBlockReference(reference, blocks, {
    recursive = false,
    maxDepth = 16,
    textStyles = [],
} = {}) {
    const definition = getDrawingBlockDefinition(blocks, reference?.blockId);
    if (!definition || drawingBlockClipShape(reference) || reference.externalReference || reference.pdfUnderlay) return [];
    return definition.entities.flatMap(entity => {
        const child = resolveDrawingBlockChild(entity, reference, 'all');
        const transformed = transformDrawingEntityAffine(cloneJson(child), reference.transform, { textStyles });
        if (recursive && transformed.type === DRAWING_BLOCK_REFERENCE_TYPE && maxDepth > 0) {
            return materializeDrawingBlockReference(transformed, blocks, { recursive, maxDepth: maxDepth - 1, textStyles });
        }
        return [transformed];
    });
}

export function drawingBlocksUseLayer(blocks, layerId) {
    return (Array.isArray(blocks) ? blocks : []).some(block => (
        Array.isArray(block.entities) && block.entities.some(entity => drawingBlockEntityUsesLayer(entity, layerId))
    ));
}

export function collectDrawingBlockDependencies(blocks, blockIds) {
    const blockMap = new Map((Array.isArray(blocks) ? blocks : []).map(block => [block.id, block]));
    const pending = [...new Set(blockIds || [])];
    const collected = [];
    const seen = new Set();
    while (pending.length) {
        const id = pending.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        const block = blockMap.get(id);
        if (!block) continue;
        collected.push(block);
        block.entities?.forEach(entity => {
            if (entity.type === DRAWING_BLOCK_REFERENCE_TYPE && entity.blockId) pending.push(entity.blockId);
        });
    }
    return collected;
}

export function remapDrawingBlockDefinition(block, {
    blockIdMap = new Map(),
    entityIdMap = new Map(),
    layerIdMap = new Map(),
    assetIdMap = new Map(),
} = {}) {
    const id = blockIdMap.get(block.id) || block.id;
    const localIdMap = new Map((block.entities || []).map(entity => [
        entity.id,
        entityIdMap.get(entity.id) || createBlockId(entity.type || 'entity'),
    ]));
    const entities = (block.entities || []).map(entity => remapDrawingBlockEntity(entity, {
        blockIdMap,
        entityIdMap: localIdMap,
        layerIdMap,
        assetIdMap,
    }));
    const remapped = { ...block, id, entities };
    const bounds = getDrawingBlockDefinitionBounds(remapped);
    return { ...remapped, ...(bounds ? { bounds } : {}) };
}

export function remapDrawingBlockEntity(entity, {
    blockIdMap = new Map(),
    entityIdMap = new Map(),
    layerIdMap = new Map(),
    assetIdMap = new Map(),
} = {}) {
    const next = cloneJson(entity);
    if (entityIdMap.has(next.id)) next.id = entityIdMap.get(next.id);
    Object.assign(next, remapDrawingEntityDependencies(next, entityIdMap, { preserveAppearance: true }));
    if (next.layerId && layerIdMap.has(next.layerId)) next.layerId = layerIdMap.get(next.layerId);
    if (next.assetId && assetIdMap.has(next.assetId)) next.assetId = assetIdMap.get(next.assetId);
    if (next.pdfUnderlay && assetIdMap.has(next.pdfUnderlay.assetId)) next.pdfUnderlay.assetId = assetIdMap.get(next.pdfUnderlay.assetId);
    if (next.blockId && blockIdMap.has(next.blockId)) next.blockId = blockIdMap.get(next.blockId);
    if (next.externalReference) next.externalReference = remapDrawingReferenceResources(next.externalReference, {
        blocks: blockIdMap, layers: layerIdMap, assets: assetIdMap,
    });
    return next;
}

export function transformDrawingEntityAffine(entity, matrix, { textStyles = [] } = {}) {
    if (entity?.detachedSource) {
        const { detachedSource, ...rest } = entity;
        const transformedSource = transformDrawingEntityAffine(detachedSource, matrix, { textStyles });
        if (['radialDimension', 'centerMark'].includes(entity.type) && !['circle', 'arc', 'ellipse'].includes(transformedSource.type)) return entity;
        if (entity.type === 'arcLengthDimension' && !['arc', 'ellipse'].includes(transformedSource.type)) return entity;
        return { ...transformDrawingEntityAffine(entity.type === 'radialDimension' ? { ...rest, angle: Number.isFinite(rest.angle) ? rest.angle : -Math.PI / 4 } : rest, matrix, { textStyles }), detachedSource: transformedSource };
    }
    if (drawingAffineFrame(entity)) return transformDrawingAffineFrame(entity, matrix);
    if (entity.splineDefinition) {
        const defined = transformDefinedSpline(entity, matrix);
        if (defined) return defined;
    }
    if (entity.array?.kind === 'path') return transformPathArrayEntity(entity, matrix);
    if (entity.array?.kind === 'polar') return transformPolarArrayEntity(entity, matrix);
    if (entity.type === DRAWING_BLOCK_REFERENCE_TYPE) return transformDrawingBlockReference(entity, matrix);
    if (entity.type === 'ellipse' || entity.type === 'spline') {
        return transformAdvancedCurveAffine(entity, matrix);
    }
    if (['hatch', 'region'].includes(entity.type)) return {
        ...entity,
        ...(entity.boundaryPick ? { boundaryPick: transformAffinePoint(entity.boundaryPick, matrix) } : {}),
        boundaries: getHatchBoundaryEntities(entity).map(boundary => transformDrawingEntityAffine(boundary, matrix)),
        ...(entity.type === 'hatch' ? { pattern: transformHatchPatternAffine(entity.pattern, matrix) } : {}),
    };
    if (['line', 'xline', 'ray'].includes(entity.type)) {
        const first = transformAffinePoint({ x: entity.x1, y: entity.y1 }, matrix);
        const second = transformAffinePoint({ x: entity.x2, y: entity.y2 }, matrix);
        return { ...entity, x1: first.x, y1: first.y, x2: second.x, y2: second.y };
    }
    if (entity.type === 'polyline') return {
        ...entity,
        ...transformArrayParameters(entity, matrix),
        ...(Array.isArray(entity.parts)
            ? { parts: entity.parts.map(part => transformDrawingEntityAffine(part, matrix)) }
            : { points: (entity.points || []).map(point => transformAffinePoint(point, matrix)) }),
    };
    if (entity.type === 'circle' || entity.type === 'arc') {
        const similarity = affineSimilarity(matrix);
        if (!similarity) return transformAdvancedCurveAffine({
            ...entity, type: 'ellipse', rx: Math.abs(entity.r), ry: Math.abs(entity.r), rotation: 0,
            fullEllipse: entity.type === 'circle' || Boolean(entity.fullCircle),
        }, matrix);
        const center = transformAffinePoint({ x: entity.cx, y: entity.cy }, matrix);
        if (entity.type === 'circle') return { ...entity, cx: center.x, cy: center.y, r: Math.abs(entity.r) * similarity.scale };
        const start = transformAffinePoint(arcPoint(entity, entity.startAngle), matrix);
        const end = transformAffinePoint(arcPoint(entity, entity.endAngle), matrix);
        return {
            ...entity,
            cx: center.x,
            cy: center.y,
            r: Math.abs(entity.r) * similarity.scale,
            startAngle: Math.atan2(start.y - center.y, start.x - center.x),
            endAngle: Math.atan2(end.y - center.y, end.x - center.x),
            counterClockwise: similarity.reflected ? entity.counterClockwise === false : entity.counterClockwise !== false,
        };
    }
    if (entity.type === 'rectangle' || entity.type === 'polygon') {
        const points = entity.type === 'rectangle' ? getRectangleOutlinePoints(entity) : getRegularPolygonVertices(entity);
        return entityAsTransformedPolyline(entity, points, matrix, true);
    }
    if (entity.type === 'image' || entity.type === 'text') {
        const similarity = affineSimilarity(matrix);
        if (similarity) {
            const center = transformAffinePoint({ x: entity.x + entity.width / 2, y: entity.y + entity.height / 2 }, matrix);
            const width = entity.width * similarity.scale;
            const height = entity.height * similarity.scale;
            const angle = (Number(entity.rotation) || 0) * Math.PI / 180;
            const rotation = similarity.reflected
                ? Math.atan2(matrix.b * Math.cos(angle) + matrix.d * Math.sin(angle),
                    matrix.a * Math.cos(angle) + matrix.c * Math.sin(angle)) * 180 / Math.PI
                : (Number(entity.rotation) || 0) + Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
            return { ...entity, x: center.x - width / 2, y: center.y - height / 2, width, height, rotation,
                ...(similarity.reflected ? { mirrored: !entity.mirrored } : {}),
                ...(entity.type === 'text' && Math.abs(similarity.scale - 1) > EPSILON ? {
                    fontSize: resolveDrawingTextStyle(entity, textStyles).fontSize * similarity.scale,
                    ...(entity.runs ? { runs: entity.runs.map(run => ({ ...run, marks: { ...run.marks,
                        ...(run.marks?.fontSize ? { fontSize: run.marks.fontSize * similarity.scale } : {}),
                    } })) } : {}),
                } : {}),
            };
        }
        return transformDrawingAffineFrame(entity, matrix);
    }
    if (isDrawingDimensionEntity(entity)) return transformDrawingDimensionAffine(entity, matrix);
    return entity;
}

function translateDrawingBlockEntity(entity, dx, dy) {
    if (drawingAffineFrame(entity)) return transformDrawingAffineFrame(entity, translationAffineMatrix(dx, dy));
    if (entity.splineDefinition || ['path', 'polar'].includes(entity.array?.kind) || entity.type === 'hatch') {
        return transformDrawingEntityAffine(entity, translationAffineMatrix(dx, dy));
    }
    if (entity.type === DRAWING_BLOCK_REFERENCE_TYPE) {
        return transformDrawingBlockReference(entity, translationAffineMatrix(dx, dy));
    }
    if (entity.type === 'ellipse' || entity.type === 'spline') {
        return transformAdvancedCurveAffine(entity, translationAffineMatrix(dx, dy));
    }
    if (['hatch', 'region'].includes(entity.type)) return {
        ...entity,
        boundaries: getHatchBoundaryEntities(entity).map(boundary => translateDrawingBlockEntity(boundary, dx, dy)),
        ...(entity.type === 'hatch' ? { pattern: transformHatchPatternAffine(entity.pattern, translationAffineMatrix(dx, dy)) } : {}),
    };
    if (['line', 'xline', 'ray'].includes(entity.type)) return { ...entity, x1: entity.x1 + dx, y1: entity.y1 + dy, x2: entity.x2 + dx, y2: entity.y2 + dy };
    if (['rectangle', 'image', 'text'].includes(entity.type)) return { ...entity, x: entity.x + dx, y: entity.y + dy };
    if (['circle', 'polygon', 'arc'].includes(entity.type)) return { ...entity, cx: entity.cx + dx, cy: entity.cy + dy };
    if (entity.type === 'polyline') return {
        ...entity,
        ...(Array.isArray(entity.parts)
            ? { parts: entity.parts.map(part => translateDrawingBlockEntity(part, dx, dy)) }
            : { points: (entity.points || []).map(point => ({ x: point.x + dx, y: point.y + dy })) }),
    };
    if (isDrawingDimensionEntity(entity)) {
        return transformDrawingDimensionAffine(entity, translationAffineMatrix(dx, dy));
    }
    return entity;
}

function getDrawingBlockEntityBounds(entity, blockMap, entityMap, visiting) {
    if (!entity || isDrawingReferenceUnloaded(entity)) return null;
    if (entity.type === DRAWING_BLOCK_REFERENCE_TYPE) {
        if (visiting.has(entity.blockId)) return normalizeBounds(entity.definitionBounds);
        const definition = blockMap.get(entity.blockId);
        if (!definition) return getDrawingBlockReferenceBounds(entity);
        const nextVisiting = new Set(visiting);
        nextVisiting.add(entity.blockId);
        const localMap = new Map(definition.entities.map(child => [child.id, child]));
        const localBounds = clippedDrawingBlockBounds(definition.entities.reduce((combined, child) => (
            combineBounds(combined, getDrawingBlockEntityBounds(resolveDrawingAttributeText(child, entity, 'all'), blockMap, localMap, nextVisiting))
        ), null), entity);
        if (!localBounds) return null;
        return boundsFromPoints(boundsCorners(localBounds).map(point => transformAffinePoint(point, entity.transform)));
    }
    if (['line', 'xline', 'ray'].includes(entity.type)) return boundsFromPoints([{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }]);
    if (entity.type === 'ellipse' || entity.type === 'spline') return getAdvancedEntityBounds(entity);
    if (['hatch', 'region'].includes(entity.type)) return getHatchBoundaryEntities(entity).reduce((combined, boundary) => (
        combineBounds(combined, getDrawingBlockEntityBounds(boundary, blockMap, entityMap, visiting))
    ), null);
    if (entity.type === 'circle') {
        const radius = Math.abs(Number(entity.r) || 0);
        return normalizeBounds({ minX: entity.cx - radius, minY: entity.cy - radius, maxX: entity.cx + radius, maxY: entity.cy + radius });
    }
    if (entity.type === 'arc') return normalizeBounds(getArcBounds(entity));
    if (entity.type === 'polygon') return boundsFromPoints(getRegularPolygonVertices(entity));
    if (entity.type === 'rectangle') return boundsFromPoints(getRectangleOutlinePoints(entity));
    if (entity.type === 'text') return boundsFromPoints(textEntityCorners(entity));
    if (entity.type === 'image') return boundsFromPoints(rectEntityCorners(entity));
    if (entity.type === 'polyline') {
        if (Array.isArray(entity.parts)) return entity.parts.reduce((combined, part) => (
            combineBounds(combined, getDrawingBlockEntityBounds(part, blockMap, entityMap, visiting))
        ), null);
        return boundsFromPoints(entity.points || []);
    }
    if (isDrawingDimensionEntity(entity)) {
        const geometry = getDimensionGeometry(entity, entityMap);
        return geometry ? boundsFromPoints(drawingDimensionPresentationPoints(geometry, entity)) : null;
    }
    return null;
}

function transformDrawingDimensionAffine(entity, matrix) {
    const normalized = normalizeAffineMatrix(matrix);
    const next = { ...entity };
    const pointProperties = [
        'p1', 'p2', 'linePoint', 'vertex', 'ray1Point', 'ray2Point',
        'jogCenter', 'jogPoint', 'origin', 'featurePoint', 'leaderPoint', 'dimensionTextPosition',
    ];
    pointProperties.forEach(property => {
        if (isFinitePoint(entity[property])) next[property] = transformAffinePoint(entity[property], normalized);
    });
    if (Array.isArray(entity.sourcePickPoints)) {
        next.sourcePickPoints = entity.sourcePickPoints.map(point => (
            isFinitePoint(point) ? transformAffinePoint(point, normalized) : point
        ));
    }
    ['angle', 'dimensionAngle', 'dimensionTextAngle', 'dimensionExtensionAngle'].forEach(property => {
        if (!Number.isFinite(Number(entity[property]))) return;
        const angle = Number(entity[property]);
        const direction = {
            x: normalized.a * Math.cos(angle) + normalized.c * Math.sin(angle),
            y: normalized.b * Math.cos(angle) + normalized.d * Math.sin(angle),
        };
        if (Math.hypot(direction.x, direction.y) > EPSILON) {
            next[property] = Math.atan2(direction.y, direction.x);
        }
    });
    const determinant = normalized.a * normalized.d - normalized.b * normalized.c;
    const distanceScale = Math.sqrt(Math.abs(determinant));
    if (Number.isFinite(distanceScale) && distanceScale > EPSILON) {
        ['offset', 'radius', 'jogSize', 'size', 'extension', 'textSize'].forEach(property => {
            if (Number.isFinite(Number(entity[property]))) next[property] = Number(entity[property]) * distanceScale;
        });
    }
    if (entity.type === 'angularDimension' && determinant < 0) {
        next.counterClockwise = entity.counterClockwise === false;
    }
    return next;
}

function drawingBlockEntityUsesLayer(entity, layerId) {
    if (entity?.layerId === layerId) return true;
    if (entity?.type === 'polyline' && Array.isArray(entity.parts)) {
        return entity.parts.some(part => drawingBlockEntityUsesLayer(part, layerId));
    }
    return ['hatch', 'region'].includes(entity?.type)
        ? getHatchBoundaryEntities(entity).some(boundary => drawingBlockEntityUsesLayer(boundary, layerId))
        : false;
}

function entityAsTransformedPolyline(entity, points, matrix, closed) {
    const {
        x: _x, y: _y, width: _width, height: _height, rotation: _rotation,
        cx: _cx, cy: _cy, r: _r, sides: _sides, mode: _mode,
        startAngle: _startAngle, endAngle: _endAngle, counterClockwise: _counterClockwise,
        ...properties
    } = entity;
    return { ...properties, type: 'polyline', points: points.map(point => transformAffinePoint(point, matrix)), closed };
}

function affineSimilarity(matrix) {
    const normalized = normalizeAffineMatrix(matrix);
    const firstLength = Math.hypot(normalized.a, normalized.b);
    const secondLength = Math.hypot(normalized.c, normalized.d);
    const dot = normalized.a * normalized.c + normalized.b * normalized.d;
    const tolerance = Math.max(EPSILON, firstLength, secondLength) * 1e-9;
    if (firstLength <= EPSILON || Math.abs(firstLength - secondLength) > tolerance || Math.abs(dot) > tolerance) return null;
    return { scale: firstLength, reflected: normalized.a * normalized.d - normalized.b * normalized.c < 0 };
}

function legacyBlockReferenceMatrix(entity) {
    const x = Number(entity?.x);
    const y = Number(entity?.y);
    const scaleX = Number.isFinite(Number(entity?.scaleX)) ? Number(entity.scaleX) : 1;
    const scaleY = Number.isFinite(Number(entity?.scaleY)) ? Number(entity.scaleY) : scaleX;
    const rotation = Number.isFinite(Number(entity?.rotation)) ? Number(entity.rotation) : 0;
    return multiplyAffineMatrices(
        translationAffineMatrix(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0),
        multiplyAffineMatrices(rotationAffineMatrix(rotation), scaleAffineMatrix(scaleX, scaleY)),
    );
}

function textEntityCorners(entity) {
    const layout = getDrawingTextLayout(entity);
    if (layout.textMode !== 'singleLine') return rectEntityCorners(entity);
    const center = { x: entity.x + entity.width / 2, y: entity.y + entity.height / 2 };
    const angle = (Number(entity.rotation) || 0) * Math.PI / 180;
    const cosine = Math.cos(angle); const sine = Math.sin(angle);
    const corners = layout.styledLines.flatMap(line => {
        const left = line.x - (line.textAnchor === 'middle' ? line.width / 2 : line.textAnchor === 'end' ? line.width : 0);
        return boundsCorners({ minX: left, maxX: left + line.width, minY: line.top, maxY: line.top + line.height });
    }).map(point => {
        const dx = point.x - center.x;
        const dy = (point.y - center.y) * (entity.mirrored ? -1 : 1);
        return framedDrawingPoint(entity, { x: center.x + dx * cosine - dy * sine, y: center.y + dx * sine + dy * cosine });
    });
    return [...rectEntityCorners(entity), ...corners];
}

function rectEntityCorners(entity) {
    const x = Number(entity.x) || 0;
    const y = Number(entity.y) || 0;
    const width = Number(entity.width) || 0;
    const height = Number(entity.height) || 0;
    const center = { x: x + width / 2, y: y + height / 2 };
    const angle = (Number(entity.rotation) || 0) * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return [
        { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
    ].map(point => {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        return framedDrawingPoint(entity, { x: center.x + dx * cosine - dy * sine, y: center.y + dx * sine + dy * cosine });
    });
}

function normalizePoint(point) {
    return isFinitePoint(point) ? { x: Number(point.x), y: Number(point.y) } : null;
}

function normalizeBounds(bounds) {
    if (!bounds || !['minX', 'minY', 'maxX', 'maxY'].every(key => Number.isFinite(Number(bounds[key])))) return null;
    return {
        minX: Math.min(Number(bounds.minX), Number(bounds.maxX)),
        minY: Math.min(Number(bounds.minY), Number(bounds.maxY)),
        maxX: Math.max(Number(bounds.minX), Number(bounds.maxX)),
        maxY: Math.max(Number(bounds.minY), Number(bounds.maxY)),
    };
}

function boundsFromPoints(points) {
    const finite = (points || []).filter(isFinitePoint);
    if (!finite.length) return null;
    return finite.reduce((bounds, point) => ({
        minX: Math.min(bounds.minX, Number(point.x)),
        minY: Math.min(bounds.minY, Number(point.y)),
        maxX: Math.max(bounds.maxX, Number(point.x)),
        maxY: Math.max(bounds.maxY, Number(point.y)),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function combineBounds(left, right) {
    if (!left) return right ? { ...right } : null;
    if (!right) return left;
    return {
        minX: Math.min(left.minX, right.minX),
        minY: Math.min(left.minY, right.minY),
        maxX: Math.max(left.maxX, right.maxX),
        maxY: Math.max(left.maxY, right.maxY),
    };
}

function boundsCorners(bounds) {
    return [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
    ];
}

function isFinitePoint(point) {
    return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
}

function createBlockId(prefix) {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}


export function transformArrayParameters(entity, matrix) {
    if (!entity.array) return {};
    if (['polar', 'path'].includes(entity.array.kind)) return {
        array: { ...entity.array, transform: multiplyAffineMatrices(matrix, entity.array.transform || IDENTITY_AFFINE_MATRIX) },
    };
    const { horizontal, vertical } = entity.array;
    if (![horizontal?.x, horizontal?.y, vertical?.x, vertical?.y].every(Number.isFinite)) return {};
    const vector = value => ({ x: matrix.a * value.x + matrix.c * value.y, y: matrix.b * value.x + matrix.d * value.y });
    return { array: { ...entity.array, horizontal: vector(horizontal), vertical: vector(vertical) } };
}

export function refreshDrawingBlockBounds(content) {
    const source = content.blocks || [];
    const bounds = new Map(source.map(block => [block.id, getDrawingBlockDefinitionBounds(block, source)]));
    const blockMap = new Map(source.map(block => [block.id, block]));
    const refresh = entity => {
        if (entity.type !== 'blockReference') return entity;
        const next = { ...entity };
        const instanceBounds = getDrawingBlockDefinitionBounds(blockMap.get(entity.blockId), source, entity);
        if (instanceBounds) next.definitionBounds = instanceBounds;
        else delete next.definitionBounds;
        return next;
    };
    return { ...content, blocks: source.map(block => ({ ...block, bounds: bounds.get(block.id), entities: block.entities.map(refresh) })), entities: content.entities.map(refresh) };
}

// Layer 0 follows the insertion layer; explicitly assigned child layers remain
// independent. Applying this at each nesting level also resolves nested inserts.
export function resolveDrawingBlockChild(entity, reference, attributeDisplay = 'normal') {
    entity = resolveDrawingAttributeText(entity, reference, attributeDisplay);
    if (entity && !entity.plotStyleName && reference.plotStyleName) entity = { ...entity, plotStyleName: reference.plotStyleName };
    if (!entity) return null;
    return entity.layerId === 'geometry' && reference.layerId && reference.layerId !== 'geometry'
        ? { ...entity, layerId: reference.layerId } : entity;
}
