import { resolveDrawingPointInput } from './drawingPrecisionInput.js';

export const DRAWING_UNITS = Object.freeze({ mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 });
// Source units accepted by file imports: display units plus the US survey foot.
export const DRAWING_IMPORT_UNITS = Object.freeze({ ...DRAWING_UNITS, 'us-ft': 1200 / 3937 });
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

/*
 * Two frames meet here. Stored (world) coordinates keep Y pointing down the
 * screen: entity geometry, .lcad files, rendering and MCP. The user frame is
 * what people read and type: the UCS, plus, when the application preference
 * "Y axis up" is on, a Y flip so Y points up and positive angles turn
 * counter-clockwise on screen, as in AutoCAD. A frame carrying `yUp: true`
 * (see drawingUserFrame) applies the flip; a plain UCS keeps the stored sense.
 */
export function drawingUcsToWorld(point, ucs) {
    if (!point) return point;
    const frame = normalizeDrawingUcs(ucs); const radians = frame.rotation * Math.PI / 180;
    const y = ucs?.yUp === true && point.y !== 0 ? -point.y : point.y;
    return { ...point, x: frame.x + point.x * Math.cos(radians) - y * Math.sin(radians), y: frame.y + point.x * Math.sin(radians) + y * Math.cos(radians) };
}
export function drawingWorldToUcs(point, ucs) {
    if (!point) return point;
    const frame = normalizeDrawingUcs(ucs); const radians = frame.rotation * Math.PI / 180;
    const dx = point.x - frame.x; const dy = point.y - frame.y;
    const y = -dx * Math.sin(radians) + dy * Math.cos(radians);
    return { ...point, x: dx * Math.cos(radians) + dy * Math.sin(radians), y: ucs?.yUp === true && y !== 0 ? -y : y };
}

/**
 * Drawing settings seen through the application preference: the returned copy
 * carries `yAxisUp`, read by the user-frame helpers below. It is a view for
 * conversion only and must never be committed to the document.
 */
export function drawingUserSettings(settings, yAxisUp) {
    return { ...(settings || {}), yAxisUp: yAxisUp === true };
}
/** The frame typed and displayed coordinates use: the UCS, flipped when Y is up. */
export function drawingUserFrame(settings) {
    return { ...normalizeDrawingUcs(settings?.ucs), yUp: settings?.yAxisUp === true };
}
export function drawingWorldToUser(point, settings) { return drawingWorldToUcs(point, drawingUserFrame(settings)); }
export function drawingUserToWorld(point, settings) { return drawingUcsToWorld(point, drawingUserFrame(settings)); }
/** A displacement (no origin) read in the user frame. */
export function drawingWorldVectorToUser(vector, settings) {
    if (!vector) return vector;
    const frame = { ...drawingUserFrame(settings), x: 0, y: 0 };
    return drawingWorldToUcs({ x: vector.x, y: vector.y }, frame);
}
export function drawingUserVectorToWorld(vector, settings) {
    if (!vector) return vector;
    const frame = { ...drawingUserFrame(settings), x: 0, y: 0 };
    return drawingUcsToWorld({ x: vector.x, y: vector.y }, frame);
}
/**
 * A relative rotation (degrees). Stored rotations turn from +X towards the
 * stored +Y, i.e. clockwise on screen; with Y up a positive user rotation
 * turns counter-clockwise, so the sign flips. The UCS rotation never matters.
 */
export function drawingUserRotationToWorld(degrees, settings) {
    return settings?.yAxisUp === true && Number.isFinite(degrees) ? (degrees === 0 ? 0 : -degrees) : degrees;
}
export const drawingWorldRotationToUser = drawingUserRotationToWorld;
/** An absolute direction (degrees, measured in the frame) between the stored and user frames. */
export function drawingUserDirectionToWorld(degrees, settings) {
    if (!Number.isFinite(degrees)) return degrees;
    const radians = degrees * Math.PI / 180;
    const vector = drawingUserVectorToWorld({ x: Math.cos(radians), y: Math.sin(radians) }, settings);
    return normalizeAngle(Math.atan2(vector.y, vector.x) * 180 / Math.PI);
}
export function drawingWorldDirectionToUser(degrees, settings) {
    if (!Number.isFinite(degrees)) return degrees;
    const radians = degrees * Math.PI / 180;
    const vector = drawingWorldVectorToUser({ x: Math.cos(radians), y: Math.sin(radians) }, settings);
    return normalizeAngle(Math.atan2(vector.y, vector.x) * 180 / Math.PI);
}
/*
 * Entry points that historically read stored values directly (typed MOVE
 * offsets, typed command coordinates, entity fields, messages) use these:
 * they apply the user frame only when Y is up and are the identity otherwise,
 * so turning the preference off restores the former behaviour exactly.
 */
