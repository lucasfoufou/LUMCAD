import {
    DEFAULT_DRAWING_QDIM_BASELINE_SPACING,
    DRAWING_QDIM_GRIP_IDS,
    buildQdimDimensions,
    getDimensionGeometry,
    normalizeDrawingDimensionPointReference,
    normalizeDrawingQdimBaselineEnd,
    normalizeDrawingQdimMode,
    normalizeDrawingDimension,
} from './drawingDimensions.js';
import { getEntitySegments } from './drawingPrimitives.js';

const EPSILON = 1e-9;

export function createQuickDimensionResult(content, selectedIds, options = {}) {
    const requestedQdimMode = options.qdimMode ?? (
        ['continuous', 'baseline'].includes(options.seriesMode) ? options.seriesMode : undefined
    );
    if (requestedQdimMode !== undefined) {
        return createQdimResult(content, selectedIds, {
            ...options,
            mode: requestedQdimMode,
            command: options.command || 'quick',
        });
    }
    const candidates = collectLinearDimensionCandidates(content, selectedIds, options);
    const radialSources = selectedEntities(content, selectedIds)
        .filter(entity => ['circle', 'arc'].includes(entity.type));
    if (!candidates.length && !radialSources.length) {
        return unchangedDimensionResult(content, selectedIds, 'no-dimension-sources', 'quick');
    }
    const spacing = finiteOr(options.spacing, 0);
    const descriptors = candidates.map((candidate, index) => {
        const shared = linearDimensionOptions(options, index, spacing);
        if (candidate.source?.type === 'linearDimension') {
            return {
                ...shared,
                type: 'linearDimension',
                p1: candidate.first,
                p2: candidate.second,
                ...(candidate.source.dimensionFormat && options.dimensionFormat === undefined
                    ? { dimensionFormat: candidate.source.dimensionFormat }
                    : {}),
            };
        }
        return {
            ...shared,
            type: 'linearDimension',
            sourceId: candidate.source.id,
            ...(candidate.edgeIndex === null ? {} : { edgeIndex: candidate.edgeIndex }),
        };
    }).concat(radialSources.map((source, index) => withCommonFormat({
        type: 'radialDimension',
        sourceId: source.id,
        mode: options.radialMode === 'diameter' ? 'diameter' : 'radius',
        angle: resolveRadialAngle(
            source,
            resolveSourceOption(options.placementPoint, source, index),
            options.angle,
        ),
        leaderScale: resolveNumberOption(options.leaderScale, source, index, 1.45),
    }, options)));
    return appendDimensionEntities(content, descriptors, { ...options, command: 'quick' });
}

export function createBaselineDimensionResult(content, selectedIds, options = {}) {
    return createQdimResult(content, selectedIds, {
        ...options,
        mode: 'baseline',
        command: options.command || 'baseline',
    });
}

export function createContinuedDimensionResult(content, selectedIds, options = {}) {
    return createQdimResult(content, selectedIds, {
        ...options,
        mode: 'continuous',
        command: options.command || 'continued',
    });
}

export function createQdimResult(content, selectedIds, options = {}) {
    const mode = normalizeDrawingQdimMode(options.mode ?? options.qdimMode);
    const baselineEnd = normalizeDrawingQdimBaselineEnd(options.baselineEnd);
    const series = collectQdimStations(content, selectedIds, options);
    const command = options.command || 'quick';
    if (series.stations.length < 2) {
        return unchangedDimensionResult(content, selectedIds, 'insufficient-series-points', command);
    }
    const seriesId = resolveQdimSeriesId(content, options.seriesId);
    const descriptors = buildQdimDimensions(
        series.stations.map(station => station.point),
        {
            mode,
            baselineEnd,
            pointReferences: series.stations.map(station => station.reference),
            seriesId,
            seriesAxis: series.axis,
            measurementMode: series.measurementMode,
            dimensionAngle: series.dimensionAngle,
            offset: options.offset,
            spacing: options.spacing,
            linePoint: options.linePoint,
            dimensionFormat: options.dimensionFormat,
        },
    ).map(descriptor => withCommonFormat(descriptor, options));
    const result = appendDimensionEntities(content, descriptors, { ...options, command });
    if (!result.changed) return result;
    const baselineReference = mode === 'baseline'
        ? result.entities[0]?.baselineReference || null
        : null;
    return {
        ...result,
        qdim: {
            mode,
            baselineEnd,
            seriesId,
            axis: series.axis,
            stationCount: series.stations.length,
            baselineReference,
        },
    };
}

