import { getDrawingTextLayout, layoutDrawingTextRuns } from './drawingText.js';
import { framedDrawingPoint } from './drawingAffineFrame.js';
import { rotatePoint } from './drawingPrimitives.js';
import { encodeDrawingWmfText } from './drawingWmfText.js';

/** Resolve native text lines to positioned GDI runs using the shared layout metrics. */
export function drawingWmfTextLayout(entity, content, color) {
    if (entity.mirrored || entity.fitWidth) throw new Error('wmfExportUnsupported');
    const layout = getDrawingTextLayout(entity, { styles: content.textStyles, color });
    const center = { x: layout.x + layout.width / 2, y: layout.y + layout.height / 2 };
    const world = point => framedDrawingPoint(entity, rotatePoint(point, center, Number(entity.rotation) || 0));
    const zero = world({ x: 0, y: 0 }); const x = world({ x: 1, y: 0 }); const y = world({ x: 0, y: 1 });
    const dx = x.x - zero.x; const dy = x.y - zero.y; const ex = y.x - zero.x; const ey = y.y - zero.y;
    const scale = Math.hypot(dx, dy); const scaleY = Math.hypot(ex, ey);
    if (!scale || Math.abs(scale - scaleY) > scale * 1e-8 || Math.abs(dx * ex + dy * ey) > scale * scaleY * 1e-8
        || dx * ey - dy * ex <= 0) throw new Error('wmfExportUnsupported');
    const points = [{ x: layout.x, y: layout.y }, { x: layout.x + layout.width, y: layout.y },
        { x: layout.x + layout.width, y: layout.y + layout.height }, { x: layout.x, y: layout.y + layout.height }].map(world);
    const clipped = layout.textMode !== 'singleLine';
    if (clipped && Math.abs(dx) > scale * 1e-8 && Math.abs(dy) > scale * 1e-8) throw new Error('wmfExportUnsupported');
    const clip = clipped ? { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)),
        maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) } : null;
    const texts = [];
    for (const line of layout.styledLines) {
        let offset = layout.textAnchor === 'middle' ? -line.width / 2 : layout.textAnchor === 'end' ? -line.width : 0;
        if (!clipped) {
            const left = line.x + offset;
            // Single-line text can overflow its editing frame in either direction.
            points.push(...[{ x: left, y: line.top }, { x: left + line.width, y: line.top },
                { x: left + line.width, y: line.top + line.height }, { x: left, y: line.top + line.height }].map(world));
        }
        for (const span of line.spans) {
            if (/[\p{Mark}\u0590-\u08ff\u0e00-\u0e7f]/u.test(span.text)) throw new Error('wmfExportUnsupported');
            let charset = null;
            for (const candidate of [0, 204, 161, 238, 162, 186, 163]) {
                try { encodeDrawingWmfText(span.text, candidate); charset = candidate; break; } catch (error) {
                    if (error.message !== 'wmfUnsupportedCharset') throw error;
                }
            }
            if (charset === null) throw new Error('wmfUnsupportedCharset');
            const style = span.style;
            const advances = [...span.text].map(character => layoutDrawingTextRuns([{ text: character, marks: {} }], Infinity,
                style, { textMode: 'singleLine' })[0].width * scale);
            texts.push({ kind: 'text', text: span.text, charset, advances, point: world({ x: line.x + offset, y: line.baseline }),
                height: style.fontSize * scale, escapement: -Math.atan2(dy, dx) * 1800 / Math.PI,
                name: style.fontFamily === 'serif' ? 'Times New Roman' : style.fontFamily === 'monospace' ? 'Courier New' : 'Arial',
                pitchAndFamily: style.fontFamily === 'serif' ? 16 : style.fontFamily === 'monospace' ? 48 : 32,
                weight: style.fontWeight, italic: style.fontStyle === 'italic', underline: style.underline,
                strikeout: style.strikethrough, appearance: { color: style.color || color }, clip });
            offset += span.width;
        }
    }
    return { texts, points };
}
