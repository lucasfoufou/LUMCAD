import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';

export function parseDrawingDwfAttachInput(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens || tokens.some(token => !token.trim())) throw new Error('dwfxSyntax');
    const result = { path: null, pageNumber: 1, x: 0, y: 0, scale: 1 }; const used = new Set();
    if (tokens.length && !['PAGE', 'AT', 'SCALE'].includes(tokens[0].toUpperCase())) result.path = tokens.shift();
    while (tokens.length) {
        const option = tokens.shift().toUpperCase();
        if (used.has(option)) throw new Error('dwfxSyntax');
        used.add(option);
        const size = option === 'AT' ? 2 : ['PAGE', 'SCALE'].includes(option) ? 1 : 0;
        if (!size || tokens.length < size) throw new Error('dwfxSyntax');
        const values = tokens.splice(0, size).map(Number);
        if (!values.every(Number.isFinite)) throw new Error('dwfxSyntax');
        if (option === 'PAGE') result.pageNumber = values[0];
        else if (option === 'SCALE') result.scale = values[0];
        else [result.x, result.y] = values;
    }
    if (!Number.isInteger(result.pageNumber) || result.pageNumber < 1 || result.pageNumber > 10000
        || result.scale <= 0 || result.scale > 1e9 || Math.abs(result.x) > 1e9 || Math.abs(result.y) > 1e9) throw new Error('dwfxSyntax');
    return result;
}