export function rebuildQdimSeriesResult(content, seriesId, options = {}) {
    const normalizedSeriesId = typeof seriesId === 'string' ? seriesId.trim() : '';
    const command = options.command || 'qdimEdit';
    if (!normalizedSeriesId || !content || !Array.isArray(content.entities)) {
        return unchangedDimensionResult(content, [], 'invalid-qdim-series', command);
    }
    const seriesEntities = collectQdimSeriesEntities(content, normalizedSeriesId);
    if (!seriesEntities.length) {
        return unchangedDimensionResult(content, [], 'qdim-series-not-found', command);
    }
    const sources = entityMap(content);
    const currentPosition = getQdimSeriesPosition(content, normalizedSeriesId);
    const seriesCandidates = seriesEntities.flatMap(entity => {
        const geometry = getDimensionGeometry(entity, sources);
        return geometry?.sourceFirst && geometry?.sourceSecond ? [{
            source: entity,
            first: geometry.sourceFirst,
            second: geometry.sourceSecond,
            references: normalizeQdimEntityReferences(entity, geometry),
        }] : [];
    });
    if (!seriesCandidates.length) {
        return unchangedDimensionResult(content, seriesEntities.map(entity => entity.id), 'invalid-qdim-series', command);
    }
    const firstEntity = seriesEntities[0];
    const measurementMode = normalizeLinearMeasurementMode(
        options.measurementMode ?? firstEntity.measurementMode,
    );
    const dimensionAngle = finiteOr(options.dimensionAngle, firstEntity.dimensionAngle || 0);
    const requestedAxis = options.seriesAxis ?? firstEntity.seriesAxis;
    const axis = canonicalSeriesAxis(seriesAxis(selectQdimAxisCandidate(seriesCandidates), {
        seriesAxis: requestedAxis,
        measurementMode,
        dimensionAngle,
    }));
    const normal = { x: -axis.y, y: axis.x };
    const stations = seriesCandidates.flatMap(candidate => [
        qdimStation(candidate.first, candidate.references[0], axis, normal),
        qdimStation(candidate.second, candidate.references[1], axis, normal),
    ]).sort(compareQdimStations).filter((station, index, sorted) => (
        index === 0 || Math.abs(station.position - sorted[index - 1].position) > EPSILON
    ));
    if (stations.length < 2) {
        return unchangedDimensionResult(content, seriesEntities.map(entity => entity.id), 'insufficient-series-points', command);
    }
    const mode = normalizeDrawingQdimMode(options.mode ?? firstEntity.seriesMode);
    const baselineEnd = normalizeDrawingQdimBaselineEnd(options.baselineEnd ?? firstEntity.baselineEnd);
    const spacing = mode !== 'baseline'
        ? 0
        : options.spacing === undefined
            ? firstEntity.seriesMode === 'baseline'
                ? currentPosition?.spacing ?? inferQdimSeriesSpacing(seriesEntities)
                : DEFAULT_DRAWING_QDIM_BASELINE_SPACING
            : Math.max(0, finiteOr(options.spacing, DEFAULT_DRAWING_QDIM_BASELINE_SPACING));
    const requestedLinePoint = Object.hasOwn(options, 'linePoint') && isFinitePoint(options.linePoint)
        ? options.linePoint
        : null;
    const descriptors = buildQdimDimensions(
        stations.map(station => station.point),
        {
            mode,
            baselineEnd,
            pointReferences: stations.map(station => station.reference),
            seriesId: normalizedSeriesId,
            seriesAxis: axis,
            measurementMode,
            dimensionAngle,
            offset: options.offset === undefined
                ? currentPosition?.offset ?? firstEntity.offset
                : options.offset,
            spacing,
            linePoint: requestedLinePoint,
            dimensionFormat: options.dimensionFormat,
        },
    );
    if (!descriptors.length) {
        return unchangedDimensionResult(content, seriesEntities.map(entity => entity.id), 'invalid-qdim-series', command);
    }
    const allocateId = createDimensionIdAllocator(content, options);
    const rebuiltEntities = descriptors.map((descriptor, index) => {
        const current = seriesEntities[index];
        return normalizeDrawingDimension({
            ...(current || firstEntity),
            ...descriptor,
            id: current?.id || allocateId('linearDimension', index),
            layerId: options.layerId || current?.layerId || firstEntity.layerId,
            linePoint: descriptor.linePoint,
            sourceId: undefined,
        });
    });
    if (sameQdimSeries(seriesEntities, rebuiltEntities)) {
        return {
            ...unchangedDimensionResult(
                content,
                seriesEntities.map(entity => entity.id),
                'unchanged-qdim-series',
                command,
            ),
            qdim: qdimResultMetadata(rebuiltEntities, mode, baselineEnd, normalizedSeriesId, axis, stations.length),
        };
    }
    const rebuiltById = new Map(rebuiltEntities.map(entity => [entity.id, entity]));
    const existingIds = new Set(seriesEntities.map(entity => entity.id));
    const lastSeriesIndex = content.entities.reduce((last, entity, index) => (
        existingIds.has(entity.id) ? index : last
    ), -1);
    const additions = rebuiltEntities.filter(entity => !existingIds.has(entity.id));
    const nextEntities = content.entities.flatMap((entity, index) => {
        if (!existingIds.has(entity.id)) return [entity];
        const replacement = rebuiltById.get(entity.id);
        return [
            ...(replacement ? [replacement] : []),
            ...(index === lastSeriesIndex ? additions : []),
        ];
    });
    return {
        changed: true,
        command,
        content: { ...content, entities: nextEntities },
        entities: rebuiltEntities,
        selectedIds: rebuiltEntities.map(entity => entity.id),
        layerId: rebuiltEntities[0]?.layerId || null,
        seriesId: normalizedSeriesId,
        qdim: qdimResultMetadata(rebuiltEntities, mode, baselineEnd, normalizedSeriesId, axis, stations.length),
    };
}

