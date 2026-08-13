import { createDrawingId } from './drawingDocument.js';
import {
    buildArcCreationEntity,
    buildCircleCreationEntity,
    buildRectangleCreationEntity,
    buildRegularPolygonCreationEntity,
} from './drawingCreation.js';

export function buildDrawingEntity(tool, first, current, layerId, forcedId = null, { defaultText = 'Text', options = {} } = {}) {
    if (!first || !current) return null;
    const id = forcedId || createDrawingId(tool);
    if (tool === 'line') return { id, type: 'line', layerId, x1: first.x, y1: first.y, x2: current.x, y2: current.y };
    if (tool === 'rectangle') return buildRectangleCreationEntity(first, current, layerId, options, id);
    if (tool === 'text') {
        return {
            id,
            type: 'text',
            layerId,
            x: first.x,
            y: first.y,
            width: current.x - first.x,
            height: current.y - first.y,
            text: options.text === undefined ? defaultText : String(options.text),
            fontSize: Number.isFinite(options.fontSize) ? Math.max(0.01, options.fontSize) : 0.35,
            horizontalAlign: ['left', 'center', 'right'].includes(options.horizontalAlign) ? options.horizontalAlign : 'left',
            verticalAlign: ['top', 'middle', 'bottom'].includes(options.verticalAlign) ? options.verticalAlign : 'top',
            rotation: 0,
        };
    }
    if (tool === 'circle') return buildCircleCreationEntity([first, current], layerId, 'centerRadius', options, id);
    if (tool === 'polygon') return buildRegularPolygonCreationEntity(first, current, layerId, options, id);
    if (tool === 'arc') return buildArcCreationEntity([first, current], layerId, 'startCenterEnd', options, id);
    return null;
}
