import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { resolveDrawingDgnUnits } from './drawingDgnUnits.js';
import { readDrawingInterchangeFile } from './drawingInterchangeFiles.js';

export function parseDrawingDgnInput(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) throw new Error('dgnSyntax');
    const result = { path: null, unit: null, x: 0, y: 0, scale: 1, cellMode: 'blocks' }; const used = new Set();
    if (tokens.length && !['UNIT', 'AT', 'SCALE', 'CELLS'].includes(tokens[0].toUpperCase())) result.path = tokens.shift();
    const number = () => {
        const token = tokens.shift();
        if (!token || !token.trim()) throw new Error('dgnSyntax');
        return Number(token);
    };
    while (tokens.length) {
        const option = tokens.shift().toUpperCase();
        if (used.has(option)) throw new Error('dgnSyntax');
        used.add(option);
        if (option === 'AT') { result.x = number(); result.y = number(); }
        else if (option === 'SCALE') result.scale = number();
        else if (option === 'CELLS' && tokens.length) {
            result.cellMode = tokens.shift().toLowerCase();
            if (!['blocks', 'explode'].includes(result.cellMode)) throw new Error('dgnSyntax');
        }
        else if (option === 'UNIT' && tokens.length) {
            try { result.unit = resolveDrawingDgnUnits(null, tokens.shift()).unit; }
            catch { throw new Error('dgnSyntax'); }
        } else throw new Error('dgnSyntax');
    }
    if (![result.x, result.y, result.scale].every(Number.isFinite) || Math.abs(result.x) > 1e9 || Math.abs(result.y) > 1e9
        || result.scale <= 0 || result.scale > 1e9) throw new Error('dgnSyntax');
    return result;
}

export const readDrawingDgnFile = (path, filterName) => readDrawingInterchangeFile(path, filterName, 'dgn');
