// Placement rules of floating, non-modal windows such as the managers.

export const FLOATING_WINDOW_MARGIN = 8;
// Part of the window that must stay on screen so its header can be grabbed again.
export const FLOATING_WINDOW_GRIP = 120;

/**
 * Keeps a window at `position` ({ left, top }) reachable inside a viewport of
 * `viewport` ({ width, height }): its header stays visible and at least
 * FLOATING_WINDOW_GRIP pixels of it remain on screen horizontally.
 */
export function clampFloatingWindowPosition(position, size, viewport, minTop = 0) {
    if (!position) return null;
    const width = Math.max(0, Number(size?.width) || 0);
    const grip = Math.min(width || FLOATING_WINDOW_GRIP, FLOATING_WINDOW_GRIP);
    const maxLeft = Math.max(FLOATING_WINDOW_MARGIN, viewport.width - grip - FLOATING_WINDOW_MARGIN);
    const minLeft = Math.min(maxLeft, FLOATING_WINDOW_MARGIN - width + grip);
    const maxTop = Math.max(minTop, viewport.height - 40 - FLOATING_WINDOW_MARGIN);
    return {
        left: Math.round(Math.min(maxLeft, Math.max(minLeft, Number(position.left) || 0))),
        top: Math.round(Math.min(maxTop, Math.max(minTop, Number(position.top) || 0))),
    };
}

/** Keyboard move of a window header: arrows move 10 px, 50 px with Shift. */
export function moveFloatingWindowByKey(position, key, shiftKey = false) {
    const step = shiftKey ? 50 : 10;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
    if (!delta || !position) return null;
    return { left: position.left + delta[0], top: position.top + delta[1] };
}
