import { transformAffinePoint } from './drawingAffine.js';
import { parseDrawingXpsGeometry } from './drawingXpsGeometry.js';

const invalid = () => { throw new Error('dwfxFont'); };

/** Decode unhinted TrueType contours without executing font instructions. */
export function createDrawingTrueTypeReader(resource, glyphCount, { maxPoints = 100000 } = {}) {
    if (resource.format !== 'truetype') throw new Error('dwfxUnsupported');
    if (!Number.isInteger(glyphCount) || glyphCount < 1 || glyphCount > 65535
        || !Number.isSafeInteger(maxPoints) || maxPoints < 1 || maxPoints > 1000000) invalid();
    const head = resource.tables.get('head')?.bytes; const loca = resource.tables.get('loca')?.bytes; const glyf = resource.tables.get('glyf')?.bytes;
    if (!head || head.length < 54 || !loca || !glyf) invalid();
    const format = new DataView(head.buffer, head.byteOffset, head.byteLength).getInt16(50);
    if (![0, 1].includes(format)) invalid();
    const stride = format ? 4 : 2;
    if (loca.length < (glyphCount + 1) * stride) invalid();
    const locations = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
    const offsets = [];
    for (let i = 0; i <= glyphCount; i++) {
        const offset = format ? locations.getUint32(i * 4) : locations.getUint16(i * 2) * 2;
        if (offset > glyf.length || i && offset < offsets[i - 1]) invalid();
        offsets.push(offset);
    }
    const cache = new Map(); let decodedPoints = 0; let components = 0;
    const readGlyph = (index, ancestors = []) => {
        if (!Number.isInteger(index) || index < 0 || index >= glyphCount) invalid();
        if (ancestors.includes(index)) invalid();
        if (ancestors.length > 32) throw new Error('dwfxLimit');
        if (cache.has(index)) return cache.get(index);
        const start = offsets[index]; const end = offsets[index + 1];
        if (start === end) { const empty = Object.freeze([]); cache.set(index, empty); return empty; }
        const view = new DataView(glyf.buffer, glyf.byteOffset + start, end - start); let cursor = 0;
        const read = (size, signed = false) => {
            if (cursor + size > view.byteLength) invalid();
            const value = size === 1 ? signed ? view.getInt8(cursor) : view.getUint8(cursor) : signed ? view.getInt16(cursor) : view.getUint16(cursor);
            cursor += size; return value;
        };
        const contourCount = read(2, true);
        for (let i = 0; i < 4; i++) read(2, true);
        if (contourCount < 0) {
            const contours = []; const parentPoints = []; let more = true; let instructions = false;
            while (more) {
                if (++components > 10000) throw new Error('dwfxLimit');
                const flags = read(2); const childIndex = read(2);
                if (flags & 0xe010 || [8, 64, 128].filter(mask => flags & mask).length > 1) invalid();
                const xy = Boolean(flags & 2); const size = flags & 1 ? 2 : 1;
                const first = read(size, xy); const second = read(size, xy);
                const matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
                if (flags & 8) matrix.a = matrix.d = read(2, true) / 16384;
                else if (flags & 64) { matrix.a = read(2, true) / 16384; matrix.d = read(2, true) / 16384; }
                else if (flags & 128) {
                    matrix.a = read(2, true) / 16384; matrix.b = read(2, true) / 16384;
                    matrix.c = read(2, true) / 16384; matrix.d = read(2, true) / 16384;
                }
                const child = readGlyph(childIndex, [...ancestors, index]);
                const count = child.reduce((sum, contour) => sum + contour.length, 0);
                if (decodedPoints + count > maxPoints) throw new Error('dwfxLimit');
                if (xy) {
                    const offset = flags & 0x0800 && !(flags & 0x1000)
                        ? transformAffinePoint({ x: first, y: second }, matrix) : { x: first, y: second };
                    matrix.e = offset.x; matrix.f = offset.y;
                } else {
                    const target = parentPoints[first]; const source = child.flat()[second];
                    if (!target || !source) throw new Error('dwfxUnsupported');
                    const point = transformAffinePoint(source, matrix);
                    matrix.e = target.x - point.x; matrix.f = target.y - point.y;
                }
                for (const contour of child) {
                    const points = contour.map(point => {
                        const placed = transformAffinePoint(point, matrix);
                        if (![placed.x, placed.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1000000)) invalid();
                        return Object.freeze({ ...placed, onCurve: point.onCurve });
                    });
                    parentPoints.push(...points); contours.push(Object.freeze(points));
                }
                decodedPoints += count;
                instructions ||= Boolean(flags & 0x100); more = Boolean(flags & 0x20);
            }
            if (instructions) { const size = read(2); cursor += size; if (cursor > view.byteLength) invalid(); }
            const result = Object.freeze(contours); cache.set(index, result); return result;
        }
        if (!contourCount) { const empty = Object.freeze([]); cache.set(index, empty); return empty; }
        const ends = [];
        for (let i = 0; i < contourCount; i++) {
            const value = read(2);
            if (i && value <= ends[i - 1]) invalid();
            ends.push(value);
        }
        const count = ends.at(-1) + 1;
        if (decodedPoints + count > maxPoints) throw new Error('dwfxLimit');
        const instructions = read(2); cursor += instructions;
        if (cursor > view.byteLength) invalid();
        const flags = [];
        while (flags.length < count) {
            const flag = read(1); const repeat = flag & 8 ? read(1) + 1 : 1;
            if (flag & 128 || flags.length + repeat > count) invalid();
            for (let i = 0; i < repeat; i++) flags.push(flag);
        }
        const coordinates = (short, same) => {
            let value = 0;
            return flags.map(flag => {
                value += flag & short ? read(1) * (flag & same ? 1 : -1) : flag & same ? 0 : read(2, true);
                if (Math.abs(value) > 1000000) invalid();
                return value;
            });
        };
        const x = coordinates(2, 16); const y = coordinates(4, 32);
        let first = 0;
        const contours = Object.freeze(ends.map(last => {
            const points = [];
            for (; first <= last; first++) points.push(Object.freeze({ x: x[first], y: y[first], onCurve: Boolean(flags[first] & 1) }));
            return Object.freeze(points);
        }));
        decodedPoints += count; cache.set(index, contours); return contours;
    };
    readGlyph.yMax = index => {
        if (!Number.isInteger(index) || index < 0 || index >= glyphCount) invalid();
        const start = offsets[index]; const end = offsets[index + 1];
        if (start === end) return 0;
        if (end - start < 10) invalid();
        return new DataView(glyf.buffer, glyf.byteOffset + start, end - start).getInt16(8);
    };
    return readGlyph;
}

/** Convert implied TrueType quadratic points through the shared exact quadratic-to-cubic parser. */
export function drawingTrueTypeContoursGeometry(contours) {
    const commands = [];
    const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, onCurve: true });
    for (const points of contours) {
        if (points.length < 2) continue;
        const first = points[0]; const last = points.at(-1);
        const start = first.onCurve ? first : last.onCurve ? last : midpoint(last, first);
        const remaining = first.onCurve ? points.slice(1) : last.onCurve ? points.slice(0, -1) : [...points];
        remaining.push(start); commands.push(`M ${start.x} ${start.y}`);
        for (let i = 0; i < remaining.length; i++) {
            const point = remaining[i];
            if (point.onCurve) commands.push(`L ${point.x} ${point.y}`);
            else {
                const next = remaining[i + 1]; const end = next.onCurve ? next : midpoint(point, next);
                commands.push(`Q ${point.x} ${point.y} ${end.x} ${end.y}`);
                if (next.onCurve) i++;
            }
        }
        commands.push('Z');
    }
    return commands.length ? parseDrawingXpsGeometry(`F1 ${commands.join(' ')}`) : { paths: [], rule: 'nonzero' };
}
