import {
    getOffsetThroughParameters,
    offsetEntity,
    offsetEntityTowardPoint,
    rotateEntity,
    scaleEntity,
    translateEntity,
} from './drawingGeometry.js';
import { getTransformSelectionEntities, transformSelectedEntities } from './drawingDocument.js';

export const ANGLE_UNITS = Object.freeze(['degrees', 'radians', 'gradians']);
export const ANGLE_DIRECTIONS = Object.freeze(['counterClockwise', 'clockwise']);
export const ROTATE_REFERENCE_MODES = Object.freeze({
    vertexAngles: 'vertexAngles',
    sourceTarget: 'sourceTarget',
});

export function operationDelta(basePoint, currentPoint) {
    if (!basePoint || !currentPoint) return { x: 0, y: 0 };
    return { x: currentPoint.x - basePoint.x, y: currentPoint.y - basePoint.y };
}

export function normalizeAngleUnit(unit = 'degrees') {
    const value = String(unit || '').trim().toLowerCase();
    if (['rad', 'radian', 'radians'].includes(value)) return 'radians';
    if (['grad', 'gradian', 'gradians', 'gon', 'gons'].includes(value)) return 'gradians';
    return 'degrees';
}

export function normalizeAngleDirection(direction = 'counterClockwise') {
    const value = String(direction || '').trim().toLowerCase().replace(/[-_\s]/g, '');
    return ['cw', 'clockwise', 'horaire', 'sensdesaiguilles'].includes(value) ? 'clockwise' : 'counterClockwise';
}

export function angleToRadians(value, unit = 'degrees') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const normalized = normalizeAngleUnit(unit);
    if (normalized === 'radians') return numeric;
    if (normalized === 'gradians') return numeric * Math.PI / 200;
    return numeric * Math.PI / 180;
}

export function radiansToAngle(radians, unit = 'degrees') {
    const numeric = Number(radians);
    if (!Number.isFinite(numeric)) return null;
    const normalized = normalizeAngleUnit(unit);
    if (normalized === 'radians') return numeric;
    if (normalized === 'gradians') return numeric * 200 / Math.PI;
    return numeric * 180 / Math.PI;
}

export function convertAngle(value, fromUnit = 'degrees', toUnit = 'degrees') {
    const radians = angleToRadians(value, fromUnit);
    return radians === null ? null : radiansToAngle(radians, toUnit);
}

export function createAngleConfig(value = 0, { unit = 'degrees', direction = 'counterClockwise' } = {}) {
    const normalizedUnit = normalizeAngleUnit(unit);
    const normalizedDirection = normalizeAngleDirection(direction);
    const numeric = Number(value);
    const radians = angleToRadians(numeric, normalizedUnit);
    if (radians === null) return null;
    const directedRadians = normalizedDirection === 'clockwise' ? -radians : radians;
    return {
        value: numeric,
        unit: normalizedUnit,
        direction: normalizedDirection,
        radians: directedRadians,
    };
}

export function resolveAngleConfig(configOrValue, defaults = {}) {
    if (configOrValue && typeof configOrValue === 'object') {
        return createAngleConfig(
            configOrValue.value ?? configOrValue.angle ?? configOrValue.degrees,
            {
                unit: configOrValue.unit ?? defaults.unit ?? 'degrees',
                direction: configOrValue.direction ?? defaults.direction ?? 'counterClockwise',
            },
        );
    }
    return createAngleConfig(configOrValue, defaults);
}

export function directedAngleBetween(first, second, { unit = 'degrees', direction = 'counterClockwise' } = {}) {
    if (!first || !second) return 0;
    const radians = Math.atan2(second.y - first.y, second.x - first.x);
    const directed = normalizeAngleDirection(direction) === 'clockwise' ? -radians : radians;
    return radiansToAngle(directed, unit);
}

export function operationAngle(basePoint, currentPoint, options = {}) {
    if (!basePoint || !currentPoint) return 0;
    return directedAngleBetween(basePoint, currentPoint, options);
}

export function operationScaleFactor(basePoint, currentPoint) {
    if (!basePoint || !currentPoint) return 1;
    return Math.hypot(currentPoint.x - basePoint.x, currentPoint.y - basePoint.y);
}

export function normalizeCopyMode(value, fallback = 'replace') {
    if (typeof value === 'boolean') return value ? 'copy' : 'replace';
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['copy', 'copier', 'keep', 'preserve', 'yes', 'oui', 'y', 'o'].includes(normalized)) return 'copy';
    if (['replace', 'remplacer', 'no', 'non', 'n'].includes(normalized)) return 'replace';
    return fallback === 'copy' ? 'copy' : 'replace';
}

