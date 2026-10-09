import { transformDrawingArcTextEntity } from './drawingArcText.js';
import { rebuildDrawingToleranceEntity } from './drawingTolerances.js';
import { rebuildDrawingTableEntity } from './drawingTableGeometry.js';
import { rebuildDrawingRevisionSymbol, drawingRevisionGripSource } from './drawingRevisionSymbols.js';
import { drawingLineworkGrips, editDrawingLineworkGrip } from './drawingLinework.js';
import { isValidDrawingPoint } from './drawingPoints.js';
import { drawingClipShapeIntersectsBounds } from './drawingClipPaths.js';
import { drawingBlockClipShape } from './drawingBlockClip.js';
import { drawingLeaderGrips } from './drawingLeaders.js';
import { presentDrawingDimension, drawingDimensionTextPoints } from './drawingDimensionPresentation.js';
import { drawingAffineFrame, unframeDrawingPoint, framedDrawingPoint } from './drawingAffineFrame.js';
import { getClosedBoundarySegments } from './drawingPrimitives.js';
import { getImageClipPoints } from './drawingImageClip.js';
import { createDrawingWipeout, isDrawingWipeout } from './drawingWipeout.js';
import { isConstructionLine, clipConstructionLine, constructionLineGeometry } from './drawingConstructionLines.js';
import {
    arcEndPoint,
    arcMidpoint,
    arcStartPoint,
    createArcFromThreePoints,
    getRegularPolygonVertices,
    isFiniteBoundedCircle,
} from './drawingCurves.js';
import {
    getDimensionGeometry,
    getEntityBounds,
    getEntitySegments,
    getRectEntityCorners,
    pointDistance,
    rotatePoint,
    translateEntity,
} from './drawingGeometry.js';
import {
    getDrawingBlockReferenceBounds,
    getDrawingBlockReferenceInsertionPoint,
    moveDrawingBlockReferenceInsertion,
} from './drawingBlocks.js';
import { getHatchBoundaryEntities } from './drawingAdvancedEntities.js';
import { curvePointAt, normalizeCurvePrimitive } from './drawingCurveKernel.js';
import { editSplineDefinitionPoint, editSplinePathControl, isDuplicateSplineJointGrip } from './drawingSplineEditing.js';
import { DRAWING_QDIM_GRIP_IDS, isDrawingDimensionEntity } from './drawingDimensions.js';

const EPSILON = 1e-9;

/**
 * Describes the editor's directional selection window. Moving left-to-right
 * creates the blue crossing window; moving right-to-left creates the green
 * containment window.
 */
// Dense selections retain outlines and all editing commands; individual grips
// return as soon as the selection is reduced to this many objects.
export const DRAWING_GRIP_OBJECT_LIMIT = 100;

export function createSelectionWindow(first, current) {
    return {
        ...normalizeBounds(first.x, first.y, current.x, current.y),
        mode: current.x >= first.x ? 'crossing' : 'window',
    };
}

/**
 * Tests actual drawing geometry against a selection window. In crossing mode
 * this deliberately avoids relying on bounding boxes for lines and circles.
 */
export function entityMatchesSelectionWindow(entity, selectionWindow, entityMap = new Map()) {
    if (!entity || !selectionWindow) return false;
    const bounds = normalizeBounds(
        selectionWindow.minX,
        selectionWindow.minY,
        selectionWindow.maxX,
        selectionWindow.maxY,
    );
    if (selectionWindow.mode === 'window') return entityIsContainedByBounds(entity, bounds, entityMap);
    return entityCrossesBounds(entity, bounds, entityMap);
}

/**
 * Pointer hit test: the entity passes within `tolerance` of `point`, or the
 * point lies inside an area that is filled on screen (hatches and regions of
 * any pattern, text, images, wipeouts, block reference extents).
 */
