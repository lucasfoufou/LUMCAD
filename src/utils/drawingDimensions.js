import {
    arcEndPoint,
    arcStartPoint,
    arcSweep,
    getRectangleOutlinePoints,
    getRegularPolygonVertices,
    isFiniteBoundedCircle,
} from './drawingCurves.js';

const EPSILON = 1e-9;
const TAU = Math.PI * 2;
const DEFAULT_LINEAR_OFFSET = 0.6;
const DEFAULT_RADIAL_ANGLE = -Math.PI / 4;
const DEFAULT_RADIAL_LEADER_SCALE = 1.45;
const DEFAULT_ANGULAR_RADIUS = 1;
const DEFAULT_CENTER_MARK_SIZE = 0.25;
const MAX_FORMAT_PRECISION = 8;

export const DRAWING_DIMENSION_TYPES = Object.freeze([
    'linearDimension',
    'radialDimension',
    'angularDimension',
    'arcLengthDimension',
    'ordinateDimension',
    'centerMark',
]);

export const DRAWING_LINEAR_DIMENSION_MODES = Object.freeze([
    'aligned',
    'horizontal',
    'vertical',
    'rotated',
]);

export const DRAWING_RADIAL_DIMENSION_MODES = Object.freeze([
    'radius',
    'diameter',
    'joggedRadius',
]);

export const DRAWING_DIMENSION_TOLERANCE_MODES = Object.freeze([
    'none',
    'symmetric',
    'deviation',
    'limits',
]);

export const DRAWING_DIMENSION_UNITS = Object.freeze(['m', 'cm', 'mm', 'in', 'ft']);
export const DRAWING_DIMENSION_SERIES_MODES = Object.freeze([
    'quick',
    'baseline',
    'continuous',
    'continued',
    'chain',
]);
export const DRAWING_QDIM_MODES = Object.freeze(['continuous', 'baseline']);
export const DRAWING_QDIM_BASELINE_ENDS = Object.freeze(['first', 'last']);
export const DEFAULT_DRAWING_QDIM_BASELINE_SPACING = 0.45;
export const DRAWING_QDIM_GRIP_IDS = Object.freeze({
    offset: 'qdim-offset',
    spacing: 'qdim-spacing',
});

const UNIT_FACTORS = Object.freeze({
    m: 1,
    cm: 100,
    mm: 1_000,
    in: 39.37007874015748,
    ft: 3.280839895013123,
});

const UNIT_LABELS = Object.freeze({
    m: 'm',
    cm: 'cm',
    mm: 'mm',
    in: 'in',
    ft: 'ft',
});

export function isDrawingDimensionEntity(entityOrType) {
    const type = typeof entityOrType === 'string' ? entityOrType : entityOrType?.type;
    return DRAWING_DIMENSION_TYPES.includes(type);
}

export function normalizeDrawingDimension(entity) {
    if (!isDrawingDimensionEntity(entity)) return entity;
    const normalized = { ...entity };
    normalizeDependencies(normalized, entity);

    if (entity.dimensionFormat !== undefined) {
        normalized.dimensionFormat = normalizeDrawingDimensionFormat(entity.dimensionFormat);
    }

    if (entity.type === 'linearDimension') {
        normalized.measurementMode = DRAWING_LINEAR_DIMENSION_MODES.includes(entity.measurementMode)
            ? entity.measurementMode
            : 'aligned';
        normalized.offset = finiteOr(entity.offset, DEFAULT_LINEAR_OFFSET);
        normalized.dimensionAngle = finiteOr(entity.dimensionAngle, 0);
        normalized.edgeIndex = Math.max(0, Math.trunc(finiteOr(entity.edgeIndex, 0)));
        normalizeOptionalPoint(normalized, entity, 'p1');
        normalizeOptionalPoint(normalized, entity, 'p2');
        normalizeOptionalPoint(normalized, entity, 'linePoint');
        normalizeLinearSeriesMetadata(normalized, entity);
    } else if (entity.type === 'radialDimension') {
        normalized.mode = DRAWING_RADIAL_DIMENSION_MODES.includes(entity.mode) ? entity.mode : 'radius';
        normalized.angle = finiteOr(entity.angle, DEFAULT_RADIAL_ANGLE);
        normalized.leaderScale = Math.max(1.05, finiteOr(entity.leaderScale, DEFAULT_RADIAL_LEADER_SCALE));
        normalized.jogSize = Math.max(0, finiteOr(entity.jogSize, 0.2));
        normalizeOptionalPoint(normalized, entity, 'jogCenter');
        normalizeOptionalPoint(normalized, entity, 'jogPoint');
    } else if (entity.type === 'angularDimension') {
        normalized.radius = Math.max(EPSILON, finiteOr(entity.radius, DEFAULT_ANGULAR_RADIUS));
        normalized.counterClockwise = entity.counterClockwise !== false;
        normalized.reflex = Boolean(entity.reflex);
        normalizeOptionalPoint(normalized, entity, 'vertex');
        normalizeOptionalPoint(normalized, entity, 'ray1Point');
        normalizeOptionalPoint(normalized, entity, 'ray2Point');
        normalized.sourcePickPoints = normalizePointArray(entity.sourcePickPoints, 2);
        if (!normalized.sourcePickPoints.length) delete normalized.sourcePickPoints;
    } else if (entity.type === 'arcLengthDimension') {
        normalized.offset = finiteOr(entity.offset, DEFAULT_LINEAR_OFFSET);
    } else if (entity.type === 'ordinateDimension') {
        normalized.axis = entity.axis === 'y' ? 'y' : 'x';
        normalized.origin = finitePointOr(entity.origin, { x: 0, y: 0 });
        normalizeOptionalPoint(normalized, entity, 'featurePoint');
        normalizeOptionalPoint(normalized, entity, 'leaderPoint');
    } else if (entity.type === 'centerMark') {
        normalized.size = Math.max(EPSILON, finiteOr(entity.size, DEFAULT_CENTER_MARK_SIZE));
        normalized.extension = Math.max(0, finiteOr(entity.extension, 0));
    }
    return normalized;
}

