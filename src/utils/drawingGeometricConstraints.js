import { canEditEntity } from './drawingDocument.js';
import { curveTangentAt, curveCurvatureVectorAt } from './drawingCurveKernel.js';
import { drawingConstraintCoordinates, rebuildDrawingConstraintEntity, resolveDrawingConstraintReference, drawingConstraintRadiusIndices, drawingConstraintIntrinsicResiduals } from './drawingConstraintEntities.js';
import { solveDrawingConstraintSystem } from './drawingConstraintSolver.js';

export const DRAWING_GEOMETRIC_CONSTRAINT_TYPES = Object.freeze([
    'coincident', 'collinear', 'concentric', 'equal', 'fix', 'horizontal', 'parallel',
    'perpendicular', 'symmetric', 'tangent', 'vertical', 'smooth',
]);

const difference = (first, second) => [first.x - second.x, first.y - second.y];
const direction = curve => curve?.type === 'line' ? { x: curve.x2 - curve.x1, y: curve.y2 - curve.y1 } : null;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const unit = vector => {
    const length = vector && Math.hypot(vector.x, vector.y);
    return length > 1e-9 ? { x: vector.x / length, y: vector.y / length } : null;
};
const circular = curve => ['circle', 'arc'].includes(curve?.type);
const centered = curve => circular(curve) || curve?.type === 'ellipse';

/** Signed residuals for a validated relation. Null means incompatible or missing references. */
export function drawingGeometricConstraintResiduals(constraint, entities) {
    if (!constraint || !DRAWING_GEOMETRIC_CONSTRAINT_TYPES.includes(constraint.type)
        || !Array.isArray(constraint.refs) || constraint.refs.length < 1 || constraint.refs.length > 3) return null;
    const refs = constraint.refs.map(ref => resolveDrawingConstraintReference(entities, ref));
    if (refs.some(ref => !ref)) return null;
    const [a, b, axis] = refs;
    const type = constraint.type;
    if (type === 'fix') {
        if (refs.length !== 1 || !Array.isArray(constraint.values) || !constraint.values.every(Number.isFinite)) return null;
        const values = a.point ? [a.point.x, a.point.y] : drawingConstraintCoordinates(a.entity);
        return values?.length === constraint.values.length ? values.map((value, index) => value - constraint.values[index]) : null;
    }
    if (['horizontal', 'vertical'].includes(type)) {
        const line = refs.length === 1 && direction(a.curve);
        if (line) return [type === 'horizontal' ? line.y : line.x];
        return refs.length === 2 && a.point && b.point ? [type === 'horizontal' ? b.point.y - a.point.y : b.point.x - a.point.x] : null;
    }
    if (type === 'symmetric') {
        const vector = refs.length === 3 && unit(direction(axis.curve));
        if (!a.point || !b?.point || !vector) return null;
        const middle = { x: (a.point.x + b.point.x) / 2 - axis.curve.x1, y: (a.point.y + b.point.y) / 2 - axis.curve.y1 };
        return [cross(vector, middle), dot(vector, { x: a.point.x - b.point.x, y: a.point.y - b.point.y })];
    }
    if (refs.length !== 2) return null;
    if (type === 'coincident') return a.point && b.point ? difference(a.point, b.point) : null;
    if (type === 'concentric') return centered(a.curve) && centered(b.curve) ? [a.curve.cx - b.curve.cx, a.curve.cy - b.curve.cy] : null;
    if (type === 'equal') {
        const first = direction(a.curve); const second = direction(b.curve);
        if (first && second) return [Math.hypot(first.x, first.y) - Math.hypot(second.x, second.y)];
        return circular(a.curve) && circular(b.curve) ? [a.curve.r - b.curve.r] : null;
    }
    if (['parallel', 'perpendicular', 'collinear'].includes(type)) {
        const first = unit(direction(a.curve)); const second = unit(direction(b.curve));
        if (!first || !second) return null;
        if (type === 'collinear') return [
            cross(first, { x: b.curve.x1 - a.curve.x1, y: b.curve.y1 - a.curve.y1 }),
            cross(first, { x: b.curve.x2 - a.curve.x1, y: b.curve.y2 - a.curve.y1 }),
        ];
        return [type === 'parallel' ? cross(first, second) : dot(first, second)];
    }
    if (type === 'tangent' && !a.point && !b.point) {
        if (circular(a.curve) && circular(b.curve)) return [Math.hypot(a.curve.cx - b.curve.cx, a.curve.cy - b.curve.cy)
            - (constraint.internal ? Math.abs(a.curve.r - b.curve.r) : a.curve.r + b.curve.r)];
        const line = direction(a.curve) ? a.curve : direction(b.curve) ? b.curve : null;
        const circle = circular(a.curve) ? a.curve : circular(b.curve) ? b.curve : null;
        const vector = line && unit(direction(line));
        return vector && circle ? [Math.abs(cross(vector, { x: circle.cx - line.x1, y: circle.cy - line.y1 })) - circle.r] : null;
    }
    if (['tangent', 'smooth'].includes(type)) {
        if (!a.point || !b.point || constraint.refs.some(ref => !['start', 'end'].includes(ref.point))) return null;
        const parameters = constraint.refs.map(ref => ref.point === 'start' ? 0 : 1);
        const first = curveTangentAt(a.curve, parameters[0]); const second = curveTangentAt(b.curve, parameters[1]);
        if (!first || !second) return null;
        const sign = parameters[0] === parameters[1] ? 1 : -1;
        const errors = [...difference(a.point, b.point), first.x + sign * second.x, first.y + sign * second.y];
        if (type === 'smooth') {
            const firstCurvature = curveCurvatureVectorAt(a.curve, parameters[0]); const secondCurvature = curveCurvatureVectorAt(b.curve, parameters[1]);
            if (!firstCurvature || !secondCurvature) return null;
            errors.push(...difference(firstCurvature, secondCurvature));
        }
        return errors;
    }
    return null;
}

