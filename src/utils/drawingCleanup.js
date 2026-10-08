import { normalizeCurvePrimitive, normalizeCurvePath, reverseCurve, reversePath, curvePointAt } from './drawingCurveKernel.js';
import { canEditEntity } from './drawingDocument.js';

const DEFAULT_COMPARISON_LIMIT = 250000;
const generated = entity => ['array', 'linework', 'revisionSymbol', 'table', 'tolerance', 'leader', 'wipeout', 'splineDefinition', 'externalReference'].some(key => entity[key]);
const near = (a, b, tolerance) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
const endpoints = line => [{ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }];

/** Preserve every referenced identity, including constraints, groups, fields and annotations. */
export function drawingCleanupProtectedIds(content) {
    const ids = new Set(content.entities.map(entity => entity.id));
    const protectedIds = new Set();
    const visit = value => {
        if (typeof value === 'string') { if (ids.has(value)) protectedIds.add(value); }
        else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    for (const [key, value] of Object.entries(content)) if (key !== 'entities') visit(value);
    for (const entity of content.entities) for (const [key, value] of Object.entries(entity)) if (key !== 'id') visit(value);
    return protectedIds;
}

function equalValues(a, b, tolerance) {
    if (typeof a === 'number' && typeof b === 'number') return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a).sort(); const other = Object.keys(b).sort();
    return keys.length === other.length && keys.every((key, index) => key === other[index] && equalValues(a[key], b[key], tolerance));
}

function withoutKeys(entity, keys) {
    return Object.fromEntries(Object.entries(entity).filter(([key]) => !keys.includes(key)));
}

const CURVE_GEOMETRY_KEYS = {
    line: ['x1', 'y1', 'x2', 'y2'], circle: ['cx', 'cy', 'r', 'counterClockwise'],
    arc: ['cx', 'cy', 'r', 'startAngle', 'endAngle', 'counterClockwise', 'fullCircle'],
    ellipse: ['cx', 'cy', 'rx', 'ry', 'rotation', 'startAngle', 'endAngle', 'counterClockwise', 'fullEllipse'],
    spline: ['controlPoints', 'degree'],
};
const spendComparison = budget => --budget.remaining >= 0;
const samePointMetadata = (a, b, tolerance) => near(a, b, tolerance)
    && equalValues(withoutKeys(a, ['x', 'y']), withoutKeys(b, ['x', 'y']), 0);

function sequenceMatches(first, second, closed, matches, budget) {
    if (first.length !== second.length) return false;
    for (let offset = 0; offset < (closed ? first.length : 1); offset += 1) {
        let equal = true;
        for (let index = 0; index < first.length; index += 1) {
            if (!spendComparison(budget)) return false;
            if (!matches(first[index], second[(index + offset) % second.length])) { equal = false; break; }
        }
        if (equal) return true;
    }
    return false;
}

function equivalentCurve(a, b, tolerance) {
    if (a.type !== b.type || !CURVE_GEOMETRY_KEYS[a.type]) return false;
    const first = normalizeCurvePrimitive(a); const second = normalizeCurvePrimitive(b);
    if (!first || !second) return false;
    if (a.type === 'spline' && [a, b].some(curve => curve.controlPoints?.some(point => Object.keys(point).some(key => !['x', 'y'].includes(key))))) return false;
    const ignored = ['id', ...CURVE_GEOMETRY_KEYS[a.type]];
    if (!equalValues(withoutKeys(first, ignored), withoutKeys(second, ignored), 0)) return false;
    const directed = candidate => {
        if (first.type === 'line') return near(endpoints(first)[0], endpoints(candidate)[0], tolerance) && near(endpoints(first)[1], endpoints(candidate)[1], tolerance);
        if (first.type === 'spline') return first.controlPoints.every((point, index) => near(point, candidate.controlPoints[index], tolerance));
        if (!near({ x: first.cx, y: first.cy }, { x: candidate.cx, y: candidate.cy }, tolerance)) return false;
        const radii = first.type === 'ellipse' ? ['rx', 'ry'] : ['r'];
        if (!radii.every(key => Math.abs(first[key] - candidate[key]) <= tolerance)) return false;
        const radius = Math.max(...radii.map(key => Math.max(first[key], candidate[key])));
        const angleNear = (left, right, period) => Math.min(Math.abs(left - right) % period, period - Math.abs(left - right) % period) <= tolerance / radius;
        if (first.type === 'ellipse' && !angleNear(first.rotation * Math.PI / 180, candidate.rotation * Math.PI / 180, Math.PI * 2)) return false;
        if (first.type === 'circle') return true;
        const fullKey = first.type === 'ellipse' ? 'fullEllipse' : 'fullCircle';
        if (first[fullKey] !== candidate[fullKey]) return false;
        if (first[fullKey]) return true;
        return near(curvePointAt(first, 0.5), curvePointAt(candidate, 0.5), tolerance)
            && first.counterClockwise === candidate.counterClockwise
            && angleNear(first.startAngle, candidate.startAngle, Math.PI * 2) && angleNear(first.endAngle, candidate.endAngle, Math.PI * 2);
    };
    return directed(second) || directed(reverseCurve(second));
}