export function normalizeDrawingDimensionFormat(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const toleranceSource = source.tolerance && typeof source.tolerance === 'object'
        ? source.tolerance
        : {};
    const alternateSource = source.alternateUnits && typeof source.alternateUnits === 'object'
        ? source.alternateUnits
        : {};
    const inspectionSource = source.inspection && typeof source.inspection === 'object'
        ? source.inspection
        : {};
    return {
        precision: normalizePrecision(source.precision, 4),
        prefix: String(source.prefix || ''),
        suffix: String(source.suffix || ''),
        tolerance: {
            mode: DRAWING_DIMENSION_TOLERANCE_MODES.includes(toleranceSource.mode)
                ? toleranceSource.mode
                : 'none',
            upper: Math.max(0, finiteOr(toleranceSource.upper, 0)),
            lower: Math.max(0, finiteOr(toleranceSource.lower, toleranceSource.upper ?? 0)),
            precision: normalizePrecision(toleranceSource.precision, source.precision ?? 4),
        },
        alternateUnits: {
            enabled: Boolean(alternateSource.enabled),
            unit: DRAWING_DIMENSION_UNITS.includes(alternateSource.unit) ? alternateSource.unit : 'mm',
            precision: normalizePrecision(alternateSource.precision, 2),
        },
        inspection: {
            enabled: Boolean(inspectionSource.enabled),
            label: String(inspectionSource.label || ''),
            rate: String(inspectionSource.rate || ''),
        },
    };
}

export function getDrawingEntityDependencyIds(entity) {
    if (!entity || typeof entity !== 'object') return [];
    const candidates = [
        entity.sourceId,
        ...(Array.isArray(entity.sourceIds) ? entity.sourceIds : []),
        ...(Array.isArray(entity.sourcePointReferences)
            ? entity.sourcePointReferences.map(reference => reference?.sourceId)
            : []),
        entity.baselineReference?.sourceId,
    ];
    return [...new Set(candidates.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))];
}

export function drawingEntityDependsOn(entity, sourceId) {
    return typeof sourceId === 'string' && getDrawingEntityDependencyIds(entity).includes(sourceId);
}

export function remapDrawingEntityDependencies(entity, idMap) {
    if (!entity || typeof entity !== 'object') return entity;
    const resolve = dependencyRemapper(idMap);
    const remapped = { ...entity };
    if (typeof entity.sourceId === 'string') remapped.sourceId = resolve(entity.sourceId);
    if (Array.isArray(entity.sourceIds)) {
        remapped.sourceIds = [...new Set(entity.sourceIds
            .filter(id => typeof id === 'string' && id.trim())
            .map(id => resolve(id.trim()))
            .filter(id => typeof id === 'string' && id.trim()))];
    }
    if (Array.isArray(entity.sourcePointReferences)) {
        remapped.sourcePointReferences = entity.sourcePointReferences.map(reference => {
            if (!reference || typeof reference !== 'object') return reference;
            return typeof reference.sourceId === 'string'
                ? { ...reference, sourceId: resolve(reference.sourceId) }
                : { ...reference };
        });
    }
    if (entity.baselineReference && typeof entity.baselineReference === 'object') {
        remapped.baselineReference = typeof entity.baselineReference.sourceId === 'string'
            ? { ...entity.baselineReference, sourceId: resolve(entity.baselineReference.sourceId) }
            : { ...entity.baselineReference };
    }
    return remapped;
}

export function normalizeDrawingQdimMode(value = 'continuous') {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'baseline' ? 'baseline' : 'continuous';
}

export function normalizeDrawingQdimBaselineEnd(value = 'first') {
    const normalized = String(value || '').trim().toLowerCase();
    return ['last', 'right', 'end'].includes(normalized) ? 'last' : 'first';
}

export function reverseDrawingQdimBaselineEnd(value = 'first') {
    return normalizeDrawingQdimBaselineEnd(value) === 'first' ? 'last' : 'first';
}

export function normalizeDrawingDimensionPointReference(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const sourceId = typeof value.sourceId === 'string' ? value.sourceId.trim() : '';
    const point = isFinitePoint(value.point) ? clonePoint(value.point) : null;
    if (!sourceId && !point) return null;
    const normalized = {
        ...(sourceId ? { sourceId } : {}),
        ...(typeof value.sourceType === 'string' && value.sourceType.trim()
            ? { sourceType: value.sourceType.trim() }
            : {}),
        endpointIndex: Number(value.endpointIndex) === 1 ? 1 : 0,
        ...(point ? { point } : {}),
    };
    if (Number.isFinite(Number(value.edgeIndex))) {
        normalized.edgeIndex = Math.max(0, Math.trunc(Number(value.edgeIndex)));
    }
    return normalized;
}

export function getDimensionGeometry(dimension, sources = null) {
    if (!dimension || typeof dimension !== 'object') return null;
    if (dimension.type === 'linearDimension') return getLinearDimensionGeometry(dimension, sources);
    if (dimension.type === 'radialDimension') return getRadialDimensionGeometry(dimension, sources);
    if (dimension.type === 'angularDimension') return getAngularDimensionGeometry(dimension, sources);
    if (dimension.type === 'arcLengthDimension') return getArcLengthDimensionGeometry(dimension, sources);
    if (dimension.type === 'ordinateDimension') return getOrdinateDimensionGeometry(dimension, sources);
    if (dimension.type === 'centerMark') return getCenterMarkGeometry(dimension, sources);
    return null;
}

