import { multiplyAffineMatrices } from './drawingAffine.js';
import { closeDrawingPdfPath, decodeDrawingPdfPath } from './drawingPdfGeometry.js';

/** Use the decoder's actual glyph outlines, never a substitute-font text box. */
export function drawingPdfTextClipPaths(run, graphicsMatrix, getGlyphPath, limit) {
    if (!getGlyphPath || !run.fontSize) return null;
    const matrix = multiplyAffineMatrices(graphicsMatrix, run.matrix);
    const result = []; let remaining = limit;
    const append = (character, x, y) => {
        if (typeof character !== 'string') return false;
        const commands = getGlyphPath(run.fontId, character);
        if (!commands) return false;
        const paths = decodeDrawingPdfPath(commands, multiplyAffineMatrices(matrix, { a: 1,b: 0,c: 0,d: -1,e: x,f: y }), remaining).map(closeDrawingPdfPath).filter(path => path.parts.length);
        remaining -= paths.reduce((sum,path) => sum + path.parts.length,0);
        if (remaining < 0) throw new RangeError('PDF glyph outline limit exceeded.');
        result.push(...paths); return true;
    };
    for (const position of run.positions) {
        if (position.isInFont === false) continue;
        if (!append(position.fontChar, position.x / run.fontSize, 0)) return null;
        if (position.accent && !append(position.accent.fontChar, position.x / run.fontSize + position.accent.offset.x, -position.accent.offset.y)) return null;
    }
    return result;
}