export function getQdimSeriesPosition(content, seriesId) {
    const normalizedSeriesId = typeof seriesId === 'string' ? seriesId.trim() : '';
    if (!normalizedSeriesId || !content || !Array.isArray(content.entities)) return null;
    const entities = collectQdimSeriesEntities(content, normalizedSeriesId);
    if (!entities.length) return null;
    const sources = entityMap(content);
    const offsets = entities.map(entity => getQdimEntityVisualOffset(entity, sources));
    const storedSpacing = entities.length > 1
        ? Math.abs(finiteOr(entities[1].offset, 0.6) - finiteOr(entities[0].offset, 0.6))
        : DEFAULT_DRAWING_QDIM_BASELINE_SPACING;
    const visualSpacing = entities.length > 1 ? Math.abs(offsets[1] - offsets[0]) : storedSpacing;
    const hasPinnedLine = entities.some(entity => isFinitePoint(entity.linePoint));
    return {
        seriesId: normalizedSeriesId,
        mode: normalizeDrawingQdimMode(entities[0].seriesMode),
        offset: offsets[0],
        spacing: entities[0].seriesMode === 'baseline'
            ? hasPinnedLine && storedSpacing > EPSILON ? storedSpacing : visualSpacing
            : 0,
        offsets,
    };
}

export function rebuildQdimSeriesFromGripResult(content, entityId, gripId, point) {
    const target = content?.entities?.find(entity => entity.id === entityId);
    const command = 'qdimGrip';
    if (target?.type !== 'linearDimension' || !target.seriesId || !isFinitePoint(point)) {
        return unchangedDimensionResult(content, entityId ? [entityId] : [], 'invalid-qdim-grip', command);
    }
    const index = Math.max(0, Math.trunc(finiteOr(target.seriesIndex, 0)));
    const isOffsetGrip = gripId === DRAWING_QDIM_GRIP_IDS.offset && index === 0;
    const isSpacingGrip = gripId === DRAWING_QDIM_GRIP_IDS.spacing
        && target.seriesMode === 'baseline'
        && index > 0;
    if (!isOffsetGrip && !isSpacingGrip) {
        return unchangedDimensionResult(content, [entityId], 'invalid-qdim-grip', command);
    }
    const sources = entityMap(content);
    const geometry = getDimensionGeometry(target, sources);
    const position = getQdimSeriesPosition(content, target.seriesId);
    if (!geometry?.sourceFirst || !position) {
        return unchangedDimensionResult(content, [entityId], 'invalid-qdim-grip', command);
    }
    const normal = { x: -Math.sin(geometry.angle), y: Math.cos(geometry.angle) };
    const draggedOffset = dot({
        x: point.x - geometry.sourceFirst.x,
        y: point.y - geometry.sourceFirst.y,
    }, normal);
    const patch = isOffsetGrip
        ? { offset: draggedOffset }
        : {
            spacing: Math.max(0, (
                (draggedOffset - position.offset) * (position.offset < 0 ? -1 : 1)
            ) / index),
        };
    return rebuildQdimSeriesResult(content, target.seriesId, { ...patch, command });
}