export function getLinearDimensionGeometry(dimension, sources = null) {
    const endpoints = getLinearSourceEndpoints(dimension, sources);
    if (!endpoints) return null;
    const [sourceFirst, sourceSecond] = endpoints;
    const delta = subtract(sourceSecond, sourceFirst);
    if (magnitude(delta) < EPSILON) return null;

    const mode = DRAWING_LINEAR_DIMENSION_MODES.includes(dimension.measurementMode)
        ? dimension.measurementMode
        : 'aligned';
    const axis = linearMeasurementAxis(mode, dimension.dimensionAngle, delta);
    const normal = { x: -axis.y, y: axis.x };
    const offset = finiteOr(dimension.offset, DEFAULT_LINEAR_OFFSET);
    const lineScalar = isFinitePoint(dimension.linePoint)
        ? dot(dimension.linePoint, normal)
        : dot(sourceFirst, normal) + offset;
    const first = projectOntoDimensionLine(sourceFirst, axis, normal, lineScalar);
    const second = projectOntoDimensionLine(sourceSecond, axis, normal, lineScalar);
    const measured = Math.abs(dot(delta, axis));
    if (measured < EPSILON) return null;
    const angle = Math.atan2(axis.y, axis.x);
    const text = midpoint(first, second);
    return createDimensionGeometry({
        kind: 'linear',
        entityType: dimension.type,
        value: measured,
        unitKind: 'length',
        points: [first, second, sourceFirst, sourceSecond],
        lines: [
            linePrimitive(sourceFirst, first, 'extension'),
            linePrimitive(sourceSecond, second, 'extension'),
            linePrimitive(first, second, 'dimension'),
        ],
        ticks: [
            tickPrimitive(first, angle + Math.PI / 2, 'dimension'),
            tickPrimitive(second, angle + Math.PI / 2, 'dimension'),
        ],
        label: labelPrimitive(text, angle),
        legacy: { first, second, sourceFirst, sourceSecond, text, angle, mode },
    });
}

export function getRadialDimensionGeometry(dimension, sources = null) {
    const source = resolvePrimarySource(dimension, sources);
    if (!['circle', 'arc'].includes(source?.type) || !isFiniteBoundedCircle(source)) return null;
    const radius = Math.abs(Number(source.r) || 0);
    if (radius < EPSILON) return null;
    const mode = DRAWING_RADIAL_DIMENSION_MODES.includes(dimension.mode) ? dimension.mode : 'radius';
    const angle = finiteOr(dimension.angle, DEFAULT_RADIAL_ANGLE);
    const direction = vectorFromAngle(angle);
    const trueCenter = { x: source.cx, y: source.cy };
    const edge = add(trueCenter, scale(direction, radius));
    const text = add(trueCenter, scale(direction, radius * Math.max(
        1.05,
        finiteOr(dimension.leaderScale, DEFAULT_RADIAL_LEADER_SCALE),
    )));
    const value = mode === 'diameter' ? radius * 2 : radius;

    if (mode !== 'joggedRadius') {
        return createDimensionGeometry({
            kind: 'radial',
            entityType: dimension.type,
            value,
            unitKind: 'length',
            points: [trueCenter, edge, text],
            lines: [linePrimitive(trueCenter, edge, 'radius'), linePrimitive(edge, text, 'leader')],
            ticks: [tickPrimitive(edge, angle + Math.PI / 2, 'dimension')],
            label: labelPrimitive(text, angle),
            legacy: { center: trueCenter, edge, text, angle, mode },
        });
    }

    const jogCenter = isFinitePoint(dimension.jogCenter) ? clonePoint(dimension.jogCenter) : trueCenter;
    const jogPoint = isFinitePoint(dimension.jogPoint)
        ? clonePoint(dimension.jogPoint)
        : midpoint(jogCenter, edge);
    const jogSize = Math.max(0, finiteOr(dimension.jogSize, Math.max(radius * 0.08, 0.2)));
    const jog = createJogPolyline(jogPoint, angle, jogSize);
    const points = [trueCenter, jogCenter, ...jog, edge, text];
    const jogLines = adjacentPointPairs(jog).map(([start, end]) => linePrimitive(start, end, 'jog'));
    return createDimensionGeometry({
        kind: 'radial',
        entityType: dimension.type,
        value,
        unitKind: 'length',
        points,
        lines: [
            linePrimitive(jogCenter, jog[0], 'radius'),
            ...jogLines,
            linePrimitive(jog[jog.length - 1], edge, 'radius'),
            linePrimitive(edge, text, 'leader'),
        ],
        ticks: [tickPrimitive(edge, angle + Math.PI / 2, 'dimension')],
        jogs: [{ points: jog, role: 'radius' }],
        label: labelPrimitive(text, angle),
        legacy: { center: trueCenter, jogCenter, jogPoint, edge, text, angle, mode },
    });
}

export function getAngularDimensionGeometry(dimension, sources = null) {
    const rays = getAngularRays(dimension, sources);
    if (!rays) return null;
    const { vertex, firstDirection, secondDirection } = rays;
    const firstAngle = Math.atan2(firstDirection.y, firstDirection.x);
    const secondAngle = Math.atan2(secondDirection.y, secondDirection.x);
    const counterClockwise = dimension.counterClockwise !== false;
    let sweep = directedSweep(firstAngle, secondAngle, counterClockwise);
    if (dimension.reflex && Math.abs(sweep) < Math.PI - EPSILON) sweep -= Math.sign(sweep || 1) * TAU;
    if (!dimension.reflex && Math.abs(sweep) > Math.PI + EPSILON) sweep -= Math.sign(sweep) * TAU;
    if (Math.abs(sweep) < EPSILON) return null;
    const radius = Math.max(EPSILON, finiteOr(dimension.radius, DEFAULT_ANGULAR_RADIUS));
    const endAngle = firstAngle + sweep;
    const first = add(vertex, scale(vectorFromAngle(firstAngle), radius));
    const second = add(vertex, scale(vectorFromAngle(endAngle), radius));
    const middleAngle = firstAngle + sweep / 2;
    const text = add(vertex, scale(vectorFromAngle(middleAngle), radius));
    const arc = arcPrimitive(vertex, radius, firstAngle, endAngle, sweep > 0, 'dimension');
    return createDimensionGeometry({
        kind: 'angular',
        entityType: dimension.type,
        value: Math.abs(sweep),
        unitKind: 'angle',
        points: [vertex, first, second, text],
        lines: [linePrimitive(vertex, first, 'extension'), linePrimitive(vertex, second, 'extension')],
        arcs: [arc],
        ticks: [
            tickPrimitive(first, firstAngle + Math.PI / 2, 'dimension'),
            tickPrimitive(second, endAngle + Math.PI / 2, 'dimension'),
        ],
        label: labelPrimitive(text, normalizeReadableAngle(middleAngle + Math.PI / 2)),
        legacy: {
            vertex,
            first,
            second,
            text,
            angle: normalizeReadableAngle(middleAngle + Math.PI / 2),
            startAngle: firstAngle,
            endAngle,
            counterClockwise: sweep > 0,
            radius,
        },
    });
}