export function getOperationCopyMode(operation, fallback = operation?.type === 'mirror' ? 'copy' : 'replace') {
    return normalizeCopyMode(operation?.copyMode, fallback);
}

export function setOperationCopyMode(operation, value, fallback = 'replace') {
    if (!operation) return operation;
    return { ...operation, copyMode: normalizeCopyMode(value, fallback) };
}

export function operationUsesCopy(operation, fallback = 'replace') {
    return getOperationCopyMode(operation, fallback) === 'copy';
}

export function operationScaleFactors(basePoint, currentPoint, { scaleX = null, scaleY = null } = {}) {
    const delta = operationDelta(basePoint, currentPoint);
    const x = Number.isFinite(Number(scaleX)) ? Number(scaleX) : Math.abs(delta.x);
    const y = Number.isFinite(Number(scaleY)) ? Number(scaleY) : Math.abs(delta.y);
    return { scaleX: x || 1, scaleY: y || 1 };
}

export function beginReferenceTransform(operation, options = {}) {
    if (!['scale', 'rotate'].includes(operation?.type)) return operation;
    const referenceMode = operation.type === 'rotate'
        ? normalizeRotateReferenceMode(options.referenceMode ?? operation.referenceMode)
        : null;
    const angleUnit = normalizeAngleUnit(options.angleUnit ?? operation.angleUnit ?? options.unit ?? operation.unit);
    const angleDirection = normalizeAngleDirection(options.angleDirection ?? operation.angleDirection ?? options.direction ?? operation.direction);
    return {
        ...operation,
        stage: 'reference',
        referencePoints: [],
        copyMode: normalizeCopyMode(options.copyMode ?? operation.copyMode, operation.type === 'mirror' ? 'copy' : 'replace'),
        ...(operation.type === 'rotate' ? {
            referenceMode,
            angleUnit,
            angleDirection,
        } : {}),
    };
}

