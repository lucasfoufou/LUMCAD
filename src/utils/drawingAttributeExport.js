import { exportDrawingText } from './drawingTextExport.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { extractDrawingAttributes, serializeDrawingAttributeExtraction } from './drawingAttributeExtraction.js';

export async function exportDrawingAttributes(content, selectedIds, input, filterName) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) throw new Error('attributeExtractionFormat');
    let format = 'csv';
    let selection = null;
    let path = null;
    const used = new Set();
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i].toUpperCase();
        const key = ['CSV', 'JSON'].includes(token) ? 'format' : ['ALL', 'SELECTED'].includes(token) ? 'scope' : token;
        if (used.has(key)) throw new Error('attributeExtractionFormat');
        used.add(key);
        if (key === 'format') format = token.toLowerCase();
        else if (key === 'scope') selection = token === 'SELECTED' ? selectedIds : null;
        else if (token === 'TO' && tokens[i + 1]) path = tokens[++i];
        else throw new Error('attributeExtractionFormat');
    }
    const records = extractDrawingAttributes(content, { selectedIds: selection });
    if (!records.length) throw new Error('attributeExtractionEmpty');
    const text = serializeDrawingAttributeExtraction(records, format);
    return exportDrawingText({ text, format, path, name: 'attributes', filterName });
}
