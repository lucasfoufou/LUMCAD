/** Bounded readers for Autodesk's SHP/SHX stroke-font format. No font data is bundled. */
export const MAX_SHX_FONT_BYTES = 4 * 1024 * 1024;
const MAX_CODES = 1000000;
const MAX_GLYPH_STEPS = 10000;
const DIRECTIONS = [[1, 0], [1, .5], [1, 1], [.5, 1], [0, 1], [-.5, 1], [-1, 1], [-1, .5], [-1, 0], [-1, -.5], [-1, -1], [-.5, -1], [0, -1], [.5, -1], [1, -1], [1, -.5]];
const invalid = () => { throw new Error('Invalid or unsupported SHX/SHP font'); };

function reader(values, binary = false) {
    let offset = 0;
    const take = (min, max) => {
        const value = values[offset++];
        if (!Number.isInteger(value) || value < min || value > max) invalid();
        return value;
    };
    const byte = () => take(0, 255);
    return {
        byte,
        signed: () => { const value = take(binary ? 0 : -128, binary ? 255 : 127); return binary && value > 127 ? value - 256 : value; },
        octant: () => { const value = take(binary ? 0 : -127, binary ? 255 : 127); return binary && value > 127 ? -(value & 127) : value; },
        word: () => binary ? byte() + byte() * 256 : take(0, 65535),
        string: () => {
            let text = '';
            for (let value = byte(); value; value = byte()) { text += String.fromCharCode(value); if (text.length > 1024) invalid(); }
            return text;
        },
        slice: length => { if (length < 0 || offset + length > values.length) invalid(); const result = values.slice(offset, offset + length); offset += length; return result; },
        get remaining() { return values.length - offset; },
    };
}

function instructions(values, unicode, binary, budget) {
    const input = reader(values, binary); const result = [];
    while (input.remaining) {
        if (--budget.codes < 0) invalid();
        const op = input.byte(); const args = [];
        if (op === 0) { if (input.remaining) invalid(); return result; }
        if (op === 15) invalid();
        if (op === 3 || op === 4) { args.push(input.byte()); if (!args[0]) invalid(); }
        else if (op === 7) args.push(unicode ? input.word() : input.byte());
        else if (op === 8 || op === 12) { args.push(input.signed(), input.signed()); if (op === 12) args.push(input.signed()); }
        else if (op === 9 || op === 13) {
            while (true) {
                if (--budget.codes < 0) invalid();
                const x = input.signed(); const y = input.signed();
                if (!x && !y) break;
                args.push(x, y);
                if (op === 13) args.push(input.signed());
            }
        } else if (op === 10) args.push(input.byte(), input.octant());
        else if (op === 11) args.push(input.byte(), input.byte(), input.byte(), input.byte(), input.octant());
        if ((op === 12 && args[2] === -128) || (op === 13 && args.some((value, index) => index % 3 === 2 && value === -128))) invalid();
        if (op === 10 || op === 11) {
            const spec = Math.abs(args.at(-1));
            if ((spec >> 4) > 7 || (spec & 15) > 7 || !(op === 10 ? args[0] : args[2] * 256 + args[3])) invalid();
        }
        result.push({ op, args });
    }
    invalid();
}

function fontDefinition(name, data, unicode) {
    const [above, below, mode, encoding = 0, embedding = 0] = data;
    if (data.length !== (unicode ? 6 : 4) || data.at(-1) !== 0 || !Number.isInteger(above) || above <= 0 || above > 255
        || !Number.isInteger(below) || below < 0 || below > 255 || ![0, 2].includes(mode)
        || (unicode && (!Number.isInteger(encoding) || encoding !== 0 || ![0, 1, 2].includes(embedding)))) invalid();
    return { name, above, below, mode, unicode, glyphs: new Map() };
}