export function collectQdimStations(content, selectedIds, options = {}) {
    const candidates = collectLinearDimensionCandidates(content, selectedIds, options);
    if (!candidates.length) return {
        axis: { x: 1, y: 0 },
        dimensionAngle: finiteOr(options.dimensionAngle, 0),
        measurementMode: normalizeLinearMeasurementMode(options.measurementMode),
        stations: [],
    };
    const { axis, dimensionAngle, measurementMode } = resolveQdimSeriesConfiguration(candidates, options);
    const normal = { x: -axis.y, y: axis.x };
    const stations = candidates.flatMap(candidate => [
        qdimStation(candidate.first, candidate.references?.[0], axis, normal),
        qdimStation(candidate.second, candidate.references?.[1], axis, normal),
    ]).sort(compareQdimStations).filter((station, index, sorted) => (
        index === 0 || Math.abs(station.position - sorted[index - 1].position) > EPSILON
    )).map(({ position: _position, perpendicular: _perpendicular, sortKey: _sortKey, ...station }) => station);
    return { axis, dimensionAngle, measurementMode, stations };
}

export function resolveQdimSeriesId(content, requestedSeriesId = null) {
    if (typeof requestedSeriesId === 'string' && requestedSeriesId.trim()) return requestedSeriesId.trim();
    const used = new Set((content?.entities || [])
        .map(entity => entity.seriesId)
        .filter(value => typeof value === 'string' && value));
    let serial = 1;
    let candidate = `qdim-series-${serial}`;
    while (used.has(candidate)) {
        serial += 1;
        candidate = `qdim-series-${serial}`;
    }
    return candidate;
}

export function createAngularDimensionResult(content, selectedIds, options = {}) {
    const selected = selectedEntities(content, selectedIds);
    const arc = selected.find(entity => entity.type === 'arc');
    const lines = selected.filter(entity => entity.type === 'line');
    let descriptor = null;
    if (arc) {
        descriptor = {
            type: 'angularDimension',
            sourceId: arc.id,
            radius: finiteOr(options.radius, 1),
            counterClockwise: options.counterClockwise === undefined
                ? arc.counterClockwise !== false
                : options.counterClockwise !== false,
            reflex: Boolean(options.reflex),
        };
    } else if (lines.length >= 2) {
        descriptor = {
            type: 'angularDimension',
            sourceIds: lines.slice(0, 2).map(entity => entity.id),
            radius: finiteOr(options.radius, 1),
            counterClockwise: options.counterClockwise !== false,
            reflex: Boolean(options.reflex),
            ...(Array.isArray(options.sourcePickPoints) ? { sourcePickPoints: options.sourcePickPoints } : {}),
        };
    } else if (isFinitePoint(options.vertex)
        && isFinitePoint(options.ray1Point)
        && isFinitePoint(options.ray2Point)) {
        descriptor = {
            type: 'angularDimension',
            vertex: options.vertex,
            ray1Point: options.ray1Point,
            ray2Point: options.ray2Point,
            radius: finiteOr(options.radius, 1),
            counterClockwise: options.counterClockwise !== false,
            reflex: Boolean(options.reflex),
        };
    }
    if (!descriptor || !getDimensionGeometry(descriptor, entityMap(content))) {
        return unchangedDimensionResult(content, selectedIds, 'invalid-angular-sources', 'angular');
    }
    return appendDimensionEntities(content, [withCommonFormat(descriptor, options)], {
        ...options,
        command: 'angular',
    });
}

export function createArcLengthDimensionResult(content, selectedIds, options = {}) {
    const descriptors = selectedEntities(content, selectedIds)
        .filter(entity => entity.type === 'arc')
        .map((source, index) => withCommonFormat({
            type: 'arcLengthDimension',
            sourceId: source.id,
            offset: resolveNumberOption(options.offset, source, index, 0.6),
        }, options));
    return descriptors.length
        ? appendDimensionEntities(content, descriptors, { ...options, command: 'arcLength' })
        : unchangedDimensionResult(content, selectedIds, 'no-arc-sources', 'arcLength');
}

export function createJoggedRadiusDimensionResult(content, selectedIds, options = {}) {
    const descriptors = selectedEntities(content, selectedIds)
        .filter(entity => ['circle', 'arc'].includes(entity.type))
        .map((source, index) => {
            const angle = resolveRadialAngle(source, resolveSourceOption(options.placementPoint, source, index), options.angle);
            return withCommonFormat({
                type: 'radialDimension',
                sourceId: source.id,
                mode: 'joggedRadius',
                angle,
                leaderScale: resolveNumberOption(options.leaderScale, source, index, 1.45),
                jogSize: resolveNumberOption(options.jogSize, source, index, 0.2),
                ...(isFinitePoint(resolveSourceOption(options.jogCenter, source, index))
                    ? { jogCenter: resolveSourceOption(options.jogCenter, source, index) }
                    : {}),
                ...(isFinitePoint(resolveSourceOption(options.jogPoint, source, index))
                    ? { jogPoint: resolveSourceOption(options.jogPoint, source, index) }
                    : {}),
            }, options);
        });
    return descriptors.length
        ? appendDimensionEntities(content, descriptors, { ...options, command: 'joggedRadius' })
        : unchangedDimensionResult(content, selectedIds, 'no-radial-sources', 'joggedRadius');
}

