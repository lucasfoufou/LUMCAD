import { resolveDrawingPointInput } from './drawingPrecisionInput.js';

export const DRAWING_UNITS = Object.freeze({ mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 });
export const DEFAULT_DRAWING_UNITS = Object.freeze({ display: 'm', precision: 3, angle: 'degrees', anglePrecision: 1, clockwise: false, angleBase: 0, alternate: null, insertion: 'm' });

export function normalizeDrawingUnits(value = {}) {
    const precision = (value, fallback) => Number.isInteger(value) && value >= 0 && value <= 8 ? value : fallback;
    return { display: Object.hasOwn(DRAWING_UNITS, value?.display) ? value.display : 'm',
        precision: precision(value?.precision, 3), angle: ['degrees', 'radians', 'gradians'].includes(value?.angle) ? value.angle : 'degrees',
        anglePrecision: precision(value?.anglePrecision, 1), clockwise: value?.clockwise === true,
        angleBase: typeof value?.angleBase === 'number' && Number.isFinite(value.angleBase) ? ((value.angleBase % 360) + 360) % 360 : 0,
        alternate: Object.hasOwn(DRAWING_UNITS, value?.alternate) ? value.alternate : null,
        insertion: Object.hasOwn(DRAWING_UNITS, value?.insertion) ? value.insertion : 'm' };
}

export function normalizeDrawingUcs(value) {
    return { x: coordinate(value?.x), y: coordinate(value?.y), rotation: typeof value?.rotation === 'number' && Number.isFinite(value.rotation) ? ((value.rotation % 360) + 360) % 360 : 0 };
}
function coordinate(value) { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9 ? value : 0; }

export function normalizeDrawingNamedUcs(value) {
    const names = new Set();
    return (Array.isArray(value) ? value : []).slice(0, 128).flatMap(item => {
        const name = typeof item?.name === 'string' ? item.name.trim() : '';
        if (!name || name.length > 128 || names.has(name.toLowerCase())) return [];
        names.add(name.toLowerCase()); return [{ name, ...normalizeDrawingUcs(item) }];
    });
}

export function drawingUcsToWorld(point, ucs) {
    if (!point) return point;
    const frame = normalizeDrawingUcs(ucs); const radians = frame.rotation * Math.PI / 180;
    return { ...point, x: frame.x + point.x * Math.cos(radians) - point.y * Math.sin(radians), y: frame.y + point.x * Math.sin(radians) + point.y * Math.cos(radians) };
}
export function drawingWorldToUcs(point, ucs) {
    if (!point) return point;
    const frame = normalizeDrawingUcs(ucs); const radians = frame.rotation * Math.PI / 180;
    const dx = point.x - frame.x; const dy = point.y - frame.y;
    return { ...point, x: dx * Math.cos(radians) + dy * Math.sin(radians), y: -dx * Math.sin(radians) + dy * Math.cos(radians) };
}

/** A screen-anchored orientation indicator; its position never represents the UCS origin. */
export function drawingUcsIndicatorGeometry(settings, viewBox, worldUnitsPerPixel) {
    if (!viewBox || ![viewBox.x, viewBox.y, viewBox.width, viewBox.height, worldUnitsPerPixel].every(Number.isFinite)
        || viewBox.width <= 0 || viewBox.height <= 0 || worldUnitsPerPixel <= 0) return null;
    const size = worldUnitsPerPixel * 30;
    const origin = { x: viewBox.x + worldUnitsPerPixel * 48, y: viewBox.y + viewBox.height - worldUnitsPerPixel * 48 };
    const rotation = normalizeDrawingUcs(settings?.ucs).rotation * Math.PI / 180;
    return { origin, size,
        xAxis: { x: origin.x + size * Math.cos(rotation), y: origin.y + size * Math.sin(rotation) },
        yAxis: { x: origin.x + size * Math.sin(rotation), y: origin.y - size * Math.cos(rotation) } };
}

/** Typed bare lengths remain metres; explicit unit suffixes retain the established parser contract. */
export function resolveDrawingUcsInput(value, options = {}, settings = {}) {
    const units = normalizeDrawingUnits(settings.units);
    const ucs = normalizeDrawingUcs(settings.ucs);
    const result = resolveDrawingPointInput(value, { ...options,
        angleUnit: settings.units ? units.angle : options.angleUnit,
        referencePoint: drawingWorldToUcs(options.referencePoint, ucs), directionPoint: drawingWorldToUcs(options.directionPoint, ucs) });
    if (!result.valid) return result;
    if (result.kind === 'relativePolar') {
        const base = drawingWorldToUcs(options.referencePoint, ucs);
        const dx = result.point.x - base.x; const dy = result.point.y - base.y;
        const angle = Math.atan2(dy, dx) * (units.clockwise ? -1 : 1) + units.angleBase * Math.PI / 180;
        result.point = { x: base.x + Math.cos(angle) * result.distance, y: base.y + Math.sin(angle) * result.distance };
    }
    return { ...result, point: drawingUcsToWorld(result.point, ucs) };
}

export function normalizeDrawingLimits(value) {
    if (![value?.minX, value?.minY, value?.maxX, value?.maxY].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9)
        || value.maxX <= value.minX || value.maxY <= value.minY) return null;
    return { minX: value.minX, minY: value.minY, maxX: value.maxX, maxY: value.maxY, enabled: value.enabled === true };
}
export function drawingPointWithinLimits(point, settings) {
    const limits = normalizeDrawingLimits(settings?.limits);
    if (!limits?.enabled) return true;
    return point.x >= limits.minX && point.x <= limits.maxX && point.y >= limits.minY && point.y <= limits.maxY;
}

export function formatDrawingDistance(value, settings, locale = 'en', exponent = 1) {
    const units = normalizeDrawingUnits(settings?.units);
    const format = unit => `${new Intl.NumberFormat(locale, { maximumFractionDigits: units.precision }).format(value / DRAWING_UNITS[unit] ** exponent)} ${unit}${exponent === 2 ? '²' : exponent === 4 ? '⁴' : ''}`;
    return `${format(units.display)}${units.alternate ? ` [${format(units.alternate)}]` : ''}`;
}
export function formatDrawingAngle(degrees, settings, locale = 'en') {
    const units = normalizeDrawingUnits(settings?.units);
    const adjusted = degrees;
    const value = units.angle === 'radians' ? adjusted * Math.PI / 180 : units.angle === 'gradians' ? adjusted / 0.9 : adjusted;
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: units.anglePrecision }).format(value)} ${units.angle === 'radians' ? 'rad' : units.angle === 'gradians' ? 'gon' : '°'}`;
}
