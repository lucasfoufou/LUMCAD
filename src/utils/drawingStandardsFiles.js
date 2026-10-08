import { readDrawingJsonFile } from './drawingJsonFiles.js';
import { parseDrawingStandards } from './drawingStandards.js';
import { exportDrawingText } from './drawingTextExport.js';

export async function readDrawingStandardsFile(path, filterName) {
    const loaded = await readDrawingJsonFile(path, filterName, 'standards');
    return loaded ? { standard: parseDrawingStandards(loaded.text), path: loaded.path } : null;
}

export async function writeDrawingStandardsFile(standard, path, filterName) {
    const validated = parseDrawingStandards(standard);
    return exportDrawingText({ text: JSON.stringify(validated, null, 2), format: 'json', path, name: 'drawing-standards', filterName });
}