export function getArcLengthDimensionGeometry(dimension, sources = null) {
    const source = resolvePrimarySource(dimension, sources);
    if (source?.type !== 'arc' || !isFiniteBoundedCircle(source)) return null;
    const sourceRadius = Math.abs(Number(source.r) || 0);
    const sweep = arcSweep(source);
    if (sourceRadius < EPSILON || Math.abs(sweep) < EPSILON) return null;
    const radius = sourceRadius + finiteOr(dimension.offset, DEFAULT_LINEAR_OFFSET);
    if (radius < EPSILON) return null;
    const center = { x: source.cx, y: source.cy };
    const startAngle = finiteOr(source.startAngle, 0);
    const endAngle = startAngle + sweep;
    const sourceFirst = arcStartPoint(source);
    const sourceSecond = arcEndPoint(source);
    const first = add(center, scale(vectorFromAngle(startAngle), radius));
    const second = add(center, scale(vectorFromAngle(endAngle), radius));
    const middleAngle = startAngle + sweep / 2;
    const text = add(center, scale(vectorFromAngle(middleAngle), radius));
    return createDimensionGeometry({
        kind: 'arcLength',
        entityType: dimension.type,
        value: sourceRadius * Math.abs(sweep),
        unitKind: 'length',
        points: [sourceFirst, sourceSecond, first, second, text],
        lines: [
            linePrimitive(sourceFirst, first, 'extension'),
            linePrimitive(sourceSecond, second, 'extension'),
        ],
        arcs: [arcPrimitive(center, radius, startAngle, endAngle, sweep > 0, 'dimension')],
        ticks: [
            tickPrimitive(first, startAngle + Math.PI / 2, 'dimension'),
            tickPrimitive(second, endAngle + Math.PI / 2, 'dimension'),
        ],
        label: labelPrimitive(text, normalizeReadableAngle(middleAngle + Math.PI / 2)),
        legacy: {
            center,
            first,
            second,
            sourceFirst,
            sourceSecond,
            text,
            angle: normalizeReadableAngle(middleAngle + Math.PI / 2),
            startAngle,
            endAngle,
            counterClockwise: sweep > 0,
            radius,
        },
    });
}

export function getOrdinateDimensionGeometry(dimension, sources = null) {
    const source = resolvePrimarySource(dimension, sources);
    const origin = finitePointOr(dimension.origin, { x: 0, y: 0 });
    const feature = resolveOrdinateFeaturePoint(dimension, source);
    if (!feature) return null;
    const axis = dimension.axis === 'y' ? 'y' : 'x';
    const defaultLeader = axis === 'x'
        ? { x: feature.x, y: feature.y + DEFAULT_LINEAR_OFFSET }
        : { x: feature.x + DEFAULT_LINEAR_OFFSET, y: feature.y };
    const leader = finitePointOr(dimension.leaderPoint, defaultLeader);
    const elbow = axis === 'x'
        ? { x: leader.x, y: feature.y }
        : { x: feature.x, y: leader.y };
    const value = axis === 'x' ? feature.x - origin.x : feature.y - origin.y;
    const angle = axis === 'x' ? 0 : Math.PI / 2;
    return createDimensionGeometry({
        kind: 'ordinate',
        entityType: dimension.type,
        value,
        unitKind: 'length',
        points: [origin, feature, elbow, leader],
        lines: [linePrimitive(feature, elbow, 'leader'), linePrimitive(elbow, leader, 'leader')],
        ticks: [tickPrimitive(feature, angle + Math.PI / 2, 'origin')],
        label: labelPrimitive(leader, angle),
        legacy: { origin, feature, elbow, text: leader, angle, axis },
    });
}

export function getCenterMarkGeometry(dimension, sources = null) {
    const source = resolvePrimarySource(dimension, sources);
    if (!['circle', 'arc'].includes(source?.type) || !isFiniteBoundedCircle(source)) return null;
    const center = { x: source.cx, y: source.cy };
    const size = Math.max(EPSILON, finiteOr(dimension.size, DEFAULT_CENTER_MARK_SIZE));
    const extension = Math.max(0, finiteOr(dimension.extension, 0));
    const half = size + extension;
    const left = { x: center.x - half, y: center.y };
    const right = { x: center.x + half, y: center.y };
    const top = { x: center.x, y: center.y - half };
    const bottom = { x: center.x, y: center.y + half };
    return createDimensionGeometry({
        kind: 'centerMark',
        entityType: dimension.type,
        value: null,
        unitKind: null,
        points: [left, right, top, bottom, center],
        lines: [linePrimitive(left, right, 'center'), linePrimitive(top, bottom, 'center')],
        legacy: { center, size, extension },
    });
}

export function formatDrawingLength(value, precision = 4, locale = 'en') {
    return `${formatDecimal(value, precision, locale)} m`;
}

export function formatDrawingAngle(value, precision = 2, locale = 'en') {
    const degrees = finiteOr(value, 0) * 180 / Math.PI;
    return `${formatDecimal(degrees, precision, locale)}°`;
}

