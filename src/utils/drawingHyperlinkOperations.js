import { canEditEntity } from './drawingDocument.js';
import { normalizeDrawingHyperlink } from './drawingHyperlinks.js';

export function setDrawingHyperlink(content, selectedIds, link) {
    const ids = new Set(selectedIds);
    const selected = content.entities.filter(entity => ids.has(entity.id));
    if (!selected.length || selected.length !== ids.size || selected.some(entity => !canEditEntity(content, entity))) throw new Error('selection');
    const normalized = link === null ? null : normalizeDrawingHyperlink(link);
    if (link !== null && !normalized) throw new Error('url');
    let changed = false;
    const entities = content.entities.map(entity => {
        if (!ids.has(entity.id)) return entity;
        if (JSON.stringify(entity.hyperlink || null) === JSON.stringify(normalized)) return entity;
        changed = true;
        const next = { ...entity };
        if (normalized) next.hyperlink = { ...normalized };
        else delete next.hyperlink;
        return next;
    });
    return changed ? { ...content, entities } : content;
}
