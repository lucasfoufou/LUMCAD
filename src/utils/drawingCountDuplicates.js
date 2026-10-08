import { drawingDuplicateShape, equalDrawingDuplicateShapes } from './drawingDuplicateShapes.js';
import { duplicateGeometry } from './drawingCleanup.js';
import { drawingCountOccurrences } from './drawingCountOccurrences.js';
import { getEntityBounds } from './drawingGeometry.js';

/** Read-only model-root diagnosis. Connected suspect pairs are grouped, never deleted. */
export function findDrawingCountDuplicates(content, ids, { tolerance = 1e-6, maxComparisons = 250000, nested = false, maxOccurrences = 10000 } = {}) {
    if (!Array.isArray(ids) || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1
        || !Number.isSafeInteger(maxComparisons) || maxComparisons < 1
        || !Number.isSafeInteger(maxOccurrences) || maxOccurrences < 1) return { error: 'invalid' };
    const expanded = drawingCountOccurrences(content, ids, { nested, maxOccurrences });
    if (expanded.error) return expanded;
    const unsupportedIds = []; const candidates = [];
    for (const occurrence of expanded.occurrences) {
        const { entity } = occurrence;
        let shape = drawingDuplicateShape(entity);
        if (entity.type === 'blockReference' && !entity.array && !entity.externalReference) {
            // Same definition and instance state; appearance and layer do not hide coincident copies.
            const { id, layerId, color, lineWeight, lineWidth, lineType, plotStyleName, transparency, locked, definitionBounds, ...state } = entity;
            shape = state;
        }
        const bounds = getEntityBounds(entity);
        if (!shape || !bounds || ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) {
            unsupportedIds.push(occurrence.id); continue;
        }
        candidates.push({ ...occurrence, shape, bounds, comparisonBounds: shape.type === 'point'
            ? { minX: shape.x, minY: shape.y } : bounds });
    }
    candidates.sort((a, b) => a.comparisonBounds.minX - b.comparisonBounds.minX);
    const parents = candidates.map((_, index) => index);
    const root = index => { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; };
    const budget = { remaining: maxComparisons };
    let pairs = 0;
    for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i]; const b = candidates[j];
        if (b.comparisonBounds.minX - a.comparisonBounds.minX > tolerance * 2) break;
        if (--budget.remaining < 0) return { error: 'limit' };
        if (a.shape.type !== b.shape.type || Math.abs(a.comparisonBounds.minY - b.comparisonBounds.minY) > tolerance * 2) continue;
        let equal;
        if (a.shape.exact !== undefined || b.shape.exact !== undefined) equal = equalDrawingDuplicateShapes(a.shape, b.shape, tolerance, budget);
        else if (a.shape.type === 'blockReference') {
            const first = a.shape.transform; const second = b.shape.transform;
            equal = first && second && ['a', 'b', 'c', 'd'].every(key => first[key] === second[key])
                && Math.hypot(first.e - second.e, first.f - second.f) <= tolerance
                && duplicateGeometry({ ...a.shape, transform: first }, { ...b.shape, transform: first }, 0, budget);
        } else equal = equalDrawingDuplicateShapes(a.shape, b.shape, tolerance, budget);
        if (budget.remaining < 0) return { error: 'limit' };
        if (equal) { parents[root(j)] = root(i); pairs++; }
    }
    const grouped = new Map();
    candidates.forEach((candidate, index) => {
        const key = root(index);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(candidate.id);
    });
    const groups = [...grouped.values()].filter(group => group.length > 1);
    const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
    const groupRootIds = groups.map(group => [...new Set(group.map(id => byId.get(id).rootId))]);
    const groupBounds = groups.map(group => {
        const bounds = group.map(id => byId.get(id).bounds);
        return { minX: Math.min(...bounds.map(box => box.minX)), minY: Math.min(...bounds.map(box => box.minY)),
            maxX: Math.max(...bounds.map(box => box.maxX)), maxY: Math.max(...bounds.map(box => box.maxY)) };
    });
    return { mode: 'countDuplicates', tolerance, nested, groups, groupRootIds, groupBounds, pairs, examined: candidates.length,
        unsupportedIds, unsupportedPaths: expanded.unsupportedPaths,
        exactOnlyIds: candidates.filter(candidate => candidate.shape.exact !== undefined).map(candidate => candidate.id),
        occurrencePaths: Object.fromEntries(candidates.map(candidate => [candidate.id, candidate.path])),
        selectedIds: [...new Set(groupRootIds.flat())], total: groups.reduce((sum, group) => sum + group.length, 0) };
}
