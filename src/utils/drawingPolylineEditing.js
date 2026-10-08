import { normalizeCurvePath, reversePath, getCurveStart, getCurveEnd, splitCurve, openClosedPathAt } from './drawingCurveKernel.js';

const MAX_VERTICES = 8192;
const pointValid = point => point && [point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9);
const samePoint = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= 1e-9;

export function parseDrawingPolylineEdit(input) {
    const tokens = String(input || '').trim().split(/\s+/);
    const action = tokens.shift().toUpperCase();
    if (['OPEN', 'CLOSE', 'REVERSE'].includes(action) && !tokens.length) return action === 'REVERSE'
        ? { action: 'reverse' } : { action: 'close', closed: action === 'CLOSE' };
    const values = tokens.map(value => Number(value.replace(',', '.')));
    if (!values.every(Number.isFinite) || !Number.isInteger(values[0]) || values[0] < 1) return null;
    if (action === 'SPLIT' && values.length === 2 && values[1] > 0 && values[1] < 1) return { action: 'split', index: values[0] - 1, parameter: values[1] };
    if (action === 'REMOVE' && values.length === 1) return { action: 'remove', index: values[0] - 1 };
    if (['VERTEX', 'INSERT'].includes(action) && values.length === 3) return {
        action: action.toLowerCase(), index: values[0] - 1, point: { x: values[1], y: values[2] },
    };
    return null;
}

/** Ordinary point paths only; generated geometry keeps its dedicated source editor. */
export function isEditablePointPolyline(entity) {
    return entity?.type === 'polyline' && Array.isArray(entity.points) && !entity.parts?.length
        && !entity.array && !entity.linework && !entity.revisionSymbol && !entity.table && !entity.tolerance
        && !entity.leader && !entity.wipeout && !entity.splineDefinition;
}

/** Shared point-topology edits for command and property-panel entry points. */
export function editDrawingPointPolyline(entity, edit) {
    if (!isEditablePointPolyline(entity) || !edit) return { error: 'selection' };
    const points = entity.points.map(point => ({ ...point }));
    if (points.length < 2 || points.length > MAX_VERTICES || points.some(point => !pointValid(point))) return { error: 'invalid' };
    let closed = Boolean(entity.closed);
    if (edit.action === 'close') {
        if (typeof edit.closed !== 'boolean') return { error: 'invalid' };
        closed = edit.closed;
        if (closed && points.length > 2 && samePoint(points[0], points.at(-1))) points.pop();
    } else if (edit.action === 'reverse') points.reverse();
    else if (['vertex', 'insert', 'remove'].includes(edit.action)) {
        const limit = edit.action === 'insert' ? points.length : points.length - 1;
        if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index > limit) return { error: 'invalid' };
        if (edit.action !== 'remove' && !pointValid(edit.point)) return { error: 'invalid' };
        if (edit.action === 'vertex') points[edit.index] = { ...points[edit.index], x: edit.point.x, y: edit.point.y };
        else if (edit.action === 'insert') points.splice(edit.index, 0, { x: edit.point.x, y: edit.point.y });
        else points.splice(edit.index, 1);
    } else return { error: 'invalid' };
    if (points.length > MAX_VERTICES) return { error: 'limit' };
    if (points.length < (closed ? 3 : 2) || points.some((point, index) => index > 0 && samePoint(point, points[index - 1]))
        || closed && samePoint(points[0], points.at(-1))) return { error: 'invalid' };
    const next = { ...entity, points, closed };
    return { entity: next, changed: JSON.stringify(next) !== JSON.stringify(entity) };
}

/** Native connected paths keep their curve representation throughout topology edits. */
export function isEditableCurvePolyline(entity) {
    return entity?.type === 'polyline' && entity.parts?.length > 0
        && !entity.array && !entity.linework && !entity.revisionSymbol && !entity.table && !entity.tolerance
        && !entity.leader && !entity.wipeout && !entity.splineDefinition
        && Boolean(normalizeCurvePath(entity));
}

export function isEditableDrawingPolyline(entity) {
    return isEditablePointPolyline(entity) || isEditableCurvePolyline(entity);
}

export function editDrawingPolyline(entity, edit) {
    if (isEditablePointPolyline(entity)) return editDrawingPointPolyline(entity, edit);
    if (!isEditableCurvePolyline(entity) || !edit) return { error: 'selection' };
    let path = normalizeCurvePath(entity);
    if (edit.action === 'reverse') path = reversePath(path);
    else if (edit.action === 'split') {
        if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= path.parts.length
            || !Number.isFinite(edit.parameter) || edit.parameter <= 1e-9 || edit.parameter >= 1 - 1e-9) return { error: 'invalid' };
        const pieces = splitCurve(path.parts[edit.index], edit.parameter);
        if (!pieces?.every(Boolean)) return { error: 'invalid' };
        path = { ...path, parts: [...path.parts.slice(0, edit.index), ...pieces, ...path.parts.slice(edit.index + 1)] };
    } else if (edit.action === 'close' && typeof edit.closed === 'boolean') {
        if (edit.closed && !path.closed) {
            const start = getCurveStart(path.parts[0]); const end = getCurveEnd(path.parts.at(-1));
            if (!samePoint(start, end)) path.parts.push({ type: 'line', x1: end.x, y1: end.y, x2: start.x, y2: start.y });
            path.closed = true;
        } else if (!edit.closed && path.closed) path = openClosedPathAt(path, { partIndex: 0, t: 0 });
    } else return { error: 'invalid' };
    path = normalizeCurvePath(path);
    if (!path) return { error: 'invalid' };
    const next = { ...entity, parts: path.parts, closed: path.closed };
    return { entity: next, changed: JSON.stringify(next) !== JSON.stringify(entity) };
}
