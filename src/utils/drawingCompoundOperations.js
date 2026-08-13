import { canEditEntity, createDrawingId } from './drawingDocument.js';
import { getEntitySegments, mirrorEntity, pointDistance, segmentsIntersect, translateEntity } from './drawingGeometry.js';

const DEFAULT_JOIN_TOLERANCE = 1e-6;

export function joinDrawingEntities(content, entityIds, tolerance = DEFAULT_JOIN_TOLERANCE) {
    const selected = new Set(entityIds || []);
    const sources = content.entities.filter(entity => selected.has(entity.id) && canEditEntity(content, entity));
    if (sources.length < 2 || sources.some(entity => !['line', 'polyline'].includes(entity.type))) {
        return { changed: false, content, selectedIds: entityIds || [], reason: 'unsupported' };
    }
    const segments = sources.flatMap(entity => getEntitySegments(entity))
        .filter(([first, second]) => pointDistance(first, second) > tolerance);
    const chain = orderConnectedSegments(segments, tolerance);
    if (!chain && !segmentsFormConnectedNetwork(segments, tolerance)) {
        return { changed: false, content, selectedIds: entityIds || [], reason: 'disconnected' };
    }

    const sourceIds = new Set(sources.map(entity => entity.id));
    const first = sources[0];
    const polyline = {
        id: createDrawingId('polyline'),
        type: 'polyline',
        layerId: first.layerId,
        ...(first.color ? { color: first.color } : {}),
        ...(first.lineWeight ? { lineWeight: first.lineWeight } : {}),
        ...(first.lineWidth ? { lineWidth: first.lineWidth } : {}),
        ...(first.lineType ? { lineType: first.lineType } : {}),
        ...(chain
            ? { points: chain.points, closed: chain.closed }
            : { parts: segments.map(([firstPoint, secondPoint]) => ({
                type: 'line', x1: firstPoint.x, y1: firstPoint.y, x2: secondPoint.x, y2: secondPoint.y,
            })) }),
    };
    const entities = content.entities.filter(entity => !sourceIds.has(entity.id) && !sourceIds.has(entity.sourceId));
    return {
        changed: true,
        content: { ...content, entities: [...entities, polyline] },
        selectedIds: [polyline.id],
        entity: polyline,
    };
}

export function explodeDrawingEntities(content, entityIds) {
    const selected = new Set(entityIds || []);
    const sources = content.entities.filter(entity => (
        selected.has(entity.id) && canEditEntity(content, entity) && ['rectangle', 'polygon', 'polyline'].includes(entity.type)
    ));
    if (!sources.length) return { changed: false, content, selectedIds: entityIds || [], explodedCount: 0 };

    const sourceIds = new Set(sources.map(entity => entity.id));
    const replacements = sources.flatMap(explodeDrawingSource);
    const entities = content.entities.filter(entity => !sourceIds.has(entity.id) && !sourceIds.has(entity.sourceId));
    return {
        changed: true,
        content: { ...content, entities: [...entities, ...replacements] },
        selectedIds: replacements.map(entity => entity.id),
        explodedCount: sources.length,
        entities: replacements,
    };
}

