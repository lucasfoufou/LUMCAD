import { normalizeDrawingTextEntity, getDrawingTextLayout } from './drawingText.js';
import { drawingAffineFrame, transformDrawingAffineFrame } from './drawingAffineFrame.js';

// V7 origin semantics: https://github.com/OSGeo/gdal/blob/master/ogr/ogrsf_frmts/dgn/dgnlib.h
/** V7 stores the bottom-left origin independently of its justification setting. */
export function drawingDgnTextEntity(source) {
    const entity = normalizeDrawingTextEntity({ type: 'text', text: source.text, textMode: 'singleLine',
        x: 0, y: 0, width: 1, height: 1.52, fontSize: 1, fontFamily: 'sans' });
    entity.width = getDrawingTextLayout(entity).styledLines[0].width + 0.32;
    const layout = getDrawingTextLayout(entity);
    const angle = source.rotation * Math.PI / 180;
    const a = source.characterWidth * Math.cos(angle); const b = source.characterWidth * Math.sin(angle);
    const c = source.characterHeight * Math.sin(angle); const d = -source.characterHeight * Math.cos(angle);
    const anchorX = 0.16; const anchorY = layout.blockTop + layout.blockHeight;
    const result = transformDrawingAffineFrame(entity, { a, b, c, d,
        e: source.origin.x - a * anchorX - c * anchorY,
        f: source.origin.y - b * anchorX - d * anchorY });
    if (!drawingAffineFrame(result)) throw new Error('dgnPlacement');
    return result;
}
