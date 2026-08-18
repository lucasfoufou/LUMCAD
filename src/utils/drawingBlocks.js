import {
    arcPoint,
    arcSweep,
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

const EPSILON = 1e-9;
const MAX_BLOCK_DEFINITIONS = 1_024;
const MAX_BLOCK_ENTITIES = 100_000;

export const DRAWING_BLOCK_REFERENCE_TYPE = 'blockReference';
export const IDENTITY_AFFINE_MATRIX = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function normalizeAffineMatrix(value, fallback = IDENTITY_AFFINE_MATRIX) {
    const source = Array.isArray(value)
        ? { a: value[0], b: value[1], c: value[2], d: value[3], e: value[4], f: value[5] }
        : value;
    if (!source || typeof source !== 'object') return { ...fallback };
    const matrix = {
        a: Number(source.a),
        b: Number(source.b),
        c: Number(source.c),
        d: Number(source.d),
        e: Number(source.e),
        f: Number(source.f),
    };
    return Object.values(matrix).every(Number.isFinite) ? matrix : { ...fallback };
}

/** Returns a matrix that applies `right` first and `left` second. */
export function multiplyAffineMatrices(left, right) {
    const first = normalizeAffineMatrix(left);
    const second = normalizeAffineMatrix(right);
    return {
        a: first.a * second.a + first.c * second.b,
        b: first.b * second.a + first.d * second.b,
        c: first.a * second.c + first.c * second.d,
        d: first.b * second.c + first.d * second.d,
        e: first.a * second.e + first.c * second.f + first.e,
        f: first.b * second.e + first.d * second.f + first.f,
    };
}

export function translationAffineMatrix(dx = 0, dy = 0) {
    const x = Number(dx);
    const y = Number(dy);
    return { a: 1, b: 0, c: 0, d: 1, e: Number.isFinite(x) ? x : 0, f: Number.isFinite(y) ? y : 0 };
}

export function rotationAffineMatrix(angleDegrees = 0, origin = { x: 0, y: 0 }) {
    const angle = Number(angleDegrees) * Math.PI / 180;
    if (!Number.isFinite(angle) || !isFinitePoint(origin)) return { ...IDENTITY_AFFINE_MATRIX };
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const rotation = { a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0 };
    return matrixAroundPoint(rotation, origin);
}

export function scaleAffineMatrix(scaleX = 1, scaleY = scaleX, origin = { x: 0, y: 0 }) {
    const x = Number(scaleX);
    const y = Number(scaleY);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !isFinitePoint(origin)) return { ...IDENTITY_AFFINE_MATRIX };
    return matrixAroundPoint({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 }, origin);
}

export function mirrorAffineMatrix(first, second) {
    if (!isFinitePoint(first) || !isFinitePoint(second)) return { ...IDENTITY_AFFINE_MATRIX };
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) return { ...IDENTITY_AFFINE_MATRIX };
    const cosine = dx / length;
    const sine = dy / length;
    return matrixAroundPoint({
        a: cosine * cosine - sine * sine,
        b: 2 * cosine * sine,
        c: 2 * cosine * sine,
        d: sine * sine - cosine * cosine,
        e: 0,
        f: 0,
    }, first);
}

export function transformAffinePoint(point, matrix) {
    if (!isFinitePoint(point)) return point;
    const normalized = normalizeAffineMatrix(matrix);
    return {
        x: normalized.a * Number(point.x) + normalized.c * Number(point.y) + normalized.e,
        y: normalized.b * Number(point.x) + normalized.d * Number(point.y) + normalized.f,
    };
}

export function affineMatrixToSvg(matrix) {
    const normalized = normalizeAffineMatrix(matrix);
    return `matrix(${normalized.a} ${normalized.b} ${normalized.c} ${normalized.d} ${normalized.e} ${normalized.f})`;
}