export function mirrorDrawingEntities(content, entityIds, axisFirst, axisSecond, {
    replace = false,
    mirrorTextGlyphs = true,
} = {}) {
    if (!axisFirst || !axisSecond || pointDistance(axisFirst, axisSecond) <= Number.EPSILON) {
        return { changed: false, content, selectedIds: entityIds || [], reason: 'invalid-axis' };
    }
    const originals = mirrorOperationSources(content, entityIds);
    if (!originals.length) return { changed: false, content, selectedIds: entityIds || [], reason: 'empty' };
    if (replace) {
        const selected = new Set(originals.map(entity => entity.id));
        return {
            changed: true,
            content: {
                ...content,
                entities: content.entities.map(entity => selected.has(entity.id)
                    ? mirrorEntity(entity, axisFirst, axisSecond, { mirrorTextGlyphs })
                    : entity),
            },
            selectedIds: originals.filter(entity => (entityIds || []).includes(entity.id)).map(entity => entity.id),
        };
    }

    const idMap = new Map(originals.map(entity => [entity.id, createDrawingId(entity.type)]));
    const copies = originals.map(entity => {
        const mirrored = mirrorEntity(entity, axisFirst, axisSecond, { mirrorTextGlyphs });
        return {
            ...mirrored,
            id: idMap.get(entity.id),
            ...(mirrored.sourceId && idMap.has(mirrored.sourceId) ? { sourceId: idMap.get(mirrored.sourceId) } : {}),
        };
    });
    const requested = new Set(entityIds || []);
    return {
        changed: true,
        content: { ...content, entities: [...content.entities, ...copies] },
        selectedIds: copies.filter((_, index) => requested.has(originals[index].id)).map(entity => entity.id),
        entities: copies,
    };
}

export function createMirrorPreviewEntities(content, entityIds, axisFirst, axisSecond, { mirrorTextGlyphs = true } = {}) {
    if (!axisFirst || !axisSecond || pointDistance(axisFirst, axisSecond) <= Number.EPSILON) return [];
    const originals = mirrorOperationSources(content, entityIds);
    const idMap = new Map(originals.map(entity => [entity.id, `mirror-preview-${entity.id}`]));
    return originals.map(entity => {
        const mirrored = mirrorEntity(entity, axisFirst, axisSecond, { mirrorTextGlyphs });
        return {
            ...mirrored,
            id: idMap.get(entity.id),
            previewMode: 'mirror',
            ...(mirrored.sourceId && idMap.has(mirrored.sourceId) ? { sourceId: idMap.get(mirrored.sourceId) } : {}),
        };
    });
}

export function createMirrorDraftEntities(content, operation, livePoint) {
    if (operation?.type !== 'mirror' || !operation.basePoint) return [];
    let axisFirst = operation.basePoint;
    let axisSecond = operation.stage === 'mirror-choice' ? operation.axisSecond : (livePoint || operation.axisSecond);
    if (operation.stage === 'mirror-option-base' && livePoint && operation.axisSecond) {
        const dx = livePoint.x - operation.basePoint.x;
        const dy = livePoint.y - operation.basePoint.y;
        axisFirst = livePoint;
        axisSecond = translatePoint(operation.axisSecond, dx, dy);
    }
    if (!axisSecond) return [];
    const axis = {
        id: 'mirror-axis-draft',
        type: 'line',
        layerId: content.activeLayerId,
        x1: axisFirst.x,
        y1: axisFirst.y,
        x2: axisSecond.x,
        y2: axisSecond.y,
    };
    return [axis, ...createMirrorPreviewEntities(content, operation.entityIds, axisFirst, axisSecond, {
        mirrorTextGlyphs: operation.mirrorTextGlyphs,
    })];
}

export function createRectangularArray(content, entityIds, basePoint, horizontalPoint, verticalPoint, columns, rows, options = {}) {
    const sources = arrayOperationSources(content, entityIds);
    const normalizedColumns = normalizeArrayQuantity(columns);
    const normalizedRows = normalizeArrayQuantity(rows);
    if (!sources.length || !basePoint || !horizontalPoint || !verticalPoint || !normalizedColumns || !normalizedRows) {
        return { changed: false, content, selectedIds: entityIds || [], reason: 'invalid-array' };
    }
    const horizontal = { x: horizontalPoint.x - basePoint.x, y: horizontalPoint.y - basePoint.y };
    const vertical = { x: verticalPoint.x - basePoint.x, y: verticalPoint.y - basePoint.y };
    if ((normalizedColumns > 1 && Math.abs(horizontal.x) <= DEFAULT_JOIN_TOLERANCE)
        || (normalizedRows > 1 && Math.abs(vertical.y) <= DEFAULT_JOIN_TOLERANCE)) {
        return { changed: false, content, selectedIds: entityIds || [], reason: 'invalid-spacing' };
    }
    const origin = arrayOrigin(basePoint, options.sourceBasePoint);
    const polyline = buildArrayPolyline(sources, horizontal, vertical, normalizedColumns, normalizedRows, { origin });
    const sourceIds = new Set(sources.map(entity => entity.id));
    const entities = content.entities.filter(entity => !sourceIds.has(entity.id) && !sourceIds.has(entity.sourceId));
    return {
        changed: true,
        content: { ...content, entities: [...entities, polyline] },
        selectedIds: [polyline.id],
        entity: polyline,
        itemCount: normalizedColumns * normalizedRows,
    };
}

