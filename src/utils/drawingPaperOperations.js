import { canEditEntity } from './drawingDocument.js';
import { createDrawingPaperAnnotation, addDrawingPaperAnnotation, applyDrawingViewportDisplaySettings, paperPointToViewportModelPoint, viewportModelPointToPaperPoint, getDrawingViewportClipPoints } from './drawingLayouts.js';
import { resolveDrawingSnap } from './drawingTracking.js';
import { snapDrawingPoint } from './drawingGeometry.js';
import { drawingPolygonContainsPoint } from './drawingBoundaryDetection.js';

export function createDrawingPaperEntityFromPoints(content, layout, type, first, second, options = {}) {
    if (!['text', 'line', 'rectangle'].includes(type) || !canEditEntity(content, { layerId: content.activeLayerId })
        || ![first?.x, first?.y, second?.x, second?.y].every(Number.isFinite) || Math.hypot(first.x - second.x, first.y - second.y) < 0.01) return null;
    const geometry = type === 'line' ? { x1: first.x, y1: first.y, x2: second.x, y2: second.y }
        : { x: Math.min(first.x, second.x), y: Math.min(first.y, second.y), width: Math.max(0.1, Math.abs(second.x - first.x)), height: Math.max(0.1, Math.abs(second.y - first.y)) };
    return createDrawingPaperAnnotation(layout, type, { ...geometry, ...options, layerId: content.activeLayerId });
}

export function commitDrawingPaperEntity(content, layout, type, first, second, options = {}) {
    const entity = createDrawingPaperEntityFromPoints(content, layout, type, first, second, options);
    return entity ? { entity, layout: addDrawingPaperAnnotation(layout, entity) } : null;
}

export function resolveDrawingPaperSnap(point, content, layout, threshold, options = {}) {
    const paperContent = { ...content, entities: layout.paperEntities || [], settings: { ...content.settings, ucs: { x: 0, y: 0, rotation: 0 }, limits: null } };
    const direct = resolveDrawingSnap(point, paperContent, threshold, options);
    const candidates = direct.type && !['grid', 'orthogonal'].includes(direct.type) ? [{ ...direct, distance: Math.hypot(direct.x - point.x, direct.y - point.y) }] : [];
    for (const viewport of layout.viewports.slice(0, 64)) {
        if (point.x < viewport.x - threshold || point.x > viewport.x + viewport.width + threshold
            || point.y < viewport.y - threshold || point.y > viewport.y + viewport.height + threshold) continue;
        const modelPoint = paperPointToViewportModelPoint(viewport, point);
        if (!modelPoint) continue;
        const hidden = new Set(viewport.hiddenLayerIds);
        const displayed = applyDrawingViewportDisplaySettings(content, viewport);
        const modelContent = { ...displayed, layers: displayed.layers.map(layer => hidden.has(layer.id) ? { ...layer, visible: false } : layer),
            settings: { ...displayed.settings, snaps: { ...displayed.settings.snaps, grid: false } } };
        const snapped = snapDrawingPoint(modelPoint, modelContent, threshold * viewport.modelViewBox.width / viewport.width);
        if (!snapped.type) continue;
        const paper = viewportModelPointToPaperPoint(viewport, snapped);
        if (paper.x < viewport.x - 1e-8 || paper.x > viewport.x + viewport.width + 1e-8 || paper.y < viewport.y - 1e-8 || paper.y > viewport.y + viewport.height + 1e-8) continue;
        if (viewport.clipBoundary && !drawingPolygonContainsPoint(getDrawingViewportClipPoints(viewport), paper)) continue;
        const rotation = (viewport.viewRotation || 0) * Math.PI / 180;
        candidates.push({ ...snapped, ...paper, distance: Math.hypot(paper.x - point.x, paper.y - point.y),
            ...(snapped.guideAngles ? { guideAngles: snapped.guideAngles.map(angle => angle + rotation) } : {}),
            ...(snapped.trackingDirections ? { trackingDirections: snapped.trackingDirections.map(direction => ({ ...direction, angle: direction.angle + rotation })) } : {}) });
    }
    if (options.forceOrthogonal || content.settings?.ortho || options.temporaryOrtho) return direct;
    return candidates.sort((a, b) => a.distance - b.distance)[0] || direct;
}
