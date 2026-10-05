// Session-only view state. The symbol cannot be serialized into an .lcad file.
const HIDDEN_OBJECT_IDS = Symbol('hiddenDrawingObjectIds');

export function drawingContentWithHiddenObjects(content, ids) {
    return ids.length ? { ...content, [HIDDEN_OBJECT_IDS]: new Set([...(content[HIDDEN_OBJECT_IDS] || []), ...ids]) } : content;
}

export function withoutDrawingObjectVisibility(content) {
    if (!content?.[HIDDEN_OBJECT_IDS]) return content;
    const { [HIDDEN_OBJECT_IDS]: ignored, ...persistent } = content;
    return persistent;
}

export function isDrawingObjectHidden(content, id) {
    return content?.[HIDDEN_OBJECT_IDS]?.has(id) || false;
}

export function updateDrawingObjectVisibility(content, previousIds, selectedIds, mode) {
    if (mode === 'show') return [];
    const selected = new Set(selectedIds);
    const validIds = new Set(content.entities.map(entity => entity.id));
    const hidden = new Set(previousIds.filter(id => validIds.has(id)));
    if (mode === 'hide') selected.forEach(id => { if (validIds.has(id)) hidden.add(id); });
    else if (mode === 'isolate') content.entities.forEach(entity => { if (!selected.has(entity.id)) hidden.add(entity.id); });
    return [...hidden];
}