export function normalizeDrawingBlockReference(entity) {
    if (!entity || entity.type !== DRAWING_BLOCK_REFERENCE_TYPE) return entity;
    const legacyTransform = legacyBlockReferenceMatrix(entity);
    const definitionBounds = normalizeBounds(entity.definitionBounds);
    return {
        ...entity,
        type: DRAWING_BLOCK_REFERENCE_TYPE,
        blockId: typeof entity.blockId === 'string' ? entity.blockId : '',
        transform: normalizeAffineMatrix(entity.transform, legacyTransform),
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
        transform: translationAffineMatrix(insertion.x, insertion.y),
        ...(bounds ? { definitionBounds: bounds } : {}),
    };
}

export function getDrawingBlockDefinition(blocks, blockId) {
    return (Array.isArray(blocks) ? blocks : []).find(block => block?.id === blockId) || null;
}

export function getDrawingBlockDefinitionBounds(definition, blocks = []) {
    if (!definition || !Array.isArray(definition.entities)) return null;
    const blockMap = new Map((Array.isArray(blocks) ? blocks : []).map(block => [block.id, block]));
    if (definition.id) blockMap.set(definition.id, definition);
    const entityMap = new Map(definition.entities.map(entity => [entity.id, entity]));
    return definition.entities.reduce((combined, entity) => (
        combineBounds(combined, getDrawingBlockEntityBounds(entity, blockMap, entityMap, new Set([definition.id])))
    ), null);
}

export function getDrawingBlockReferenceBounds(reference, blocks = []) {
    if (reference?.type !== DRAWING_BLOCK_REFERENCE_TYPE) return null;
    const definition = getDrawingBlockDefinition(blocks, reference.blockId);
    const localBounds = normalizeBounds(reference.definitionBounds)
        || normalizeBounds(definition?.bounds)
        || getDrawingBlockDefinitionBounds(definition, blocks);
    if (!localBounds) return null;
    const corners = boundsCorners(localBounds).map(point => transformAffinePoint(point, reference.transform));
    return boundsFromPoints(corners);
}

