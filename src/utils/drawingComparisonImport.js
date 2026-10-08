import { compareDrawingDocuments, drawingComparisonKey, drawingComparisonValue } from './drawingComparison.js';
import { auditDrawingDocument } from './drawingAudit.js';
import { canEditEntity } from './drawingDocument.js';
import { drawingChangesAffectLockedEntities } from './drawingLockedChanges.js';

const equal = (first, second) => JSON.stringify(drawingComparisonValue(first)) === JSON.stringify(drawingComparisonValue(second));
const collectionAt = (document, scope) => scope.startsWith('content.') ? document.content[scope.slice(8)] : document[scope];
const setField = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
const setCollection = (document, scope, value) => setField(scope.startsWith('content.') ? document.content : document, scope.startsWith('content.') ? scope.slice(8) : scope, value);

/** Apply accepted changes atomically; never normalize away missing dependencies or stale edits. */
export function importDrawingComparison(current, baseline, incoming, selectedIndexes) {
    const report = compareDrawingDocuments(baseline, incoming);
    if (!Array.isArray(selectedIndexes) || !selectedIndexes.length || new Set(selectedIndexes).size !== selectedIndexes.length
        || selectedIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= report.changes.length)) return { error: 'comparisonSelection' };
    if (current.id !== baseline.id) return { error: 'comparisonStale' };
    // Validate current identities before matching and preserve every unrelated local field.
    compareDrawingDocuments(current, current);
    const candidate = structuredClone(current);
    const selected = selectedIndexes.map(index => report.changes[index]);
    const collections = new Map();
    for (const change of selected) {
        if (['content', 'document'].includes(change.scope)) {
            const old = change.scope === 'content' ? baseline.content : baseline;
            const now = change.scope === 'content' ? current.content : current;
            const next = change.scope === 'content' ? incoming.content : incoming;
            const target = change.scope === 'content' ? candidate.content : candidate;
            if (!equal(old[change.key], now[change.key])) return { error: 'comparisonStale' };
            if (Object.hasOwn(next, change.key)) setField(target, change.key, structuredClone(next[change.key]));
            else delete target[change.key];
        } else {
            if (!collections.has(change.scope)) collections.set(change.scope, []);
            collections.get(change.scope).push(change);
        }
    }
    for (const [scope, changes] of collections) {
        const original = collectionAt(current, scope) || [];
        const source = collectionAt(incoming, scope) || [];
        const keys = values => values.map(drawingComparisonKey);
        const sourceKeys = keys(source);
        let values = structuredClone(original);
        for (const change of changes.filter(item => item.kind !== 'order')) {
            const position = keys(values).indexOf(change.key);
            const originalPosition = keys(original).indexOf(change.key);
            if (change.kind === 'added' ? originalPosition !== -1 : originalPosition === -1 || !equal(original[originalPosition], change.before)) return { error: 'comparisonStale' };
            if (scope === 'content.entities' && originalPosition !== -1 && !canEditEntity(current.content, original[originalPosition])) return { error: 'comparisonLocked' };
            if (change.kind === 'removed') values.splice(position, 1);
            else {
                const sourcePosition = sourceKeys.indexOf(change.key);
                const value = structuredClone(source[sourcePosition]);
                if (change.kind === 'changed') values[position] = value;
                else {
                    // Insert before the next surviving source item, preserving local objects.
                    const currentKeys = keys(values);
                    const following = sourceKeys.slice(sourcePosition + 1).find(key => currentKeys.includes(key));
                    values.splice(following === undefined ? values.length : currentKeys.indexOf(following), 0, value);
                }
            }
        }
        const order = changes.find(change => change.kind === 'order');
        if (order) {
            if (!equal(keys(original), order.before)) return { error: 'comparisonStale' };
            const map = new Map(values.map((value, index) => [drawingComparisonKey(value, index), value]));
            if (map.size !== order.after.length || order.after.some(key => !map.has(key))) return { error: 'comparisonDependencies' };
            values = order.after.map(key => map.get(key));
        }
        setCollection(candidate, scope, values);
    }
    if (drawingChangesAffectLockedEntities(current, candidate)) return { error: 'comparisonLocked' };
    const audit = auditDrawingDocument(candidate);
    if (!audit.valid) return { error: 'comparisonDependencies', issues: audit.issues || [], limit: audit.error || null };
    return { document: candidate, applied: selectedIndexes.length };
}
