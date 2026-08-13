const DEFAULT_FONT_SIZE = 0.35;

export function getDrawingTextLayout(entity) {
    const x = Math.min(entity.x, entity.x + entity.width);
    const y = Math.min(entity.y, entity.y + entity.height);
    const width = Math.abs(entity.width);
    const height = Math.abs(entity.height);
    const fontSize = Math.max(0.01, Number(entity.fontSize) || DEFAULT_FONT_SIZE);
    const padding = Math.min(fontSize * 0.16, width / 2, height / 2);
    const lineHeight = fontSize * 1.2;
    const lines = wrapDrawingText(entity.text || '', Math.max(0, width - padding * 2), fontSize);
    const blockHeight = lines.length ? lines.length * lineHeight : 0;
    const horizontalAlign = ['center', 'right'].includes(entity.horizontalAlign) ? entity.horizontalAlign : 'left';
    const verticalAlign = ['middle', 'bottom'].includes(entity.verticalAlign) ? entity.verticalAlign : 'top';
    const textX = horizontalAlign === 'center' ? x + width / 2 : horizontalAlign === 'right' ? x + width - padding : x + padding;
    const textAnchor = horizontalAlign === 'center' ? 'middle' : horizontalAlign === 'right' ? 'end' : 'start';
    const blockTop = verticalAlign === 'middle'
        ? y + (height - blockHeight) / 2
        : verticalAlign === 'bottom'
            ? y + height - padding - blockHeight
            : y + padding;
    // WebKit does not consistently honour SVG's `dominant-baseline="hanging"`.
    // Persist an explicit alphabetic baseline instead so the glyph ascent never
    // sits above the clipping rectangle, regardless of browser or font size.
    const firstBaseline = blockTop + fontSize;
    return { x, y, width, height, fontSize, lineHeight, lines, textX, textAnchor, blockTop, firstBaseline };
}

export function wrapDrawingText(text, availableWidth, fontSize) {
    const maxCharacters = Math.max(1, Math.floor(availableWidth / Math.max(0.01, fontSize * 0.56)));
    return String(text).split('\n').flatMap(paragraph => wrapParagraph(paragraph, maxCharacters));
}

function wrapParagraph(paragraph, maxCharacters) {
    if (!paragraph) return [''];
    const lines = [];
    let current = '';
    paragraph.split(/\s+/).forEach(word => {
        const pieces = splitLongWord(word, maxCharacters);
        pieces.forEach(piece => {
            const candidate = current ? `${current} ${piece}` : piece;
            if (candidate.length <= maxCharacters) current = candidate;
            else {
                if (current) lines.push(current);
                current = piece;
            }
        });
    });
    if (current || !lines.length) lines.push(current);
    return lines;
}

function splitLongWord(word, maxCharacters) {
    if (word.length <= maxCharacters) return [word];
    const pieces = [];
    for (let index = 0; index < word.length; index += maxCharacters) pieces.push(word.slice(index, index + maxCharacters));
    return pieces;
}
