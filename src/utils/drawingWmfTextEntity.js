import { normalizeDrawingTextEntity, getDrawingTextLayout } from './drawingText.js';
import { transformDrawingAffineFrame } from './drawingAffineFrame.js';

export function drawingWmfTextEntities(primitive, { maxEntities = 100000 } = {}) {
    if (!primitive.advances) {
        const entity = drawingWmfTextEntity(primitive);
        return entity ? [entity] : [];
    }
    const characters = [...primitive.text];
    if (characters.length > maxEntities) throw new Error('wmfLimit');
    if (characters.length !== primitive.advances.length || !primitive.advances.every(Number.isFinite)) throw new Error('wmfInvalid');
    // Shape-dependent scripts must remain a run rather than being separated into glyphs.
    if (/[\p{M}\u0590-\u08ff\u200c\u200d]/u.test(primitive.text)) throw new Error('wmfUnsupportedTextSpacing');
    const total = primitive.advances.reduce((sum, value) => sum + value, 0);
    const horizontal = (primitive.textAlign || 0) & 6;
    let offset = horizontal === 6 ? -total / 2 : horizontal === 2 ? -total : 0;
    const angle = -primitive.font.escapement * Math.PI / 1800;
    return characters.map((text, index) => {
        const point = { x: primitive.points[0].x + offset * Math.cos(angle) * primitive.mapping.scaleX,
            y: primitive.points[0].y + offset * Math.sin(angle) * primitive.mapping.scaleY };
        offset += primitive.advances[index];
        return drawingWmfTextEntity({ ...primitive, text, advances: null, points: [point], textAlign: (primitive.textAlign || 0) & ~6 });
    });
}

/** Keep font geometry in local em units, then map it into physical drawing space. */
export function drawingWmfTextEntity(primitive) {
    const { font, mapping, textAlign = 0 } = primitive;
    if (primitive.clipped || primitive.backgroundMode !== 1 || primitive.advances
        || primitive.rightToLeft || (textAlign & 0x101) || font.height >= 0 || font.width
        || font.orientation !== font.escapement || /[\r\n\t\x00]/.test(primitive.text)) throw new Error('wmfUnsupportedTextRendering');
    if (!primitive.text) return null;
    const family = (font.pitchAndFamily & 0xf0) === 0x10 ? 'serif'
        : (font.pitchAndFamily & 0xf0) === 0x30 ? 'monospace' : 'sans';
    const entity = normalizeDrawingTextEntity({ type: 'text', text: primitive.text, textMode: 'singleLine',
        x: 0, y: 0, width: 1, height: 1.52, fontSize: 1, fontFamily: family,
        fontWeight: font.weight || 400, fontStyle: font.italic ? 'italic' : 'normal',
        underline: font.underline, strikethrough: font.strikeout, color: primitive.textColor });
    const measured = getDrawingTextLayout(entity);
    entity.width = measured.styledLines[0].width + 0.32;
    const layout = getDrawingTextLayout(entity);
    const horizontal = textAlign & 6; const vertical = textAlign & 24;
    const anchorX = horizontal === 6 ? entity.width / 2 : horizontal === 2 ? entity.width - 0.16 : 0.16;
    const anchorY = vertical === 24 ? layout.firstBaseline : vertical === 8 ? layout.blockTop + layout.blockHeight : layout.blockTop;
    const angle = -font.escapement * Math.PI / 1800; const height = -font.height;
    const a = height * Math.cos(angle) * mapping.scaleX; const b = height * Math.sin(angle) * mapping.scaleY;
    const c = -height * Math.sin(angle) * mapping.scaleX; const d = height * Math.cos(angle) * mapping.scaleY;
    return transformDrawingAffineFrame(entity, { a, b, c, d,
        e: primitive.points[0].x - a * anchorX - c * anchorY,
        f: primitive.points[0].y - b * anchorX - d * anchorY });
}
