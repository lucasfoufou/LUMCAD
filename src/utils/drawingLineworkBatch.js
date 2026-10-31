// Plain linework (lines, arcs, circles, rectangles, regular polygons and simple
// polylines, including inside block references) can be drawn as subpaths of a
// shared path instead of one SVG element each. The path data below reproduces
// what the scene draws for each entity; anything else returns null and keeps
// its own element.
import { getArcPath, getCircleViewportGeometry, getRectangleOutlinePath, getRegularPolygonVertices } from './drawingCurves.js';
import { drawingRectTransform } from './drawingAffineFrame.js';
import { isConstructionLine } from './drawingConstructionLines.js';
import { isDrawingWipeout } from './drawingWipeout.js';
import { ANNOTATION_HIDDEN } from './drawingAnnotations.js';
import { drawingBlockClipShape } from './drawingBlockClip.js';
import { drawingBlockInstanceEntities } from './drawingDynamicBlocks.js';
import { resolveDrawingBlockChild, transformDrawingEntityAffine } from './drawingBlocks.js';

const PART_APPEARANCE = ['color', 'lineWeight', 'lineWidth', 'lineType', 'transparency'];

function pointsPath(points, closed) {
    if (!points.length) return '';
    return `${points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')}${closed ? ' Z' : ''}`;
}

function linePath(line) {
    return `M ${line.x1} ${line.y1} L ${line.x2} ${line.y2}`;
}

function circlePath(circle, viewBox) {
    const geometry = getCircleViewportGeometry(circle, viewBox);
    if (!geometry) return '';
    if (geometry.kind !== 'circle') return geometry.d;
    const { cx, cy, r } = geometry;
    return `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} Z`;
}

/** Whether the path of an entity depends on the view (circles are drawn for the visible area). */
export function drawingLineworkDependsOnViewport(entity) {
    return entity?.type === 'circle';
}

/**
 * Path data drawing `entity` as the scene draws it with its own element, or
 * null when it needs one (fills, widths, per-part appearance, text, transforms
 * other than its coordinates). An empty string means nothing is visible.
 */
export function drawingLineworkPath(entity, viewBox = null) {
    if (!entity || entity[ANNOTATION_HIDDEN] || isConstructionLine(entity) || isDrawingWipeout(entity)) return null;
    switch (entity.type) {
    case 'line': return linePath(entity);
    case 'arc': return getArcPath(entity);
    case 'circle': return circlePath(entity, viewBox);
    case 'rectangle': return drawingRectTransform(entity) ? null : getRectangleOutlinePath(entity);
    case 'polygon': return pointsPath(getRegularPolygonVertices(entity), true);
    case 'spline': {
        const points = entity.controlPoints;
        if (!Array.isArray(points) || points.length !== 4) return null;
        return `M ${points[0].x} ${points[0].y} C ${points[1].x} ${points[1].y} ${points[2].x} ${points[2].y} ${points[3].x} ${points[3].y}`;
    }
    case 'polyline': {
        if (entity.lineWidth || entity.width) return null;
        if (!Array.isArray(entity.parts)) return pointsPath(entity.points || [], Boolean(entity.closed));
        // Parts are drawn one by one, so each is its own subpath.
        if (entity.parts.some(part => !['line', 'arc', 'spline'].includes(part?.type) || PART_APPEARANCE.some(key => Object.hasOwn(part, key)))) return null;
        const paths = entity.parts.map(part => drawingLineworkPath(part, viewBox));
        return paths.some(path => path === null) ? null : paths.join(' ');
    }
    default: return null;
    }
}

/**
 * Children of a block reference as drawable linework in drawing coordinates,
 * each with the child entity whose appearance it uses, or null when the
 * reference needs its own rendering (clipping, unloaded external reference,
 * nested blocks, text, or children that are not plain linework).
 */
export function drawingLineworkBlockChildren(reference, block, { layerVisible = () => true, viewBox = null, textStyles = [], attributeDisplay = 'normal' } = {}) {
    if (!block || reference.externalReference?.loaded === false || drawingBlockClipShape(reference)) return null;
    const children = [];
    for (const child of drawingBlockInstanceEntities(block, reference)) {
        const resolved = resolveDrawingBlockChild(child, reference, attributeDisplay);
        if (!resolved || !layerVisible(resolved.layerId)) continue;
        if (drawingLineworkPath(resolved, null) === null) return null;
        const world = transformDrawingEntityAffine(resolved, reference.transform, { textStyles });
        const d = drawingLineworkPath(world, viewBox);
        if (d === null) return null;
        children.push({ entity: resolved, d });
    }
    return children;
}