export function createOrdinateDimensionResult(content, selectedIds, options = {}) {
    const selected = selectedEntities(content, selectedIds);
    const explicitFeature = isFinitePoint(options.featurePoint) ? options.featurePoint : null;
    const sources = selected.length ? selected : explicitFeature ? [null] : [];
    const descriptors = sources.flatMap((source, index) => {
        const featurePoint = explicitFeature || resolveOrdinateFeaturePoint(source);
        if (!featurePoint) return [];
        const leaderPoint = resolveSourceOption(options.leaderPoint, source, index);
        return [withCommonFormat({
            type: 'ordinateDimension',
            ...(source?.id ? { sourceId: source.id } : {}),
            axis: options.axis === 'y' ? 'y' : 'x',
            origin: isFinitePoint(options.origin) ? options.origin : { x: 0, y: 0 },
            ...(!source || explicitFeature ? { featurePoint } : {}),
            ...(isFinitePoint(leaderPoint) ? { leaderPoint } : {}),
        }, options)];
    });
    return descriptors.length
        ? appendDimensionEntities(content, descriptors, { ...options, command: 'ordinate' })
        : unchangedDimensionResult(content, selectedIds, 'no-ordinate-features', 'ordinate');
}

export function createCenterMarkResult(content, selectedIds, options = {}) {
    const descriptors = selectedEntities(content, selectedIds)
        .filter(entity => ['circle', 'arc'].includes(entity.type))
        .map((source, index) => ({
            type: 'centerMark',
            sourceId: source.id,
            size: resolveNumberOption(options.size, source, index, 0.25),
            extension: resolveNumberOption(options.extension, source, index, 0),
        }));
    return descriptors.length
        ? appendDimensionEntities(content, descriptors, { ...options, command: 'centerMark' })
        : unchangedDimensionResult(content, selectedIds, 'no-center-sources', 'centerMark');
}

export function appendDimensionEntities(content, descriptors, options = {}) {
    if (!content || !Array.isArray(content.entities)) {
        return unchangedDimensionResult(content, [], 'invalid-content', options.command || 'dimension');
    }
    const layerId = resolveDimensionLayerId(content, options.layerId);
    const allocateId = createDimensionIdAllocator(content, options);
    const entityMapValue = entityMap(content);
    const entities = (descriptors || []).flatMap((descriptor, index) => {
        const normalized = normalizeDrawingDimension({
            ...descriptor,
            layerId,
        });
        if (!normalized || typeof normalized.type !== 'string') return [];
        if (!getDimensionGeometry(normalized, entityMapValue)) return [];
        return [{ ...normalized, id: allocateId(normalized.type, index) }];
    });
    if (!entities.length) {
        return unchangedDimensionResult(content, [], 'invalid-dimension-geometry', options.command || 'dimension');
    }
    return {
        changed: true,
        command: options.command || 'dimension',
        content: { ...content, entities: [...content.entities, ...entities] },
        entities,
        selectedIds: entities.map(entity => entity.id),
        layerId,
    };
}

export function createDimensionIdAllocator(content, {
    idFactory = null,
    idPrefix = 'dimension',
} = {}) {
    const usedIds = new Set((content?.entities || []).map(entity => entity.id));
    let serial = 1;
    return (type = 'dimension', index = 0) => {
        if (typeof idFactory === 'function') {
            const requested = idFactory({ type, index, usedIds: new Set(usedIds) });
            if (typeof requested === 'string' && requested && !usedIds.has(requested)) {
                usedIds.add(requested);
                return requested;
            }
        }
        let candidate = `${idPrefix}-${serial}`;
        while (usedIds.has(candidate)) {
            serial += 1;
            candidate = `${idPrefix}-${serial}`;
        }
        usedIds.add(candidate);
        serial += 1;
        return candidate;
    };
}

export function resolveDimensionLayerId(content, requestedLayerId = null) {
    const layers = Array.isArray(content?.layers) ? content.layers : [];
    if (requestedLayerId && layers.some(layer => layer.id === requestedLayerId)) return requestedLayerId;
    if (layers.some(layer => layer.id === 'dimensions')) return 'dimensions';
    if (content?.activeLayerId && layers.some(layer => layer.id === content.activeLayerId)) {
        return content.activeLayerId;
    }
    return layers[0]?.id || 'dimensions';
}

