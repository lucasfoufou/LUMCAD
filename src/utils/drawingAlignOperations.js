import { transformSelectedEntities } from './drawingDocument.js';
import { rotateEntity, scaleEntity, translateEntity } from './drawingPrimitives.js';
import { remapDrawingEntityDependencies } from './drawingDimensions.js';

export const DEFAULT_ALIGN_TOLERANCE = 1e-9;

/**
 * Resolves the orientation-preserving least-squares transform for two or
 * three source/destination point pairs. With scaling disabled the result is
 * a rigid transform; with scaling enabled it is a uniform similarity.
 */
export function resolveAlignTransform(pairs, {
    scale = false,
    tolerance = DEFAULT_ALIGN_TOLERANCE,
} = {}) {
    if (!Array.isArray(pairs) || ![2, 3].includes(pairs.length)) {
        return invalidAlignTransform('pair-count', Array.isArray(pairs) ? pairs.length : 0);
    }
    const normalizedPairs = pairs.map(normalizeAlignPair);
    if (normalizedPairs.some(pair => !pair)) return invalidAlignTransform('non-finite', pairs.length);

    const sourcePoints = normalizedPairs.map(pair => pair.source);
    const destinationPoints = normalizedPairs.map(pair => pair.destination);
    const sourceCenter = pointCentroid(sourcePoints);
    const destinationCenter = pointCentroid(destinationPoints);
    if (!isFinitePoint(sourceCenter) || !isFinitePoint(destinationCenter)) {
        return invalidAlignTransform('overflow', pairs.length);
    }

    const sourceOffsets = sourcePoints.map(point => subtractPoints(point, sourceCenter));
    const destinationOffsets = destinationPoints.map(point => subtractPoints(point, destinationCenter));
    const sourceSpread = squaredSpread(sourceOffsets);
    const destinationSpread = squaredSpread(destinationOffsets);
    const resolvedTolerance = normalizeTolerance(tolerance);
    const spreadThreshold = resolvedTolerance ** 2;
    if (!Number.isFinite(sourceSpread) || !Number.isFinite(destinationSpread)) {
        return invalidAlignTransform('overflow', pairs.length);
    }
    if (sourceSpread <= spreadThreshold) return invalidAlignTransform('source-degenerate', pairs.length);
    if (destinationSpread <= spreadThreshold) return invalidAlignTransform('destination-degenerate', pairs.length);

    const covariance = sourceOffsets.reduce((result, source, index) => {
        const destination = destinationOffsets[index];
        return {
            dot: result.dot + source.x * destination.x + source.y * destination.y,
            cross: result.cross + source.x * destination.y - source.y * destination.x,
        };
    }, { dot: 0, cross: 0 });
    const covarianceMagnitude = Math.hypot(covariance.dot, covariance.cross);
    const covarianceScale = Math.sqrt(sourceSpread) * Math.sqrt(destinationSpread);
    if (![covariance.dot, covariance.cross, covarianceMagnitude, covarianceScale].every(Number.isFinite)) {
        return invalidAlignTransform('overflow', pairs.length);
    }
    if (covarianceMagnitude <= resolvedTolerance * covarianceScale) {
        return invalidAlignTransform('ambiguous-rotation', pairs.length);
    }

    const cosine = covariance.dot / covarianceMagnitude;
    const sine = covariance.cross / covarianceMagnitude;
    const scaleFactor = scale ? covarianceMagnitude / sourceSpread : 1;
    if (![cosine, sine, scaleFactor].every(Number.isFinite) || scaleFactor <= 0) {
        return invalidAlignTransform('invalid-scale', pairs.length);
    }

    const angleRadians = Math.atan2(sine, cosine);
    const angleDegrees = angleRadians * 180 / Math.PI;
    const translation = {
        x: destinationCenter.x - scaleFactor * (cosine * sourceCenter.x - sine * sourceCenter.y),
        y: destinationCenter.y - scaleFactor * (sine * sourceCenter.x + cosine * sourceCenter.y),
    };
    if (![angleRadians, angleDegrees, translation.x, translation.y].every(Number.isFinite)) {
        return invalidAlignTransform('overflow', pairs.length);
    }

    const transform = {
        valid: true,
        pairCount: pairs.length,
        scaling: Boolean(scale),
        scaleFactor,
        angleRadians,
        angleDegrees,
        cosine,
        sine,
        sourceCenter,
        destinationCenter,
        translation,
    };
    const errors = normalizedPairs.map(pair => pointDistance(
        transformAlignPoint(pair.source, transform),
        pair.destination,
    ));
    if (errors.some(error => !Number.isFinite(error))) return invalidAlignTransform('overflow', pairs.length);
    const rmsError = Math.hypot(...errors) / Math.sqrt(errors.length);
    if (!Number.isFinite(rmsError)) return invalidAlignTransform('overflow', pairs.length);
    return {
        ...transform,
        rmsError,
        maxError: Math.max(...errors),
    };
}

