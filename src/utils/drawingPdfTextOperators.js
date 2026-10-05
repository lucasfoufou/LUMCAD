import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices } from './drawingAffine.js';

export function initialDrawingPdfTextState() {
    return { matrix: IDENTITY_AFFINE_MATRIX, x: 0, y: 0, lineX: 0, lineY: 0,
        fontId: null, size: 0, charSpacing: 0, wordSpacing: 0, horizontalScale: 1, leading: 0, rise: 0, mode: 0 };
}

/** Interpret text-space advances without depending on a DOM or canvas renderer. */
export function advanceDrawingPdfText(current, operation, args, ops, getFont = () => null) {
    const state = { ...current };
    const move = (x, y) => { state.x = state.lineX += x; state.y = state.lineY += y; };
    if (operation === ops.beginText) Object.assign(state, { matrix: IDENTITY_AFFINE_MATRIX, x: 0, y: 0, lineX: 0, lineY: 0 });
    else if (operation === ops.endText) return { state };
    else if (operation === ops.setFont) { state.fontId = args[0]; state.size = args[1]; }
    else if (operation === ops.setCharSpacing) state.charSpacing = args[0];
    else if (operation === ops.setWordSpacing) state.wordSpacing = args[0];
    else if (operation === ops.setHScale) state.horizontalScale = args[0] / 100;
    else if (operation === ops.setLeading) state.leading = -args[0];
    else if (operation === ops.setTextRise) state.rise = args[0];
    else if (operation === ops.setTextRenderingMode) state.mode = args[0];
    else if (operation === ops.moveText) move(args[0], args[1]);
    else if (operation === ops.setLeadingMoveText) { state.leading = args[1]; move(args[0], args[1]); }
    else if (operation === ops.nextLine) move(0, state.leading);
    else if (operation === ops.setTextMatrix) {
        const values = args.length === 1 ? args[0] : args;
        if (!values || values.length !== 6 || !Array.from(values).every(Number.isFinite)) throw new TypeError('Invalid PDF text matrix.');
        const [a, b, c, d, e, f] = values;
        Object.assign(state, { matrix: { a, b, c, d, e, f }, x: 0, y: 0, lineX: 0, lineY: 0 });
    } else if ([ops.showText, ops.showSpacedText, ops.nextLineShowText, ops.nextLineSetSpacingShowText].includes(operation)) {
        let glyphs = args[0];
        if (operation === ops.nextLineShowText) move(0, state.leading);
        if (operation === ops.nextLineSetSpacingShowText) {
            state.wordSpacing = args[0]; state.charSpacing = args[1]; glyphs = args[2]; move(0, state.leading);
        }
        if (!Array.isArray(glyphs) || glyphs.length > 100000) throw new RangeError('PDF text limit exceeded.');
        const font = getFont(state.fontId);
        if (!font || font.vertical || font.isType3Font) return { state, unsupported: 'text-font' };
        const fontScale = font.fontMatrix?.[0] ?? 0.001;
        const size = Math.abs(state.size); const direction = state.size < 0 ? -1 : 1;
        let advance = 0; let text = '';
        const positions = [];
        for (const glyph of glyphs) {
            if (typeof glyph === 'number') { advance -= glyph * size / 1000; continue; }
            if (!Number.isFinite(glyph?.width) || typeof glyph.unicode !== 'string') throw new TypeError('Invalid PDF glyph.');
            if (text.length + glyph.unicode.length > 100000) throw new RangeError('PDF text limit exceeded.');
            positions.push({ text: glyph.unicode, x: advance, fontChar: glyph.fontChar, accent: glyph.accent, isInFont: glyph.isInFont });
            text += glyph.unicode;
            advance += glyph.width * size * fontScale + (state.charSpacing + (glyph.isSpace ? state.wordSpacing : 0)) * direction;
        }
        const run = { text, positions, advance, fontSize: size,
            matrix: multiplyAffineMatrices(state.matrix, { a: size * state.horizontalScale * direction, b: 0, c: 0, d: -size * direction,
                e: state.x, f: state.y + state.rise }), mode: state.mode, fontId: state.fontId,
            font: { family: font.fallbackName || 'sans-serif', name: font.name || '', bold: Boolean(font.bold || font.black), italic: Boolean(font.italic) } };
        state.x += advance * state.horizontalScale * direction;
        if (![advance, state.x, ...Object.values(run.matrix)].every(Number.isFinite)) throw new RangeError('Invalid PDF text advance.');
        return { state, run };
    } else return null;
    if (!['x', 'y', 'lineX', 'lineY', 'size', 'charSpacing', 'wordSpacing', 'horizontalScale', 'leading', 'rise', 'mode'].every(key => Number.isFinite(state[key]))) throw new TypeError('Invalid PDF text state.');
    return { state };
}