function collectLinearDimensionCandidates(content, selectedIds, options) {
    const map = entityMap(content);
    const candidates = selectedEntities(content, selectedIds).flatMap(source => {
        if (source.type === 'linearDimension') {
            const geometry = getDimensionGeometry(source, map);
            return geometry ? [{
                source,
                first: geometry.sourceFirst,
                second: geometry.sourceSecond,
                edgeIndex: null,
                references: [
                    pointReference(null, geometry.sourceFirst, 0),
                    pointReference(null, geometry.sourceSecond, 1),
                ],
            }] : [];
        }
        if (source.type === 'line') return [{
            source,
            first: { x: source.x1, y: source.y1 },
            second: { x: source.x2, y: source.y2 },
            edgeIndex: null,
            references: [
                pointReference(source, { x: source.x1, y: source.y1 }, 0),
                pointReference(source, { x: source.x2, y: source.y2 }, 1),
            ],
        }];
        if (!['rectangle', 'polygon'].includes(source.type)) return [];
        const segments = getEntitySegments(source);
        if (!segments.length) return [];
        const requested = resolveSourceOption(options.edgeIndex, source, 0);
        const edgeIndex = Math.max(0, Math.min(segments.length - 1, Math.trunc(finiteOr(requested, 0))));
        return [{
            source,
            first: segments[edgeIndex][0],
            second: segments[edgeIndex][1],
            edgeIndex,
            references: [
                pointReference(source, segments[edgeIndex][0], 0, edgeIndex),
                pointReference(source, segments[edgeIndex][1], 1, edgeIndex),
            ],
        }];
    });
    return candidates.filter(candidate => (
        isFinitePoint(candidate.first)
        && isFinitePoint(candidate.second)
        && Math.hypot(candidate.second.x - candidate.first.x, candidate.second.y - candidate.first.y) > EPSILON
    ));
}

function collectQdimSeriesEntities(content, seriesId) {
    return content.entities.map((entity, documentIndex) => ({ entity, documentIndex }))
        .filter(({ entity }) => entity.type === 'linearDimension' && entity.seriesId === seriesId)
        .sort((left, right) => (
            finiteOr(left.entity.seriesIndex, 0) - finiteOr(right.entity.seriesIndex, 0)
            || left.documentIndex - right.documentIndex
            || String(left.entity.id || '').localeCompare(String(right.entity.id || ''))
        ))
        .map(({ entity }) => normalizeDrawingDimension(entity));
}

function normalizeQdimEntityReferences(entity, geometry) {
    const references = Array.isArray(entity.sourcePointReferences)
        ? entity.sourcePointReferences.slice(0, 2).map(normalizeDrawingDimensionPointReference)
        : [];
    return [geometry.sourceFirst, geometry.sourceSecond].map((point, index) => (
        references[index] || pointReference(null, point, index)
    ));
}

function inferQdimSeriesSpacing(seriesEntities) {
    if (seriesEntities.length < 2) return 0;
    return Math.abs(
        finiteOr(seriesEntities[1].offset, 0.6) - finiteOr(seriesEntities[0].offset, 0.6),
    );
}

function getQdimEntityVisualOffset(entity, sources) {
    if (!isFinitePoint(entity.linePoint)) return finiteOr(entity.offset, 0.6);
    const geometry = getDimensionGeometry(entity, sources);
    if (!geometry?.first || !geometry?.sourceFirst) return finiteOr(entity.offset, 0.6);
    const normal = { x: -Math.sin(geometry.angle), y: Math.cos(geometry.angle) };
    return dot({
        x: geometry.first.x - geometry.sourceFirst.x,
        y: geometry.first.y - geometry.sourceFirst.y,
    }, normal);
}

function sameQdimSeries(previous, next) {
    if (previous.length !== next.length) return false;
    return previous.every((entity, index) => (
        JSON.stringify(normalizeDrawingDimension(entity)) === JSON.stringify(next[index])
    ));
}

function qdimResultMetadata(entities, mode, baselineEnd, seriesId, axis, stationCount) {
    return {
        mode,
        baselineEnd,
        seriesId,
        axis,
        stationCount,
        baselineReference: mode === 'baseline' ? entities[0]?.baselineReference || null : null,
    };
}

function seriesAxis(candidate, options) {
    if (isFinitePoint(options.seriesAxis)) {
        const length = Math.hypot(options.seriesAxis.x, options.seriesAxis.y);
        if (length > EPSILON) return { x: options.seriesAxis.x / length, y: options.seriesAxis.y / length };
    }
    if (options.measurementMode === 'vertical') return { x: 0, y: 1 };
    if (options.measurementMode === 'rotated') {
        const angle = finiteOr(options.dimensionAngle, 0);
        return { x: Math.cos(angle), y: Math.sin(angle) };
    }
    if (options.measurementMode === 'horizontal') return { x: 1, y: 0 };
    const dx = candidate.second.x - candidate.first.x;
    const dy = candidate.second.y - candidate.first.y;
    const length = Math.hypot(dx, dy);
    return length > EPSILON ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
}

