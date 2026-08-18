const EPSILON = 1e-9;

export const DEFAULT_POLAR_INCREMENT = 45;
export const MIN_POLAR_INCREMENT = 1;
export const MAX_POLAR_INCREMENT_DIRECTIONS = 180;
export const MAX_POLAR_ANGLES = 32;
export const DEFAULT_TRACKING_RELATIONS = Object.freeze({
    parallel: true,
    perpendicular: true,
    tangent: true,
});

export function normalizeDrawingDraftingSettings(settings = {}) {
    const ortho = Boolean(settings?.ortho);
    return {
        ortho,
        polarTracking: !ortho && Boolean(settings?.polarTracking),
        polarIncrement: normalizePolarIncrement(settings?.polarIncrement),
        polarAngles: normalizePolarAngles(settings?.polarAngles),
        tracking: Boolean(settings?.tracking),
        trackingRelations: normalizeTrackingRelations(settings?.trackingRelations),
    };
}

export function normalizePolarIncrement(value, fallback = DEFAULT_POLAR_INCREMENT) {
    const increment = Number(value);
    if (!Number.isFinite(increment) || increment < MIN_POLAR_INCREMENT || increment > 180) return fallback;
    return increment;
}

export function normalizePolarAngles(values) {
    const source = Array.isArray(values)
        ? values
        : typeof values === 'string'
            ? values.split(/[;,\s]+/)
            : [];
    return source.reduce((angles, value) => {
        if (angles.length >= MAX_POLAR_ANGLES) return angles;
        const numeric = Number(String(value).replace(',', '.'));
        if (!Number.isFinite(numeric)) return angles;
        const normalized = normalizeHalfTurnDegrees(numeric);
        if (!angles.some(angle => angularDistanceDegrees(angle, normalized) <= 1e-7)) angles.push(normalized);
        return angles;
    }, []);
}

export function parsePolarAnglesInput(value, locale = 'en') {
    const source = Array.isArray(value)
        ? value
        : String(value ?? '').split(locale === 'fr' ? /[;\s]+/ : /[;,\s]+/);
    return normalizePolarAngles(source);
}

export function normalizeTrackingRelations(relations) {
    return {
        parallel: relations?.parallel !== false,
        perpendicular: relations?.perpendicular !== false,
        tangent: relations?.tangent !== false,
    };
}

export function getPolarTrackingAngles(settings = {}) {
    const drafting = normalizeDrawingDraftingSettings(settings);
    const count = Math.min(MAX_POLAR_INCREMENT_DIRECTIONS, Math.ceil(180 / drafting.polarIncrement));
    const incremental = Array.from({ length: count }, (_, index) => index * drafting.polarIncrement)
        .filter(angle => angle < 180 - EPSILON);
    return uniqueHalfTurnRadians([...incremental, ...drafting.polarAngles]);
}

export function isOrthoTrackingEnabled(settings = {}, temporaryOverride = false) {
    return Boolean(settings?.ortho) !== Boolean(temporaryOverride);
}

export function relationIsEnabled(settings, relation) {
    if (!Object.hasOwn(DEFAULT_TRACKING_RELATIONS, relation)) return true;
    return normalizeTrackingRelations(settings?.trackingRelations)[relation];
}

function uniqueHalfTurnRadians(anglesInDegrees) {
    return anglesInDegrees.reduce((angles, degrees) => {
        const radians = normalizeHalfTurnDegrees(degrees) * Math.PI / 180;
        if (!angles.some(angle => angularDistanceRadians(angle, radians) <= 1e-9)) angles.push(radians);
        return angles;
    }, []);
}

function normalizeHalfTurnDegrees(value) {
    return ((Number(value) % 180) + 180) % 180;
}

function angularDistanceDegrees(first, second) {
    const delta = Math.abs(first - second) % 180;
    return Math.min(delta, 180 - delta);
}

function angularDistanceRadians(first, second) {
    const delta = Math.abs(first - second) % Math.PI;
    return Math.min(delta, Math.PI - delta);
}
