import { aciHex } from '@tarikjabiri/dxf';
import { DEFAULT_DRAWING_COLOR } from './drawingDocument.js';
import { failDxf } from './drawingDxfReader.js';
import { normalizeDrawingTextEntity, normalizeDrawingTextStyle, getDrawingTextLayout } from './drawingText.js';
import { normalizeDrawingAffineFrame } from './drawingAffineFrame.js';
import { transformAffinePoint } from './drawingAffine.js';
import { dxfOcsAxes } from './drawingDxfGeometry.js';

const unicode = text => text.replace(/\\U\+([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

/** Parse MTEXT's scoped formatting without losing the literal text or accents. */
export function readDxfTextRuns(text, height, multiline, warnings, factor = 1) {
    const input = unicode(text).replace(/%%[dDpPcC]/g, value => ({ d: '°', p: '±', c: 'Ø' })[value[2].toLowerCase()]);
    if (!multiline) return [{ text: input, marks: {} }];
    const runs = []; const stack = []; let marks = {}; let buffer = '';
    const flush = () => { if (buffer) runs.push({ text: buffer, marks: { ...marks } }); buffer = ''; };
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (char === '{') { flush(); if (stack.length >= 64) failDxf('cadLimit'); stack.push({ ...marks }); continue; }
        if (char === '}') { flush(); marks = stack.pop() || {}; continue; }
        if (char === '^' && /[IJM]/.test(input[i + 1] || '')) { buffer += input[++i] === 'I' ? '\t' : '\n'; continue; }
        if (char !== '\\') { buffer += char; continue; }
        const command = input[++i];
        if (command === undefined) { buffer += '\\'; break; }
        if (['\\', '{', '}'].includes(command)) { buffer += command; continue; }
        if (command === 'P' || command === 'X') { buffer += '\n'; continue; }
        if (command === '~') { buffer += '\u00a0'; continue; }
        flush();
        if (/[LlOoKk]/.test(command)) {
            if (command.toLowerCase() === 'l') marks.underline = command === 'L';
            else if (command.toLowerCase() === 'k') marks.strikethrough = command === 'K';
            else warnings.add('textFormatting');
            continue;
        }
        const end = input.indexOf(';', i + 1);
        if (end < 0 || !'fFHCcWQTASp'.includes(command)) failDxf('cadUnsupported', 'MTEXT format');
        const value = input.slice(i + 1, end); i = end;
        if (command === 'f' || command === 'F') {
            const parts = value.split('|');
            marks.bold = parts.includes('b1'); marks.italic = parts.includes('i1');
            marks.fontFamily = /courier|mono/i.test(parts[0]) ? 'monospace' : /times|roman/i.test(parts[0]) ? 'serif' : 'sans';
        } else if (command === 'H') {
            const size = Number(value.replace(/x$/i, '')) * (/x$/i.test(value) ? height : factor);
            if (!(size > 0) || !Number.isFinite(size)) failDxf('cadInvalid');
            marks.fontSize = size;
        } else if (command === 'C' || command === 'c') {
            const color = Number(value);
            if (!Number.isInteger(color) || color < 0) failDxf('cadInvalid');
            if (command === 'c') marks.color = `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
            else if (color > 0 && color < 256) marks.color = color === 7 ? DEFAULT_DRAWING_COLOR : `#${aciHex(color).toLowerCase()}`;
            else delete marks.color;
        } else if (command === 'S') {
            buffer += value.replace(/\^ ?|#/g, '/'); warnings.add('textFormatting');
        } else warnings.add('textFormatting');
    }
    flush();
    return runs;
}

/** Anchor an editable native text frame to the DXF insertion/alignment point. */
export function importDxfText(source, position, factor, warnings) {
    if (!(source.height > 0) || !Number.isFinite(source.height) || source.text.length > 100000) failDxf('cadInvalid');
    const multiline = source.type === 'MTEXT';
    const physicalHeight = source.height * factor;
    if (!(physicalHeight > 0) || !Number.isFinite(physicalHeight)) failDxf('cadInvalid');
    // Sub-centimetre labels inside scaled blocks must not lose their size at
    // native text normalization. Keep a valid local frame and scale it exactly.
    const physicalRuns = readDxfTextRuns(source.text, physicalHeight, multiline, warnings, factor);
    const sizes = [physicalHeight, ...physicalRuns.flatMap(run => run.marks.fontSize ? [run.marks.fontSize] : [])];
    const validSize = size => normalizeDrawingTextStyle({ fontSize: size }).fontSize === size;
    const frameScale = sizes.every(validSize) ? 1 : Math.min(...sizes);
    if (!sizes.every(size => validSize(size / frameScale))) failDxf('cadUnsupported', 'text height range');
    const textFactor = factor / frameScale;
    const height = source.height * textFactor;
    const runs = physicalRuns.map(run => ({ ...run, marks: { ...run.marks,
        ...(run.marks.fontSize ? { fontSize: run.marks.fontSize / frameScale } : {}) } }));
    const text = runs.map(run => run.text).join('');
    const width = multiline && source.width > 0 ? source.width * textFactor : Math.max(height, text.length * height);
    const horizontal = multiline ? (source.attachment - 1) % 3 : source.horizontalAlignment || 0;
    const entity = normalizeDrawingTextEntity({ type: 'text', x: 0, y: 0, width: width + height * 0.32,
        height: height * 1.52, text, runs, textMode: multiline ? 'multiline' : 'singleLine',
        fontSize: height, horizontalAlign: horizontal === 1 || horizontal === 4 ? 'center' : horizontal === 2 ? 'right' : 'left' });
    let layout = getDrawingTextLayout(entity);
    entity.height = layout.blockHeight + height * 0.32;
    layout = getDrawingTextLayout(entity);
    const anchorX = layout.textX;
    const vertical = source.verticalAlignment || 0;
    const anchorY = multiline ? layout.blockTop + layout.blockHeight * Math.floor((source.attachment - 1) / 3) / 2
        : vertical === 3 ? layout.blockTop : vertical === 2 || horizontal === 4 ? layout.blockTop + layout.blockHeight / 2 : layout.firstBaseline;
    let angle = -source.rotation * Math.PI / 180;
    let xScale = frameScale * (source.widthFactor ?? 1) * (source.generation & 2 ? -1 : 1);
    let yScale = frameScale * (source.generation & 4 ? -1 : 1);
    if (!multiline && [3, 5].includes(source.horizontalAlignment) && source.alignmentPoint) {
        const dx = source.alignmentPoint.x - source.position.x; const dy = source.alignmentPoint.y - source.position.y;
        const naturalWidth = layout.styledLines[0]?.width;
        if (!(naturalWidth > 0 && Math.hypot(dx, dy) > 0)) failDxf('cadUnsupported', 'text alignment');
        const fitScale = Math.hypot(dx, dy) * factor / naturalWidth;
        angle = -Math.atan2(dy, dx);
        xScale = fitScale * (source.generation & 2 ? -1 : 1);
        if (source.horizontalAlignment === 3) yScale = fitScale * (source.generation & 4 ? -1 : 1);
    }
    const slant = Math.tan((source.oblique || 0) * Math.PI / 180);
    if (![xScale, slant].every(Number.isFinite) || xScale === 0 || Math.abs(slant) > 100) failDxf('cadUnsupported', 'text transform');
    const basis = multiline ? mtextBasis(source, warnings) : { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle) };
    const a = basis.a * xScale; const b = basis.b * xScale;
    const c = basis.c * yScale - a * slant; const d = basis.d * yScale - b * slant;
    const affineFrame = normalizeDrawingAffineFrame({ a, b, c, d, e: position.x * factor - a * anchorX - c * anchorY,
        f: -position.y * factor - b * anchorX - d * anchorY });
    if (!affineFrame) failDxf('cadUnsupported', 'text transform');
    return { ...entity, affineFrame };
}

/** MTEXT insertion and direction are WCS; only the glyph plane uses extrusion. */
function mtextBasis(source, warnings) {
    const angle = source.rotation * Math.PI / 180;
    let direction = source.direction;
    if (direction && !Math.hypot(direction.x, direction.y, direction.z)) {
        // Some LibreDWG caches contain a zero direction. Retain the rotation
        // fallback used by the reader and report that orientation is approximate.
        warnings.add('textFormatting');
        direction = null;
    }
    const normal = source.extrusion || { x: 0, y: 0, z: 1 };
    const defaultDirection = !direction && source.rotationDefined === false;
    if (!direction) {
        if (defaultDirection) direction = { x: 1, y: 0, z: 0 };
        else {
            const axes = dxfOcsAxes(normal);
            direction = Object.fromEntries(['x', 'y', 'z'].map(key => [key,
                axes.x[key] * Math.cos(angle) + axes.y[key] * Math.sin(angle)]));
        }
    }
    const length = Math.hypot(direction.x, direction.y, direction.z);
    const normalLength = Math.hypot(normal.x, normal.y, normal.z);
    if (!(length > 0 && normalLength > 0)) failDxf('cadInvalid');
    const x = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
    const n = { x: normal.x / normalLength, y: normal.y / normalLength, z: normal.z / normalLength };
    if (!defaultDirection && Math.abs(x.x * n.x + x.y * n.y + x.z * n.z) > 1e-8) failDxf('cadUnsupported', 'text plane');
    if (Math.abs(n.x) > 1e-8 || Math.abs(n.y) > 1e-8) warnings.add('elevation');
    // Local text Y points down, opposite to the WCS glyph up vector n × x.
    const up = { x: n.y * x.z - n.z * x.y, y: n.z * x.x - n.x * x.z, z: n.x * x.y - n.y * x.x };
    const upLength = Math.hypot(up.x, up.y, up.z);
    if (!(upLength > 1e-10)) failDxf('cadUnsupported', 'text plane');
    return { a: x.x, b: -x.y, c: -up.x / upLength, d: up.y / upLength };
}

/** Export simple framed text without discarding its physical baseline or scale. */
export function exportDxfFramedText(entity) {
    const frame = normalizeDrawingAffineFrame(entity.affineFrame);
    const scale = frame && Math.hypot(frame.a, frame.b);
    if (!frame || !(scale > 0) || Math.abs(frame.c + frame.b) > scale * 1e-9
        || Math.abs(frame.d - frame.a) > scale * 1e-9 || entity.mirrored) failDxf('cadUnsupported', 'text');
    const layout = getDrawingTextLayout(entity);
    // The basic DXF exporter emits left-aligned text; retain other alignments
    // as an explicit unsupported case instead of silently shifting them.
    if (entity.horizontalAlign !== 'left') failDxf('cadUnsupported', 'text alignment');
    const anchor = { x: layout.textX, y: entity.textMode === 'singleLine' ? layout.firstBaseline : layout.blockTop };
    const angle = (entity.rotation || 0) * Math.PI / 180;
    const center = { x: entity.x + entity.width / 2, y: entity.y + entity.height / 2 };
    const dx = anchor.x - center.x; const dy = anchor.y - center.y;
    const position = transformAffinePoint({ x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
        y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) }, frame);
    const { affineFrame, ...plain } = entity;
    return { ...plain, ...position, fontSize: layout.fontSize * scale, width: layout.availableWidth * scale,
        rotation: (entity.rotation || 0) + Math.atan2(frame.b, frame.a) * 180 / Math.PI };
}