function canonicalSeriesAxis(axis) {
    const length = Math.hypot(axis?.x || 0, axis?.y || 0);
    if (length <= EPSILON) return { x: 1, y: 0 };
    const normalized = { x: axis.x / length, y: axis.y / length };
    if (normalized.x < -EPSILON || (Math.abs(normalized.x) <= EPSILON && normalized.y < 0)) {
        return cleanAxis({ x: -normalized.x, y: -normalized.y });
    }
    return cleanAxis(normalized);
}

function resolveQdimSeriesConfiguration(candidates, options) {
    const explicitMeasurementMode = isLinearMeasurementMode(options.measurementMode)
        ? options.measurementMode
        : null;
    const requestedAngle = finiteOr(options.dimensionAngle, 0);
    const hasExplicitAxis = isFinitePoint(options.seriesAxis)
        && Math.hypot(options.seriesAxis.x, options.seriesAxis.y) > EPSILON;
    const axisCandidate = selectQdimAxisCandidate(candidates);
    const axis = hasExplicitAxis || explicitMeasurementMode
        ? canonicalSeriesAxis(seriesAxis(axisCandidate, {
            ...options,
            measurementMode: explicitMeasurementMode || 'aligned',
            dimensionAngle: requestedAngle,
        }))
        : inferQdimSeriesAxis(candidates, axisCandidate);
    const measurementMode = explicitMeasurementMode || measurementModeForSeriesAxis(axis);
    const dimensionAngle = measurementMode === 'rotated' && !explicitMeasurementMode
        ? Math.atan2(axis.y, axis.x)
        : requestedAngle;
    return { axis, dimensionAngle, measurementMode };
}

function inferQdimSeriesAxis(candidates, fallbackCandidate) {
    const usable = candidates.map(candidate => {
        const dx = candidate.second.x - candidate.first.x;
        const dy = candidate.second.y - candidate.first.y;
        const length = Math.hypot(dx, dy);
        return length > EPSILON ? {
            center: {
                x: (candidate.first.x + candidate.second.x) / 2,
                y: (candidate.first.y + candidate.second.y) / 2,
            },
            direction: canonicalSeriesAxis({ x: dx / length, y: dy / length }),
        } : null;
    }).filter(Boolean);
    if (usable.length > 1) {
        const direction = usable[0].direction;
        const parallel = usable.every(candidate => Math.abs(
            candidate.direction.x * direction.y - candidate.direction.y * direction.x,
        ) <= 1e-7);
        if (parallel) {
            const normal = canonicalSeriesAxis({ x: -direction.y, y: direction.x });
            const normalSpread = scalarSpread(usable.map(candidate => dot(candidate.center, normal)));
            if (normalSpread > EPSILON) return normal;
            const directionSpread = scalarSpread(usable.map(candidate => dot(candidate.center, direction)));
            if (directionSpread > EPSILON) return direction;
        }
        const xSpread = scalarSpread(usable.map(candidate => candidate.center.x));
        const ySpread = scalarSpread(usable.map(candidate => candidate.center.y));
        if (xSpread > EPSILON || ySpread > EPSILON) {
            return xSpread >= ySpread ? { x: 1, y: 0 } : { x: 0, y: 1 };
        }
    }
    return canonicalSeriesAxis(seriesAxis(fallbackCandidate, { measurementMode: 'aligned' }));
}

function measurementModeForSeriesAxis(axis) {
    if (Math.abs(axis.y) <= EPSILON) return 'horizontal';
    if (Math.abs(axis.x) <= EPSILON) return 'vertical';
    return 'rotated';
}

function scalarSpread(values) {
    return Math.max(...values) - Math.min(...values);
}

function cleanAxis(axis) {
    return {
        x: Math.abs(axis.x) <= EPSILON ? 0 : axis.x,
        y: Math.abs(axis.y) <= EPSILON ? 0 : axis.y,
    };
}

function selectQdimAxisCandidate(candidates) {
    return [...candidates].sort((left, right) => {
        const leftLength = pointDistance(left.first, left.second);
        const rightLength = pointDistance(right.first, right.second);
        if (Math.abs(leftLength - rightLength) > EPSILON) return rightLength - leftLength;
        return qdimCandidateSortKey(left).localeCompare(qdimCandidateSortKey(right));
    })[0];
}

function qdimCandidateSortKey(candidate) {
    const first = candidate.first;
    const second = candidate.second;
    const endpoints = [first, second].sort((left, right) => (
        left.x - right.x || left.y - right.y
    ));
    return [
        endpoints[0].x,
        endpoints[0].y,
        endpoints[1].x,
        endpoints[1].y,
        candidate.source?.id || '',
        candidate.edgeIndex ?? -1,
    ].join(':');
}