export function materializeDrawingBlockReference(reference, blocks, {
    recursive = false,
    maxDepth = 16,
} = {}) {
    const definition = getDrawingBlockDefinition(blocks, reference?.blockId);
    if (!definition) return [];
    return definition.entities.flatMap(entity => {
        const transformed = transformDrawingBlockEntityAffine(cloneJson(entity), reference.transform);
        if (recursive && transformed.type === DRAWING_BLOCK_REFERENCE_TYPE && maxDepth > 0) {
            return materializeDrawingBlockReference(transformed, blocks, { recursive, maxDepth: maxDepth - 1 });
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
    if (next.sourceId && entityIdMap.has(next.sourceId)) next.sourceId = entityIdMap.get(next.sourceId);
    if (next.layerId && layerIdMap.has(next.layerId)) next.layerId = layerIdMap.get(next.layerId);
    if (next.assetId && assetIdMap.has(next.assetId)) next.assetId = assetIdMap.get(next.assetId);
    if (next.blockId && blockIdMap.has(next.blockId)) next.blockId = blockIdMap.get(next.blockId);
    return next;
}

function transformDrawingBlockEntityAffine(entity, matrix) {
    if (entity.type === DRAWING_BLOCK_REFERENCE_TYPE) return transformDrawingBlockReference(entity, matrix);
    if (entity.type === 'ellipse' || entity.type === 'spline') {
        return transformAdvancedCurveAffine(entity, matrix);
    }
    if (entity.type === 'hatch') return {
        ...entity,
        boundaries: getHatchBoundaryEntities(entity).map(boundary => transformDrawingBlockEntityAffine(boundary, matrix)),
        pattern: transformHatchPatternAffine(entity.pattern, matrix),
    };
    if (entity.type === 'line') {
        const first = transformAffinePoint({ x: entity.x1, y: entity.y1 }, matrix);
        const second = transformAffinePoint({ x: entity.x2, y: entity.y2 }, matrix);
        return { ...entity, x1: first.x, y1: first.y, x2: second.x, y2: second.y };
    }
    if (entity.type === 'polyline') return {
        ...entity,
        ...(Array.isArray(entity.parts)
            ? { parts: entity.parts.map(part => transformDrawingBlockEntityAffine(part, matrix)) }
            : { points: (entity.points || []).map(point => transformAffinePoint(point, matrix)) }),
    };
    if (entity.type === 'circle' || entity.type === 'arc') {
        const similarity = affineSimilarity(matrix);
        if (!similarity) return curveEntityAsTransformedPolyline(entity, matrix);
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
        const bounds = boundsFromPoints(rectEntityCorners(entity).map(point => transformAffinePoint(point, matrix)));
        return bounds ? {
            ...entity,
            x: bounds.minX,
            y: bounds.minY,
            width: bounds.maxX - bounds.minX,
            height: bounds.maxY - bounds.minY,
            rotation: 0,
        } : entity;
    }
    if (entity.type === 'linearDimension' && entity.p1 && entity.p2) {
        return { ...entity, p1: transformAffinePoint(entity.p1, matrix), p2: transformAffinePoint(entity.p2, matrix) };
    }
    return entity;
}

function translateDrawingBlockEntity(entity, dx, dy) {
    if (entity.type === DRAWING_BLOCK_REFERENCE_TYPE) {
        return transformDrawingBlockReference(entity, translationAffineMatrix(dx, dy));
    }
    if (entity.type === 'ellipse' || entity.type === 'spline') {
        return transformAdvancedCurveAffine(entity, translationAffineMatrix(dx, dy));
    }
    if (entity.type === 'hatch') return {
        ...entity,
        boundaries: getHatchBoundaryEntities(entity).map(boundary => translateDrawingBlockEntity(boundary, dx, dy)),
        pattern: transformHatchPatternAffine(entity.pattern, translationAffineMatrix(dx, dy)),
    };
    if (entity.type === 'line') return { ...entity, x1: entity.x1 + dx, y1: entity.y1 + dy, x2: entity.x2 + dx, y2: entity.y2 + dy };
    if (['rectangle', 'image', 'text'].includes(entity.type)) return { ...entity, x: entity.x + dx, y: entity.y + dy };
    if (['circle', 'polygon', 'arc'].includes(entity.type)) return { ...entity, cx: entity.cx + dx, cy: entity.cy + dy };
    if (entity.type === 'polyline') return {
        ...entity,
        ...(Array.isArray(entity.parts)
            ? { parts: entity.parts.map(part => translateDrawingBlockEntity(part, dx, dy)) }
            : { points: (entity.points || []).map(point => ({ x: point.x + dx, y: point.y + dy })) }),
    };
    if (entity.type === 'linearDimension' && entity.p1 && entity.p2) {
        return { ...entity, p1: { x: entity.p1.x + dx, y: entity.p1.y + dy }, p2: { x: entity.p2.x + dx, y: entity.p2.y + dy } };
    }
    return entity;
}

function getDrawingBlockEntityBounds(entity, blockMap, entityMap, visiting) {
    if (!entity) return null;
    if (entity.type === DRAWING_BLOCK_REFERENCE_TYPE) {
        if (visiting.has(entity.blockId)) return normalizeBounds(entity.definitionBounds);
        const definition = blockMap.get(entity.blockId);
        if (!definition) return getDrawingBlockReferenceBounds(entity);
        const nextVisiting = new Set(visiting);
        nextVisiting.add(entity.blockId);
        const localMap = new Map(definition.entities.map(child => [child.id, child]));
        const localBounds = definition.entities.reduce((combined, child) => (
            combineBounds(combined, getDrawingBlockEntityBounds(child, blockMap, localMap, nextVisiting))
        ), null);
        if (!localBounds) return null;
        return boundsFromPoints(boundsCorners(localBounds).map(point => transformAffinePoint(point, entity.transform)));
    }
    if (entity.type === 'line') return boundsFromPoints([{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }]);
    if (entity.type === 'ellipse' || entity.type === 'spline') return getAdvancedEntityBounds(entity);
    if (entity.type === 'hatch') return getHatchBoundaryEntities(entity).reduce((combined, boundary) => (
        combineBounds(combined, getDrawingBlockEntityBounds(boundary, blockMap, entityMap, visiting))
    ), null);
    if (entity.type === 'circle') {
        const radius = Math.abs(Number(entity.r) || 0);
        return normalizeBounds({ minX: entity.cx - radius, minY: entity.cy - radius, maxX: entity.cx + radius, maxY: entity.cy + radius });
    }
    if (entity.type === 'arc') return normalizeBounds(getArcBounds(entity));
    if (entity.type === 'polygon') return boundsFromPoints(getRegularPolygonVertices(entity));
    if (entity.type === 'rectangle') return boundsFromPoints(getRectangleOutlinePoints(entity));
    if (entity.type === 'image' || entity.type === 'text') return boundsFromPoints(rectEntityCorners(entity));
    if (entity.type === 'polyline') {
        if (Array.isArray(entity.parts)) return entity.parts.reduce((combined, part) => (
            combineBounds(combined, getDrawingBlockEntityBounds(part, blockMap, entityMap, visiting))
        ), null);
        return boundsFromPoints(entity.points || []);
    }
    if (entity.type === 'linearDimension') return linearDimensionBounds(entity, entityMap.get(entity.sourceId));
    if (entity.type === 'radialDimension') return radialDimensionBounds(entity, entityMap.get(entity.sourceId));
    return null;
}

function linearDimensionBounds(entity, source) {
    let first = entity.p1;
    let second = entity.p2;
    if (source?.type === 'line') {
        first = { x: source.x1, y: source.y1 };
        second = { x: source.x2, y: source.y2 };
    } else if (source?.type === 'rectangle' || source?.type === 'polygon') {
        const points = source.type === 'rectangle' ? getRectangleOutlinePoints(source) : getRegularPolygonVertices(source);
        const index = Math.max(0, Math.min(points.length - 1, Number(entity.edgeIndex) || 0));
        first = points[index];
        second = points[(index + 1) % points.length];
    }
    if (!isFinitePoint(first) || !isFinitePoint(second)) return null;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) return boundsFromPoints([first, second]);
    const offset = Number.isFinite(Number(entity.offset)) ? Number(entity.offset) : 0.6;
    const normal = { x: -dy / length * offset, y: dx / length * offset };
    return boundsFromPoints([first, second, { x: first.x + normal.x, y: first.y + normal.y }, { x: second.x + normal.x, y: second.y + normal.y }]);
}

function radialDimensionBounds(entity, source) {
    if (!['circle', 'arc'].includes(source?.type)) return null;
    const angle = Number(entity.angle) || 0;
    const radius = Math.abs(Number(source.r) || 0);
    const scale = Math.max(1.05, Number(entity.leaderScale) || 1.45);
    return boundsFromPoints([
        { x: source.cx, y: source.cy },
        { x: source.cx + Math.cos(angle) * radius * scale, y: source.cy + Math.sin(angle) * radius * scale },
    ]);
}

function drawingBlockEntityUsesLayer(entity, layerId) {
    if (entity?.layerId === layerId) return true;
    if (entity?.type === 'polyline' && Array.isArray(entity.parts)) {
        return entity.parts.some(part => drawingBlockEntityUsesLayer(part, layerId));
    }
    return entity?.type === 'hatch'
        ? getHatchBoundaryEntities(entity).some(boundary => drawingBlockEntityUsesLayer(boundary, layerId))
        : false;
}

function curveEntityAsTransformedPolyline(entity, matrix) {
    const count = entity.type === 'circle' ? 96 : Math.max(8, Math.ceil(Math.abs(arcSweep(entity)) / (Math.PI * 2) * 96));
    const start = entity.type === 'circle' ? 0 : Number(entity.startAngle) || 0;
    const sweep = entity.type === 'circle' ? Math.PI * 2 : arcSweep(entity);
    const points = Array.from({ length: entity.type === 'circle' ? count : count + 1 }, (_, index) => {
        const angle = start + sweep * index / count;
        return transformAffinePoint(arcPoint(entity, angle), matrix);
    });
    return entityAsTransformedPolyline(entity, points, IDENTITY_AFFINE_MATRIX, entity.type === 'circle');
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

function matrixAroundPoint(matrix, point) {
    return multiplyAffineMatrices(
        translationAffineMatrix(point.x, point.y),
        multiplyAffineMatrices(matrix, translationAffineMatrix(-point.x, -point.y)),
    );
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
        return { x: center.x + dx * cosine - dy * sine, y: center.y + dx * sine + dy * cosine };
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
