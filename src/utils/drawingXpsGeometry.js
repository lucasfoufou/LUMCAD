import { parseSvgPath } from './drawingClipboard.js';

/** XPS abbreviated geometry shares SVG segments, with an optional leading fill rule. */
export function parseDrawingXpsGeometry(input) {
    if (typeof input !== 'string') throw new Error('dwfxGeometry');
    const fill = /^\s*F\s*([01])(?=\s|[Mm])/.exec(input);
    const data = fill ? input.slice(fill[0].length) : input;
    if (!/^\s*[Mm]/.test(data)) throw new Error('dwfxGeometry');
    try {
        const entities = parseSvgPath(data);
        return { rule: fill?.[1] === '1' ? 'nonzero' : 'evenodd',
            paths: entities.map(entity => entity.type === 'polyline'
                ? { parts: entity.parts, closed: entity.closed } : { parts: [entity], closed: false }) };
    } catch { throw new Error('dwfxGeometry'); }
}