function addGlyph(font, code, name, data, binary, budget) {
    if (!Number.isInteger(code) || code < 1 || code > 65535 || font.glyphs.has(code) || font.glyphs.size >= 65535) invalid();
    font.glyphs.set(code, { name, instructions: instructions(data, font.unicode, binary, budget) });
}

function asciiNumber(text) {
    const value = text.trim(); const hexadecimal = /^-?0[0-9a-f]*$/i.test(value);
    if (!hexadecimal && !/^-?[1-9][0-9]*$/.test(value)) invalid();
    return parseInt(value, hexadecimal ? 16 : 10);
}

function parseAscii(text, budget) {
    const records = []; let record;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.split(';')[0].trim();
        if (!line) continue;
        if (line.startsWith('*')) {
            const match = /^\*([^,]+),\s*([0-9]+)\s*,(.*)$/.exec(line);
            if (!match) invalid();
            record = { code: match[1].trim(), name: match[3].trim(), lines: [] }; records.push(record);
            if (records.length > 65536) invalid();
        } else {
            if (!record) invalid();
            record.lines.push(line);
        }
    }
    const values = record => record.lines.join(',').replace(/[()]/g, '').split(',').filter(value => value.trim()).map(asciiNumber);
    const definition = records.shift();
    if (!definition || !['0', 'UNIFONT'].includes(definition.code)) invalid();
    const font = fontDefinition(definition.name, values(definition), definition.code === 'UNIFONT');
    for (const record of records) addGlyph(font, asciiNumber(record.code), record.name, values(record), false, budget);
    return font;
}

function parseBinary(bytes, budget) {
    const header = new TextDecoder('ascii').decode(bytes.subarray(0, 24));
    const unicode = header.startsWith('AutoCAD-86 unifont 1.0\r\n');
    if (!unicode && !/^AutoCAD-86 shapes 1\.[01]\r\n/.test(header)) invalid();
    const input = reader(bytes.subarray(unicode ? 24 : 23), true);
    if (input.byte() !== 26) invalid();
    if (unicode) {
        const count = input.word(); const zero = input.word(); const size = input.word();
        if (zero || count < 2) invalid();
        const definition = reader(input.slice(size), true); const name = definition.string();
        const font = fontDefinition(name, Array.from(definition.slice(definition.remaining)), true);
        for (let index = 1; index < count; index++) {
            const code = input.word(); const size = input.word(); const record = reader(input.slice(size), true);
            addGlyph(font, code, record.string(), record.slice(record.remaining), true, budget);
        }
        if (input.remaining) invalid();
        return font;
    }
    const first = input.word(); const last = input.word(); const count = input.word(); const entries = [];
    for (let index = 0; index < count; index++) entries.push([input.word(), input.word()]);
    if (entries[0]?.[0] !== first || entries.at(-1)?.[0] !== last || first !== 0) invalid();
    const records = entries.map(([code, size]) => {
        const record = reader(input.slice(size), true); const name = record.string();
        return { code, name, data: record.slice(record.remaining) };
    });
    const definition = records.shift(); const font = fontDefinition(definition.name, Array.from(definition.data), false);
    for (const record of records) addGlyph(font, record.code, record.name, record.data, true, budget);
    if (input.remaining !== 3 || input.byte() !== 69 || input.byte() !== 79 || input.byte() !== 70) invalid();
    return font;
}

export function parseDrawingShxFont(source) {
    const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source;
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_SHX_FONT_BYTES) invalid();
    const budget = { codes: MAX_CODES };
    const font = bytes[0] === 65 ? parseBinary(bytes, budget) : parseAscii(new TextDecoder().decode(bytes), budget);
    if (!font.glyphs.size) invalid();
    return font;
}