export function entityHitsPoint(entity, point, tolerance, entityMap = new Map()) {
    if (!entity || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
    const bounds = normalizeBounds(point.x - tolerance, point.y - tolerance, point.x + tolerance, point.y + tolerance);
    if (entityCrossesBounds(entity, bounds, entityMap)) return true;
    if (!['hatch', 'region'].includes(entity.type)) return false;
    return pointIsInsideHatch(point, hatchBoundarySegments(entity), entity.fillRule);
}

/**
 * Control points exposed by the selection tool. Rectangle grips are based on
 * normalized corners so negatively drawn rectangles behave identically.
 */
export function getEntityGrips(entity, source = null) {
    if (entity?.type === 'point') return isValidDrawingPoint(entity) ? [{ id: 'node', x: entity.x, y: entity.y }] : [];
    if (drawingAffineFrame(entity)) {
        const { affineFrame, ...local } = entity;
        return getEntityGrips(local, source).map(grip => ({ ...grip, ...framedDrawingPoint(entity, grip) }));
    }
    if (entity?.type === 'region') {
        const bounds = getEntityBounds(entity);
        return bounds ? [{ id: 'region-origin', x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }] : [];
    }
    if (!entity) return [];
    if (entity.arcText) {
        const bounds = getEntityBounds(entity);
        return bounds ? [{ id: 'arc-text-origin', x: bounds.minX, y: bounds.minY }] : [];
    }
    if (entity.tolerance) return [{ id: 'tolerance-origin', x: entity.tolerance.transform.e, y: entity.tolerance.transform.f }];
    if (entity.table) return [{ id: 'table-origin', x: entity.table.transform.e, y: entity.table.transform.f }];
    if (entity.revisionSymbol) {
        const definition = entity.revisionSymbol;
        const local = drawingRevisionGripSource(definition);
        const m = definition.transform;
        return getEntityGrips(local).map(grip => ({ ...grip, id: `revision:${grip.id}`, x: m.a * grip.x + m.c * grip.y + m.e, y: m.b * grip.x + m.d * grip.y + m.f }));
    }
    if (entity.linework) return drawingLineworkGrips(entity);
    if (entity.splineDefinition) return entity.splineDefinition.points.map((point, index) => ({ id: `spline-point-${index}`, ...point }));
    if (entity.type === 'polyline' && entity.array) {
        const bounds = getEntityBounds(entity);
        return bounds ? [{ id: 'array-origin', x: bounds.minX, y: bounds.minY }] : [];
    }
    if (entity.type === 'blockReference') {
        if (entity.leader) return drawingLeaderGrips(entity);
        const insertion = getDrawingBlockReferenceInsertionPoint(entity);
        return insertion ? [{ id: 'insertion', ...insertion }] : [];
    }
    if (entity.type === 'line' || isConstructionLine(entity)) {
        return [
            { id: 'start', x: entity.x1, y: entity.y1 },
            { id: 'end', x: entity.x2, y: entity.y2 },
        ];
    }
    if (entity.type === 'spline') {
        const spline = normalizeCurvePrimitive(entity);
        return spline?.type === 'spline'
            ? spline.controlPoints.map((point, index) => ({ id: `control-${index}`, ...point }))
            : [];
    }
    if (entity.type === 'ellipse') {
        const ellipse = normalizeCurvePrimitive(entity);
        if (ellipse?.type !== 'ellipse') return [];
        const grips = [{ id: 'center', x: ellipse.cx, y: ellipse.cy }];
        grips.push({ id: 'radius-x', ...ellipseLocalPoint(ellipse, ellipse.rx, 0) });
        grips.push({ id: 'radius-y', ...ellipseLocalPoint(ellipse, 0, ellipse.ry) });
        if (!ellipse.fullEllipse) {
            grips.push({ id: 'start', ...curvePointAt(ellipse, 0) });
            grips.push({ id: 'end', ...curvePointAt(ellipse, 1) });
        }
        return grips;
    }
    if (['hatch', 'region'].includes(entity.type)) {
        return getHatchBoundaryEntities(entity).flatMap((boundary, boundaryIndex) => (
            getEntityGrips(boundary).map(grip => ({ ...grip, id: `boundary-${boundaryIndex}:${grip.id}` }))
        ));
    }
    if (entity.type === 'polyline') {
        if (Array.isArray(entity.parts)) return entity.parts.flatMap((part, partIndex) => (
            getEntityGrips(part).filter(grip => !isDuplicateSplineJointGrip(entity, partIndex, grip.id))
                .map(grip => ({ ...grip, id: `part-${partIndex}:${grip.id}` }))
        ));
        return (entity.points || []).map((point, index) => ({ id: `vertex-${index}`, ...point }));
    }
    if (entity.type === 'polygon') return [
        { id: 'center', x: entity.cx, y: entity.cy },
        ...getRegularPolygonVertices(entity).map((point, index) => ({ id: `vertex-${index}`, ...point })),
    ];
    if (entity.type === 'arc') return [
        { id: 'start', ...arcStartPoint(entity) },
        { id: 'end', ...arcEndPoint(entity) },
        { id: 'center', x: entity.cx, y: entity.cy },
        { id: 'midpoint', ...arcMidpoint(entity) },
    ];
    if (['rectangle', 'image', 'text'].includes(entity.type)) {
        const ids = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
        return getRectEntityCorners(entity).map((point, index) => ({ id: ids[index], ...point }));
    }
    if (entity.type === 'circle') return isFiniteBoundedCircle(entity) ? [
        { id: 'center', x: entity.cx, y: entity.cy },
        { id: 'radius', x: entity.cx + Math.abs(entity.r), y: entity.cy },
    ] : [];
    if (isDrawingDimensionEntity(entity)) {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return [];
        if (entity.type === 'linearDimension' && entity.seriesId) {
            const seriesIndex = Math.max(0, Math.trunc(Number(entity.seriesIndex) || 0));
            if (seriesIndex === 0 && geometry.label) return [
                { id: DRAWING_QDIM_GRIP_IDS.offset, ...geometry.label.point },
            ];
            if (entity.seriesMode === 'baseline' && seriesIndex === 1 && geometry.label) return [
                { id: DRAWING_QDIM_GRIP_IDS.spacing, ...geometry.label.point },
            ];
            return [];
        }
        if (geometry.kind === 'ordinate') return [
            { id: 'ordinate-origin', ...geometry.origin },
            { id: 'ordinate-feature', ...geometry.feature },
            { id: 'dimension-position', ...geometry.text },
        ];
        if (geometry.kind === 'centerLine') return [{ id: 'center-line-extension', ...geometry.second }];
        if (geometry.kind === 'centerMark') return [
            { id: 'center-mark-size', x: geometry.center.x + geometry.size, y: geometry.center.y },
        ];
        const grips = geometry.label
            ? [{ id: 'dimension-position', ...geometry.label.point }]
            : geometry.text ? [{ id: 'dimension-position', ...geometry.text }] : [];
        if (geometry.kind === 'radial' && geometry.mode === 'joggedRadius') {
            grips.push(
                { id: 'jog-center', ...geometry.jogCenter },
                { id: 'jog-point', ...geometry.jogPoint },
            );
        }
        return grips;
    }
    return [];
}

/**
 * Applies one grip edit. Rectangle corners keep their opposite corner fixed,
 * including when the dragged corner crosses it and produces negative extents.
 */
export function editEntityGrip(entity, gripId, point, source = null) {
    if (entity?.type === 'point') return gripId === 'node' && isValidDrawingPoint(point) ? { ...entity, x: point.x, y: point.y } : entity;
    const frame = drawingAffineFrame(entity);
    if (frame && point) {
        const { affineFrame, ...local } = entity;
        return { ...editEntityGrip(local, gripId, unframeDrawingPoint(point, frame), source), affineFrame };
    }
    if (entity?.arcText) {
        const bounds = getEntityBounds(entity);
        return gripId === 'arc-text-origin' && bounds && point
            ? transformDrawingArcTextEntity(entity, { a: 1, b: 0, c: 0, d: 1, e: point.x - bounds.minX, f: point.y - bounds.minY }) || entity : entity;
    }
    if (entity?.tolerance) {
        if (gripId !== 'tolerance-origin' || !point) return entity;
        return rebuildDrawingToleranceEntity({ ...entity, tolerance: { ...entity.tolerance, transform: { ...entity.tolerance.transform, e: point.x, f: point.y } } }) || entity;
    }
    if (entity?.table) {
        if (gripId !== 'table-origin' || !point) return entity;
        return rebuildDrawingTableEntity({ ...entity, table: { ...entity.table, transform: { ...entity.table.transform, e: point.x, f: point.y } } }) || entity;
    }
    if (entity?.revisionSymbol) {
        if (!gripId.startsWith('revision:') || !point) return entity;
        const definition = entity.revisionSymbol; const m = definition.transform;
        const determinant = m.a * m.d - m.b * m.c;
        const x = point.x - m.e; const y = point.y - m.f;
        const localPoint = { x: (m.d * x - m.c * y) / determinant, y: (m.a * y - m.b * x) / determinant };
        const sourceEntity = drawingRevisionGripSource(definition);
        const changed = editEntityGrip(sourceEntity, gripId.slice(9), localPoint);
        const revisionSymbol = definition.kind === 'cloud' ? { ...definition, source: changed }
            : { ...definition, start: changed.points[0], end: changed.points[1] };
        return rebuildDrawingRevisionSymbol({ ...entity, revisionSymbol }) || entity;
    }
    if (entity?.linework) return editDrawingLineworkGrip(entity, gripId, point);
    if (gripId.startsWith('spline-point-')) return editSplineDefinitionPoint(entity, Number(gripId.slice('spline-point-'.length)), point);
    if (!entity || !point) return entity;
    if (isDrawingWipeout(entity)) {
        if (!gripId.startsWith('vertex-')) return entity;
        const index = Number(gripId.slice(7));
        const candidate = createDrawingWipeout(entity.points.map((current, currentIndex) => currentIndex === index ? point : current), entity.layerId, entity.id, entity.wipeout.frame);
        return candidate ? { ...entity, points: candidate.points } : entity;
    }
    if (entity.type === 'region') {
        const origin = getEntityGrips(entity)[0];
        return gripId === 'region-origin' && origin ? translateEntity(entity, point.x - origin.x, point.y - origin.y) : entity;
    }
    if (entity.type === 'polyline' && entity.array) {
        const origin = getEntityGrips(entity)[0];
        return gripId === 'array-origin' && origin ? translateEntity(entity, point.x - origin.x, point.y - origin.y) : entity;
    }
    if (entity.type === 'blockReference') {
        return gripId === 'insertion' ? moveDrawingBlockReferenceInsertion(entity, point) : entity;
    }
    if (isConstructionLine(entity)) {
        if (gripId === 'start') return translateEntity(entity, point.x - entity.x1, point.y - entity.y1);
        const candidate = { ...entity, x2: point.x, y2: point.y };
        return gripId === 'end' && constructionLineGeometry(candidate) ? candidate : entity;
    }
    if (entity.type === 'line') {
        if (gripId === 'start') return { ...entity, x1: point.x, y1: point.y };
        if (gripId === 'end') return { ...entity, x2: point.x, y2: point.y };
        return entity;
    }
    if (entity.type === 'spline' && gripId.startsWith('control-')) {
        const index = Number.parseInt(gripId.slice('control-'.length), 10);
        const spline = normalizeCurvePrimitive(entity);
        if (spline?.type !== 'spline' || !Number.isInteger(index) || !spline.controlPoints[index]) return entity;
        return {
            ...entity,
            degree: 3,
            controlPoints: spline.controlPoints.map((current, currentIndex) => (
                currentIndex === index ? { x: point.x, y: point.y } : current
            )),
        };
    }
    if (entity.type === 'ellipse') {
        const ellipse = normalizeCurvePrimitive(entity);
        if (ellipse?.type !== 'ellipse') return entity;
        if (gripId === 'center') return { ...entity, cx: point.x, cy: point.y };
        const local = ellipseWorldToLocal(ellipse, point);
        if (gripId === 'radius-x') {
            const rx = Math.hypot(point.x - ellipse.cx, point.y - ellipse.cy);
            return rx > EPSILON ? { ...entity, rx, rotation: Math.atan2(point.y - ellipse.cy, point.x - ellipse.cx) * 180 / Math.PI } : entity;
        }
        if (gripId === 'radius-y' && Math.abs(local.y) > EPSILON) return { ...entity, ry: Math.abs(local.y) };
        if (gripId === 'start' || gripId === 'end') {
            const angle = Math.atan2(local.y / ellipse.ry, local.x / ellipse.rx);
            const candidate = gripId === 'start' ? { ...entity, startAngle: angle } : { ...entity, endAngle: angle };
            return normalizeCurvePrimitive(candidate) ? candidate : entity;
        }
        return entity;
    }
    if (['hatch', 'region'].includes(entity.type) && gripId.startsWith('boundary-')) {
        const match = /^boundary-(\d+):(.+)$/.exec(gripId);
        const boundaryIndex = Number.parseInt(match?.[1], 10);
        const boundaries = getHatchBoundaryEntities(entity);
        if (!match || !Number.isInteger(boundaryIndex) || !boundaries[boundaryIndex]) return entity;
        return {
            ...entity,
            boundaries: boundaries.map((boundary, index) => (
                index === boundaryIndex ? editEntityGrip(boundary, match[2], point) : boundary
            )),
        };
    }
    if (entity.type === 'polyline' && Array.isArray(entity.parts) && gripId.startsWith('part-')) {
        const match = /^part-(\d+):(.+)$/.exec(gripId);
        const partIndex = Number.parseInt(match?.[1], 10);
        if (!match || !Number.isInteger(partIndex) || !entity.parts[partIndex]) return entity;
        const control = /^control-([0-3])$/.exec(match[2]);
        const splineEdit = control ? editSplinePathControl(entity, partIndex, Number(control[1]), point) : null;
        if (splineEdit) return splineEdit;
        return {
            ...entity,
            parts: entity.parts.map((part, index) => index === partIndex ? editEntityGrip(part, match[2], point) : part),
        };
    }
    if (entity.type === 'polyline' && gripId.startsWith('vertex-')) {
        const index = Number.parseInt(gripId.slice('vertex-'.length), 10);
        if (!Number.isInteger(index) || !entity.points?.[index]) return entity;
        return { ...entity, points: entity.points.map((current, currentIndex) => currentIndex === index ? { x: point.x, y: point.y } : current) };
    }
    if (entity.type === 'circle') {
        if (gripId === 'center') {
            const candidate = { ...entity, cx: point.x, cy: point.y };
            return isFiniteBoundedCircle(candidate) ? candidate : entity;
        }
        if (gripId === 'radius') {
            const radius = Math.hypot(point.x - entity.cx, point.y - entity.cy);
            const candidate = { ...entity, r: radius };
            return radius > EPSILON && isFiniteBoundedCircle(candidate) ? candidate : entity;
        }
        return entity;
    }
    if (entity.type === 'polygon') {
        if (gripId === 'center') return { ...entity, cx: point.x, cy: point.y };
        if (!gripId.startsWith('vertex-')) return entity;
        const index = Number.parseInt(gripId.slice('vertex-'.length), 10);
        const sides = Math.max(3, Math.round(Number(entity.sides) || 6));
        const radius = Math.hypot(point.x - entity.cx, point.y - entity.cy);
        if (!Number.isInteger(index) || index < 0 || index >= sides || radius <= EPSILON) return entity;
        const apothem = entity.mode === 'circumscribed' ? radius * Math.cos(Math.PI / sides) : radius;
        return {
            ...entity,
            r: apothem,
            rotation: normalizeDegrees(Math.atan2(point.y - entity.cy, point.x - entity.cx) * 180 / Math.PI + 90 - index * 360 / sides),
        };
    }
    if (entity.type === 'arc') {
        if (gripId === 'center') return { ...entity, cx: point.x, cy: point.y };
        const angle = Math.atan2(point.y - entity.cy, point.x - entity.cx);
        if (gripId === 'start') return { ...entity, startAngle: angle };
        if (gripId === 'end') return { ...entity, endAngle: angle };
        if (gripId === 'midpoint') {
            const geometry = createArcFromThreePoints(arcStartPoint(entity), point, arcEndPoint(entity));
            return geometry ? { ...entity, ...geometry } : entity;
        }
        return entity;
    }
    if (gripId === 'dimension-position' && entity.type === 'linearDimension') {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return entity;
        const normal = { x: -Math.sin(geometry.angle), y: Math.cos(geometry.angle) };
        const offset = (point.x - geometry.sourceFirst.x) * normal.x + (point.y - geometry.sourceFirst.y) * normal.y;
        return geometry.mode === 'aligned' && !entity.linePoint
            ? { ...entity, offset }
            : { ...entity, linePoint: { x: point.x, y: point.y }, offset };
    }
    if (entity.type === 'radialDimension') {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return entity;
        if (gripId === 'jog-center') return { ...entity, jogCenter: { x: point.x, y: point.y } };
        if (gripId === 'jog-point') return { ...entity, jogPoint: { x: point.x, y: point.y } };
        if (gripId !== 'dimension-position') return entity;
        const dx = point.x - geometry.center.x;
        const dy = point.y - geometry.center.y;
        const distance = Math.hypot(dx, dy);
        const radius = pointDistance(geometry.center, geometry.edge);
        if (distance <= EPSILON || radius <= EPSILON) return entity;
        return {
            ...entity,
            angle: Math.atan2(dy, dx),
            leaderScale: Math.max(1.05, distance / radius),
        };
    }
    if (gripId === 'dimension-position' && entity.type === 'angularDimension') {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return entity;
        const radius = pointDistance(geometry.vertex, point);
        return radius > EPSILON ? { ...entity, radius } : entity;
    }
    if (gripId === 'dimension-position' && entity.type === 'arcLengthDimension') {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return entity;
        if (geometry.offsetNormal && geometry.offsetOrigin) {
            const offset = (point.x - geometry.offsetOrigin.x) * geometry.offsetNormal.x + (point.y - geometry.offsetOrigin.y) * geometry.offsetNormal.y;
            const candidate = { ...entity, offset };
            return getDimensionGeometry(candidate, source) ? candidate : entity;
        }
        const radius = pointDistance(geometry.center, point);
        const currentOffset = Number.isFinite(Number(entity.offset)) ? Number(entity.offset) : 0.6;
        const sourceRadius = geometry.radius - currentOffset;
        return radius > EPSILON ? { ...entity, offset: radius - sourceRadius } : entity;
    }
    if (entity.type === 'ordinateDimension') {
        if (gripId === 'ordinate-origin') return { ...entity, origin: { x: point.x, y: point.y } };
        if (gripId === 'ordinate-feature') return { ...entity, featurePoint: { x: point.x, y: point.y } };
        if (gripId === 'dimension-position') return { ...entity, leaderPoint: { x: point.x, y: point.y } };
    }
    if (gripId === 'center-line-extension' && entity.type === 'centerLine') {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return entity;
        const dx = geometry.sourceSecond.x - geometry.sourceFirst.x;
        const dy = geometry.sourceSecond.y - geometry.sourceFirst.y;
        const length = Math.hypot(dx, dy);
        const extension = ((point.x - geometry.sourceSecond.x) * dx + (point.y - geometry.sourceSecond.y) * dy) / length;
        return Number.isFinite(extension) ? { ...entity, extension: Math.max(0, Math.min(1e6, extension)) } : entity;
    }
    if (gripId === 'center-mark-size' && entity.type === 'centerMark') {
        const geometry = getDimensionGeometry(entity, source);
        if (!geometry) return entity;
        const size = pointDistance(geometry.center, point) - geometry.extension;
        return size > EPSILON ? { ...entity, size } : entity;
    }
    if (!['rectangle', 'image', 'text'].includes(entity.type)) return entity;

    const grips = getEntityGrips(entity);
    const gripIndex = grips.findIndex(grip => grip.id === gripId);
    if (gripIndex < 0) return entity;
    const opposite = grips[(gripIndex + 2) % 4];
    const rotation = Number(entity.rotation) || 0;
    const localPoint = rotatePoint(point, opposite, -rotation);
    const delta = { x: localPoint.x - opposite.x, y: localPoint.y - opposite.y };
    const localCenter = { x: opposite.x + delta.x / 2, y: opposite.y + delta.y / 2 };
    const center = rotatePoint(localCenter, opposite, rotation);
    const width = Math.abs(delta.x);
    const height = Math.abs(delta.y);
    return { ...entity, x: center.x - width / 2, y: center.y - height / 2, width, height };
}

/** Keeps a dragged line endpoint on the line's original infinite axis. */
export function constrainLineGripPoint(entity, gripId, point) {
    if (entity?.type !== 'line' || !['start', 'end'].includes(gripId) || !point) return point;
    const fixed = gripId === 'start'
        ? { x: entity.x2, y: entity.y2 }
        : { x: entity.x1, y: entity.y1 };
    const moving = gripId === 'start'
        ? { x: entity.x1, y: entity.y1 }
        : { x: entity.x2, y: entity.y2 };
    const dx = moving.x - fixed.x;
    const dy = moving.y - fixed.y;
    const squaredLength = dx * dx + dy * dy;
    if (squaredLength <= EPSILON) return point;
    const factor = ((point.x - fixed.x) * dx + (point.y - fixed.y) * dy) / squaredLength;
    return { ...point, x: fixed.x + dx * factor, y: fixed.y + dy * factor };
}

function entityIsContainedByBounds(entity, bounds, entityMap) {
    if (entity.type === 'point') return pointIsInBounds(entity, bounds);
    if (isConstructionLine(entity)) return false;
    if (entity.type === 'blockReference') {
        return boundsContainBounds(bounds, getDrawingBlockReferenceBounds(entity));
    }
    if (entity.type === 'line') {
        return pointIsInBounds({ x: entity.x1, y: entity.y1 }, bounds)
            && pointIsInBounds({ x: entity.x2, y: entity.y2 }, bounds);
    }
    if (['ellipse', 'spline', 'hatch', 'region'].includes(entity.type)) {
        return boundsContainBounds(bounds, getEntityBounds(entity, entityMap));
    }
    if (entity.type === 'polyline') {
        if (Array.isArray(entity.parts)) return entity.parts.every(part => entityIsContainedByBounds(part, bounds, entityMap));
        return (entity.points || []).every(point => pointIsInBounds(point, bounds));
    }
    if (entity.type === 'rectangle' || entity.type === 'image' || entity.type === 'text') {
        return boundsContainBounds(bounds, getEntityBounds(entity, entityMap));
    }
    if (entity.type === 'polygon' || entity.type === 'arc') {
        return getEntitySegments(entity).every(([first, second]) => (
            pointIsInBounds(first, bounds) && pointIsInBounds(second, bounds)
        ));
    }
    if (entity.type === 'circle') {
        if (!isFiniteBoundedCircle(entity)) return false;
        const radius = Math.abs(entity.r);
        return entity.cx - radius >= bounds.minX - EPSILON
            && entity.cx + radius <= bounds.maxX + EPSILON
            && entity.cy - radius >= bounds.minY - EPSILON
            && entity.cy + radius <= bounds.maxY + EPSILON;
    }
    const segments = dimensionSegments(entity, entityMap);
    return segments.length > 0 && segments.every(([first, second]) => (
        pointIsInBounds(first, bounds) && pointIsInBounds(second, bounds)
    ));
}

function entityCrossesBounds(entity, bounds, entityMap) {
    if (entity.type === 'point') return pointIsInBounds(entity, bounds);
    if (isDrawingWipeout(entity)) {
        const segments = getEntitySegments(entity);
        return segments.some(([a, b]) => segmentIntersectsBounds(a, b, bounds))
            || boundsCorners(bounds).some(point => pointIsInsideHatch(point, [segments]));
    }
    if (isConstructionLine(entity)) return Boolean(clipConstructionLine(entity, bounds));
    if (entity.type === 'blockReference') {
        if (!boundsOverlap(getDrawingBlockReferenceBounds(entity), bounds)) return false;
        const clip = drawingBlockClipShape(entity, { world: true });
        return !clip || drawingClipShapeIntersectsBounds(clip, bounds);
    }
    if (entity.type === 'line') {
        return segmentIntersectsBounds(
            { x: entity.x1, y: entity.y1 },
            { x: entity.x2, y: entity.y2 },
            bounds,
        );
    }
    if (entity.type === 'ellipse' || entity.type === 'spline') {
        return getEntitySegments(entity).some(segment => segmentIntersectsBounds(segment[0], segment[1], bounds));
    }
    if (['hatch', 'region'].includes(entity.type)) {
        const segments = hatchBoundarySegments(entity);
        if (segments.some(loop => loop.some(segment => segmentIntersectsBounds(segment[0], segment[1], bounds)))) return true;
        if (!['solid', 'gradient', 'radial'].includes(entity.pattern?.name || 'solid')) return false;
        const corners = boundsCorners(bounds);
        return corners.some(point => pointIsInsideHatch(point, segments, entity.fillRule));
    }
    if (entity.type === 'polyline') {
        if (Array.isArray(entity.parts)) return entity.parts.some(part => entityCrossesBounds(part, bounds, entityMap));
        return getEntitySegments(entity).some(segment => segmentIntersectsBounds(segment[0], segment[1], bounds));
    }
    if (['rectangle', 'polygon', 'arc'].includes(entity.type)) return getEntitySegments(entity).some(segment => segmentIntersectsBounds(segment[0], segment[1], bounds));
    if (entity.type === 'image' && getImageClipPoints(entity)) {
        const segments = getEntitySegments(entity);
        return segments.some(([a, b]) => segmentIntersectsBounds(a, b, bounds))
            || boundsCorners(bounds).some(point => pointIsInsideHatch(point, [segments]));
    }
    if (entity.type === 'image' || entity.type === 'text') return boundsOverlap(getEntityBounds(entity, entityMap), bounds);
    if (entity.type === 'circle') return isFiniteBoundedCircle(entity) && circleIntersectsBounds(entity, bounds);
    return cachedDimensionSegments(entity, entityMap)
        .some(segment => segmentIntersectsBounds(segment[0], segment[1], bounds));
}

// Entities are immutable between commits: repeated pointer and window tests
// reuse their boundary segments instead of renormalizing curves each time.
const hatchSegmentCache = new WeakMap();
const dimensionSegmentCache = new WeakMap();

function hatchBoundarySegments(entity) {
    if (!hatchSegmentCache.has(entity)) hatchSegmentCache.set(entity, getHatchBoundaryEntities(entity).map(getClosedBoundarySegments));
    return hatchSegmentCache.get(entity);
}

/** Dimension segments depend on their sources, so the cache is per source map. */
function cachedDimensionSegments(entity, sources) {
    let segments = dimensionSegmentCache.get(sources);
    if (!segments) dimensionSegmentCache.set(sources, segments = new WeakMap());
    if (!segments.has(entity)) segments.set(entity, dimensionSegments(entity, sources));
    return segments.get(entity);
}

/** Extent of everything a dimension can be hit or selected by: lines, arcs, markers and text frame. */
export function getDrawingDimensionSelectionBounds(entity, sources = new Map()) {
    const points = cachedDimensionSegments(entity, sources).flat();
    if (!points.length) return null;
    return points.reduce((bounds, point) => ({
        minX: Math.min(bounds.minX, point.x), minY: Math.min(bounds.minY, point.y),
        maxX: Math.max(bounds.maxX, point.x), maxY: Math.max(bounds.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function pointIsInBounds(point, bounds) {
    return point.x >= bounds.minX - EPSILON && point.x <= bounds.maxX + EPSILON
        && point.y >= bounds.minY - EPSILON && point.y <= bounds.maxY + EPSILON;
}

function boundsContainBounds(container, candidate) {
    return Boolean(candidate)
        && candidate.minX >= container.minX - EPSILON && candidate.maxX <= container.maxX + EPSILON
        && candidate.minY >= container.minY - EPSILON && candidate.maxY <= container.maxY + EPSILON;
}

function boundsOverlap(left, right) {
    return Boolean(left && right)
        && left.maxX >= right.minX - EPSILON && left.minX <= right.maxX + EPSILON
        && left.maxY >= right.minY - EPSILON && left.minY <= right.maxY + EPSILON;
}

function segmentIntersectsBounds(first, second, bounds) {
    if (pointIsInBounds(first, bounds) || pointIsInBounds(second, bounds)) return true;
    const corners = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
    ];
    return corners.some((corner, index) => segmentsIntersect(first, second, corner, corners[(index + 1) % corners.length]));
}

function segmentsIntersect(a, b, c, d) {
    const cross = (first, second, third) => (
        (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
    );
    const abC = cross(a, b, c);
    const abD = cross(a, b, d);
    const cdA = cross(c, d, a);
    const cdB = cross(c, d, b);
    if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
        && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
    return (Math.abs(abC) <= EPSILON && pointIsOnSegment(c, a, b))
        || (Math.abs(abD) <= EPSILON && pointIsOnSegment(d, a, b))
        || (Math.abs(cdA) <= EPSILON && pointIsOnSegment(a, c, d))
        || (Math.abs(cdB) <= EPSILON && pointIsOnSegment(b, c, d));
}

function pointIsOnSegment(point, first, second) {
    const cross = (second.x - first.x) * (point.y - first.y) - (second.y - first.y) * (point.x - first.x);
    return Math.abs(cross) <= EPSILON * Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
        && point.x >= Math.min(first.x, second.x) - EPSILON && point.x <= Math.max(first.x, second.x) + EPSILON
        && point.y >= Math.min(first.y, second.y) - EPSILON && point.y <= Math.max(first.y, second.y) + EPSILON;
}

function circleIntersectsBounds(circle, bounds) {
    const radius = Math.abs(circle.r);
    const center = { x: circle.cx, y: circle.cy };
    const closest = {
        x: Math.max(bounds.minX, Math.min(circle.cx, bounds.maxX)),
        y: Math.max(bounds.minY, Math.min(circle.cy, bounds.maxY)),
    };
    const corners = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
    ];
    const nearestDistance = pointDistance(center, closest);
    const farthestDistance = Math.max(...corners.map(point => pointDistance(center, point)));
    return nearestDistance <= radius + EPSILON && farthestDistance >= radius - EPSILON;
}

function dimensionSegments(entity, sources) {
    const geometry = presentDrawingDimension(getDimensionGeometry(entity, sources), entity, entity.textSize);
    if (!geometry) return [];
    const lines = geometry.lines.map(line => [line.start, line.end]);
    const arcs = geometry.arcs.flatMap(arc => {
        let sweep = (arc.endAngle - arc.startAngle) % (Math.PI * 2);
        if (arc.counterClockwise && sweep < 0) sweep += Math.PI * 2;
        if (!arc.counterClockwise && sweep > 0) sweep -= Math.PI * 2;
        const count = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
        const points = Array.from({ length: count + 1 }, (_, index) => {
            const angle = arc.startAngle + sweep * index / count;
            return {
                x: arc.center.x + Math.cos(angle) * arc.radius,
                y: arc.center.y + Math.sin(angle) * arc.radius,
            };
        });
        return points.slice(0, -1).map((point, index) => [point, points[index + 1]]);
    });
    const markers = geometry.markers.flatMap(marker => {
        const points = marker.type === 'polygon' ? [...marker.points, marker.points[0]] : marker.points;
        return points.slice(1).map((point, index) => [points[index], point]);
    });
    const text = drawingDimensionTextPoints(geometry, entity);
    const textSegments = text.map((point, index) => [point, text[(index + 1) % text.length]]);
    return [...lines, ...arcs, ...markers, ...textSegments];
}

function ellipseLocalPoint(ellipse, x, y) {
    const angle = ellipse.rotation * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return {
        x: ellipse.cx + x * cosine - y * sine,
        y: ellipse.cy + x * sine + y * cosine,
    };
}

function ellipseWorldToLocal(ellipse, point) {
    const angle = -ellipse.rotation * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const dx = point.x - ellipse.cx;
    const dy = point.y - ellipse.cy;
    return { x: dx * cosine - dy * sine, y: dx * sine + dy * cosine };
}

function boundsCorners(bounds) {
    return [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
    ];
}

function pointIsInsideHatch(point, boundarySegments, fillRule = 'evenodd') {
    let inside = false;
    let winding = 0;
    for (const segments of boundarySegments) {
        for (const [first, second] of segments) {
            if (pointIsOnSegment(point, first, second)) return true;
            const crossesRay = (first.y > point.y) !== (second.y > point.y)
                && point.x < (second.x - first.x) * (point.y - first.y) / (second.y - first.y) + first.x;
            if (crossesRay) { inside = !inside; winding += second.y > first.y ? 1 : -1; }
        }
    }
    return fillRule === 'nonzero' ? winding !== 0 : inside;
}

function normalizeBounds(x1, y1, x2, y2) {
    return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
}

function normalizeDegrees(value) {
    const normalized = (Number(value) || 0) % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}