export function createArrayDraftEntities(content, operation, livePoint) {
    if (operation?.type !== 'array' || !operation.basePoint) return [];
    const basePoint = operation.basePoint;
    const horizontalPoint = operation.horizontalPoint || (operation.stage === 'array-horizontal' && livePoint
        ? { x: livePoint.x, y: basePoint.y }
        : null);
    const verticalPoint = operation.verticalPoint || (operation.stage === 'array-vertical' && livePoint
        ? { x: basePoint.x, y: livePoint.y }
        : null);
    const drafts = [];
    if (horizontalPoint) drafts.push(arrayGuide('array-horizontal-guide', content.activeLayerId, basePoint, horizontalPoint));
    if (verticalPoint) drafts.push(arrayGuide('array-vertical-guide', content.activeLayerId, basePoint, verticalPoint));
    if (!horizontalPoint) return drafts;
    const sources = arrayOperationSources(content, operation.entityIds);
    if (!sources.length) return drafts;
    const horizontal = { x: horizontalPoint.x - basePoint.x, y: 0 };
    const vertical = verticalPoint ? { x: 0, y: verticalPoint.y - basePoint.y } : { x: 0, y: 0 };
    const columns = normalizeArrayQuantity(operation.columns || operation.defaultColumns) || 2;
    const rows = verticalPoint ? (normalizeArrayQuantity(operation.rows || operation.defaultRows) || 2) : 1;
    const origin = arrayOrigin(basePoint, operation.sourceBasePoint);
    const preview = buildArrayPolyline(sources, horizontal, vertical, columns, rows, { preview: true, origin });
    if (preview.parts.length) drafts.push(preview);
    return drafts;
}

export function getArrayControlGeometry(operation) {
    if (operation?.type !== 'array' || operation.stage !== 'array-edit'
        || !operation.basePoint || !operation.horizontalPoint || !operation.verticalPoint) return null;
    const columns = normalizeArrayQuantity(operation.columns) || 1;
    const rows = normalizeArrayQuantity(operation.rows) || 1;
    const horizontal = {
        x: operation.horizontalPoint.x - operation.basePoint.x,
        y: operation.horizontalPoint.y - operation.basePoint.y,
    };
    const vertical = {
        x: operation.verticalPoint.x - operation.basePoint.x,
        y: operation.verticalPoint.y - operation.basePoint.y,
    };
    return {
        base: operation.basePoint,
        xSpacing: operation.horizontalPoint,
        ySpacing: operation.verticalPoint,
        xQuantity: {
            x: operation.basePoint.x + horizontal.x * (columns - 1),
            y: operation.basePoint.y + horizontal.y * (columns - 1),
        },
        yQuantity: {
            x: operation.basePoint.x + vertical.x * (rows - 1),
            y: operation.basePoint.y + vertical.y * (rows - 1),
        },
        columns,
        rows,
        horizontal,
        vertical,
    };
}

