import { canEditEntity, createDrawingId } from './drawingDocument.js';
import {
    getDimensionGeometry,
    mirrorEntity,
    pointDistance,
    translateEntity,
} from './drawingGeometry.js';
import {
    extractEntityPaths,
    getCurveEnd,
    getCurveStart,
    reversePath,
} from './drawingCurveKernel.js';
import { materializeDrawingBlockReference } from './drawingBlocks.js';
import { getDrawingTextLayout } from './drawingText.js';
import {
    formatDrawingDimensionLabel,
    getDrawingEntityDependencyIds,
    isDrawingDimensionEntity,
    remapDrawingEntityDependencies,
} from './drawingDimensions.js';

const DEFAULT_JOIN_TOLERANCE = 1e-6;

export function joinDrawingEntities(content, entityIds, tolerance = DEFAULT_JOIN_TOLERANCE) {
    const selected = new Set(entityIds || []);
    const sources = content.entities.filter(entity => selected.has(entity.id) && canEditEntity(content, entity));
    if (sources.length < 2) {
        return { changed: false, content, selectedIds: entityIds || [], reason: 'unsupported' };
    }

    const paths = [];
    for (const source of sources) {
        const extracted = extractEntityPaths(source, { joinTolerance: tolerance });
        if (extracted.length !== 1 || !extracted[0].parts.length) {
            return { changed: false, content, selectedIds: entityIds || [], reason: 'unsupported' };
        }
        if (extracted[0].closed) {
            return { changed: false, content, selectedIds: entityIds || [], reason: 'closed' };
        }
        paths.push(extracted[0]);
    }
    const ordered = orderConnectedPaths(paths, tolerance);
    if (!ordered.path) {
        return { changed: false, content, selectedIds: entityIds || [], reason: ordered.reason };
    }

    const sourceIds = new Set(sources.map(entity => entity.id));
    const first = sources[0];
    const joinedParts = coalesceJoinedLineParts(ordered.path.parts, tolerance).map(compoundPart);
    const appearance = drawingAppearance(first);
    const nativeLineAppearance = joinedParts.length === 1
        ? { ...appearance, ...drawingAppearance(joinedParts[0]) }
        : appearance;
    const joinedEntity = joinedParts.length === 1 && joinedParts[0].type === 'line' && !ordered.path.closed
        ? {
            id: createDrawingId('line'),
            type: 'line',
            ...nativeLineAppearance,
            x1: joinedParts[0].x1,
            y1: joinedParts[0].y1,
            x2: joinedParts[0].x2,
            y2: joinedParts[0].y2,
        }
        : {
            id: createDrawingId('polyline'),
            type: 'polyline',
            ...appearance,
            parts: joinedParts,
            closed: ordered.path.closed,
        };
    const entities = content.entities.filter(entity => (
        !sourceIds.has(entity.id)
        && !getDrawingEntityDependencyIds(entity).some(id => sourceIds.has(id))
    ));
    return {
        changed: true,
        content: { ...content, entities: [...entities, joinedEntity] },
        selectedIds: [joinedEntity.id],
        entity: joinedEntity,
    };
}

export function explodeDrawingEntities(content, entityIds, options = {}) {
    return explodeDrawingEntitiesWithAppearance(content, entityIds, {
        ...options,
        appearanceMode: 'parent',
    });
}

export function xplodeDrawingEntities(content, entityIds, {
    appearanceMode = 'parts',
    inheritParent = false,
    propertyMode = null,
    ...options
} = {}) {
    const resolvedAppearance = inheritParent || propertyMode === 'parent' || appearanceMode === 'parent'
        ? 'parent'
        : 'parts';
    return explodeDrawingEntitiesWithAppearance(content, entityIds, {
        ...options,
        appearanceMode: resolvedAppearance,
    });
}