export function formatDrawingDimensionMeasurement(valueOrGeometry, dimensionOrOptions = {}, locale = 'en') {
    const geometry = valueOrGeometry && typeof valueOrGeometry === 'object'
        ? valueOrGeometry
        : null;
    const value = geometry ? finiteOr(geometry.value, 0) : finiteOr(valueOrGeometry, 0);
    const dimension = dimensionOrOptions && typeof dimensionOrOptions === 'object' ? dimensionOrOptions : {};
    const format = normalizeDrawingDimensionFormat(dimension.dimensionFormat || dimension);
    const unitKind = geometry?.unitKind || dimension.unitKind || 'length';
    const primaryUnit = unitKind === 'angle' ? 'angle' : normalizeUnit(dimension.unit, 'm');
    const primaryValue = unitKind === 'angle' ? value : convertDrawingLength(value, primaryUnit);
    const primaryNumeric = unitKind === 'angle'
        ? formatDecimal(primaryValue * 180 / Math.PI, format.precision, locale)
        : formatDecimal(primaryValue, format.precision, locale);
    const primaryUnitLabel = unitKind === 'angle' ? '°' : UNIT_LABELS[primaryUnit];
    const primary = `${format.prefix}${primaryNumeric} ${primaryUnitLabel}${format.suffix}`
        .replace(` ${primaryUnitLabel}`, primaryUnitLabel === '°' ? primaryUnitLabel : ` ${primaryUnitLabel}`);
    const tolerance = formatTolerance(value, unitKind, primaryUnit, format.tolerance, locale);
    const alternate = format.alternateUnits.enabled && unitKind === 'length'
        ? `[${formatDecimal(
            convertDrawingLength(value, format.alternateUnits.unit),
            format.alternateUnits.precision,
            locale,
        )} ${UNIT_LABELS[format.alternateUnits.unit]}]`
        : '';
    const inspection = format.inspection.enabled ? { ...format.inspection } : null;
    const lines = [primary];
    if (tolerance) lines.push(tolerance);
    if (alternate) lines.push(alternate);
    return {
        primary,
        tolerance,
        alternate,
        inspection,
        lines,
        plainText: lines.join(' '),
    };
}

export function formatDrawingDimensionLabel(geometry, dimension = {}, locale = 'en') {
    if (!geometry || geometry.value === null || geometry.value === undefined) {
        return { lines: [], plainText: '', inspection: null };
    }
    const formatted = formatDrawingDimensionMeasurement(geometry, dimension, locale);
    const lines = [...formatted.lines];
    if (lines.length && geometry.kind === 'radial') {
        lines[0] = `${geometry.mode === 'diameter' ? 'Ø ' : 'R '}${lines[0]}`;
    } else if (lines.length && geometry.kind === 'arcLength') {
        lines[0] = `⌒ ${lines[0]}`;
    }
    if (formatted.inspection?.label) lines.unshift(formatted.inspection.label);
    if (formatted.inspection?.rate) lines.push(formatted.inspection.rate);
    return {
        ...formatted,
        lines,
        plainText: lines.join('\n'),
    };
}

export function convertDrawingLength(value, unit = 'm') {
    return finiteOr(value, 0) * UNIT_FACTORS[normalizeUnit(unit, 'm')];
}

export function buildLinearDimensionSeries(points, {
    mode = 'chain',
    measurementMode = 'aligned',
    dimensionAngle = 0,
    offset = DEFAULT_LINEAR_OFFSET,
    linePoint = null,
    dimensionFormat,
} = {}) {
    const seriesMode = DRAWING_DIMENSION_SERIES_MODES.includes(mode) ? mode : 'chain';
    const normalizedPoints = deduplicateConsecutivePoints(points);
    if (normalizedPoints.length < 2) return [];
    const pairs = seriesMode === 'baseline'
        ? normalizedPoints.slice(1).map(point => [normalizedPoints[0], point])
        : normalizedPoints.slice(1).map((point, index) => [normalizedPoints[index], point]);
    return pairs.map(([p1, p2], index) => {
        const dimension = normalizeDrawingDimension({
            type: 'linearDimension',
            p1,
            p2,
            measurementMode,
            dimensionAngle,
            offset,
            ...(isFinitePoint(linePoint) ? { linePoint } : {}),
            ...(dimensionFormat !== undefined ? { dimensionFormat } : {}),
        });
        return { ...dimension, seriesMode, seriesIndex: index };
    });
}

export function buildBaselineDimensions(points, options = {}) {
    return buildLinearDimensionSeries(points, { ...options, mode: 'baseline' });
}

export function buildContinuedDimensions(points, options = {}) {
    return buildLinearDimensionSeries(points, { ...options, mode: 'continued' });
}

export function buildChainDimensions(points, options = {}) {
    return buildLinearDimensionSeries(points, { ...options, mode: 'chain' });
}

export function buildQuickDimensions(points, options = {}) {
    return buildLinearDimensionSeries(points, { ...options, mode: 'quick' });
}

