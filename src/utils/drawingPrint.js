import { invoke } from '@tauri-apps/api/core';

import {
    DRAWING_CUSTOM_PAPER_FORMAT,
    getDrawingPaperSize,
    normalizePaperFormat,
    normalizePaperOrientation,
} from './drawingLayouts.js';
import { isTauriRuntime } from './lcadStorage.js';

const CSS_PIXELS_PER_MM = 96 / 25.4;
const CSS_PIXELS_PER_POINT = 96 / 72;
const POSTSCRIPT_POINTS_PER_MM = 72 / 25.4;
// WebKit and native print drivers quantize CSS boxes to device pixels. Large
// A-series sheets can therefore round a nominally exact box beyond the physical
// page boundary and create a blank second page. Two PostScript points absorb
// the additional A1 driver rounding seen in WebKit while remaining below
// 0.71 mm; @page and the native paper profile retain their exact dimensions.
export const DRAWING_PRINT_CONTENT_EDGE_GUARD_POINTS = 2;

export function createDrawingPrintPageStyle(layouts) {
    const profiles = new Map((layouts || []).map(layout => {
        const pageName = getDrawingPrintPageName(layout);
        const paper = getDrawingPaperSize(layout);
        return [pageName, paper];
    }));
    return [...profiles].map(([pageName, paper]) => (
        `@page ${pageName} { size: ${paper.width}mm ${paper.height}mm; margin: 0; }\n`
        + `.drawing-layout-print-page[data-print-page="${pageName}"] { page: ${pageName}; }`
    )).join('\n');
}

export function getDrawingPrintPageName(layout) {
    const paper = getDrawingPaperSize(layout);
    const format = normalizePaperFormat(layout?.format);
    if (format !== DRAWING_CUSTOM_PAPER_FORMAT) {
        return `layout-${format.toLowerCase()}-${normalizePaperOrientation(layout?.orientation)}`;
    }
    return `layout-custom-${dimensionToken(paper.width)}x${dimensionToken(paper.height)}`;
}

export function getDrawingPrintPagePixelSize(layout) {
    const paper = getDrawingPaperSize(layout);
    return {
        width: physicalMillimetresToCssPixels(paper.width),
        height: physicalMillimetresToCssPixels(paper.height),
    };
}

export function getDrawingPrintPagePointSize(layout) {
    const paper = getDrawingPaperSize(layout);
    return {
        width: paper.width * POSTSCRIPT_POINTS_PER_MM,
        height: paper.height * POSTSCRIPT_POINTS_PER_MM,
    };
}

export function getDrawingPrintContentSize(layout) {
    const points = getDrawingPrintPagePointSize(layout);
    return {
        width: physicalPointsToCssPixels(Math.max(0, points.width - DRAWING_PRINT_CONTENT_EDGE_GUARD_POINTS)),
        height: physicalPointsToCssPixels(Math.max(0, points.height - DRAWING_PRINT_CONTENT_EDGE_GUARD_POINTS)),
    };
}

export function getCommonDrawingPrintPage(layouts) {
    const profiles = new Map((layouts || []).map(layout => {
        const paper = getDrawingPaperSize(layout);
        return [`${paper.width}x${paper.height}`, paper];
    }));
    return profiles.size === 1 ? profiles.values().next().value : null;
}

export async function prepareNativeDrawingPrint(layouts) {
    const paper = getCommonDrawingPrintPage(layouts);
    if (!paper || !isTauriRuntime()) return false;
    await invoke('prepare_print_page', { widthMm: paper.width, heightMm: paper.height });
    return true;
}

export async function printRenderedLayouts(targetWindow = window, { layouts = [], timeoutMs = 120_000 } = {}) {
    await waitForPrintRendering(targetWindow);
    await prepareNativeDrawingPrint(layouts);
    await new Promise((resolve, reject) => {
        let settled = false;
        let blurred = false;
        const timeout = targetWindow.setTimeout(finish, timeoutMs);

        function cleanup() {
            targetWindow.clearTimeout(timeout);
            targetWindow.removeEventListener('afterprint', finish);
            targetWindow.removeEventListener('blur', handleBlur);
            targetWindow.removeEventListener('focus', handleFocus);
        }

        function finish() {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        }

        function handleBlur() {
            blurred = true;
        }

        function handleFocus() {
            if (blurred) targetWindow.setTimeout(finish, 0);
        }

        targetWindow.addEventListener('afterprint', finish);
        targetWindow.addEventListener('blur', handleBlur);
        targetWindow.addEventListener('focus', handleFocus);
        try {
            targetWindow.print();
        } catch (error) {
            cleanup();
            reject(error);
        }
    });
}

export async function waitForPrintRendering(targetWindow = window) {
    if (targetWindow.document?.fonts?.ready) await targetWindow.document.fonts.ready;
    await nextFrame(targetWindow);
    await nextFrame(targetWindow);
    await nextFrame(targetWindow);
}

function nextFrame(targetWindow) {
    return new Promise(resolve => targetWindow.requestAnimationFrame(resolve));
}

function physicalMillimetresToCssPixels(millimetres) {
    return Math.max(1, millimetres * CSS_PIXELS_PER_MM);
}

function physicalPointsToCssPixels(points) {
    return Math.max(1, points * CSS_PIXELS_PER_POINT);
}

function dimensionToken(value) {
    return String(Math.round(Number(value) * 1_000));
}
