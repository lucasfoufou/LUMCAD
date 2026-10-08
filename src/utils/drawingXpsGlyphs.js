import { parseDrawingXpsGlyphIndices } from './drawingXpsGlyphIndices.js';
import { readDrawingXpsFontResource, readDrawingXpsFontMetrics, createDrawingXpsVerticalMetrics } from './drawingXpsFonts.js';
import { readDrawingFontCmap } from './drawingFontCmap.js';
import { createDrawingFontOutlineReader, drawingFontOutlineBounds } from './drawingFontOutlines.js';

const invalid = () => { throw new Error('dwfxGlyphs'); };
const number = (value, fallback) => {
    if (value === undefined || value === '') return fallback;
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) invalid();
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || Math.abs(parsed) > 1e9) invalid();
    return parsed;
};

/** Interpret positioned glyph runs using embedded outlines, never operating-system font substitution. */
export function createDrawingXpsGlyphReader(files, base) {
    const fonts = new Map(); let bytes = 0; let glyphs = 0;
    return ({ fontUri, unicodeString = '', indices = '', fontSize, x, y, bidiLevel = 0, isSideways = false, style = 'None' }, { maxParts = 100000 } = {}) => {
        if (![fontSize, x, y].every(Number.isFinite) || fontSize < 0 || fontSize > 1e6 || Math.abs(x) > 1e9 || Math.abs(y) > 1e9) invalid();
        if (!Number.isInteger(bidiLevel) || bidiLevel < 0 || bidiLevel > 61) invalid();
        if (!['None', 'ItalicSimulation', 'BoldSimulation', 'BoldItalicSimulation'].includes(style)) throw new Error('dwfxUnsupported');
        const bold = style.startsWith('Bold');
        const slant = style.includes('Italic') ? Math.tan(20 * Math.PI / 180) : 0;
        const rightToLeft = bidiLevel % 2 === 1;
        if (typeof isSideways !== 'boolean' || isSideways && rightToLeft) invalid();
        const direction = rightToLeft ? -1 : 1;
        const entries = parseDrawingXpsGlyphIndices(unicodeString, indices);
        glyphs += entries.length;
        if (glyphs > 10000) throw new Error('dwfxLimit');
        if (!fonts.has(fontUri)) {
            if (fonts.size >= 16) throw new Error('dwfxLimit');
            const resource = readDrawingXpsFontResource(files, base, fontUri);
            bytes += resource.bytes.length;
            if (bytes > 32 * 1024 * 1024) throw new Error('dwfxLimit');
            const metrics = readDrawingXpsFontMetrics(resource);
            fonts.set(fontUri, { resource, metrics, read: createDrawingFontOutlineReader(resource, metrics), cmap: null });
        }
        const font = fonts.get(fontUri); const scale = fontSize / font.metrics.unitsPerEm;
        const paths = []; const boldGlyphs = []; let advance = 0; let parts = 0;
        const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const { fields, codePoint } of entries) {
            let index;
            if (fields[0]) index = Number(fields[0]);
            else {
                font.cmap ||= readDrawingFontCmap(font.resource, font.metrics.glyphCount);
                index = font.cmap(codePoint);
            }
            const metric = font.metrics.glyph(index);
            if (isSideways) font.vertical ||= createDrawingXpsVerticalMetrics(font.resource, font.metrics);
            const vertical = isSideways ? font.vertical(index, font.read.yMax(index)) : null;
            const width = number(fields[1], (vertical?.advanceWidth ?? metric.advanceWidth) * 100 / font.metrics.unitsPerEm + (bold ? 2 : 0));
            if (width < 0) invalid();
            const offsetX = number(fields[2], 0) * fontSize / 100;
            const offsetY = number(fields[3], 0) * fontSize / 100;
            // XPS anchors RTL outlines at the right end of the intrinsic font advance.
            // An explicit Indices advance changes the next glyph position, not this origin.
            const originX = x + direction * (advance + offsetX) - (rightToLeft ? metric.advanceWidth * scale : 0);
            const placement = shear => isSideways
                ? { a: 0, b: -scale, c: -scale, d: -shear * scale,
                    e: originX + vertical.originY * scale, f: y - offsetY + vertical.originX * scale }
                : { a: scale, b: 0, c: shear * scale, d: -scale, e: originX, f: y - offsetY };
            // Decode even zero-size runs so malformed glyph programs still reject.
            font.read.yMax(index);
            if (fontSize > 0) {
                const geometry = font.read.geometry(index, placement(slant));
                parts += geometry.paths.reduce((sum, path) => sum + path.parts.length, 0);
                if (bold && geometry.paths.length) {
                    // Keep the stroke in unsheared glyph space: bold precedes italic in XPS.
                    const baselineX = originX + (vertical?.originY || 0) * scale;
                    const baselineY = y - offsetY;
                    const matrix = isSideways ? [1, slant, 0, 1, 0, -slant * baselineX]
                        : [1, 0, -slant, 1, slant * baselineY, 0];
                    const outline = font.read.geometry(index, placement(0));
                    parts += outline.paths.reduce((sum, path) => sum + path.parts.length, 0);
                    boldGlyphs.push({ geometry: outline, matrix });
                    const box = drawingFontOutlineBounds(geometry);
                    if (box) {
                        bounds.minX = Math.min(bounds.minX, box.minX); bounds.maxX = Math.max(bounds.maxX, box.maxX);
                        bounds.minY = Math.min(bounds.minY, box.minY); bounds.maxY = Math.max(bounds.maxY, box.maxY);
                    }
                }
                if (parts > maxParts) throw new Error('dwfxLimit');
                paths.push(...geometry.paths);
            }
            advance += width * fontSize / 100;
            if (!Number.isFinite(advance) || Math.abs(advance) > 1e9) invalid();
        }
        if (!boldGlyphs.length) return { paths, rule: 'nonzero' };
        const padding = fontSize * .01 * (1 + Math.abs(slant));
        return { paths, rule: 'nonzero', boldMask: { glyphs: boldGlyphs, width: fontSize * .02,
            x: bounds.minX - padding, y: bounds.minY - padding,
            spanX: bounds.maxX - bounds.minX + 2 * padding, spanY: bounds.maxY - bounds.minY + 2 * padding } };
    };
}
