import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { canEditEntity, createDrawingId } from './drawingDocument.js';
import { normalizeDrawingTextEntity } from './drawingText.js';
import { drawingShxGlyph } from './drawingShxFont.js';
import { recognizeDrawingShxGeometry } from './drawingShxRecognition.js';
import { createI18nError } from '../i18n/translator.js';

/** Replace only complete recognized geometry, through the caller's ordinary history commit. */
export function convertDrawingShxText(content, selectedIds, font, options) {
    if (selectedIds.length > 5000) throw createI18nError('shx.limit');
    const selection = new Set(selectedIds); const groups = new Map();
    for (const entity of content.entities) {
        if (!selection.has(entity.id) || !canEditEntity(content, entity)) continue;
        const key = JSON.stringify([entity.layerId, entity.color, entity.transparency, entity.lineWeight, entity.lineType]);
        const group = groups.get(key) || []; group.push(entity); groups.set(key, group);
    }
    if (!groups.size) throw createI18nError('shx.selection');
    let space = .5;
    try { const advance = drawingShxGlyph(font, 32).advance.x / font.above; if (advance > 0) space = advance; } catch { /* A missing space has no visible geometry to recognize. */ }
    const matches = []; const budget = { checks: 20000000, points: 200000 };
    try {
        for (const entities of groups.values()) {
            const result = recognizeDrawingShxGeometry(entities, font, options, budget);
            for (const match of result.matches) matches.push({ ...match, source: entities.find(entity => entity.id === match.ids[0]) });
        }
    } catch { throw createI18nError('shx.limit'); }
    if (!matches.length) throw createI18nError('shx.noMatch');
    const replacements = new Map(); const removed = new Set(); const selected = []; let characters = 0;
    const positions = new Map(content.entities.map((entity, index) => [entity.id, index]));
    for (const match of matches) {
        if (removed.has(match.ids[0])) continue;
        const run = [match]; let last = match;
        // Combine only compatible consecutive glyphs on the same baseline. Large gaps remain separate text objects.
        while (true) {
            const next = matches.filter(candidate => candidate !== last && !run.includes(candidate) && !removed.has(candidate.ids[0])
                && candidate.source.layerId === match.source.layerId && candidate.source.color === match.source.color
                && candidate.source.transparency === match.source.transparency && Math.abs(candidate.origin.y - match.origin.y) < .01
                && candidate.origin.x > last.origin.x && candidate.origin.x - (last.origin.x + last.advance) >= -.02
                && candidate.origin.x - (last.origin.x + last.advance) <= space * 4.25)
                .sort((a, b) => a.origin.x - b.origin.x)[0];
            if (!next) break;
            run.push(next); last = next;
        }
        let text = run[0].text;
        for (let index = 1; index < run.length; index++) {
            const previous = run[index - 1]; const gap = run[index].origin.x - previous.origin.x - previous.advance;
            text += ' '.repeat(Math.max(0, Math.min(4, Math.round(gap / space)))) + run[index].text;
        }
        const width = Math.max(.05, last.origin.x + Math.max(last.advance, .1) - match.origin.x);
        const radians = match.angle * Math.PI / 180; const size = match.height; const cos = Math.cos(radians); const sin = Math.sin(radians);
        const padding = .16;
        const entity = normalizeDrawingTextEntity({ id: createDrawingId('text'), type: 'text', layerId: match.source.layerId,
            x: -padding, y: -1 - padding, width: width + padding * 2, height: 1.4 + padding * 2,
            text, textMode: 'singleLine', fitWidth: true, fontSize: 1, lineHeight: 1.2, fontFamily: 'technical',
            color: match.source.color, transparency: match.source.transparency,
            affineFrame: { a: size * cos, b: size * sin, c: -size * sin || 0, d: size * cos, e: match.position.x, f: match.position.y } });
        const ids = run.flatMap(value => value.ids);
        const firstId = ids.reduce((a, b) => positions.get(a) < positions.get(b) ? a : b);
        replacements.set(firstId, entity); ids.forEach(id => removed.add(id)); selected.push(entity.id); characters += run.length;
    }
    return { content: { ...content, entities: content.entities.flatMap(entity => replacements.has(entity.id)
        ? [replacements.get(entity.id)] : removed.has(entity.id) ? [] : [entity]) }, selectedIds: selected,
    report: { characters, objects: selected.length, remaining: selectedIds.filter(id => !removed.has(id)).length } };
}

export function parseDrawingShxInput(input) {
    const tokens = tokenizeDrawingAttributeInput(input); const result = { path: null, angle: 0, threshold: 95 }; const seen = new Set();
    if (!tokens) throw createI18nError('shx.syntax');
    if (tokens.length && !['HEIGHT', 'ANGLE', 'THRESHOLD'].includes(tokens[0].toUpperCase())) result.path = tokens.shift();
    while (tokens.length) {
        const key = tokens.shift().toUpperCase();
        if (!['HEIGHT', 'ANGLE', 'THRESHOLD'].includes(key) || seen.has(key) || !tokens.length) throw createI18nError('shx.syntax');
        seen.add(key); result[key.toLowerCase()] = Number(tokens.shift());
    }
    if (!Number.isFinite(result.height) || result.height <= 1e-8 || result.height > 1e6 || !Number.isFinite(result.angle)
        || !Number.isFinite(result.threshold) || result.threshold < 80 || result.threshold > 100) throw createI18nError('shx.syntax');
    return result;
}