export function advanceReferenceTransform(operation, point) {
    if (operation?.stage !== 'reference' || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    const normalizedPoint = { x: Number(point.x), y: Number(point.y) };
    const referenceMode = operation.type === 'rotate' ? normalizeRotateReferenceMode(operation.referenceMode) : null;
    if (operation.type === 'rotate' && referenceMode === ROTATE_REFERENCE_MODES.sourceTarget
        && !operation.basePoint && !(operation.referencePoints || []).length) {
        return {
            complete: false,
            operation: { ...operation, basePoint: normalizedPoint, referencePoints: [] },
            basePoint: normalizedPoint,
        };
    }
    const required = referencePointCount(operation.type, referenceMode, operation);
    if (!required) return null;
    const referencePoints = [...(operation.referencePoints || []), normalizedPoint].slice(0, required);
    const nextOperation = { ...operation, referencePoints };
    if (referencePoints.length < required) return { complete: false, operation: nextOperation };
    return {
        complete: true,
        operation: nextOperation,
        ...resolveReferenceTransform(operation.type, referencePoints, nextOperation),
    };
}

export function previewReferenceTransform(operation, currentPoint) {
    if (operation?.stage !== 'reference') return null;
    const referenceMode = operation.type === 'rotate' ? normalizeRotateReferenceMode(operation.referenceMode) : null;
    const required = referencePointCount(operation.type, referenceMode, operation);
    const points = operation.referencePoints || [];
    if (!required || points.length !== required - 1 || !Number.isFinite(currentPoint?.x) || !Number.isFinite(currentPoint?.y)) return null;
    return resolveReferenceTransform(operation.type, [...points, currentPoint], operation);
}

export function referencePointCount(type, referenceMode = null, operation = null) {
    if (type === 'scale') return 4;
    if (type !== 'rotate') return 0;
    if (normalizeRotateReferenceMode(referenceMode ?? operation?.referenceMode) === ROTATE_REFERENCE_MODES.sourceTarget) {
        return operation?.basePoint ? 4 : 5;
    }
    return 6;
}

export function referenceOrthogonalOrigin(operation) {
    if (operation?.stage !== 'reference') return null;
    const points = operation.referencePoints || [];
    if (operation.type === 'rotate' && normalizeRotateReferenceMode(operation.referenceMode) === ROTATE_REFERENCE_MODES.sourceTarget) {
        return operation.basePoint || (points.length ? points[points.length - 1] : null);
    }
    const index = points.length;
    if (operation.type === 'scale' && [1, 3].includes(index)) return points[index - 1];
    if (operation.type === 'rotate' && [1, 2, 4, 5].includes(index)) return points[index - 1];
    return null;
}

export function directionalDelta(basePoint, currentPoint, distance) {
    const value = Number(distance);
    if (!basePoint || !Number.isFinite(value)) return null;
    const raw = operationDelta(basePoint, currentPoint || { x: basePoint.x + 1, y: basePoint.y });
    const length = Math.hypot(raw.x, raw.y) || 1;
    return { x: raw.x / length * value, y: raw.y / length * value };
}

export function previewTransformContent(content, operation, currentPoint) {
    if (!operation?.entityIds?.length || !currentPoint) return content;
    const reference = previewReferenceTransform(operation, currentPoint);
    if (operation.stage === 'reference' && !reference) return content;
    const basePoint = reference?.basePoint || operation.basePoint;
    if (!basePoint) return content;
    let updater = entity => entity;
    if (operation.type === 'move') {
        const delta = operationDelta(basePoint, currentPoint);
        updater = entity => translateEntity(entity, delta.x, delta.y);
    } else if (operation.type === 'rotate') {
        const angle = reference?.valid ? reference.value : operationAngle(basePoint, currentPoint);
        if (reference && !reference.valid) return content;
        updater = entity => rotateEntity(entity, angle, basePoint);
    } else if (operation.type === 'scale') {
        const factor = reference?.valid ? reference.value : operationScaleFactor(basePoint, currentPoint);
        if (reference && !reference.valid) return content;
        const scaleX = Number.isFinite(Number(operation.scaleX)) ? Number(operation.scaleX) : factor;
        const scaleY = Number.isFinite(Number(operation.scaleY)) ? Number(operation.scaleY) : factor;
        updater = entity => scaleEntity(entity, { scaleX, scaleY, origin: basePoint });
    }
    return transformSelectedEntities(content, operation.entityIds, updater).content;
}

export function resolveReferenceTransform(type, points, operation = {}) {
    if (type === 'scale') {
        const sourceLength = distance(points[0], points[1]);
        const targetLength = distance(points[2], points[3]);
        if (sourceLength <= 1e-9) return { valid: false, reason: 'source' };
        if (targetLength <= 1e-9) return { valid: false, reason: 'target' };
        return {
            valid: true,
            value: targetLength / sourceLength,
            basePoint: operation.basePoint || points[0],
        };
    }
    if (type === 'rotate') {
        const referenceMode = normalizeRotateReferenceMode(operation.referenceMode);
        if (referenceMode === ROTATE_REFERENCE_MODES.sourceTarget) {
            if (!operation.basePoint || points.length < 4) return { valid: false, reason: 'source' };
            const sourceLength = distance(points[0], points[1]);
            const targetLength = distance(points[2], points[3]);
            if (sourceLength <= 1e-9) return { valid: false, reason: 'source' };
            if (targetLength <= 1e-9) return { valid: false, reason: 'target' };
            return createRotateReferenceResult(
                directedAngleBetween(points[0], points[1], { direction: 'counterClockwise', unit: 'radians' }),
                directedAngleBetween(points[2], points[3], { direction: 'counterClockwise', unit: 'radians' }),
                operation,
            );
        }
        if ([distance(points[0], points[1]), distance(points[1], points[2])].some(length => length <= 1e-9)) {
            return { valid: false, reason: 'source' };
        }
        if ([distance(points[3], points[4]), distance(points[4], points[5])].some(length => length <= 1e-9)) {
            return { valid: false, reason: 'target' };
        }
        const sourceAngle = vertexAngle(points[0], points[1], points[2]);
        const targetAngle = vertexAngle(points[3], points[4], points[5]);
        return createRotateReferenceResult(
            sourceAngle * Math.PI / 180,
            targetAngle * Math.PI / 180,
            { ...operation, basePoint: points[1] },
        );
    }
    return { valid: false, reason: 'unsupported' };
}

export function resolveRotateReferenceAngle(sourceAngle, targetAngle, {
    unit = 'degrees',
    direction = 'counterClockwise',
} = {}) {
    const source = angleToRadians(sourceAngle, unit);
    const target = angleToRadians(targetAngle, unit);
    if (source === null || target === null) return null;
    const directedDelta = normalizeAngleDirection(direction) === 'clockwise' ? source - target : target - source;
    const radians = normalizeRadiansSigned(directedDelta);
    return {
        value: radiansToAngle(radians, unit),
        unit: normalizeAngleUnit(unit),
        direction: normalizeAngleDirection(direction),
        radians,
        degrees: radiansToAngle(radians, 'degrees'),
    };
}

function createRotateReferenceResult(sourceRadians, targetRadians, operation) {
    const angleDirection = normalizeAngleDirection(operation.angleDirection ?? operation.direction);
    const radians = normalizeRadiansSigned(targetRadians - sourceRadians);
    const displayRadians = angleDirection === 'clockwise' ? -radians : radians;
    return {
        valid: true,
        value: radiansToAngle(radians, 'degrees'),
        angle: {
            value: radiansToAngle(displayRadians, operation.angleUnit || 'degrees'),
            unit: normalizeAngleUnit(operation.angleUnit),
            direction: angleDirection,
            radians,
            displayRadians,
        },
        angleRadians: radians,
        basePoint: operation.basePoint,
    };
}

function vertexAngle(first, vertex, third) {
    const start = Math.atan2(first.y - vertex.y, first.x - vertex.x);
    const end = Math.atan2(third.y - vertex.y, third.x - vertex.x);
    return normalizeDegrees((end - start) * 180 / Math.PI);
}

function normalizeDegrees(value) {
    let normalized = Number(value) % 360;
    if (normalized > 180) normalized -= 360;
    if (normalized <= -180) normalized += 360;
    return normalized;
}

function normalizeRadiansSigned(value) {
    let normalized = Number(value) % (Math.PI * 2);
    if (normalized > Math.PI) normalized -= Math.PI * 2;
    if (normalized <= -Math.PI) normalized += Math.PI * 2;
    return normalized;
}

function normalizeRotateReferenceMode(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[-_\s]/g, '');
    return ['sourcetarget', 'twopoint', 'conventional', 'referenceangle', 'reference'].includes(normalized)
        ? ROTATE_REFERENCE_MODES.sourceTarget
        : ROTATE_REFERENCE_MODES.vertexAngles;
}

