import { DRAWING_LINEAR_DIMENSION_MODES, DRAWING_RADIAL_DIMENSION_MODES, normalizeDrawingDimensionPointReference, normalizeDimensionDetachedSource } from './drawingDimensions.js';

const finite = value => Number.isFinite(value) && Math.abs(value) <= 1e12;
const point = value => value && finite(value.x) && finite(value.y);
const has = (entity, key) => Object.hasOwn(entity, key);

/** Validate supplied raw geometry without applying the display normalizer's defaults. */
export function validRawDimensionGeometry(entity) {
    const points = ['dimensionTextPosition'];
    const numbers = ['dimensionExtensionAngle', 'dimensionTextAngle'];
    const positive = [];
    const nonnegative = [];
    if (entity.type === 'linearDimension') {
        points.push('p1', 'p2', 'linePoint', 'seriesAxis');
        numbers.push('offset', 'dimensionAngle');
        if (has(entity, 'measurementMode') && !DRAWING_LINEAR_DIMENSION_MODES.includes(entity.measurementMode)) return false;
        if (has(entity, 'edgeIndex') && (!Number.isSafeInteger(entity.edgeIndex) || entity.edgeIndex < 0)) return false;
        if (has(entity, 'sourcePointReferences') && (!Array.isArray(entity.sourcePointReferences) || entity.sourcePointReferences.length !== 2
            || !entity.sourcePointReferences.every(normalizeDrawingDimensionPointReference))) return false;
    } else if (entity.type === 'radialDimension') {
        points.push('jogCenter', 'jogPoint'); numbers.push('angle'); nonnegative.push('jogSize');
        if (has(entity, 'leaderScale') && (!finite(entity.leaderScale) || entity.leaderScale < 1.05)) return false;
        if (has(entity, 'mode') && !DRAWING_RADIAL_DIMENSION_MODES.includes(entity.mode)) return false;
    } else if (entity.type === 'angularDimension') {
        points.push('vertex', 'ray1Point', 'ray2Point'); positive.push('radius');
        if (has(entity, 'sourcePickPoints') && (!Array.isArray(entity.sourcePickPoints) || entity.sourcePickPoints.length > 2 || !entity.sourcePickPoints.every(point))) return false;
    } else if (entity.type === 'arcLengthDimension') numbers.push('offset');
    else if (entity.type === 'ordinateDimension') {
        points.push('origin', 'featurePoint', 'leaderPoint');
        if (has(entity, 'axis') && !['x', 'y'].includes(entity.axis)) return false;
    } else if (entity.type === 'centerMark') { positive.push('size'); nonnegative.push('extension'); }
    else if (entity.type === 'centerLine') {
        points.push('p1', 'p2'); nonnegative.push('extension');
        if (has(entity, 'extension') && entity.extension > 1e6) return false;
    }
    if (has(entity, 'detachedSource')) {
        const source = entity.detachedSource;
        if (!normalizeDimensionDetachedSource(source)) return false;
        if (source.type === 'ellipse' ? !(source.rx > 0 && source.ry > 0) : !(source.r > 0)) return false;
    }
    return points.every(key => !has(entity, key) || point(entity[key]))
        && numbers.every(key => !has(entity, key) || finite(entity[key]))
        && positive.every(key => !has(entity, key) || finite(entity[key]) && entity[key] > 0)
        && nonnegative.every(key => !has(entity, key) || finite(entity[key]) && entity[key] >= 0);
}
