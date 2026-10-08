import { parseDrawingXpsGeometry } from './drawingXpsGeometry.js';

const invalid = () => { throw new Error('dwfxFont'); };
const bias = count => count < 1240 ? 107 : count < 33900 ? 1131 : 32768;

/** Bounded, unhinted Type 2 path interpretation. Hint bytes are data, not executed code. */
export function createDrawingCffOutlineReader(font, { maxOperations = 1000000, maxParts = 100000 } = {}) {
    if (![maxOperations, maxParts].every(value => Number.isSafeInteger(value) && value > 0 && value <= 1000000)) invalid();
    const cache = new Map(); let operations = 0; let parts = 0;
    return index => {
        if (!Number.isInteger(index) || index < 0 || index >= font.charStrings.length) invalid();
        if (cache.has(index)) return cache.get(index);
        const localSubrs = font.fontDicts ? font.fontDicts[font.fdSelect[index]].localSubrs : font.localSubrs;
        let x = 0; let y = 0; let open = false; let widthSeen = false; let stems = 0;
        const stack = []; const path = []; const transient = new Map();
        let randomState = (index + 1) >>> 0;
        const push = value => {
            if (!Number.isFinite(value) || Math.abs(value) > 1e9 || stack.length >= 48) invalid();
            stack.push(value);
        };
        const pop = () => { if (!stack.length) invalid(); return stack.pop(); };
        const address = value => { if (!Number.isInteger(value) || value < 0 || value >= 32) invalid(); return value; };
        const calculate = op => {
            if ([3, 4, 10, 11, 12, 15, 24].includes(op)) {
                const b = pop(); const a = pop();
                if (op === 3) push(Number(Boolean(a) && Boolean(b)));
                if (op === 4) push(Number(Boolean(a) || Boolean(b)));
                if (op === 10) push(a + b);
                if (op === 11) push(a - b);
                if (op === 12) push(a / b);
                if (op === 15) push(Number(a === b));
                if (op === 24) push(a * b);
            } else if ([5, 9, 14, 26].includes(op)) {
                const value = pop();
                push(op === 5 ? Number(!value) : op === 9 ? Math.abs(value) : op === 14 ? -value : Math.sqrt(value));
            } else if (op === 18) pop();
            else if (op === 20) { const i = address(pop()); transient.set(i, pop()); }
            else if (op === 21) {
                const i = address(pop()); if (!transient.has(i)) invalid(); push(transient.get(i));
            } else if (op === 22) {
                const v2 = pop(); const v1 = pop(); const s2 = pop(); const s1 = pop(); push(v1 <= v2 ? s1 : s2);
            } else if (op === 23) {
                // Repeatable per-glyph pseudo-random sequence in the Type 2 interval (0, 1].
                randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
                push((randomState + 1) / 4294967296);
            } else if (op === 27) { const value = pop(); push(value); push(value); }
            else if (op === 28) { const b = pop(); const a = pop(); push(b); push(a); }
            else if (op === 29) {
                const i = pop(); if (!Number.isInteger(i) || !stack.length || i >= stack.length) invalid();
                push(stack[stack.length - 1 - Math.max(0, i)]);
            } else if (op === 30) {
                const shift = pop(); const count = pop();
                if (!Number.isInteger(count) || count < 0 || count > stack.length || !Number.isInteger(shift)) invalid();
                if (count) {
                    const amount = ((shift % count) + count) % count;
                    const values = stack.splice(stack.length - count);
                    stack.push(...values.slice(count - amount), ...values.slice(0, count - amount));
                }
            } else return false;
            return true;
        };
        const point = (dx, dy) => {
            x += dx; y += dy;
            if (![x, y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) invalid();
            return `${x} ${y}`;
        };
        const emit = value => { if (++parts > maxParts) throw new Error('dwfxLimit'); path.push(value); };
        const close = () => { if (open) { emit('Z'); open = false; } };
        const move = (dx, dy) => { close(); emit(`M${point(dx, dy)}`); open = true; };
        const line = (dx, dy) => { if (!open) invalid(); emit(`L${point(dx, dy)}`); };
        const curve = (a, b, c, d, e, f) => {
            if (!open) invalid();
            emit(`C${point(a, b)} ${point(c, d)} ${point(e, f)}`);
        };
        const width = count => {
            if (!widthSeen && stack.length === count + 1) stack.shift();
            widthSeen = true;
            if (stack.length !== count) invalid();
        };
        const hints = () => {
            if (!widthSeen && stack.length % 2) stack.shift();
            widthSeen = true;
            if (stack.length % 2) invalid();
            stems += stack.length / 2; stack.length = 0;
            if (stems > 96) invalid();
        };
        const run = (bytes, depth = 0) => {
            if (!(bytes instanceof Uint8Array) || depth > 10) invalid();
            let cursor = 0;
            const next = () => {
                if (cursor >= bytes.length) invalid();
                if (++operations > maxOperations) throw new Error('dwfxLimit');
                return bytes[cursor++];
            };
            while (cursor < bytes.length) {
                const op = next();
                if (op >= 32 && op <= 246) { push(op - 139); continue; }
                if (op >= 247 && op <= 250) { push((op - 247) * 256 + next() + 108); continue; }
                if (op >= 251 && op <= 254) { push(-(op - 251) * 256 - next() - 108); continue; }
                if (op === 28) { const n = next() * 256 + next(); push(n >= 32768 ? n - 65536 : n); continue; }
                if (op === 255) {
                    let n = 0; for (let i = 0; i < 4; i++) n = n * 256 + next();
                    push((n >= 2147483648 ? n - 4294967296 : n) / 65536); continue;
                }
                if (op === 10 || op === 29) {
                    const subrs = op === 10 ? localSubrs : font.globalSubrs;
                    const operand = stack.pop(); const sub = operand + bias(subrs.length);
                    if (!Number.isInteger(operand) || sub < 0 || sub >= subrs.length) invalid();
                    if (run(subrs[sub], depth + 1) === 'end') { if (cursor !== bytes.length) invalid(); return 'end'; }
                    continue;
                }
                if (op === 11) { if (!depth || cursor !== bytes.length) invalid(); return 'return'; }
                if (op === 14) {
                    if (stack.length >= 4) throw new Error('dwfxUnsupported');
                    width(0); close();
                    if (cursor !== bytes.length) invalid();
                    return 'end';
                }
                if ([1, 3, 18, 23, 19, 20].includes(op)) {
                    hints();
                    if (op === 19 || op === 20) for (let i = 0; i < Math.ceil(stems / 8); i++) next();
                    continue;
                }
                if ([4, 21, 22].includes(op)) {
                    width(op === 21 ? 2 : 1);
                    move(op === 4 ? 0 : stack[0], op === 22 ? 0 : stack.at(-1));
                    stack.length = 0; continue;
                }
                const escaped = op === 12 ? next() : null;
                if (escaped !== null && calculate(escaped)) continue;
                const args = stack.splice(0);
                if (op === 5) {
                    if (!args.length || args.length % 2) invalid();
                    for (let i = 0; i < args.length; i += 2) line(args[i], args[i + 1]);
                } else if (op === 6 || op === 7) {
                    if (!args.length) invalid();
                    let horizontal = op === 6;
                    for (const value of args) { line(horizontal ? value : 0, horizontal ? 0 : value); horizontal = !horizontal; }
                } else if (op === 8) {
                    if (!args.length || args.length % 6) invalid();
                    for (let i = 0; i < args.length; i += 6) curve(...args.slice(i, i + 6));
                } else if (op === 24 || op === 25) {
                    const tail = op === 24 ? 2 : 6; const stride = op === 24 ? 6 : 2;
                    if (args.length < tail + stride || (args.length - tail) % stride) invalid();
                    for (let i = 0; i < args.length - tail; i += stride) {
                        if (op === 24) curve(...args.slice(i, i + 6)); else line(args[i], args[i + 1]);
                    }
                    if (op === 24) line(...args.slice(-2)); else curve(...args.slice(-6));
                } else if (op === 26 || op === 27) {
                    if (args.length < 4 || ![0, 1].includes(args.length % 4)) invalid();
                    const horizontal = op === 27; let extra = args.length % 4 ? args.shift() : 0;
                    for (let i = 0; i < args.length; i += 4) {
                        const [a, b, c, d] = args.slice(i, i + 4);
                        if (horizontal) curve(a, extra, b, c, d, 0); else curve(extra, a, b, c, 0, d);
                        extra = 0;
                    }
                } else if (op === 30 || op === 31) {
                    if (args.length < 4 || ![0, 1].includes(args.length % 4)) invalid();
                    let horizontal = op === 31;
                    while (args.length >= 4) {
                        const [a, b, c, d] = args.splice(0, 4); const extra = args.length === 1 ? args.shift() : 0;
                        if (horizontal) curve(a, 0, b, c, extra, d); else curve(0, a, b, c, d, extra);
                        horizontal = !horizontal;
                    }
                } else if (op === 12) {
                    if (escaped === 34 && args.length === 7) {
                        const [a, b, c, d, e, f, g] = args;
                        curve(a, 0, b, c, d, 0); curve(e, 0, f, -c, g, 0);
                    } else if (escaped === 35 && args.length === 13) {
                        curve(...args.slice(0, 6)); curve(...args.slice(6, 12));
                    } else if (escaped === 36 && args.length === 9) {
                        const [a, b, c, d, e, f, g, h, i] = args;
                        curve(a, b, c, d, e, 0); curve(f, 0, g, h, i, -b - d - h);
                    } else if (escaped === 37 && args.length === 11) {
                        const dx = args[0] + args[2] + args[4] + args[6] + args[8];
                        const dy = args[1] + args[3] + args[5] + args[7] + args[9];
                        curve(...args.slice(0, 6));
                        curve(...args.slice(6, 10), Math.abs(dx) > Math.abs(dy) ? args[10] : -dx, Math.abs(dx) > Math.abs(dy) ? -dy : args[10]);
                    } else throw new Error('dwfxUnsupported');
                } else throw new Error('dwfxUnsupported');
            }
            invalid();
        };
        if (run(font.charStrings[index]) !== 'end') invalid();
        const result = path.length ? parseDrawingXpsGeometry(`F1 ${path.join(' ')}`) : { paths: [], rule: 'nonzero' };
        cache.set(index, result);
        return result;
    };
}