export function transformAlignPoint(point, transform) {
    if (!isFinitePoint(point) || !isValidAlignTransform(transform)) return null;
    const offset = subtractPoints(point, transform.sourceCenter);
    const rotated = {
        x: transform.cosine * offset.x - transform.sine * offset.y,
        y: transform.sine * offset.x + transform.cosine * offset.y,
    };
    const result = {
        x: transform.destinationCenter.x + rotated.x * transform.scaleFactor,
        y: transform.destinationCenter.y + rotated.y * transform.scaleFactor,
    };
    return isFinitePoint(result) ? result : null;
}

export function transformAlignEntity(entity, transform) {
    if (!entity || !isValidAlignTransform(transform)) return entity;
    let transformed = entity;
    if (transform.scaleFactor !== 1) {
        transformed = scaleEntity(transformed, transform.scaleFactor, transform.sourceCenter);
    }
    if (transform.angleDegrees !== 0) {
        transformed = rotateEntity(transformed, transform.angleDegrees, transform.sourceCenter);
    }
    const dx = transform.destinationCenter.x - transform.sourceCenter.x;
    const dy = transform.destinationCenter.y - transform.sourceCenter.y;
    if (dx !== 0 || dy !== 0) transformed = translateEntity(transformed, dx, dy);
    return transformed;
}

export function alignDrawingEntities(content, entityIds, pairs, options = {}) {
    const transform = resolveAlignTransform(pairs, options);
    if (!transform.valid) {
        return {
            changed: false,
            content,
            selectedIds: entityIds || [],
            entities: [],
            reason: transform.reason,
            transform,
        };
    }
    const result = transformSelectedEntities(
        content,
        entityIds || [],
        entity => transformAlignEntity(entity, transform),
    );
    return {
        ...result,
        ...(result.changed ? {} : { reason: 'empty-selection' }),
        transform,
    };
}

export function previewAlignDrawingContent(content, entityIds, pairs, options = {}) {
    const result = alignDrawingEntities(content, entityIds, pairs, options);
    return result.changed ? result.content : content;
}

export function createAlignPreviewEntities(content, entityIds, pairs, options = {}) {
    const result = alignDrawingEntities(content, entityIds, pairs, options);
    if (!result.changed) return [];
    const idMap = new Map(result.entities.map(entity => [entity.id, `align-preview-${entity.id}`]));
    return result.entities.map(entity => ({
        ...remapDrawingEntityDependencies(entity, idMap, { preserveAppearance: true }),
        id: idMap.get(entity.id),
        previewMode: 'align',
    }));
}

function normalizeAlignPair(pair) {
    if (!isFinitePoint(pair?.source) || !isFinitePoint(pair?.destination)) return null;
    return {
        source: { x: pair.source.x, y: pair.source.y },
        destination: { x: pair.destination.x, y: pair.destination.y },
    };
}

function pointCentroid(points) {
    return points.reduce((center, point, index) => ({
        x: center.x + (point.x - center.x) / (index + 1),
        y: center.y + (point.y - center.y) / (index + 1),
    }), { x: 0, y: 0 });
}

function squaredSpread(offsets) {
    return offsets.reduce((sum, offset) => sum + offset.x ** 2 + offset.y ** 2, 0);
}

function normalizeTolerance(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_ALIGN_TOLERANCE;
}

function subtractPoints(first, second) {
    return { x: first.x - second.x, y: first.y - second.y };
}

function pointDistance(first, second) {
    if (!first || !second) return Infinity;
    return Math.hypot(first.x - second.x, first.y - second.y);
}

function isFinitePoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function isValidAlignTransform(transform) {
    return transform?.valid === true
        && isFinitePoint(transform.sourceCenter)
        && isFinitePoint(transform.destinationCenter)
        && [transform.scaleFactor, transform.angleDegrees, transform.cosine, transform.sine].every(Number.isFinite)
        && transform.scaleFactor > 0;
}

function invalidAlignTransform(reason, pairCount) {
    return { valid: false, reason, pairCount };
}