function explodeDrawingEntitiesWithAppearance(content, entityIds, options) {
    const selected = new Set(entityIds || []);
    const selectedQdimSeries = new Set(content.entities
        .filter(entity => selected.has(entity.id) && isDrawingQdimSeriesEntity(entity))
        .map(entity => entity.seriesId));
    const editableQdimSeries = new Set([...selectedQdimSeries].filter(seriesId => (
        content.entities
            .filter(entity => isDrawingQdimSeriesEntity(entity) && entity.seriesId === seriesId)
            .every(entity => canEditEntity(content, entity))
    )));
    const candidates = content.entities.filter(entity => {
        if (isDrawingQdimSeriesEntity(entity) && selectedQdimSeries.has(entity.seriesId)) {
            return editableQdimSeries.has(entity.seriesId);
        }
        return selected.has(entity.id) && canEditEntity(content, entity);
    });
    const exploded = candidates.map(source => ({
        source,
        replacements: explodeDrawingSource(source, content, options),
    })).filter(result => result.replacements.length);
    const sources = exploded.map(result => result.source);
    if (!sources.length) return { changed: false, content, selectedIds: entityIds || [], explodedCount: 0 };

    const sourceIds = new Set(sources.map(entity => entity.id));
    const replacements = exploded.flatMap(({ source, replacements: raw }) => (
        assignExplodedEntityIds(raw.map(part => applyExplodedAppearance(part, source, options.appearanceMode)))
    ));
    const entities = content.entities.filter(entity => (
        !sourceIds.has(entity.id)
        && !getDrawingEntityDependencyIds(entity).some(id => sourceIds.has(id))
    ));
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
            ...remapDrawingEntityDependencies(mirrored, idMap),
            id: idMap.get(entity.id),
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
            ...remapDrawingEntityDependencies(mirrored, idMap),
            id: idMap.get(entity.id),
            previewMode: 'mirror',
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
    const entities = content.entities.filter(entity => (
        !sourceIds.has(entity.id)
        && !getDrawingEntityDependencyIds(entity).some(id => sourceIds.has(id))
    ));
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
        (sourceIds.has(entity.id)
            || getDrawingEntityDependencyIds(entity).some(id => sourceIds.has(id)))
        && canEditEntity(content, entity)
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
        ...(Object.hasOwn(sources[0], 'transparency') ? { transparency: sources[0].transparency } : {}),
        parts,
        ...(preview ? { previewMode: 'array' } : { array: { columns, rows, horizontal, vertical } }),
    };
}

function entityAsPolylineParts(entity) {
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) return entity.parts.flatMap(entityAsPolylineParts);
    const { id, layerId, locked, sourceId, sourceIds, previewMode, array, ...part } = entity;
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

function explodeDrawingSource(source, content, options) {
    if (source.type === 'blockReference') {
        return materializeDrawingBlockReference(source, content.blocks || [], {
            recursive: Boolean(options.recursiveBlocks),
            maxDepth: Math.max(1, Math.min(64, Number(options.maxBlockDepth) || 16)),
        });
    }
    if (source.type === 'text') return explodeTextEntity(source);
    if (isDrawingDimensionEntity(source)) {
        if (isDrawingQdimSeriesEntity(source)) return [detachDrawingQdimDimension(source)];
        return explodeDimensionEntity(source, new Map(content.entities.map(entity => [entity.id, entity])), options);
    }
    if (!['path', 'polyline', 'rectangle', 'polygon', 'hatch', 'block'].includes(source.type)) return [];
    const paths = extractEntityPaths(source, {
        boundaryExtractor: entity => {
            if (!['hatch', 'block'].includes(entity?.type)) return undefined;
            return entity.boundaries || entity.loops;
        },
    });
    return paths.flatMap(path => path.parts.map(compoundPart));
}

function isDrawingQdimSeriesEntity(entity) {
    return entity?.type === 'linearDimension'
        && typeof entity.seriesId === 'string'
        && Boolean(entity.seriesId.trim());
}

function detachDrawingQdimDimension(entity) {
    const detached = { ...entity };
    [
        'seriesId',
        'seriesMode',
        'seriesIndex',
        'seriesAxis',
        'baselineEnd',
        'baselineReference',
    ].forEach(property => delete detached[property]);
    return detached;
}

function applyExplodedAppearance(part, parent, appearanceMode) {
    const next = { ...part };
    delete next.locked;
    delete next.previewMode;
    delete next.array;
    const parentAppearance = drawingAppearance(parent);
    if (appearanceMode === 'parent') {
        APPEARANCE_PROPERTIES.forEach(property => delete next[property]);
        return { ...next, ...parentAppearance };
    }
    APPEARANCE_PROPERTIES.forEach(property => {
        if (!Object.hasOwn(next, property) && Object.hasOwn(parentAppearance, property)) {
            next[property] = parentAppearance[property];
        }
    });
    return next;
}

function assignExplodedEntityIds(parts) {
    const idMap = new Map();
    parts.forEach(part => {
        if (typeof part.id === 'string' && part.id && !idMap.has(part.id)) {
            idMap.set(part.id, createDrawingId(part.type || 'entity'));
        }
    });
    return parts.map(part => ({
        ...remapDrawingEntityDependencies(part, idMap),
        id: idMap.get(part.id) || createDrawingId(part.type || 'entity'),
    }));
}

