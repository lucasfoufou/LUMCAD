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
