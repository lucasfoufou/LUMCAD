import { resolveDrawingPackagePart } from './drawingDwfxPackage.js';

const MAX_FONT_BYTES = 16 * 1024 * 1024;
const invalid = () => { throw new Error('dwfxFont'); };
const signature = bytes => bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
const supported = value => value === 0x00010000 || value === 0x4f54544f;

/** Own and deobfuscate an embedded OpenType resource before interpreting its tables. */
export function readDrawingXpsFontResource(files, base, uri, { maxBytes = MAX_FONT_BYTES, maxTables = 256 } = {}) {
    if (![maxBytes, maxTables].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('dwfxLimit');
    if (typeof uri !== 'string') invalid();
    const components = uri.split('#');
    if (components.length > 2 || components.length === 2 && !/^\d+$/.test(components[1])) invalid();
    const faceIndex = components.length === 2 ? Number(components[1]) : 0;
    if (!Number.isSafeInteger(faceIndex)) invalid();
    const path = resolveDrawingPackagePart(base, components[0]);
    const source = files.get(path);
    if (!(source instanceof Uint8Array) || source.length < 12) invalid();
    if (source.length > Math.min(MAX_FONT_BYTES, maxBytes)) throw new Error('dwfxLimit');
    const bytes = source.slice(); let obfuscated = false;
    if (!supported(signature(bytes)) && signature(bytes) !== 0x74746366) {
        const name = path.split('/').at(-1);
        const guid = /^([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:\.[^.]*)?$/i.exec(name)?.[1];
        if (!guid || bytes.length < 32) invalid();
        const key = guid.replaceAll('-', '').match(/../g).map(value => parseInt(value, 16)).reverse();
        for (let i = 0; i < 32; i++) bytes[i] ^= key[i % 16];
        obfuscated = true;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let faceOffsets = [0]; let headerEnd = 0;
    if (signature(bytes) === 0x74746366) {
        const version = view.getUint32(4); const faces = view.getUint32(8);
        if (![0x00010000, 0x00020000].includes(version) || !faces) invalid();
        if (faces > 256) throw new Error('dwfxLimit');
        headerEnd = 12 + faces * 4 + (version === 0x00020000 ? 12 : 0);
        if (headerEnd > bytes.length) invalid();
        faceOffsets = Array.from({ length: faces }, (_, index) => view.getUint32(12 + index * 4));
        if (version === 0x00020000) {
            const position = 12 + faces * 4;
            const tag = view.getUint32(position); const length = view.getUint32(position + 4); const offset = view.getUint32(position + 8);
            if (tag === 0 ? length !== 0 || offset !== 0 : tag !== 0x44534947 || offset < headerEnd || offset + length > bytes.length) invalid();
        }
    }
    if (faceIndex >= faceOffsets.length) invalid();
    const directories = faceOffsets.map(offset => {
        if (offset % 4 || offset < headerEnd || offset + 12 > bytes.length || !supported(view.getUint32(offset))) invalid();
        const count = view.getUint16(offset + 4); const end = offset + 12 + count * 16;
        if (!count || count > Math.min(256, maxTables)) throw new Error('dwfxLimit');
        if (end > bytes.length) invalid();
        return { offset, count, end };
    });
    const ordered = [...directories].sort((a, b) => a.offset - b.offset);
    if (ordered.some((item, index) => index && item.offset < ordered[index - 1].end)) invalid();
    const directory = directories[faceIndex]; const count = directory.count;
    const tables = new Map(); let total = 0;
    for (let i = 0; i < count; i++) {
        const position = directory.offset + 12 + i * 16;
        const tag = String.fromCharCode(...bytes.subarray(position, position + 4));
        const offset = view.getUint32(position + 8); const length = view.getUint32(position + 12);
        if (!/^[\x20-\x7e]{4}$/.test(tag) || tables.has(tag) || offset % 4 || offset < headerEnd || offset + length > bytes.length
            || directories.some(item => offset < item.end && offset + Math.max(1, length) > item.offset)) invalid();
        total += length;
        if (total > MAX_FONT_BYTES * 2) throw new Error('dwfxLimit');
        tables.set(tag, { offset, length, checksum: view.getUint32(position + 4), bytes: bytes.subarray(offset, offset + length) });
    }
    return { path, bytes, tables, faceIndex, obfuscated, format: view.getUint32(directory.offset) === 0x4f54544f ? 'cff' : 'truetype' };
}

/** Horizontal metrics used by XPS glyph placement; this does not decode glyph outlines. */
export function readDrawingXpsFontMetrics(resource) {
    const table = (tag, minimum) => {
        const bytes = resource.tables.get(tag)?.bytes;
        if (!bytes || bytes.length < minimum) invalid();
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    };
    const head = table('head', 54); const maxp = table('maxp', 6); const hhea = table('hhea', 36);
    if (head.getUint32(0) !== 0x00010000 || head.getUint32(12) !== 0x5f0f3cf5
        || hhea.getUint32(0) !== 0x00010000 || ![0x00010000, 0x00005000].includes(maxp.getUint32(0))) invalid();
    const unitsPerEm = head.getUint16(18); const glyphCount = maxp.getUint16(4); const metricCount = hhea.getUint16(34);
    if (unitsPerEm < 16 || unitsPerEm > 16384 || !glyphCount || !metricCount || metricCount > glyphCount) invalid();
    const metrics = table('hmtx', metricCount * 4 + (glyphCount - metricCount) * 2);
    return { unitsPerEm, glyphCount, ascender: hhea.getInt16(4), descender: hhea.getInt16(6), lineGap: hhea.getInt16(8),
        glyph(index) {
            if (!Number.isInteger(index) || index < 0 || index >= glyphCount) invalid();
            return { advanceWidth: metrics.getUint16(Math.min(index, metricCount - 1) * 4),
                leftSideBearing: metrics.getInt16(index < metricCount ? index * 4 + 2 : metricCount * 4 + (index - metricCount) * 2) };
        } };
}

/** XPS sideways origin and advances in unscaled font units (XPS 12.1.6.1). */
export function createDrawingXpsVerticalMetrics(resource, horizontal) {
    const view = (tag, minimum) => {
        const bytes = resource.tables.get(tag)?.bytes;
        if (!bytes || bytes.length < minimum) invalid();
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    };
    let metrics = null; let count = 0;
    let originY = horizontal.ascender; let descender = Math.abs(horizontal.descender);
    if (resource.tables.has('vmtx') || resource.tables.has('vhea')) {
        const header = view('vhea', 36);
        if (![0x00010000, 0x00011000].includes(header.getUint32(0))) invalid();
        count = header.getUint16(34);
        if (!count || count > horizontal.glyphCount) invalid();
        metrics = view('vmtx', count * 4 + (horizontal.glyphCount - count) * 2);
    } else if (resource.tables.has('OS/2')) {
        const windows = view('OS/2', 72);
        originY = windows.getInt16(68);
        descender = Math.abs(windows.getInt16(70));
    }
    let verticalOrigin = null; const origins = new Map();
    if (resource.format === 'cff' && resource.tables.has('VORG')) {
        const header = view('VORG', 8); const count = header.getUint16(6);
        if (header.getUint32(0) !== 0x00010000 || count > horizontal.glyphCount || 8 + count * 4 > header.byteLength) invalid();
        verticalOrigin = header.getInt16(4);
        let previous = -1;
        for (let i = 0; i < count; i++) {
            const index = header.getUint16(8 + i * 4);
            if (index <= previous || index >= horizontal.glyphCount) invalid();
            origins.set(index, header.getInt16(10 + i * 4)); previous = index;
        }
    }
    return (index, yMax) => {
        const originX = horizontal.glyph(index).advanceWidth / 2;
        if (!Number.isFinite(yMax)) invalid();
        const top = verticalOrigin !== null ? origins.get(index) ?? verticalOrigin
            : metrics ? yMax + metrics.getInt16(index < count ? index * 4 + 2 : count * 4 + (index - count) * 2) : originY;
        const advanceWidth = metrics ? metrics.getUint16(Math.min(index, count - 1) * 4) : top + descender;
        if (advanceWidth < 0) invalid();
        return { originX, originY: top, advanceWidth };
    };
}
