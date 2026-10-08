import { refreshDrawingQuantityTables } from './drawingQuantityTables.js';
import { applyCurrentStyleToNewDimensions } from './drawingDimensionStyles.js';
import { refreshDrawingHatches } from './drawingHatches.js';
import { refreshPathArrays } from './drawingPathArray.js';
import { prepareDrawingConstraintEdit } from './drawingConstraintEditing.js';

const HISTORY_LIMIT = 100;

export function undoDrawingHistoryState(current) {
    if (!current.past.length) return current;
    return { past: current.past.slice(0, -1), present: current.past.at(-1),
        future: [current.present, ...current.future], coalesceKey: null, rejection: null };
}

export function redoDrawingHistoryState(current) {
    if (!current.future.length) return current;
    return { past: [...current.past, current.present].slice(-HISTORY_LIMIT), present: current.future[0],
        future: current.future.slice(1), coalesceKey: null, rejection: null };
}

/** A rejected edit leaves past, present, future and coalescing untouched. */
export function commitDrawingHistoryState(current, next, { coalesceKey = null, applyCreationStyles = true, preserveConstraintSnapshot = false } = {}) {
    if (!next || next === current.present) return current;
    const previousContent = current.present.content || current.present;
    const nextContent = next.content || next;
    let content = nextContent;
    if (nextContent !== previousContent) {
        const prepared = preserveConstraintSnapshot ? { content: nextContent } : prepareDrawingConstraintEdit(previousContent, nextContent);
        if (prepared.error) return { ...current, rejection: { kind: 'constraint', code: prepared.error,
            constraintIds: prepared.constraintIds || [], revision: (current.rejection?.revision || 0) + 1 } };
        content = refreshDrawingHatches(refreshPathArrays(
            applyCreationStyles ? applyCurrentStyleToNewDimensions(prepared.content, previousContent) : prepared.content,
            previousContent), previousContent);
        content = refreshDrawingQuantityTables(content);
    }
    return {
        past: coalesceKey && current.coalesceKey === coalesceKey ? current.past : [...current.past, current.present].slice(-HISTORY_LIMIT),
        present: next.content ? { ...(current.present.content ? current.present : {}), ...next, content } : content,
        future: [], coalesceKey, rejection: null,
    };
}


/** Keep ordinary metadata setters independent of undo, while explicit document
 * commits can snapshot them. Asset-cache additions retain historical versions
 * of unrelated IDs instead of overwriting every snapshot with today's cache.
 */
export function updateDrawingHistoryMetadata(current, field, updater) {
    if (!current.present.content || !['name', 'assets'].includes(field)) return current;
    const previous = current.present[field];
    const next = typeof updater === 'function' ? updater(previous) : updater;
    if (next === previous) return current;
    if (field === 'name' && typeof next !== 'string' || field === 'assets' && !Array.isArray(next)) return current;
    let apply;
    if (field === 'name') apply = state => ({ ...state, name: next });
    else {
        const before = new Map((previous || []).map(asset => [asset.id, asset]));
        const after = new Map(next.map(asset => [asset.id, asset]));
        const changed = next.filter(asset => !before.has(asset.id) || JSON.stringify(before.get(asset.id)) !== JSON.stringify(asset));
        const removed = new Set([...before.keys()].filter(id => !after.has(id)));
        apply = state => {
            const assets = new Map((state.assets || []).filter(asset => !removed.has(asset.id)).map(asset => [asset.id, asset]));
            for (const asset of changed) assets.set(asset.id, asset);
            return { ...state, assets: [...assets.values()] };
        };
    }
    return { ...current, past: current.past.map(apply), present: { ...current.present, [field]: next }, future: current.future.map(apply) };
}