export function editArrayOperation(operation, handle, point) {
    const geometry = getArrayControlGeometry(operation);
    if (!geometry || !point) return operation;
    if (handle === 'base') {
        const dx = point.x - geometry.base.x;
        const dy = point.y - geometry.base.y;
        return {
            ...operation,
            basePoint: { x: point.x, y: point.y },
            horizontalPoint: translatePoint(operation.horizontalPoint, dx, dy),
            verticalPoint: translatePoint(operation.verticalPoint, dx, dy),
        };
    }
    if (handle === 'x-spacing' && Math.abs(point.x - geometry.base.x) > DEFAULT_JOIN_TOLERANCE) {
        return { ...operation, horizontalPoint: { x: point.x, y: geometry.base.y } };
    }
    if (handle === 'y-spacing' && Math.abs(point.y - geometry.base.y) > DEFAULT_JOIN_TOLERANCE) {
        return { ...operation, verticalPoint: { x: geometry.base.x, y: point.y } };
    }
    if (handle === 'columns') {
        if (Math.abs(geometry.horizontal.x) <= DEFAULT_JOIN_TOLERANCE) return operation;
        const quantity = Math.round((point.x - geometry.base.x) / geometry.horizontal.x) + 1;
        return { ...operation, columns: clampArrayQuantity(quantity) };
    }
    if (handle === 'rows') {
        if (Math.abs(geometry.vertical.y) <= DEFAULT_JOIN_TOLERANCE) return operation;
        const quantity = Math.round((point.y - geometry.base.y) / geometry.vertical.y) + 1;
        return { ...operation, rows: clampArrayQuantity(quantity) };
    }
    return operation;
}

function mirrorOperationSources(content, entityIds) {
    const requested = new Set(entityIds || []);
    const sourceIds = new Set(content.entities
        .filter(entity => requested.has(entity.id) && canEditEntity(content, entity))
        .map(entity => entity.id));
    return content.entities.filter(entity => (
        (sourceIds.has(entity.id) || sourceIds.has(entity.sourceId)) && canEditEntity(content, entity)
    ));
}

function arrayOperationSources(content, entityIds) {
    const requested = new Set(entityIds || []);
    return content.entities.filter(entity => (
        requested.has(entity.id)
        && canEditEntity(content, entity)
        && ['line', 'rectangle', 'circle', 'polygon', 'arc', 'polyline'].includes(entity.type)
    ));
}

function buildArrayPolyline(sources, horizontal, vertical, columns, rows, { preview = false, origin = { x: 0, y: 0 } } = {}) {
    const parts = [];
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const dx = origin.x + horizontal.x * column + vertical.x * row;
            const dy = origin.y + horizontal.y * column + vertical.y * row;
            sources.forEach(source => parts.push(...entityAsPolylineParts(translateEntity(source, dx, dy))));
        }
    }
    return {
        id: preview ? 'array-preview' : createDrawingId('polyline'),
        type: 'polyline',
        layerId: sources[0].layerId,
        ...(sources[0].color ? { color: sources[0].color } : {}),
        ...(sources[0].lineWeight ? { lineWeight: sources[0].lineWeight } : {}),
        ...(sources[0].lineWidth ? { lineWidth: sources[0].lineWidth } : {}),
        ...(sources[0].lineType ? { lineType: sources[0].lineType } : {}),
        parts,
        ...(preview ? { previewMode: 'array' } : { array: { columns, rows, horizontal, vertical } }),
    };
}

function entityAsPolylineParts(entity) {
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) return entity.parts.flatMap(entityAsPolylineParts);
    const { id, layerId, locked, sourceId, previewMode, array, ...part } = entity;
    return [{ ...part }];
}

function normalizeArrayQuantity(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return null;
    return parsed;
}

function clampArrayQuantity(value) {
    return Math.max(1, Math.min(100, Number.isFinite(value) ? value : 1));
}

function arrayOrigin(basePoint, sourceBasePoint = basePoint) {
    return {
        x: basePoint.x - (sourceBasePoint?.x ?? basePoint.x),
        y: basePoint.y - (sourceBasePoint?.y ?? basePoint.y),
    };
}

function translatePoint(point, dx, dy) {
    return { x: point.x + dx, y: point.y + dy };
}

function arrayGuide(id, layerId, first, second) {
    return {
        id, type: 'line', layerId,
        x1: first.x, y1: first.y, x2: second.x, y2: second.y,
        previewMode: 'array',
    };
}