export function buildQdimDimensions(points, {
    mode = 'continuous',
    baselineEnd = 'first',
    pointReferences = [],
    seriesId = null,
    seriesAxis = null,
    measurementMode = 'aligned',
    dimensionAngle = 0,
    offset = DEFAULT_LINEAR_OFFSET,
    spacing = null,
    linePoint = null,
    dimensionFormat,
} = {}) {
    const qdimMode = normalizeDrawingQdimMode(mode);
    const normalizedBaselineEnd = normalizeDrawingQdimBaselineEnd(baselineEnd);
    const stations = normalizeQdimStations(points, pointReferences);
    if (stations.length < 2) return [];
    const ordered = qdimMode === 'baseline' && normalizedBaselineEnd === 'last'
        ? [...stations].reverse()
        : stations;
    const pairs = qdimMode === 'baseline'
        ? ordered.slice(1).map(station => [ordered[0], station])
        : ordered.slice(1).map((station, index) => [ordered[index], station]);
    const normalizedSeriesId = typeof seriesId === 'string' && seriesId.trim() ? seriesId.trim() : null;
    const normalizedAxis = (isFinitePoint(seriesAxis) ? normalizeVector(seriesAxis) : null) || linearMeasurementAxis(
        DRAWING_LINEAR_DIMENSION_MODES.includes(measurementMode) ? measurementMode : 'aligned',
        dimensionAngle,
        subtract(ordered[ordered.length - 1].point, ordered[0].point),
    );
    const baselineReference = qdimMode === 'baseline' ? ordered[0].reference : null;
    const normalizedSpacing = qdimMode === 'baseline'
        ? Math.max(0, spacing === null || spacing === undefined
            ? DEFAULT_DRAWING_QDIM_BASELINE_SPACING
            : finiteOr(spacing, DEFAULT_DRAWING_QDIM_BASELINE_SPACING))
        : 0;
    const normalizedOffset = finiteOr(offset, DEFAULT_LINEAR_OFFSET);
    const spacingDirection = normalizedOffset < 0 ? -1 : 1;

    return pairs.map(([first, second], index) => normalizeDrawingDimension({
        type: 'linearDimension',
        p1: first.point,
        p2: second.point,
        measurementMode,
        dimensionAngle,
        offset: normalizedOffset + normalizedSpacing * spacingDirection * index,
        ...(isFinitePoint(linePoint) ? { linePoint } : {}),
        ...(dimensionFormat !== undefined ? { dimensionFormat } : {}),
        seriesMode: qdimMode,
        seriesIndex: index,
        ...(normalizedSeriesId ? { seriesId: normalizedSeriesId } : {}),
        seriesAxis: normalizedAxis,
        ...(qdimMode === 'baseline' ? {
            baselineEnd: normalizedBaselineEnd,
            baselineReference,
        } : {}),
        sourcePointReferences: [first.reference, second.reference],
        sourceIds: [...new Set([first.reference?.sourceId, second.reference?.sourceId]
            .filter(id => typeof id === 'string' && id))],
    }));
}

function normalizeDependencies(normalized, source) {
    if (typeof source.sourceId === 'string' && source.sourceId.trim()) normalized.sourceId = source.sourceId.trim();
    else delete normalized.sourceId;
    const referenceSourceIds = Array.isArray(source.sourcePointReferences)
        ? source.sourcePointReferences.map(reference => reference?.sourceId)
        : [];
    const sourceIds = [...(Array.isArray(source.sourceIds) ? source.sourceIds : []), ...referenceSourceIds];
    if (sourceIds.length) {
        normalized.sourceIds = [...new Set(sourceIds
            .filter(id => typeof id === 'string' && id.trim())
            .map(id => id.trim()))];
        if (!normalized.sourceIds.length) delete normalized.sourceIds;
    } else delete normalized.sourceIds;
}

function normalizeLinearSeriesMetadata(normalized, source) {
    const references = Array.isArray(source.sourcePointReferences)
        ? source.sourcePointReferences
            .map(normalizeDrawingDimensionPointReference)
            .filter(Boolean)
            .slice(0, 2)
        : [];
    if (references.length === 2) normalized.sourcePointReferences = references;
    else delete normalized.sourcePointReferences;

    if (DRAWING_DIMENSION_SERIES_MODES.includes(source.seriesMode)) {
        normalized.seriesMode = source.seriesMode;
        normalized.seriesIndex = Math.max(0, Math.trunc(finiteOr(source.seriesIndex, 0)));
    } else {
        delete normalized.seriesMode;
        delete normalized.seriesIndex;
    }
    if (typeof source.seriesId === 'string' && source.seriesId.trim()) normalized.seriesId = source.seriesId.trim();
    else delete normalized.seriesId;
    if (isFinitePoint(source.seriesAxis)) {
        normalized.seriesAxis = normalizeVector(source.seriesAxis) || { x: 1, y: 0 };
    } else delete normalized.seriesAxis;
    if (source.seriesMode === 'baseline') {
        normalized.baselineEnd = normalizeDrawingQdimBaselineEnd(source.baselineEnd);
        const baselineReference = normalizeDrawingDimensionPointReference(source.baselineReference);
        if (baselineReference) normalized.baselineReference = baselineReference;
        else delete normalized.baselineReference;
    } else {
        delete normalized.baselineEnd;
        delete normalized.baselineReference;
    }
}

function normalizeQdimStations(points, pointReferences) {
    const references = Array.isArray(pointReferences) ? pointReferences : [];
    return (Array.isArray(points) ? points : []).flatMap((point, index) => {
        if (!isFinitePoint(point)) return [];
        const normalizedPoint = clonePoint(point);
        const reference = normalizeDrawingDimensionPointReference(references[index]) || {
            endpointIndex: 0,
            point: normalizedPoint,
        };
        if (!reference.point) reference.point = normalizedPoint;
        return [{ point: normalizedPoint, reference }];
    }).filter((station, index, stations) => (
        index === 0 || magnitude(subtract(station.point, stations[index - 1].point)) >= EPSILON
    ));
}

function normalizeOptionalPoint(normalized, source, key) {
    if (isFinitePoint(source[key])) normalized[key] = clonePoint(source[key]);
    else delete normalized[key];
}

function normalizePointArray(value, maximum = Infinity) {
    return Array.isArray(value) ? value.filter(isFinitePoint).slice(0, maximum).map(clonePoint) : [];
}

function getLinearSourceEndpoints(dimension, sources) {
    const hasAssociatedPointReference = Array.isArray(dimension.sourcePointReferences)
        && dimension.sourcePointReferences.some(reference => (
            typeof reference?.sourceId === 'string' && reference.sourceId.trim()
        ));
    if (hasAssociatedPointReference) {
        const referenced = resolveLinearPointReferences(dimension.sourcePointReferences, sources);
        if (referenced) return referenced;
    }
    const source = resolvePrimarySource(dimension, sources);
    if (source?.type === 'line') {
        return [{ x: source.x1, y: source.y1 }, { x: source.x2, y: source.y2 }].every(isFinitePoint)
            ? [{ x: source.x1, y: source.y1 }, { x: source.x2, y: source.y2 }]
            : null;
    }
    if (['rectangle', 'polygon'].includes(source?.type)) {
        const points = source.type === 'rectangle'
            ? getRectangleOutlinePoints(source)
            : getRegularPolygonVertices(source);
        const segments = points.map((point, index) => [point, points[(index + 1) % points.length]]);
        const edgeIndex = Math.max(0, Math.min(segments.length - 1, Math.trunc(finiteOr(dimension.edgeIndex, 0))));
        return segments[edgeIndex] || null;
    }
    return isFinitePoint(dimension.p1) && isFinitePoint(dimension.p2)
        ? [clonePoint(dimension.p1), clonePoint(dimension.p2)]
        : null;
}

