const MAX_NODES = 1000000;
const MAX_TEXT = 64 * 1024 * 1024;

export function drawingComparisonKey(value, position) {
    return typeof value?.id === 'string' && value.id ? `id:${value.id}`
        : typeof value?.name === 'string' && value.name ? `name:${value.name}` : `index:${position}`;
}

/** Canonical JSON for drawing comparisons; object order and cached bounds are irrelevant. */
export function drawingComparisonValue(value, { mapField = null } = {}) {
    let nodes = 0; let textSize = 0;
    const ancestors = new Set();
    const visit = (item, depth) => {
        if (++nodes > MAX_NODES || depth > 64) throw new Error('comparisonLimit');
        if (typeof item === 'string') {
            textSize += item.length;
            if (textSize > MAX_TEXT) throw new Error('comparisonLimit');
            return item;
        }
        if (item === null || item === undefined || typeof item === 'boolean') return item;
        if (typeof item === 'number') {
            if (!Number.isFinite(item)) throw new Error('comparisonInvalid');
            return item;
        }
        if (typeof item !== 'object' || ancestors.has(item)) throw new Error('comparisonInvalid');
        ancestors.add(item);
        const result = Array.isArray(item) ? item.map(child => visit(child, depth + 1))
            : Object.fromEntries(Object.keys(item).sort().filter(key => !['bounds', 'definitionBounds'].includes(key)).map(key =>
                [key, visit(mapField ? mapField(key, item[key]) : item[key], depth + 1)]));
        ancestors.delete(item);
        return result;
    };
    return visit(value, 0);
}

/** ID-based comparison preserves identity and separately reports painter/catalog order. */
export function compareDrawingDocuments(before, after) {
    if (!before?.content || !after?.content) throw new Error('comparisonInvalid');
    const left = drawingComparisonValue(before); const right = drawingComparisonValue(after);
    const changes = [];
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const collection = (scope, first = [], second = []) => {
        if (!Array.isArray(first) || !Array.isArray(second) || first.length + second.length > 100000) throw new Error('comparisonLimit');
        const index = values => {
            const result = new Map();
            values.forEach((value, position) => {
                if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('comparisonInvalid');
                const key = drawingComparisonKey(value, position);
                if (result.has(key)) throw new Error('comparisonIdentity');
                result.set(key, value);
            });
            return result;
        };
        const a = index(first); const b = index(second);
        for (const [key, value] of a) {
            if (!b.has(key)) changes.push({ scope, key, kind: 'removed', before: value, after: null });
            else if (!equal(value, b.get(key))) changes.push({ scope, key, kind: 'changed', before: value, after: b.get(key) });
        }
        for (const [key, value] of b) if (!a.has(key)) changes.push({ scope, key, kind: 'added', before: null, after: value });
        const commonA = [...a.keys()].filter(key => b.has(key));
        const commonB = [...b.keys()].filter(key => a.has(key));
        if (!equal(commonA, commonB)) changes.push({ scope, key: '$order', kind: 'order', before: [...a.keys()], after: [...b.keys()] });
    };
    const contentKeys = new Set([...Object.keys(left.content), ...Object.keys(right.content)]);
    for (const key of contentKeys) {
        const a = left.content[key]; const b = right.content[key];
        if (Array.isArray(a) || Array.isArray(b)) collection(`content.${key}`, a ?? [], b ?? []);
        else if (!equal(a, b)) changes.push({ scope: 'content', key, kind: 'changed', before: a ?? null, after: b ?? null });
    }
    for (const key of ['assets', 'layouts', 'pageSetups']) collection(key, left[key] ?? [], right[key] ?? []);
    const metadataKeys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of metadataKeys) {
        if (['id', 'createdAt', 'updatedAt', 'content', 'assets', 'layouts', 'pageSetups'].includes(key)) continue;
        if (!equal(left[key], right[key])) changes.push({ scope: 'document', key, kind: 'changed', before: left[key] ?? null, after: right[key] ?? null });
    }
    return { version: 1, sourceDocumentChanged: before.id !== after.id, changes,
        counts: Object.fromEntries(['added', 'removed', 'changed', 'order'].map(kind => [kind, changes.filter(change => change.kind === kind).length])) };
}