/** Native line/arc geometry in font units, with a baseline advance. Subshapes share drawing state. */
export function drawingShxGlyph(font, code, { vertical = false } = {}) {
    const parts = []; const stack = []; const active = new Set();
    let x = 0; let y = 0; let scale = 1; let pen = true; let remaining = MAX_GLYPH_STEPS;
    const bounded = (...values) => { if (!values.every(value => Number.isFinite(value) && Math.abs(value) <= 1e6)) invalid(); };
    const move = (dx, dy) => {
        const nx = x + dx * scale; const ny = y + dy * scale; bounded(nx, ny);
        if (pen && (Math.abs(nx - x) > 1e-12 || Math.abs(ny - y) > 1e-12)) parts.push({ type: 'line', x1: x, y1: y, x2: nx, y2: ny });
        x = nx; y = ny;
    };
    const arc = (r, startAngle, sweep) => {
        const cx = x - r * Math.cos(startAngle); const cy = y - r * Math.sin(startAngle);
        const endAngle = startAngle + sweep; const nx = cx + r * Math.cos(endAngle); const ny = cy + r * Math.sin(endAngle);
        bounded(cx, cy, r, nx, ny);
        if (pen && Math.abs(sweep) > 1e-12) parts.push({ type: 'arc', cx, cy, r, startAngle, endAngle, counterClockwise: sweep > 0, fullCircle: Math.abs(Math.abs(sweep) - 2 * Math.PI) < 1e-10 });
        x = nx; y = ny;
    };
    const bulge = (dx, dy, value) => {
        if (!pen || !value || (!dx && !dy)) { move(dx, dy); return; }
        const bx = dx * scale; const by = dy * scale; const b = value / 127;
        const offset = (1 - b * b) / (4 * b);
        const cx = x + bx / 2 - by * offset; const cy = y + by / 2 + bx * offset;
        arc(Math.hypot(x - cx, y - cy), Math.atan2(y - cy, x - cx), 4 * Math.atan(b));
    };
    const draw = number => {
        if (active.has(number) || active.size >= 16) invalid();
        const glyph = font.glyphs.get(number); if (!glyph) invalid();
        active.add(number); let skip = false;
        for (const { op, args } of glyph.instructions) {
            if (--remaining < 0) invalid();
            if (skip) { skip = false; continue; }
            if (op >= 16) { const [dx, dy] = DIRECTIONS[op & 15]; move(dx * (op >> 4), dy * (op >> 4)); }
            else if (op === 1) pen = true;
            else if (op === 2) pen = false;
            else if (op === 3 || op === 4) { scale = op === 3 ? scale / args[0] : scale * args[0]; bounded(scale); if (scale < 1e-12) invalid(); }
            else if (op === 5) { if (stack.length >= 4) invalid(); stack.push({ x, y }); }
            else if (op === 6) { const point = stack.pop(); if (!point) invalid(); x = point.x; y = point.y; }
            else if (op === 7) draw(args[0]);
            else if (op === 8) move(...args);
            else if (op === 9 || op === 13) {
                const stride = op === 9 ? 2 : 3;
                for (let index = 0; index < args.length; index += stride) {
                    if (--remaining < 0) invalid();
                    if (op === 9) move(args[index], args[index + 1]); else bulge(args[index], args[index + 1], args[index + 2]);
                }
            } else if (op === 12) bulge(...args);
            else if (op === 10 || op === 11) {
                const spec = args.at(-1); const sign = spec < 0 ? -1 : 1; const start = Math.abs(spec) >> 4; const span = (Math.abs(spec) & 15) || 8;
                const unit = Math.PI / 4;
                if (op === 10) arc(args[0] * scale, start * unit, sign * span * unit);
                else {
                    const startOffset = args[0] / 256; const endOffset = (args[1] || 256) / 256;
                    const sweep = span - 1 + endOffset - startOffset;
                    if (sweep <= 0 || sweep > 8) invalid();
                    arc((args[2] * 256 + args[3]) * scale, (start + sign * startOffset) * unit, sign * sweep * unit);
                }
            } else if (op === 14 && !vertical) skip = true;
        }
        if (skip) invalid();
        active.delete(number);
    };
    draw(code);
    if (stack.length) invalid();
    return { parts, advance: { x, y } };
}
