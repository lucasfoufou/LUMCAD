// Text of the status-bar cursor position. The world point is converted to the
// current UCS and formatted with the drawing display units, like every other
// coordinate shown to the user.
import { drawingWorldToUcs, formatDrawingDistance } from './drawingCoordinates.js';

export function formatDrawingCursorPosition(point, settings, locale = 'en', t = null) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return '';
    const local = drawingWorldToUcs(point, settings?.ucs);
    const x = formatDrawingDistance(local.x, settings, locale);
    const y = formatDrawingDistance(local.y, settings, locale);
    // French separates coordinates with a semicolon because the comma is the decimal separator.
    return t ? t('status.cursorPosition', { x, y }) : `${x}${locale === 'fr' ? ' ; ' : ', '}${y}`;
}
