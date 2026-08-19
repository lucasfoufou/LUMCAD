import { createDrawingId } from './drawingDocument.js';
import {
    buildArcCreationEntity,
    buildCircleCreationEntity,
    buildRectangleCreationEntity,
    buildRegularPolygonCreationEntity,
} from './drawingCreation.js';
import { normalizeDrawingTextEntity } from './drawingText.js';
import { normalizeDrawingDimension } from './drawingDimensions.js';

const DIMENSION_TOOL_TYPES = Object.freeze({
    linearDimension: 'linearDimension',
    alignedDimension: 'linearDimension',
    horizontalDimension: 'linearDimension',
    verticalDimension: 'linearDimension',
    rotatedDimension: 'linearDimension',
    radialDimension: 'radialDimension',
    diameterDimension: 'radialDimension',
    joggedRadiusDimension: 'radialDimension',
    angularDimension: 'angularDimension',
    arcLengthDimension: 'arcLengthDimension',
    ordinateDimension: 'ordinateDimension',
    centerMark: 'centerMark',
});

export function buildDrawingEntity(tool, first, current, layerId, forcedId = null, { defaultText = 'Text', options = {} } = {}) {
    if (!first || !current) return null;
    const id = forcedId || createDrawingId(tool);
    if (tool === 'line') return { id, type: 'line', layerId, x1: first.x, y1: first.y, x2: current.x, y2: current.y };
    if (tool === 'rectangle') return buildRectangleCreationEntity(first, current, layerId, options, id);
    if (tool === 'text') {
        const textMode = options.textMode === 'singleLine' ? 'singleLine' : 'multiline';
        const rawText = options.text === undefined ? defaultText : String(options.text);
        return normalizeDrawingTextEntity({
            id,
            type: 'text',
            layerId,
            x: first.x,
            y: first.y,
            width: current.x - first.x,
            height: current.y - first.y,
            text: textMode === 'singleLine' ? rawText.replace(/\r\n?|\n/g, ' ') : rawText,
            textMode,
            wrapMode: textMode === 'singleLine' ? 'none' : options.wrapMode,
            textStyleId: options.textStyleId,
            fontFamily: options.fontFamily,
            fontSize: Number.isFinite(options.fontSize) ? Math.max(0.01, options.fontSize) : undefined,
            fontWeight: typeof options.bold === 'boolean' ? options.bold ? 700 : 400 : options.fontWeight,
            fontStyle: typeof options.italic === 'boolean' ? options.italic ? 'italic' : 'normal' : options.fontStyle,
            underline: options.underline,
            strikethrough: options.strikethrough,
            horizontalAlign: ['left', 'center', 'right'].includes(options.horizontalAlign) ? options.horizontalAlign : 'left',
            verticalAlign: ['top', 'middle', 'bottom'].includes(options.verticalAlign) ? options.verticalAlign : 'top',
            rotation: 0,
        });
    }
    if (tool === 'circle') return buildCircleCreationEntity([first, current], layerId, 'centerRadius', options, id);
    if (tool === 'polygon') return buildRegularPolygonCreationEntity(first, current, layerId, options, id);
    if (tool === 'arc') return buildArcCreationEntity([first, current], layerId, 'startCenterEnd', options, id);
    if (DIMENSION_TOOL_TYPES[tool]) {
        return buildDrawingDimensionEntity(tool, layerId, {
            ...options,
            ...(!options.p1 && !options.sourceId && tool !== 'angularDimension'
                ? { p1: first, p2: current }
                : {}),
        }, id);
    }
    return null;
}

export function buildDrawingDimensionEntity(toolOrType, layerId, options = {}, forcedId = null) {
    const type = DIMENSION_TOOL_TYPES[toolOrType] || toolOrType;
    if (!Object.values(DIMENSION_TOOL_TYPES).includes(type)) return null;
    const toolDefaults = {
        alignedDimension: { measurementMode: 'aligned' },
        horizontalDimension: { measurementMode: 'horizontal' },
        verticalDimension: { measurementMode: 'vertical' },
        rotatedDimension: { measurementMode: 'rotated' },
        diameterDimension: { mode: 'diameter' },
        joggedRadiusDimension: { mode: 'joggedRadius' },
    }[toolOrType] || {};
    const id = forcedId || createDrawingId('dimension');
    return normalizeDrawingDimension({
        id,
        type,
        layerId,
        ...toolDefaults,
        ...options,
    });
}