function explodeDimensionEntity(entity, sources, { locale = 'en', dimensionTextSize = 0.35 } = {}) {
    const geometry = getDimensionGeometry(entity, sources);
    if (!geometry) return [];
    const textSize = Math.max(0.01, Number(entity.textSize) || Number(dimensionTextSize) || 0.35);
    const primitives = [
        ...geometry.lines.map(line => linePart(line.start, line.end)),
        ...geometry.arcs.map(arc => ({
            type: 'arc',
            cx: arc.center.x,
            cy: arc.center.y,
            r: arc.radius,
            startAngle: arc.startAngle,
            endAngle: arc.endAngle,
            counterClockwise: arc.counterClockwise,
        })),
        ...geometry.ticks.map(tick => dimensionTick(tick.point, tick.angle - Math.PI / 2, textSize * 0.7)),
    ];
    if (!geometry.label || geometry.value === null) return primitives;
    const formatted = formatDrawingDimensionLabel(geometry, entity, locale);
    if (!formatted.lines.length) return primitives;
    return [
        ...primitives,
        dimensionText(
            formatted.plainText,
            geometry.label.point,
            readableTextAngle(geometry.label.angle * 180 / Math.PI),
            textSize,
            geometry.kind === 'radial' || geometry.kind === 'ordinate' ? 'start' : 'middle',
        ),
    ];
}

function explodeTextEntity(entity) {
    const layout = getDrawingTextLayout(entity);
    const characterWidth = layout.fontSize * 0.56;
    const glyphs = layout.lines.flatMap((line, lineIndex) => {
        const lineWidth = line.length * characterWidth;
        const startX = layout.textAnchor === 'middle'
            ? layout.textX - lineWidth / 2
            : layout.textAnchor === 'end' ? layout.textX - lineWidth : layout.textX;
        return [...line].flatMap((character, characterIndex) => {
            if (/\s/.test(character)) return [];
            const center = transformTextPoint({
                x: startX + (characterIndex + 0.5) * characterWidth,
                y: layout.blockTop + (lineIndex + 0.5) * layout.lineHeight,
            }, entity, layout);
            const {
                id: _id,
                sourceId: _sourceId,
                sourceIds: _sourceIds,
                text: _text,
                x: _x,
                y: _y,
                width: _width,
                height: _height,
                horizontalAlign: _horizontalAlign,
                verticalAlign: _verticalAlign,
                ...properties
            } = entity;
            return [{
                ...properties,
                type: 'text',
                text: character,
                x: center.x - characterWidth / 2,
                y: center.y - layout.lineHeight / 2,
                width: characterWidth,
                height: layout.lineHeight,
                horizontalAlign: 'left',
                verticalAlign: 'top',
            }];
        });
    });
    return glyphs.length > 1 ? glyphs : [];
}

function transformTextPoint(point, entity, layout) {
    const center = { x: layout.x + layout.width / 2, y: layout.y + layout.height / 2 };
    const angle = (Number(entity.rotation) || 0) * Math.PI / 180;
    const dx = point.x - center.x;
    const dy = (point.y - center.y) * (entity.mirrored ? -1 : 1);
    return {
        x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
        y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    };
}

function dimensionTick(point, angle, size) {
    const tickAngle = angle + Math.PI / 4;
    const offset = { x: Math.cos(tickAngle) * size / 2, y: Math.sin(tickAngle) * size / 2 };
    return linePart(
        { x: point.x - offset.x, y: point.y - offset.y },
        { x: point.x + offset.x, y: point.y + offset.y },
    );
}

function dimensionText(text, point, rotation, fontSize, anchor) {
    const lines = String(text).split('\n');
    const width = Math.max(fontSize, ...lines.map(line => [...line].length * fontSize * 0.56));
    const height = Math.max(fontSize * 1.2, lines.length * fontSize * 1.2);
    return {
        type: 'text',
        text,
        x: anchor === 'start' ? point.x : point.x - width / 2,
        y: point.y - height,
        width,
        height,
        fontSize,
        rotation,
        textMode: lines.length > 1 ? 'multiline' : 'singleLine',
        wrapMode: 'none',
        horizontalAlign: anchor === 'start' ? 'left' : 'center',
        verticalAlign: 'top',
    };
}

function linePart(first, second) {
    return { type: 'line', x1: first.x, y1: first.y, x2: second.x, y2: second.y };
}

function readableTextAngle(degrees) {
    return degrees > 90 || degrees < -90 ? degrees + 180 : degrees;
}

