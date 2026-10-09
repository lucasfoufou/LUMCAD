import { getWorldUnitsPerPixelForScaleRatio } from './drawingGeometry.js';

export const MIN_SCREEN_SCALE_RATIO = 1;
export const MAX_SCREEN_SCALE_RATIO = 10000;

export function zoomDrawingViewBox(viewBox, factor, focus, canvasSize) {
    const limits = getZoomWidthLimits(canvasSize);
    const width = Math.min(limits.max, Math.max(limits.min, viewBox.width * factor));
    const height = viewBox.height * width / viewBox.width;
    const ratioX = (focus.x - viewBox.x) / viewBox.width;
    const ratioY = (focus.y - viewBox.y) / viewBox.height;
    return { x: focus.x - ratioX * width, y: focus.y - ratioY * height, width, height };
}

export function scaleDrawingViewBox(viewBox, canvasSize, scaleRatio) {
    const ratio = Math.min(MAX_SCREEN_SCALE_RATIO, Math.max(MIN_SCREEN_SCALE_RATIO, Number(scaleRatio) || 1));
    const unitsPerPixel = getWorldUnitsPerPixelForScaleRatio(ratio);
    if (!unitsPerPixel || !canvasSize?.width || !canvasSize?.height) return viewBox;
    const width = unitsPerPixel * canvasSize.width;
    const height = unitsPerPixel * canvasSize.height;
    const centerX = viewBox.x + viewBox.width / 2;
    const centerY = viewBox.y + viewBox.height / 2;
    return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

function getZoomWidthLimits(canvasSize) {
    const width = Math.max(1, Number(canvasSize?.width) || 1);
    return {
        min: getWorldUnitsPerPixelForScaleRatio(MIN_SCREEN_SCALE_RATIO) * width,
        max: getWorldUnitsPerPixelForScaleRatio(MAX_SCREEN_SCALE_RATIO) * width,
    };
}

/**
 * Screen-space transform that makes content rendered for `renderedViewBox`
 * appear as `viewBox` would, both fitted with `xMidYMid meet` in a canvas of
 * `canvasSize` pixels. Pan and zoom gestures apply it as a composited CSS
 * transform and re-render the SVG only once the view settles.
 */
export function drawingViewBoxScreenTransform(renderedViewBox, viewBox, canvasSize) {
    if (!renderedViewBox || !viewBox || renderedViewBox === viewBox) return null;
    const width = Number(canvasSize?.width);
    const height = Number(canvasSize?.height);
    if (!(width > 0) || !(height > 0)) return null;
    const rendered = meetMapping(renderedViewBox, width, height);
    const current = meetMapping(viewBox, width, height);
    if (!rendered || !current) return null;
    const scale = current.scale / rendered.scale;
    return {
        x: current.offsetX + (renderedViewBox.x - viewBox.x) * current.scale - rendered.offsetX * scale,
        y: current.offsetY + (renderedViewBox.y - viewBox.y) * current.scale - rendered.offsetY * scale,
        scale,
    };
}

function meetMapping(viewBox, width, height) {
    if (!(viewBox.width > 0) || !(viewBox.height > 0)) return null;
    const scale = Math.min(width / viewBox.width, height / viewBox.height);
    return { scale, offsetX: (width - viewBox.width * scale) / 2, offsetY: (height - viewBox.height * scale) / 2 };
}

/** World-space rectangle actually visible when `viewBox` is fitted with `xMidYMid meet`. */
export function drawingVisibleViewBox(viewBox, canvasSize) {
    const width = Number(canvasSize?.width);
    const height = Number(canvasSize?.height);
    if (!viewBox || !(width > 0) || !(height > 0)) return viewBox;
    const mapping = meetMapping(viewBox, width, height);
    if (!mapping) return viewBox;
    return {
        x: viewBox.x - mapping.offsetX / mapping.scale,
        y: viewBox.y - mapping.offsetY / mapping.scale,
        width: width / mapping.scale,
        height: height / mapping.scale,
    };
}