export function drawingEntryPointToWorld(point, settings) { return settings?.yAxisUp === true ? drawingUserToWorld(point, settings) : point; }
export function drawingWorldPointForDisplay(point, settings) { return settings?.yAxisUp === true ? drawingWorldToUser(point, settings) : point; }
export function drawingEntryVectorToWorld(vector, settings) { return settings?.yAxisUp === true ? drawingUserVectorToWorld(vector, settings) : vector; }
export function drawingWorldVectorForDisplay(vector, settings) { return settings?.yAxisUp === true ? drawingWorldVectorToUser(vector, settings) : vector; }
export function drawingEntryDirectionToWorld(degrees, settings) { return settings?.yAxisUp === true ? drawingUserDirectionToWorld(degrees, settings) : degrees; }
export function drawingWorldDirectionForDisplay(degrees, settings) { return settings?.yAxisUp === true ? drawingWorldDirectionToUser(degrees, settings) : degrees; }
/*
 * Sheet annotations that print a coordinate (Y ordinate dimensions) are drawn
 * by pure render code without editor state: the application sets the
 * preference here once (AppSettingsProvider). Stored geometry never changes.
 */
let displayYAxisUp = false;
export function setDrawingDisplayYAxisUp(value) { displayYAxisUp = value === true; }
export function drawingDisplayYAxisUp() { return displayYAxisUp; }

/** The UCS as the user types and reads it: origin in user world coordinates, user rotation. */
export function drawingUcsToUser(ucs, yAxisUp) {
    const frame = normalizeDrawingUcs(ucs);
    return yAxisUp === true ? { ...frame, y: frame.y === 0 ? 0 : -frame.y, rotation: normalizeAngle(-frame.rotation) } : frame;
}
export function drawingUcsFromUser(ucs, yAxisUp) {
    return normalizeDrawingUcs(drawingUcsToUser(ucs, yAxisUp));
}
/** Drawing limits typed or read by the user (min/max swap on Y when it is flipped). */
export function drawingLimitsFromUser(limits, yAxisUp) {
    if (yAxisUp !== true || !limits) return limits;
    return { ...limits, minY: -limits.maxY || 0, maxY: -limits.minY || 0 };
}
export const drawingLimitsToUser = drawingLimitsFromUser;
function normalizeAngle(value) {
    const normalized = ((value % 360) + 360) % 360;
    return Math.abs(normalized - 360) < 1e-9 || Math.abs(normalized) < 1e-9 ? 0 : normalized;
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
    const ucs = drawingUserFrame(settings);
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

/**
 * Distance and polar angle from one world point to another, expressed in the
 * current UCS with the same angle convention as typed @distance<angle input,
 * so the value shown while drawing is the value the user would type.
 */
export function drawingPolarMeasure(from, to, settings) {
    if (![from?.x, from?.y, to?.x, to?.y].every(Number.isFinite)) return null;
    const units = normalizeDrawingUnits(settings?.units);
    const ucs = drawingUserFrame(settings);
    const start = drawingWorldToUcs(from, ucs);
    const end = drawingWorldToUcs(to, ucs);
    const dx = end.x - start.x; const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    const raw = (Math.atan2(dy, dx) * 180 / Math.PI - units.angleBase) * (units.clockwise ? -1 : 1);
    const angle = Math.abs(((raw % 360) + 360) % 360 - 360) < 1e-9 ? 0 : ((raw % 360) + 360) % 360;
    return { distance, angle };
}

export function formatDrawingPolarMeasure(from, to, settings, locale = 'en') {
    const measure = drawingPolarMeasure(from, to, settings);
    if (!measure) return '';
    return `${formatDrawingDistance(measure.distance, settings, locale)} < ${formatDrawingAngle(measure.angle, settings, locale)}`;
}