function resolveLinearPointReferences(references, sources) {
    if (!Array.isArray(references) || references.length !== 2) return null;
    const resolved = references.map(reference => resolveLinearPointReference(reference, sources));
    return resolved.every(isFinitePoint) ? resolved : null;
}

function resolveLinearPointReference(value, sources) {
    const reference = normalizeDrawingDimensionPointReference(value);
    if (!reference) return null;
    const source = reference.sourceId ? resolveSourceById(reference.sourceId, sources) : null;
    if (source?.type === 'line') {
        const point = reference.endpointIndex === 1
            ? { x: source.x2, y: source.y2 }
            : { x: source.x1, y: source.y1 };
        if (isFinitePoint(point)) return point;
    }
    if (['rectangle', 'polygon'].includes(source?.type)) {
        const points = source.type === 'rectangle'
            ? getRectangleOutlinePoints(source)
            : getRegularPolygonVertices(source);
        const segments = points.map((point, index) => [point, points[(index + 1) % points.length]]);
        const edgeIndex = Math.max(0, Math.min(
            segments.length - 1,
            Math.trunc(finiteOr(reference.edgeIndex, 0)),
        ));
        const point = segments[edgeIndex]?.[reference.endpointIndex === 1 ? 1 : 0];
        if (isFinitePoint(point)) return clonePoint(point);
    }
    return isFinitePoint(reference.point) ? clonePoint(reference.point) : null;
}

function resolveSourceById(sourceId, sources) {
    if (!sourceId || !sources) return null;
    if (sources instanceof Map) return sources.get(sourceId) || null;
    if (Array.isArray(sources)) return sources.find(source => source?.id === sourceId) || null;
    if (Array.isArray(sources.entities)) return resolveSourceById(sourceId, sources.entities);
    if (sources.id === sourceId) return sources;
    return sources[sourceId]?.id === sourceId ? sources[sourceId] : null;
}

function getAngularRays(dimension, sources) {
    const resolved = resolveDimensionSources(dimension, sources);
    const arc = resolved.find(source => source?.type === 'arc');
    if (arc && isFiniteBoundedCircle(arc)) {
        const vertex = { x: arc.cx, y: arc.cy };
        return {
            vertex,
            firstDirection: normalizeVector(subtract(arcStartPoint(arc), vertex)),
            secondDirection: normalizeVector(subtract(arcEndPoint(arc), vertex)),
        };
    }

    const lines = resolved.filter(source => source?.type === 'line').slice(0, 2);
    if (lines.length === 2) {
        const intersection = infiniteLineIntersection(lines[0], lines[1]);
        if (!intersection) return null;
        const pickPoints = Array.isArray(dimension.sourcePickPoints) ? dimension.sourcePickPoints : [];
        const firstDirection = lineRayDirection(lines[0], intersection, pickPoints[0]);
        const secondDirection = lineRayDirection(lines[1], intersection, pickPoints[1]);
        if (!firstDirection || !secondDirection) return null;
        return { vertex: intersection, firstDirection, secondDirection };
    }

    if (!isFinitePoint(dimension.vertex)
        || !isFinitePoint(dimension.ray1Point)
        || !isFinitePoint(dimension.ray2Point)) return null;
    const firstDirection = normalizeVector(subtract(dimension.ray1Point, dimension.vertex));
    const secondDirection = normalizeVector(subtract(dimension.ray2Point, dimension.vertex));
    return firstDirection && secondDirection
        ? { vertex: clonePoint(dimension.vertex), firstDirection, secondDirection }
        : null;
}

function resolveOrdinateFeaturePoint(dimension, source) {
    if (isFinitePoint(dimension.featurePoint)) return clonePoint(dimension.featurePoint);
    if (source?.type === 'line') return { x: source.x1, y: source.y1 };
    if (Number.isFinite(source?.cx) && Number.isFinite(source?.cy)) return { x: source.cx, y: source.cy };
    if (Number.isFinite(source?.x) && Number.isFinite(source?.y)) return { x: source.x, y: source.y };
    return null;
}

function resolvePrimarySource(dimension, sources) {
    const resolved = resolveDimensionSources(dimension, sources);
    return resolved[0] || null;
}

function resolveDimensionSources(dimension, sources) {
    if (!sources) return [];
    if (sources instanceof Map) {
        return getDrawingEntityDependencyIds(dimension).map(id => sources.get(id)).filter(Boolean);
    }
    if (Array.isArray(sources)) {
        const sourceMap = new Map(sources.filter(Boolean).map(source => [source.id, source]));
        const dependencyIds = getDrawingEntityDependencyIds(dimension);
        return dependencyIds.length ? dependencyIds.map(id => sourceMap.get(id)).filter(Boolean) : sources.filter(Boolean);
    }
    if (Array.isArray(sources.entities)) return resolveDimensionSources(dimension, sources.entities);
    return typeof sources === 'object' ? [sources] : [];
}

function createDimensionGeometry({
    kind,
    entityType,
    value,
    unitKind,
    points = [],
    lines = [],
    arcs = [],
    ticks = [],
    jogs = [],
    label = null,
    legacy = {},
}) {
    return {
        kind,
        entityType,
        value,
        unitKind,
        points: points.filter(isFinitePoint),
        lines,
        arcs,
        ticks,
        jogs,
        label,
        ...legacy,
    };
}

function linePrimitive(start, end, role) {
    return { start: clonePoint(start), end: clonePoint(end), role };
}

