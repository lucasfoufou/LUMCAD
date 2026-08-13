import { invoke } from '@tauri-apps/api/core';

import {
    DRAWING_ORIENTATION_OPTIONS,
    DRAWING_PAPER_FORMATS,
    getDrawingPaperSize,
} from './drawingLayouts.js';
import { isTauriRuntime } from './lcadStorage.js';

const CSS_PIXELS_PER_MM = 96 / 25.4;
const WEBKIT_PAGE_CONTENT_INSET_PX = 2;

export function createDrawingPrintPageStyle(layouts) {
    const profiles = new Map((layouts || []).map(layout => {
        const pageName = getDrawingPrintPageName(layout);
        const pageSize = getDrawingPrintPagePixelSize(layout);
        return [pageName, pageSize];
    }));
    return [...profiles].map(([pageName, pageSize]) => (
        `@page ${pageName} { size: ${pageSize.width}px ${pageSize.height}px; margin: 0; }\n`
        + `.drawing-layout-print-page[data-print-page="${pageName}"] { page: ${pageName}; }`
    )).join('\n');
}

export function getDrawingPrintPageName(layout) {
    const formatValue = String(layout?.format || '').trim().toUpperCase();
    const format = Object.hasOwn(DRAWING_PAPER_FORMATS, formatValue) ? formatValue : 'A0';
    const orientationValue = String(layout?.orientation || '').trim().toLowerCase();
    const orientation = DRAWING_ORIENTATION_OPTIONS.includes(orientationValue)
        ? orientationValue
        : 'landscape';
    return `layout-${format.toLowerCase()}-${orientation}`;
}

export function getDrawingPrintPagePixelSize(layout) {
    const paper = getDrawingPaperSize(layout.format, layout.orientation);
    return {
        width: physicalMillimetresToCssPixels(paper.width),
        height: physicalMillimetresToCssPixels(paper.height),
    };
}

export function getDrawingPrintContentSize(layout) {
    const pageSize = getDrawingPrintPagePixelSize(layout);
    return {
        width: pageSize.width - WEBKIT_PAGE_CONTENT_INSET_PX,
        height: pageSize.height - WEBKIT_PAGE_CONTENT_INSET_PX,
    };
}

export function getCommonDrawingPrintPage(layouts) {
    const profiles = new Map((layouts || []).map(layout => {
        const paper = getDrawingPaperSize(layout.format, layout.orientation);
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
    return Math.max(1, Math.floor(millimetres * CSS_PIXELS_PER_MM));
}
