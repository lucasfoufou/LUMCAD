import { addEntity } from './drawingDocument.js';
import { resolveDrawingTextStyle } from './drawingText.js';

/**
 * Opposite corner of the frame of a single-line text placed with one click:
 * a line of about twelve characters at the style height, grown by the editor.
 */
export function singleClickTextFrame(point, options = {}, textStyles = []) {
    const style = resolveDrawingTextStyle(options, textStyles);
    const size = Number.isFinite(options.fontSize) && options.fontSize > 0 ? options.fontSize : style.fontSize;
    return { x: point.x + size * 7, y: point.y + size * 1.4 };
}

/** The text being typed has no content yet; it is added to the drawing only when validated. */
export function createPendingDrawingText(entity) {
    return { ...entity, text: '', runs: [] };
}

/** Returns the content with the validated text, or null when nothing was typed. */
export function commitPendingDrawingText(content, entity) {
    if (!entity || !String(entity.text || '').trim()) return null;
    return addEntity(content, entity);
}