function explodeDrawingSource(source) {
    if (source.type === 'polyline' && Array.isArray(source.parts)) {
        return source.parts.flatMap(part => explodePolylinePart(part, source));
    }
    return getEntitySegments(source).map(([first, second]) => ({
        id: createDrawingId('line'), type: 'line', layerId: source.layerId,
        ...(source.color ? { color: source.color } : {}),
        ...(source.lineWeight ? { lineWeight: source.lineWeight } : {}),
        ...(source.lineWidth ? { lineWidth: source.lineWidth } : {}),
        ...(source.lineType ? { lineType: source.lineType } : {}),
        x1: first.x, y1: first.y, x2: second.x, y2: second.y,
    }));
}

function explodePolylinePart(part, source) {
    if (part.type === 'polyline' && Array.isArray(part.parts)) {
        return part.parts.flatMap(child => explodePolylinePart(child, source));
    }
    return [{
        ...part,
        id: createDrawingId(part.type),
        layerId: source.layerId,
        ...(part.color || source.color ? { color: part.color || source.color } : {}),
        ...(part.lineWeight || source.lineWeight ? { lineWeight: part.lineWeight || source.lineWeight } : {}),
        ...(part.lineWidth || source.lineWidth ? { lineWidth: part.lineWidth || source.lineWidth } : {}),
        ...(part.lineType || source.lineType ? { lineType: part.lineType || source.lineType } : {}),
    }];
}

function segmentsFormConnectedNetwork(segments, tolerance) {
    if (!segments.length) return false;
    const visited = new Set([0]);
    let progressed = true;
    while (progressed && visited.size < segments.length) {
        progressed = false;
        segments.forEach((segment, index) => {
            if (visited.has(index)) return;
            const connected = [...visited].some(visitedIndex => segmentsConnect(segment, segments[visitedIndex], tolerance));
            if (connected) {
                visited.add(index);
                progressed = true;
            }
        });
    }
    return visited.size === segments.length;
}

function segmentsConnect(left, right, tolerance) {
    return segmentsIntersect(left[0], left[1], right[0], right[1], tolerance);
}

function orderConnectedSegments(segments, tolerance) {
    if (!segments.length) return null;
    const nodes = [];
    const nodeIndex = point => {
        const existing = nodes.findIndex(node => pointDistance(node.point, point) <= tolerance);
        if (existing >= 0) return existing;
        nodes.push({ point: { ...point }, degree: 0 });
        return nodes.length - 1;
    };
    const indexed = segments.map(([first, second]) => {
        const firstNode = nodeIndex(first);
        const secondNode = nodeIndex(second);
        nodes[firstNode].degree += 1;
        nodes[secondNode].degree += 1;
        return { first, second, firstNode, secondNode };
    });
    const endpoints = nodes.filter(node => node.degree === 1);
    if (nodes.some(node => node.degree > 2) || ![0, 2].includes(endpoints.length)) return null;

    const startNode = endpoints.length ? nodes.indexOf(endpoints[0]) : indexed[0].firstNode;
    const firstIndex = indexed.findIndex(segment => segment.firstNode === startNode || segment.secondNode === startNode);
    const first = indexed[firstIndex];
    const points = first.firstNode === startNode
        ? [{ ...first.first }, { ...first.second }]
        : [{ ...first.second }, { ...first.first }];
    const used = new Set([firstIndex]);
    while (used.size < indexed.length) {
        const end = points[points.length - 1];
        const nextIndex = indexed.findIndex((segment, index) => !used.has(index)
            && (pointDistance(segment.first, end) <= tolerance || pointDistance(segment.second, end) <= tolerance));
        if (nextIndex < 0) return null;
        const next = indexed[nextIndex];
        points.push(pointDistance(next.first, end) <= tolerance ? { ...next.second } : { ...next.first });
        used.add(nextIndex);
    }
    const closed = points.length > 2 && pointDistance(points[0], points[points.length - 1]) <= tolerance;
    if (closed) points.pop();
    return { points, closed };
}