export function duplicateGeometry(a, b, tolerance, budget) {
    const left = withoutKeys(a, ['id']); const right = withoutKeys(b, ['id']);
    if (equalValues(left, right, 0)) return true;
    if (CURVE_GEOMETRY_KEYS[a.type]) return equivalentCurve(a, b, tolerance);
    if (a.type !== 'polyline' || b.type !== 'polyline') return false;
    if (a.points && b.points && equalValues(withoutKeys(a, ['id', 'points']), withoutKeys(b, ['id', 'points']), 0)) {
        const matches = (first, second) => samePointMetadata(first, second, tolerance);
        return sequenceMatches(a.points, b.points, a.closed, matches, budget)
            || sequenceMatches(a.points, [...b.points].reverse(), a.closed, matches, budget);
    }
    if (a.parts && b.parts && equalValues(withoutKeys(a, ['id', 'parts']), withoutKeys(b, ['id', 'parts']), 0)) {
        const first = normalizeCurvePath(a); const second = normalizeCurvePath(b);
        if (!first || !second) return false;
        const matches = (leftPart, rightPart) => equivalentCurve(leftPart, rightPart, tolerance);
        return sequenceMatches(first.parts, second.parts, first.closed, matches, budget)
            || sequenceMatches(first.parts, reversePath(second).parts, first.closed, matches, budget);
    }
    return false;
}

/** Finite collinear union; keeps the first line's direction and never bridges a real gap. */
export function mergeDrawingCleanupLines(first, second, tolerance) {
    if (first.type !== 'line' || second.type !== 'line'
        || !equalValues(withoutKeys(first, ['id', 'x1', 'y1', 'x2', 'y2']), withoutKeys(second, ['id', 'x1', 'y1', 'x2', 'y2']), 0)) return null;
    const [a, b] = endpoints(first); const [c, d] = endpoints(second);
    if (![a, b, c, d].every(point => [point.x, point.y].every(Number.isFinite))) return null;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length <= tolerance) return null;
    const x = (b.x - a.x) / length; const y = (b.y - a.y) / length;
    const distance = point => Math.abs((point.x - a.x) * y - (point.y - a.y) * x);
    if (distance(c) > tolerance || distance(d) > tolerance) return null;
    const project = point => (point.x - a.x) * x + (point.y - a.y) * y;
    const lower = Math.min(project(c), project(d)); const upper = Math.max(project(c), project(d));
    if (lower > length + tolerance || upper < -tolerance) return null;
    const start = Math.min(0, lower); const end = Math.max(length, upper);
    return { ...first, x1: a.x + start * x, y1: a.y + start * y, x2: a.x + end * x, y2: a.y + end * y };
}

/** Build an atomic cleanup proposal. Callers commit once or display its report as a preview. */
export function cleanupDrawingEntities(content, selectedIds, { tolerance = 1e-9, mergeLines = true, maxComparisons = DEFAULT_COMPARISON_LIMIT } = {}) {
    if (!Array.isArray(content?.entities) || !Array.isArray(selectedIds) || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1
        || !Number.isInteger(maxComparisons) || maxComparisons < 1) return { error: 'invalid' };
    const selected = new Set(selectedIds);
    const protectedIds = drawingCleanupProtectedIds(content);
    const removed = new Set(); const replacements = new Map();
    const report = { examined: 0, protected: 0, duplicates: 0, zeroLength: 0, merged: 0, removedIds: [] };
    const candidates = content.entities.filter(entity => {
        if (!selected.has(entity.id)) return false;
        report.examined += 1;
        if (!canEditEntity(content, entity) || protectedIds.has(entity.id) || generated(entity)) { report.protected += 1; return false; }
        return true;
    });
    for (const entity of candidates) {
        const zero = entity.type === 'line' ? near(...endpoints(entity), tolerance)
            : entity.type === 'polyline' && !entity.parts?.length && entity.points?.length > 1 && entity.points.every(point => near(point, entity.points[0], tolerance));
        if (zero) { removed.add(entity.id); report.zeroLength += 1; }
    }
    const budget = { remaining: maxComparisons };
    for (let i = 0; i < candidates.length; i += 1) {
        const source = candidates[i];
        if (removed.has(source.id)) continue;
        let first = replacements.get(source.id) || source;
        // Restart after a union: a previously separate segment may now touch the extended line.
        for (let j = i + 1; j < candidates.length; j += 1) {
            const second = candidates[j];
            if (removed.has(second.id)) continue;
            if (!spendComparison(budget)) return { error: 'limit' };
            const duplicate = duplicateGeometry(first, second, tolerance, budget);
            if (budget.remaining < 0) return { error: 'limit' };
            if (duplicate) { removed.add(second.id); report.duplicates += 1; continue; }
            const layer = content.layers?.find(item => item.id === first.layerId);
            const continuous = (first.lineType || layer?.lineType || 'continuous') === 'continuous';
            const merged = mergeLines && continuous && mergeDrawingCleanupLines(first, second, tolerance);
            if (merged) {
                first = merged; replacements.set(first.id, first); removed.add(second.id); report.merged += 1; j = i;
            }
        }
    }
    report.removedIds = [...removed];
    const changed = removed.size > 0;
    return { content: changed ? { ...content, entities: content.entities.filter(entity => !removed.has(entity.id)).map(entity => replacements.get(entity.id) || entity) } : content,
        report, changed, selectedIds: selectedIds.filter(id => !removed.has(id)) };
}

export function parseDrawingCleanupInput(input = '') {
    const tokens = String(input).trim().split(/\s+/).filter(Boolean);
    const options = { preview: false, all: false, tolerance: 1e-9, mergeLines: true };
    const used = new Set();
    while (tokens.length) {
        const key = tokens.shift().toUpperCase();
        if (used.has(key)) return null;
        used.add(key);
        if (key === 'PREVIEW') options.preview = true;
        else if (key === 'ALL') options.all = true;
        else if (key === 'TOLERANCE') {
            const value = tokens.shift();
            if (!value || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1) return null;
            options.tolerance = Number(value);
        } else if (key === 'MERGE') {
            const value = tokens.shift()?.toUpperCase();
            if (!['ON', 'OFF'].includes(value)) return null;
            options.mergeLines = value === 'ON';
        } else return null;
    }
    return options;
}