function compoundPart(part) {
    const {
        id: _id,
        sourceId: _sourceId,
        sourceIds: _sourceIds,
        locked: _locked,
        previewMode: _previewMode,
        array: _array,
        ...geometry
    } = part;
    return geometry;
}

function coalesceJoinedLineParts(parts, tolerance) {
    const maximumDistance = Number.isFinite(Number(tolerance))
        ? Math.max(0, Number(tolerance))
        : DEFAULT_JOIN_TOLERANCE;
    const coalesced = [];
    (parts || []).forEach(part => {
        const previous = coalesced.at(-1);
        if (!canCoalesceLineParts(previous, part, maximumDistance)) {
            coalesced.push(part);
            return;
        }
        coalesced[coalesced.length - 1] = {
            ...previous,
            x2: part.x2,
            y2: part.y2,
        };
    });
    return coalesced;
}

function canCoalesceLineParts(first, second, tolerance) {
    if (first?.type !== 'line' || second?.type !== 'line') return false;
    if (pointDistance({ x: first.x2, y: first.y2 }, { x: second.x1, y: second.y1 }) > tolerance) return false;
    if (!samePartAppearance(first, second)) return false;
    const firstVector = { x: first.x2 - first.x1, y: first.y2 - first.y1 };
    const secondVector = { x: second.x2 - second.x1, y: second.y2 - second.y1 };
    const firstLength = Math.hypot(firstVector.x, firstVector.y);
    const secondLength = Math.hypot(secondVector.x, secondVector.y);
    if (firstLength <= tolerance || secondLength <= tolerance) return false;
    const cross = Math.abs(firstVector.x * secondVector.y - firstVector.y * secondVector.x);
    const maximumPerpendicularDeviation = cross / Math.min(firstLength, secondLength);
    const dot = firstVector.x * secondVector.x + firstVector.y * secondVector.y;
    return maximumPerpendicularDeviation <= tolerance && dot > 0;
}

function samePartAppearance(first, second) {
    return APPEARANCE_PROPERTIES.every(property => (
        Object.hasOwn(first, property) === Object.hasOwn(second, property)
        && first[property] === second[property]
    ));
}

function drawingAppearance(entity) {
    return Object.fromEntries(APPEARANCE_PROPERTIES.flatMap(property => (
        Object.hasOwn(entity || {}, property) ? [[property, entity[property]]] : []
    )));
}

function orderConnectedPaths(paths, tolerance) {
    if (!paths.length) return { path: null, reason: 'unsupported' };
    const maximumDistance = Number.isFinite(Number(tolerance)) ? Math.max(0, Number(tolerance)) : DEFAULT_JOIN_TOLERANCE;
    const nodes = [];
    const nodeIndex = point => {
        const existing = nodes.findIndex(node => pointDistance(node.point, point) <= maximumDistance);
        if (existing >= 0) return existing;
        nodes.push({ point: { ...point }, edges: [] });
        return nodes.length - 1;
    };
    const edges = paths.map((path, index) => {
        const firstNode = nodeIndex(getCurveStart(path.parts[0]));
        const secondNode = nodeIndex(getCurveEnd(path.parts[path.parts.length - 1]));
        const edge = { index, path, firstNode, secondNode };
        nodes[firstNode].edges.push(index);
        nodes[secondNode].edges.push(index);
        return edge;
    });
    if (edges.some(edge => edge.firstNode === edge.secondNode)) return { path: null, reason: 'closed' };
    if (nodes.some(node => node.edges.length > 2)) return { path: null, reason: 'branched' };
    const endpoints = nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.edges.length === 1);
    if (![0, 2].includes(endpoints.length)) return { path: null, reason: 'branched' };

    const startNode = endpoints[0]?.index ?? edges[0].firstNode;
    let currentNode = startNode;
    const used = new Set();
    const parts = [];
    while (used.size < edges.length) {
        const edgeIndex = nodes[currentNode].edges.find(index => !used.has(index));
        if (edgeIndex === undefined) return { path: null, reason: 'disconnected' };
        const edge = edges[edgeIndex];
        const forward = edge.firstNode === currentNode;
        const oriented = forward ? edge.path : reversePath(edge.path, { joinTolerance: maximumDistance });
        if (!oriented) return { path: null, reason: 'unsupported' };
        parts.push(...oriented.parts);
        used.add(edgeIndex);
        currentNode = forward ? edge.secondNode : edge.firstNode;
    }
    return {
        path: { type: 'path', parts, closed: currentNode === startNode },
        reason: null,
    };
}

const APPEARANCE_PROPERTIES = [
    'layerId',
    'color',
    'lineWeight',
    'lineWidth',
    'lineType',
    'transparency',
];
