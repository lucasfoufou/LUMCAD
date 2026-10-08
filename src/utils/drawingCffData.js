import { readDrawingCffSelectors } from './drawingCffSelectors.js';
import { multiplyAffineMatrices, normalizeAffineMatrix } from './drawingAffine.js';

const invalid = () => { throw new Error('dwfxFont'); };

/** CFF 1 INDEX objects use one-based offsets of one to four bytes. */
export function readDrawingCffIndex(bytes, offset = 0) {
    if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(offset) || offset < 0 || offset + 2 > bytes.length) invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint16(offset); let cursor = offset + 2;
    if (!count) return { entries: [], end: cursor };
    const size = bytes[cursor++];
    if (!(size >= 1 && size <= 4) || cursor + (count + 1) * size > bytes.length) invalid();
    const dataStart = cursor + (count + 1) * size;
    const offsets = [];
    for (let i = 0; i <= count; i++) {
        let value = 0;
        for (let j = 0; j < size; j++) value = value * 256 + bytes[cursor++];
        if (i === 0 && value !== 1 || value < 1 || dataStart + value - 1 > bytes.length
            || i && value < offsets[i - 1]) invalid();
        offsets.push(value);
    }
    return { entries: offsets.slice(0, -1).map((value, i) => bytes.subarray(dataStart + value - 1, dataStart + offsets[i + 1] - 1)),
        end: dataStart + offsets[count] - 1 };
}

/** Parse operands and operator keys without evaluating PostScript or charstrings. */
export function readDrawingCffDict(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > 65535) invalid();
    let cursor = 0; let operands = []; const result = new Map();
    const next = () => { if (cursor >= bytes.length) invalid(); return bytes[cursor++]; };
    const push = value => {
        if (!Number.isFinite(value) || operands.length >= 48) invalid();
        operands.push(value);
    };
    while (cursor < bytes.length) {
        const byte = next();
        if (byte >= 32 && byte <= 246) push(byte - 139);
        else if (byte >= 247 && byte <= 250) push((byte - 247) * 256 + next() + 108);
        else if (byte >= 251 && byte <= 254) push(-(byte - 251) * 256 - next() - 108);
        else if (byte === 28) { const n = next() * 256 + next(); push(n >= 32768 ? n - 65536 : n); }
        else if (byte === 29) { let n = 0; for (let i = 0; i < 4; i++) n = n * 256 + next(); push(n >= 2147483648 ? n - 4294967296 : n); }
        else if (byte === 30) {
            let text = ''; let done = false;
            while (!done) {
                const pair = next();
                for (const nibble of [pair >> 4, pair & 15]) {
                    if (nibble === 15) { done = true; break; }
                    if (nibble === 13) invalid();
                    text += nibble <= 9 ? String(nibble) : ({ 10: '.', 11: 'e', 12: 'e-', 14: '-' })[nibble];
                    if (text.length > 64) invalid();
                }
            }
            if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?$/.test(text)) invalid();
            push(Number(text));
        } else if (byte <= 21) {
            const key = byte === 12 ? `12 ${next()}` : String(byte);
            if (result.has(key)) invalid();
            result.set(key, operands); operands = [];
        } else invalid();
    }
    if (operands.length) invalid();
    return result;
}

/** Locate the Type 2 programs and subroutines of an OpenType CFF 1 font. */
export function readDrawingCffData(resource, glyphCount) {
    const bytes = resource.tables.get('CFF ')?.bytes;
    if (!bytes || bytes.length < 4 || bytes[0] !== 1 || bytes[1] !== 0 || bytes[2] < 4 || bytes[2] > bytes.length
        || bytes[3] < 1 || bytes[3] > 4 || !Number.isInteger(glyphCount) || glyphCount < 1 || glyphCount > 65535) invalid();
    const names = readDrawingCffIndex(bytes, bytes[2]);
    const tops = readDrawingCffIndex(bytes, names.end);
    const strings = readDrawingCffIndex(bytes, tops.end);
    const globals = readDrawingCffIndex(bytes, strings.end);
    if (names.entries.length !== 1 || tops.entries.length !== 1) invalid();
    const top = readDrawingCffDict(tops.entries[0]);
    const cid = top.has('12 30');
    if (cid && (top.get('12 30').length !== 3 || !top.get('12 30').every(value => Number.isInteger(value) && value >= 0))) invalid();
    if (top.has('12 6') && (top.get('12 6').length !== 1 || top.get('12 6')[0] !== 2)) invalid();
    const location = (value, minimum = globals.end) => {
        if (!Number.isSafeInteger(value) || value < minimum || value >= bytes.length) invalid();
        return value;
    };
    const charStringOffset = top.get('17');
    if (charStringOffset?.length !== 1) invalid();
    const charStrings = readDrawingCffIndex(bytes, location(charStringOffset[0]));
    if (charStrings.entries.length !== glyphCount) invalid();
    const privateData = dict => {
        let privateDict = new Map(); let subrs = [];
        if (dict.has('18')) {
            const values = dict.get('18');
            if (values.length !== 2 || !Number.isSafeInteger(values[0]) || values[0] < 0) invalid();
            const [size, start] = values;
            location(start);
            if (start + size > bytes.length) invalid();
            privateDict = readDrawingCffDict(bytes.subarray(start, start + size));
            if (privateDict.has('19')) {
                const offset = privateDict.get('19');
                if (offset.length !== 1) invalid();
                subrs = readDrawingCffIndex(bytes, location(start + offset[0], start + size)).entries;
            }
        }
        return { privateDict, localSubrs: subrs };
    };
    const matrix = top.get('12 7') || [.001, 0, 0, .001, 0, 0];
    if (matrix.length !== 6 || !matrix.every(Number.isFinite)) invalid();
    const result = { charStrings: charStrings.entries, globalSubrs: globals.entries, ...privateData(top), matrix };
    if (cid) {
        if (top.get('12 36')?.length !== 1 || top.get('12 37')?.length !== 1) invalid();
        const array = readDrawingCffIndex(bytes, location(top.get('12 36')[0]));
        if (!array.entries.length || array.entries.length > 256) throw new Error('dwfxLimit');
        result.fontDicts = array.entries.map(entry => {
            const dict = readDrawingCffDict(entry);
            const own = dict.get('12 7') || [1, 0, 0, 1, 0, 0];
            if (own.length !== 6 || !own.every(Number.isFinite)) invalid();
            return { ...privateData(dict), matrix: Object.values(multiplyAffineMatrices(normalizeAffineMatrix(matrix), normalizeAffineMatrix(own))) };
        });
        result.fdSelect = readDrawingCffSelectors(bytes, location(top.get('12 37')[0]), glyphCount, result.fontDicts.length);
    }
    return result;
}