function distance(first, second) {
    return Math.hypot(second.x - first.x, second.y - first.y);
}

export function createCopyPreviewEntities(content, entityIds, delta) {
    const selected = new Set(entityIds);
    const originals = content.entities.filter(entity => selected.has(entity.id));
    const idMap = new Map(originals.map(entity => [entity.id, `copy-preview-${entity.id}`]));
    return originals.map(entity => {
        const copy = {
            ...entity,
            id: idMap.get(entity.id),
            previewMode: 'copy',
            sourceId: entity.sourceId && idMap.has(entity.sourceId) ? idMap.get(entity.sourceId) : entity.sourceId,
        };
        return translateEntity(copy, delta.x, delta.y);
    });
}

export function createTransformCopyPreviewEntities(content, operation, currentPoint) {
    if (!operationUsesCopy(operation) || !operation?.entityIds?.length || !currentPoint) return [];
    const sources = getTransformSelectionEntities(content, operation.entityIds);
    const preview = previewTransformContent(content, {
        ...operation,
        entityIds: sources.map(entity => entity.id),
        copyMode: 'replace',
    }, currentPoint);
    const transformedById = new Map(preview.entities.map(entity => [entity.id, entity]));
    const idMap = new Map(sources.map(entity => [entity.id, `transform-preview-${entity.id}`]));
    return sources.map(source => {
        const transformed = transformedById.get(source.id) || source;
        return {
            ...transformed,
            id: idMap.get(source.id),
            previewMode: 'copy',
            ...(transformed.sourceId && idMap.has(transformed.sourceId)
                ? { sourceId: idMap.get(transformed.sourceId) }
                : {}),
        };
    });
}

export function createOffsetPreviewEntities(content, entityIds, distance, sidePoint, { through = false } = {}) {
    const selected = new Set(entityIds || []);
    return content.entities
        .filter(entity => selected.has(entity.id))
        .map((entity, index) => {
            const parameters = through ? getOffsetThroughParameters(entity, sidePoint) : null;
            const preview = through
                ? parameters && offsetEntity(entity, parameters.distance * parameters.side)
                : offsetEntityTowardPoint(entity, distance, sidePoint);
            return preview ? { ...preview, id: `offset-preview-${index}` } : null;
        })
        .filter(Boolean);
}

export function formatOperationNumber(value, locale = 'en') {
    const decimal = Number(value || 0).toFixed(4).replace(/\.?0+$/, '');
    return String(locale).startsWith('fr') ? decimal.replace('.', ',') : decimal;
}

export function formatOperationDelta(delta, locale = 'en') {
    return `ΔX ${formatOperationNumber(delta.x, locale)} m, ΔY ${formatOperationNumber(delta.y, locale)} m`;
}
