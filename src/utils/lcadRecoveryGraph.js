import { prepareLcadRecovery } from './lcadRecovery.js';

function recoveryReferences(result, maxReferences) {
    const document = result.candidate?.document;
    if (!document) return [];
    const scopes = [
        { path: 'content.entities', entities: document.content?.entities },
        ...(document.content?.blocks || []).map((block, index) => ({ path: `content.blocks[${index}].entities`, entities: block?.entities })),
        ...(document.layouts || []).map((layout, index) => ({ path: `layouts[${index}].paperEntities`, entities: layout?.paperEntities })),
    ];
    const references = [];
    const add = (entity, scope) => {
        if (entity?.type !== 'blockReference' || !entity.externalReference?.path) return;
        references.push({ path: entity.externalReference.path, entityId: typeof entity.id === 'string' ? entity.id : null, scope });
        if (references.length > maxReferences) throw new Error('limit');
    };
    for (const scope of scopes) for (const [index, entity] of (scope.entities || []).entries()) add(entity, `${scope.path}[${index}]`);
    // A discarded insertion still provides evidence of a source worth recovering.
    for (const item of result.report.quarantine || []) if (item.kind === 'entity') add(item.value, item.path);
    return references;
}

function errorEvidence(error) {
    if (error?.translationKey) return { translationKey: error.translationKey, translationValues: error.translationValues };
    if (typeof error === 'string') {
        try { const parsed = JSON.parse(error); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed; } catch { /* Keep non-JSON native errors as evidence. */ }
        return { detail: error };
    }
    return { detail: String(error?.message || error) };
}

function closesReferenceCycle(from, to, edges) {
    const pending = [to]; const visited = new Set();
    while (pending.length) {
        const id = pending.pop();
        if (id === from) return true;
        if (visited.has(id)) continue;
        visited.add(id);
        for (const edge of edges) if (edge.from === id && edge.to) pending.push(edge.to);
    }
    return false;
}

/** Read-only, bounded traversal. The adapters resolve native identity and read raw bytes. */
export async function prepareLcadRecoveryGraph(rootPath, { resolvePath, readBytes, maxFiles = 32, maxDepth = 8,
    maxReferences = 2048, maxBytes = 300 * 1024 * 1024, maxCandidateCharacters = 300 * 1024 * 1024, ...options } = {}) {
    if (typeof resolvePath !== 'function' || typeof readBytes !== 'function'
        || ![maxFiles, maxReferences, maxBytes, maxCandidateCharacters].every(value => Number.isInteger(value) && value > 0)
        || !Number.isInteger(maxDepth) || maxDepth < 0) throw new TypeError('Invalid recovery graph limits or adapters.');
    const entries = []; const edges = []; const known = new Map();
    const queue = [{ path: rootPath, parentPath: null, from: null, depth: 0 }];
    let bytesRead = 0; let candidateCharacters = 0; let limited = false;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const item = queue[cursor];
        const displayPath = typeof item.path === 'string' ? item.path : '';
        const edge = item.from ? { from: item.from, path: displayPath, entityId: item.entityId, scope: item.scope } : null;
        if (edge) edges.push(edge);
        if (item.depth > maxDepth) {
            if (edge) edge.status = 'limit';
            limited = true; continue;
        }
        let sourcePath;
        try {
            if (typeof item.path !== 'string' || !item.path || item.path.length > 4096 || /[\u0000-\u001f]/.test(item.path)) throw new Error('Invalid reference path.');
            sourcePath = await resolvePath(item.path, item.parentPath);
            if (typeof sourcePath !== 'string' || !sourcePath || sourcePath.length > 4096 || /[\u0000-\u001f]/.test(sourcePath)) throw new Error('Invalid resolved source path.');
        } catch (error) {
            if (entries.length >= maxFiles) { limited = true; if (edge) edge.status = 'limit'; continue; }
            const evidence = errorEvidence(error);
            const entry = { id: `recovery-${entries.length + 1}`, sourcePath: typeof evidence.path === 'string' ? evidence.path : displayPath, status: 'failed', error: evidence };
            entries.push(entry);
            if (edge) Object.assign(edge, { to: entry.id, status: 'failed' });
            continue;
        }
        if (known.has(sourcePath)) {
            if (edge) Object.assign(edge, { to: known.get(sourcePath), status: closesReferenceCycle(item.from, known.get(sourcePath), edges) ? 'cycle' : 'shared' });
            continue;
        }
        if (entries.length >= maxFiles) { limited = true; if (edge) edge.status = 'limit'; continue; }
        const entry = { id: `recovery-${entries.length + 1}`, sourcePath, status: 'failed' };
        entries.push(entry); known.set(sourcePath, entry.id);
        if (edge) Object.assign(edge, { to: entry.id, status: 'visited' });
        try {
            if (bytesRead >= maxBytes) throw new Error('limit');
            const bytes = await readBytes(sourcePath, maxBytes - bytesRead);
            if (!Number.isInteger(bytes?.byteLength) || bytes.byteLength > maxBytes - bytesRead) throw new Error('limit');
            bytesRead += bytes.byteLength;
            const result = prepareLcadRecovery(bytes, options);
            if (result.error) { entry.error = { translationKey: `audit.${result.error}` }; continue; }
            const size = JSON.stringify(result).length;
            if (size > maxCandidateCharacters - candidateCharacters) throw new Error('limit');
            candidateCharacters += size;
            entry.result = { ...result, sourcePath, sourceName: sourcePath.split(/[\\/]/).at(-1) };
            entry.status = result.ready ? 'ready' : 'unresolved';
            const references = recoveryReferences(result, maxReferences);
            for (const reference of references) {
                if (queue.length - 1 >= maxReferences) { limited = true; break; }
                queue.push({ ...reference, from: entry.id, parentPath: sourcePath, depth: item.depth + 1 });
            }
        } catch (error) {
            entry.error = errorEvidence(error);
            if (error?.message === 'limit' || entry.error.code === 'reference_too_large') limited = true;
            // Keep a validated local candidate if only dependency enumeration failed.
            if (!entry.result) entry.status = 'failed';
        }
    }
    return { entries, edges, bytesRead, limited,
        complete: !limited && entries.every(entry => entry.status === 'ready' && !entry.error) && edges.every(edge => !['cycle', 'failed', 'limit'].includes(edge.status)) };
}

export function lcadRecoveryGraphReport(graph) {
    return { mode: 'recoveryManager', complete: graph.complete, limited: graph.limited, bytesRead: graph.bytesRead,
        edges: graph.edges, entries: graph.entries.map(entry => ({ id: entry.id, path: entry.sourcePath, savedPath: entry.savedPath || null, status: entry.status,
            error: entry.error, issues: entry.result?.report.issues.length || 0,
            quarantined: entry.result?.report.quarantine.length || 0, repairs: entry.result?.report.repairs.length || 0 })) };
}
