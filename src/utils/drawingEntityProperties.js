// Derived properties shown and edited in the Properties panel: line length
// and angle, block reference rotation and scale, selection breakdown by type.
// Coordinates and angles go through the UCS helpers of drawingCoordinates.js.
import { drawingUcsToWorld, drawingWorldToUcs } from './drawingCoordinates.js';

const EPSILON = 1e-9;

/** Length and angle (degrees in the current UCS, 0..360) of a line segment. */
export function describeDrawingLine(entity, ucs) {
    if (!entity || ![entity.x1, entity.y1, entity.x2, entity.y2].every(Number.isFinite)) return null;
    const start = drawingWorldToUcs({ x: entity.x1, y: entity.y1 }, ucs);
    const end = drawingWorldToUcs({ x: entity.x2, y: entity.y2 }, ucs);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const angle = length > EPSILON ? normalizeDegrees(Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI) : 0;
    return { length, angle };
}

/**
 * Endpoint patch giving the line `length` and/or `angle` (degrees in the UCS)
 * while keeping its first point. Returns null for an unusable value.
 */
export function resizeDrawingLine(entity, { length, angle } = {}, ucs) {
    const current = describeDrawingLine(entity, ucs);
    if (!current) return null;
    const nextLength = length === undefined ? current.length : length;
    const nextAngle = angle === undefined ? current.angle : angle;
    if (!Number.isFinite(nextLength) || nextLength <= EPSILON || nextLength > 1e9 || !Number.isFinite(nextAngle)) return null;
    const start = drawingWorldToUcs({ x: entity.x1, y: entity.y1 }, ucs);
    const radians = nextAngle * Math.PI / 180;
    const end = drawingUcsToWorld({ x: start.x + nextLength * Math.cos(radians), y: start.y + nextLength * Math.sin(radians) }, ucs);
    return { x2: end.x, y2: end.y };
}

/**
 * Rotation (degrees) and uniform scale of a block reference transform. Only
 * rotations combined with a positive uniform scale are `editable`; mirrored or
 * stretched references keep their transform as is.
 */
export function describeDrawingBlockTransform(transform, ucs) {
    const { a = 1, b = 0, c = 0, d = 1 } = transform || {};
    if (![a, b, c, d].every(Number.isFinite)) return null;
    const scale = Math.hypot(a, b);
    const uniform = Math.abs(Math.hypot(c, d) - scale) <= EPSILON * Math.max(1, scale)
        && Math.abs(a * c + b * d) <= EPSILON * Math.max(1, scale * scale)
        && a * d - b * c > 0;
    // The block X axis, read in the UCS.
    const origin = drawingWorldToUcs({ x: 0, y: 0 }, ucs);
    const axis = drawingWorldToUcs({ x: a, y: b }, ucs);
    return { rotation: normalizeDegrees(Math.atan2(axis.y - origin.y, axis.x - origin.x) * 180 / Math.PI), scale, editable: uniform && scale > EPSILON };
}

/**
 * Transform with a new rotation and/or uniform scale about the insertion
 * point (e, f). Returns null when the reference is not editable or the value
 * is out of range.
 */
export function updateDrawingBlockTransform(transform, { rotation, scale } = {}, ucs) {
    const current = describeDrawingBlockTransform(transform, ucs);
    if (!current?.editable) return null;
    const nextRotation = rotation === undefined ? current.rotation : rotation;
    const nextScale = scale === undefined ? current.scale : scale;
    if (!Number.isFinite(nextRotation) || !Number.isFinite(nextScale) || nextScale <= EPSILON || nextScale > 1e6) return null;
    const radians = nextRotation * Math.PI / 180;
    // Back from the UCS to a world direction of the block X axis.
    const origin = drawingUcsToWorld({ x: 0, y: 0 }, ucs);
    const axis = drawingUcsToWorld({ x: Math.cos(radians), y: Math.sin(radians) }, ucs);
    const worldAngle = Math.atan2(axis.y - origin.y, axis.x - origin.x);
    const cos = Math.cos(worldAngle) * nextScale;
    const sin = Math.sin(worldAngle) * nextScale;
    return { ...transform, a: cos, b: sin, c: -sin, d: cos, e: transform?.e ?? 0, f: transform?.f ?? 0 };
}

/** Selected object types with their count, most frequent first. */
export function summarizeDrawingSelectionTypes(entities) {
    const counts = new Map();
    for (const entity of entities || []) counts.set(entity.type, (counts.get(entity.type) || 0) + 1);
    return [...counts].map(([type, count]) => ({ type, count }))
        .sort((left, right) => right.count - left.count || String(left.type).localeCompare(String(right.type)));
}

function normalizeDegrees(value) {
    const normalized = ((value % 360) + 360) % 360;
    return Math.abs(normalized - 360) < 1e-9 ? 0 : normalized;
}
