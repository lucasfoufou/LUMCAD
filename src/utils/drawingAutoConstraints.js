import { createDrawingId } from './drawingDocument.js';
import { normalizeCurvePrimitive, extractEntityPaths, curveLength } from './drawingCurveKernel.js';
import { drawingConstraintCoordinates } from './drawingConstraintEntities.js';
import { drawingGeometricConstraintResiduals } from './drawingGeometricConstraints.js';
import { prepareDrawingConstraintEdit } from './drawingConstraintEditing.js';

export const DRAWING_AUTO_CONSTRAINT_TYPES = Object.freeze([
    'coincident', 'horizontal', 'vertical', 'collinear', 'concentric', 'parallel', 'perpendicular', 'tangent', 'smooth', 'equal',
]);

const signature = constraint => JSON.stringify([constraint.type, Boolean(constraint.internal), constraint.refs
    .map(ref => JSON.stringify([ref.entityId, ref.part ?? null, ref.point ?? null])).sort()]);

function wholeTangencyTouches(first, second, tolerance) {
    if (first.type === 'circle' && second.type === 'circle') return Math.hypot(first.cx - second.cx, first.cy - second.cy) > tolerance;
    const line = first.type === 'line' ? first : second.type === 'line' ? second : null;
    const circle = first.type === 'circle' ? first : second.type === 'circle' ? second : null;
    if (!line || !circle) return false;
    const dx = line.x2 - line.x1; const dy = line.y2 - line.y1;
    const parameter = ((circle.cx - line.x1) * dx + (circle.cy - line.y1) * dy) / (dx * dx + dy * dy);
    return parameter >= 0 && parameter <= 1;
}

/** Deterministic bounded proposal list. Detection never mutates or solves the drawing. */
export function detectDrawingAutoConstraints(content, selectedIds, {
    tolerance = 1e-4, angle = 0.1, types = DRAWING_AUTO_CONSTRAINT_TYPES,
} = {}) {
    if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 1
        || !Number.isFinite(angle) || angle <= 0 || angle > 10 || !Array.isArray(types) || !types.length
        || types.some(type => !DRAWING_AUTO_CONSTRAINT_TYPES.includes(type))) return { error: 'invalid' };
    if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length) return { error: 'selection' };
    if (selectedIds.length > 64) return { error: 'limit' };
    const entities = new Map(content.entities.map(entity => [entity.id, entity]));
    const curves = []; const points = [];
    const angularTolerance = Math.sin(angle * Math.PI / 180);
    for (const id of selectedIds) {
        const entity = entities.get(id);
        if (!drawingConstraintCoordinates(entity)) return { error: 'unsupported' };
        const primitive = normalizeCurvePrimitive(entity);
        const paths = primitive ? null : extractEntityPaths(entity);
        const parts = primitive ? [{ ref: { entityId: id }, curve: primitive }]
            : paths?.length === 1 ? paths[0].parts.map((curve, part) => ({ ref: { entityId: id, part }, curve })) : [];
        curves.push(...parts.map(part => ({ ...part, length: curveLength(part.curve) })));
        if (curves.length > 128) return { error: 'limit' };
        if (entity.type === 'point') points.push({ entityId: id, point: 'node' });
        if (['circle', 'arc', 'ellipse'].includes(entity.type)) points.push({ entityId: id, point: 'center' });
        for (const { ref, curve } of parts) if (curve.type !== 'circle' && !(curve.type === 'ellipse' && curve.fullEllipse)) {
            points.push({ ...ref, point: 'start' }, { ...ref, point: 'end' });
        }
    }
    const known = new Set((content.geometricConstraints || []).map(signature));
    const candidates = []; const enabled = new Set(types);
    const add = (type, refs, thresholds, extra = {}) => {
        if (!enabled.has(type)) return;
        const constraint = { type, refs, ...extra };
        const key = signature(constraint);
        if (known.has(key)) return;
        const residuals = drawingGeometricConstraintResiduals(constraint, entities);
        if (!residuals || residuals.some((value, index) => {
            const threshold = Array.isArray(thresholds) ? thresholds[index] : thresholds;
            return !Number.isFinite(value) || !Number.isFinite(threshold) || Math.abs(value) > threshold;
        })) return;
        known.add(key); candidates.push(constraint);
    };
    for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) {
        if (points[i].entityId !== points[j].entityId) add('coincident', [points[i], points[j]], tolerance);
    }
    for (const { ref, curve, length } of curves) if (curve.type === 'line') {
        const threshold = length * angularTolerance;
        add('horizontal', [ref], threshold); add('vertical', [ref], threshold);
    }
    for (let i = 0; i < curves.length; i += 1) for (let j = i + 1; j < curves.length; j += 1) {
        const first = curves[i]; const second = curves[j];
        if (first.ref.entityId === second.ref.entityId) continue;
        const refs = [first.ref, second.ref];
        add('collinear', refs, tolerance); add('concentric', refs, tolerance);
        add('parallel', refs, angularTolerance); add('perpendicular', refs, angularTolerance);
        add('equal', refs, tolerance);
        if (wholeTangencyTouches(first.curve, second.curve, tolerance)) {
            add('tangent', refs, tolerance);
            if (first.curve.type === 'circle' && second.curve.type === 'circle') add('tangent', refs, tolerance, { internal: true });
        }
        if (first.curve.type === 'circle' || second.curve.type === 'circle') continue;
        for (const a of ['start', 'end']) for (const b of ['start', 'end']) {
            const ends = [{ ...first.ref, point: a }, { ...second.ref, point: b }];
            add('tangent', ends, [tolerance, tolerance, angularTolerance, angularTolerance]);
            if (first.curve.type === 'spline' || second.curve.type === 'spline') {
                const length = Math.max(tolerance, Math.min(first.length, second.length));
                const curvatureTolerance = tolerance / (length * length);
                add('smooth', ends, [tolerance, tolerance, angularTolerance, angularTolerance, curvatureTolerance, curvatureTolerance]);
            }
        }
    }
    candidates.sort((a, b) => DRAWING_AUTO_CONSTRAINT_TYPES.indexOf(a.type) - DRAWING_AUTO_CONSTRAINT_TYPES.indexOf(b.type));
    if (candidates.length + (content.geometricConstraints?.length || 0) > 256) return { error: 'limit' };
    return { candidates };
}

export function applyDrawingAutoConstraints(content, selectedIds, options) {
    const detected = detectDrawingAutoConstraints(content, selectedIds, options);
    if (detected.error) return detected;
    if (!detected.candidates.length) return { content, changed: false, count: 0 };
    const additions = detected.candidates.map(constraint => ({ id: createDrawingId('constraint'), ...constraint }));
    const result = prepareDrawingConstraintEdit(content, { ...content, geometricConstraints: [...(content.geometricConstraints || []), ...additions] });
    return result.error ? result : { ...result, changed: true, count: additions.length };
}