function arcPrimitive(center, radius, startAngle, endAngle, counterClockwise, role) {
    return { center: clonePoint(center), radius, startAngle, endAngle, counterClockwise, role };
}

function tickPrimitive(point, angle, role) {
    return { point: clonePoint(point), angle, role };
}

function labelPrimitive(point, angle) {
    return { point: clonePoint(point), angle };
}

function linearMeasurementAxis(mode, dimensionAngle, delta) {
    if (mode === 'horizontal') return { x: 1, y: 0 };
    if (mode === 'vertical') return { x: 0, y: 1 };
    if (mode === 'rotated') return vectorFromAngle(finiteOr(dimensionAngle, 0));
    return normalizeVector(delta);
}

function projectOntoDimensionLine(point, axis, normal, lineScalar) {
    return add(scale(axis, dot(point, axis)), scale(normal, lineScalar));
}

function infiniteLineIntersection(first, second) {
    const p = { x: first.x1, y: first.y1 };
    const r = { x: first.x2 - first.x1, y: first.y2 - first.y1 };
    const q = { x: second.x1, y: second.y1 };
    const s = { x: second.x2 - second.x1, y: second.y2 - second.y1 };
    if (![p, q, add(p, r), add(q, s)].every(isFinitePoint)) return null;
    const denominator = cross(r, s);
    if (Math.abs(denominator) < EPSILON) return null;
    return add(p, scale(r, cross(subtract(q, p), s) / denominator));
}

function lineRayDirection(line, vertex, pickPoint) {
    const direction = normalizeVector({ x: line.x2 - line.x1, y: line.y2 - line.y1 });
    if (!direction) return null;
    const target = isFinitePoint(pickPoint) ? pickPoint : { x: line.x2, y: line.y2 };
    return dot(subtract(target, vertex), direction) < 0 ? scale(direction, -1) : direction;
}

function directedSweep(start, end, counterClockwise) {
    let positive = normalizeAngle(end - start);
    if (positive < EPSILON) return 0;
    if (counterClockwise) return positive;
    return positive - TAU;
}

function createJogPolyline(point, angle, size) {
    const direction = vectorFromAngle(angle);
    const normal = { x: -direction.y, y: direction.x };
    const half = size / 2;
    return [
        add(point, scale(direction, -size)),
        add(add(point, scale(direction, -half)), scale(normal, half)),
        add(add(point, scale(direction, half)), scale(normal, -half)),
        add(point, scale(direction, size)),
    ];
}

function adjacentPointPairs(points) {
    return points.slice(0, -1).map((point, index) => [point, points[index + 1]]);
}

function formatTolerance(value, unitKind, unit, tolerance, locale) {
    if (tolerance.mode === 'none') return '';
    const factor = unitKind === 'angle' ? 180 / Math.PI : UNIT_FACTORS[unit];
    const unitLabel = unitKind === 'angle' ? '°' : ` ${UNIT_LABELS[unit]}`;
    const formatValue = amount => `${formatDecimal(amount * factor, tolerance.precision, locale)}${unitLabel}`;
    if (tolerance.mode === 'symmetric') return `±${formatValue(tolerance.upper)}`;
    if (tolerance.mode === 'deviation') {
        return `+${formatValue(tolerance.upper)} / −${formatValue(tolerance.lower)}`;
    }
    return `${formatValue(value + tolerance.upper)} / ${formatValue(value - tolerance.lower)}`;
}

function formatDecimal(value, precision, locale) {
    const fixed = finiteOr(value, 0).toFixed(normalizePrecision(precision, 0));
    const decimal = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
    return String(locale).startsWith('fr') ? decimal.replace('.', ',') : decimal;
}

function normalizePrecision(value, fallback) {
    const precision = Number(value);
    return Number.isFinite(precision)
        ? Math.max(0, Math.min(MAX_FORMAT_PRECISION, Math.trunc(precision)))
        : Math.max(0, Math.min(MAX_FORMAT_PRECISION, Math.trunc(Number(fallback) || 0)));
}

function normalizeUnit(value, fallback) {
    return DRAWING_DIMENSION_UNITS.includes(value) ? value : fallback;
}

function dependencyRemapper(idMap) {
    if (idMap instanceof Map) return id => idMap.get(id) || id;
    if (idMap && typeof idMap === 'object') return id => idMap[id] || id;
    if (typeof idMap === 'function') return id => idMap(id) || id;
    return id => id;
}

function deduplicateConsecutivePoints(points) {
    return normalizePointArray(points).filter((point, index, normalized) => (
        index === 0 || magnitude(subtract(point, normalized[index - 1])) >= EPSILON
    ));
}

function finiteOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function finitePointOr(value, fallback) {
    return isFinitePoint(value) ? clonePoint(value) : clonePoint(fallback);
}

function isFinitePoint(point) {
    return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
}

function clonePoint(point) {
    return { x: Number(point.x), y: Number(point.y) };
}

function add(first, second) {
    return { x: first.x + second.x, y: first.y + second.y };
}

function subtract(first, second) {
    return { x: first.x - second.x, y: first.y - second.y };
}

function scale(vector, factor) {
    return { x: vector.x * factor, y: vector.y * factor };
}

function dot(first, second) {
    return first.x * second.x + first.y * second.y;
}

function cross(first, second) {
    return first.x * second.y - first.y * second.x;
}

function magnitude(vector) {
    return Math.hypot(vector.x, vector.y);
}

function normalizeVector(vector) {
    const length = magnitude(vector);
    return length < EPSILON ? null : scale(vector, 1 / length);
}

function vectorFromAngle(angle) {
    return { x: Math.cos(angle), y: Math.sin(angle) };
}

function midpoint(first, second) {
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function normalizeAngle(angle) {
    const normalized = finiteOr(angle, 0) % TAU;
    return normalized < 0 ? normalized + TAU : normalized;
}

function normalizeReadableAngle(angle) {
    let normalized = normalizeAngle(angle);
    if (normalized > Math.PI / 2 && normalized < Math.PI * 1.5) normalized += Math.PI;
    return normalizeAngle(normalized);
}