function normalizeLinearMeasurementMode(value) {
    return isLinearMeasurementMode(value) ? value : 'aligned';
}

function isLinearMeasurementMode(value) {
    return ['aligned', 'horizontal', 'vertical', 'rotated'].includes(value);
}

function pointReference(source, point, endpointIndex, edgeIndex = null) {
    return normalizeDrawingDimensionPointReference({
        ...(source?.id ? { sourceId: source.id, sourceType: source.type } : {}),
        ...(edgeIndex === null ? {} : { edgeIndex }),
        endpointIndex,
        point,
    });
}

function qdimStation(point, reference, axis, normal) {
    const normalizedReference = normalizeDrawingDimensionPointReference(reference) || pointReference(null, point, 0);
    const sortKey = [
        normalizedReference.sourceId || '',
        normalizedReference.sourceType || '',
        normalizedReference.edgeIndex ?? -1,
        normalizedReference.endpointIndex,
        point.x,
        point.y,
    ].join(':');
    return {
        point: { x: Number(point.x), y: Number(point.y) },
        reference: normalizedReference,
        position: dot(point, axis),
        perpendicular: dot(point, normal),
        sortKey,
    };
}

function compareQdimStations(left, right) {
    if (Math.abs(left.position - right.position) > EPSILON) return left.position - right.position;
    if (Math.abs(left.perpendicular - right.perpendicular) > EPSILON) {
        return left.perpendicular - right.perpendicular;
    }
    return left.sortKey.localeCompare(right.sortKey);
}

function linearDimensionOptions(options, index, spacing) {
    return withCommonFormat({
        measurementMode: ['aligned', 'horizontal', 'vertical', 'rotated'].includes(options.measurementMode)
            ? options.measurementMode
            : 'aligned',
        dimensionAngle: finiteOr(options.dimensionAngle, 0),
        offset: finiteOr(options.offset, 0.6) + spacing * index,
        ...(isFinitePoint(options.linePoint) ? { linePoint: options.linePoint } : {}),
    }, options);
}

function withCommonFormat(descriptor, options) {
    return {
        ...descriptor,
        ...(options.dimensionFormat !== undefined ? { dimensionFormat: options.dimensionFormat } : {}),
        ...(Number.isFinite(Number(options.textSize)) ? { textSize: Number(options.textSize) } : {}),
    };
}

function selectedEntities(content, selectedIds) {
    const entityMapValue = new Map((content?.entities || []).map(entity => [entity.id, entity]));
    return [...new Set(selectedIds || [])].map(id => entityMapValue.get(id)).filter(Boolean);
}

function entityMap(content) {
    return new Map((content?.entities || []).map(entity => [entity.id, entity]));
}

function unchangedDimensionResult(content, selectedIds, reason, command) {
    return {
        changed: false,
        command,
        content,
        entities: [],
        selectedIds: selectedIds || [],
        reason,
    };
}

function resolveRadialAngle(source, placementPoint, requestedAngle) {
    if (Number.isFinite(Number(requestedAngle))) return Number(requestedAngle);
    if (isFinitePoint(placementPoint)) {
        const dx = placementPoint.x - source.cx;
        const dy = placementPoint.y - source.cy;
        if (Math.hypot(dx, dy) > EPSILON) return Math.atan2(dy, dx);
    }
    return -Math.PI / 4;
}

function resolveOrdinateFeaturePoint(source) {
    if (!source) return null;
    if (source.type === 'line') return { x: source.x1, y: source.y1 };
    if (Number.isFinite(Number(source.cx)) && Number.isFinite(Number(source.cy))) {
        return { x: Number(source.cx), y: Number(source.cy) };
    }
    if (Number.isFinite(Number(source.x)) && Number.isFinite(Number(source.y))) {
        return { x: Number(source.x), y: Number(source.y) };
    }
    return null;
}

function resolveNumberOption(option, source, index, fallback) {
    return finiteOr(resolveSourceOption(option, source, index), fallback);
}

function resolveSourceOption(option, source, index) {
    if (typeof option === 'function') return option(source, index);
    if (option instanceof Map) return option.get(source?.id);
    if (option && typeof option === 'object' && !Array.isArray(option) && !isFinitePoint(option)
        && source?.id && Object.hasOwn(option, source.id)) return option[source.id];
    return option;
}

function dot(point, axis) {
    return point.x * axis.x + point.y * axis.y;
}

function pointDistance(first, second) {
    return Math.hypot(second.x - first.x, second.y - first.y);
}

function finiteOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function isFinitePoint(point) {
    return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
}
