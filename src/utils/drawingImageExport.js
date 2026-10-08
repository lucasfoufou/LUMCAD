import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';

export function parseDrawingImageExport(input, format) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens || !['png', 'jpg', 'svg'].includes(format)) throw new Error('syntax');
    const options = { format, path: null, width: 2048, background: format === 'jpg' ? '#ffffff' : 'transparent', quality: .92 };
    const used = new Set();
    while (tokens.length) {
        const key = tokens.shift().toUpperCase(); const value = tokens.shift();
        if (!value || used.has(key)) throw new Error('syntax');
        used.add(key);
        if (key === 'TO') options.path = value;
        else if (key === 'WIDTH') options.width = Number(value);
        else if (key === 'BACKGROUND') options.background = value.toLowerCase();
        else if (key === 'QUALITY' && format === 'jpg') options.quality = Number(value);
        else throw new Error('syntax');
    }
    if (!Number.isInteger(options.width) || options.width < 64 || options.width > 4096
        || !Number.isFinite(options.quality) || options.quality < .1 || options.quality > 1
        || !/^#[0-9a-f]{6}$/i.test(options.background) && !(format !== 'jpg' && options.background === 'transparent')
        || options.path && !new RegExp(`\\.${format === 'jpg' ? 'jpe?g' : format}$`, 'i').test(options.path)) throw new Error('syntax');
    return options;
}

export function drawingImageExportBytes(result, format) {
    const bytes = format === 'svg' ? new TextEncoder().encode(result.text)
        : Uint8Array.from(atob(result.dataUrl.split(',')[1]), char => char.charCodeAt(0));
    if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error('limit');
    return bytes;
}