/** Independent components solve separately; a failed component discards the entire edit. */
export function solveDrawingGeometricConstraints(content, constraints, options = {}) {
    if (!Array.isArray(constraints) || constraints.length > 256) return { error: 'invalid' };
    const parents = new Map();
    const root = id => {
        if (!parents.has(id)) parents.set(id, id);
        let result = id;
        while (parents.get(result) !== result) result = parents.get(result);
        return result;
    };
    const ids = new Set();
    for (const constraint of constraints) {
        if (typeof constraint?.id !== 'string' || !constraint.id || ids.has(constraint.id)
            || !Array.isArray(constraint.refs) || !constraint.refs.length || constraint.refs.length > 3
            || constraint.refs.some(ref => typeof ref?.entityId !== 'string')) return { error: 'definition' };
        ids.add(constraint.id);
        const first = root(constraint.refs[0].entityId);
        constraint.refs.forEach(ref => parents.set(root(ref.entityId), first));
    }
    const groups = new Map();
    for (const constraint of constraints) {
        const id = root(constraint.refs[0].entityId);
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(constraint);
    }
    let next = content; let residual = 0;
    for (const component of groups.values()) {
        const result = solveComponent(next, component, options);
        if (result.error) return { ...result, constraintIds: component.map(constraint => constraint.id) };
        next = result.content; residual = Math.max(residual, result.residual || 0);
    }
    return { content: next, changed: next !== content, residual };
}

/** Solve native objects atomically. Unreferenced objects and all metadata retain identity. */
function solveComponent(content, constraints, { fixedIds = [], fixedCoordinates = new Map(), intrinsicEntities = new Map(),
    residuals = drawingGeometricConstraintResiduals, ...options } = {}) {
    if (!Array.isArray(constraints) || constraints.length > 256 || !Array.isArray(fixedIds)) return { error: 'invalid' };
    if (!(fixedCoordinates instanceof Map) || !(intrinsicEntities instanceof Map)) return { error: 'invalid' };
    if (!constraints.length) return { content, changed: false };
    const entities = new Map(content.entities.map(entity => [entity.id, entity]));
    const constraintIds = new Set();
    const targetIds = new Set();
    for (const constraint of constraints) {
        if (typeof constraint?.id !== 'string' || !constraint.id || constraintIds.has(constraint.id)
            || !residuals(constraint, entities)) return { error: 'definition', constraintId: constraint?.id };
        constraintIds.add(constraint.id);
        constraint.refs.forEach(ref => targetIds.add(ref.entityId));
    }
    const initial = []; const fixed = []; const records = [];
    const pinned = new Set(fixedIds);
    for (const id of targetIds) {
        const entity = entities.get(id); const values = drawingConstraintCoordinates(entity);
        if (!values) return { error: 'unsupported', entityId: id };
        const radii = drawingConstraintRadiusIndices(entity);
        if (radii.some(index => values[index] <= 1e-9)) return { error: 'invalid', entityId: id };
        // Logarithmic radii keep every numerical step inside the valid domain.
        // Fixed snapshots and all returned entities still use physical metres.
        const encoded = values.map((value, index) => radii.includes(index) ? Math.log(value - 1e-9) : value);
        const start = initial.length;
        const locked = pinned.has(id) || !canEditEntity(content, entity);
        const driven = fixedCoordinates.get(id) || [];
        if (!Array.isArray(driven) || driven.some(index => !Number.isInteger(index) || index < 0 || index >= values.length)) return { error: 'invalid' };
        initial.push(...encoded); records.push({ entity, start, count: values.length, radii, locked, driven, original: values });
        if (locked) values.forEach((_, index) => fixed.push(start + index));
        else driven.forEach(index => fixed.push(start + index));
    }
    const build = values => {
        const result = new Map(entities);
        for (const record of records) {
            if (record.locked) continue;
            const decoded = values.slice(record.start, record.start + record.count)
                .map((value, index) => record.radii.includes(index) ? 1e-9 + Math.exp(value) : value);
            record.driven.forEach(index => { decoded[index] = record.original[index]; });
            const entity = rebuildDrawingConstraintEntity(record.entity, decoded);
            if (!entity) return null;
            result.set(entity.id, entity);
        }
        return result;
    };
    const result = solveDrawingConstraintSystem(initial, values => {
        const current = build(values);
        if (!current) return null;
        const errors = constraints.map(constraint => residuals(constraint, current));
        return errors.some(error => !error) ? null : [...errors.flat(),
            ...records.flatMap(record => drawingConstraintIntrinsicResiduals(intrinsicEntities.get(record.entity.id) || record.entity, current.get(record.entity.id)))];
    }, { ...options, fixed, valid: values => Boolean(build(values)) });
    if (result.error) return result;
    if (result.values.every((value, index) => value === initial[index])) return { content, changed: false };
    const solved = build(result.values);
    return { content: { ...content, entities: content.entities.map(entity => targetIds.has(entity.id) ? solved.get(entity.id) : entity) }, changed: true, residual: result.residual };
}
