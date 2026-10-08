const validPath = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f]/.test(value);
const windowsAbsolute = value => /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);

/** Preserve the original directory without collapsing symlink-sensitive '..' segments. */
export function resolveRecoveredReferencePath(path, sourcePath) {
    if (!validPath(path) || !validPath(sourcePath)) return null;
    const windows = windowsAbsolute(sourcePath);
    if (!windows && !sourcePath.startsWith('/')) return null;
    if (windowsAbsolute(path) || path.startsWith('/') && !windows) return path;
    // Drive-relative and root-relative Windows paths need native drive context.
    if (windows && (/^[a-z]:/i.test(path) || /^[\\/]/.test(path))) return null;
    const separator = windows ? Math.max(sourcePath.lastIndexOf('\\'), sourcePath.lastIndexOf('/')) : sourcePath.lastIndexOf('/');
    const resolved = sourcePath.slice(0, separator + 1) + path;
    return validPath(resolved) ? resolved : null;
}

/** Clone before pinning reference paths; cached geometry and source evidence stay untouched. */
export function prepareRecoveredReferencePaths(document, sourcePath, graph = null) {
    const copy = structuredClone(document);
    const changes = [];
    const unresolved = [];
    const root = graph?.entries?.find(entry => entry.sourcePath === sourcePath);
    const entries = new Map((graph?.entries || []).map(entry => [entry.id, entry]));
    const canonical = new Map();
    for (const edge of graph?.edges || []) {
        const target = entries.get(edge.to);
        if (edge.from === root?.id && ['visited', 'shared', 'cycle'].includes(edge.status) && validPath(target?.sourcePath)) canonical.set(edge.path, target.savedPath || target.sourcePath);
    }
    const scopes = [
        { path: 'content.entities', entities: copy.content?.entities },
        ...(copy.content?.blocks || []).map((block, index) => ({ path: `content.blocks[${index}].entities`, entities: block.entities })),
        ...(copy.layouts || []).map((layout, index) => ({ path: `layouts[${index}].paperEntities`, entities: layout.paperEntities })),
    ];
    for (const scope of scopes) for (const [index, entity] of (scope.entities || []).entries()) {
        const link = entity.table?.dataLink;
        if (link?.path) {
            const previous = link.path;
            const resolved = resolveRecoveredReferencePath(previous, sourcePath);
            const evidence = { entityId: entity.id, scope: `${scope.path}[${index}].table.dataLink`, from: previous };
            if (!resolved) unresolved.push(evidence);
            else if (resolved !== previous) { link.path = resolved; changes.push({ ...evidence, to: resolved }); }
        }
        if (entity.type !== 'blockReference' || !entity.externalReference?.path) continue;
        const previous = entity.externalReference.path;
        const originalPath = resolveRecoveredReferencePath(previous, sourcePath);
        const savedTarget = graph?.entries?.find(entry => (entry.sourcePath === originalPath || entry.previousSavedPaths?.includes(originalPath)) && entry.savedPath);
        const resolved = canonical.get(previous) || savedTarget?.savedPath || originalPath;
        const evidence = { entityId: entity.id, scope: `${scope.path}[${index}]`, from: previous };
        if (!resolved) { unresolved.push(evidence); continue; }
        if (resolved === previous) continue;
        entity.externalReference.path = resolved;
        changes.push({ ...evidence, to: resolved });
    }
    return { document: copy, changes, unresolved };
}

/** Called only after successful native Save/Save As; never register cancelled browser downloads. */
export function recordRecoveredCopyPath(graph, sourcePath, savedPath) {
    if (!graph || !validPath(savedPath) || !(savedPath.startsWith('/') || windowsAbsolute(savedPath))) return graph;
    if (graph.entries.some(entry => entry.sourcePath === savedPath)) return graph;
    const source = graph.entries.find(entry => entry.sourcePath === sourcePath && entry.result?.ready);
    if (!source) return graph;
    return { ...graph, entries: graph.entries.map(entry => {
        if (entry === source) return { ...entry, savedPath, previousSavedPaths: [...new Set([entry.savedPath, ...(entry.previousSavedPaths || [])].filter(path => path && path !== savedPath))].slice(0, 32) };
        const previousSavedPaths = (entry.previousSavedPaths || []).filter(path => path !== savedPath);
        if (entry.savedPath !== savedPath) return { ...entry, previousSavedPaths };
        const { savedPath: overwrittenPath, ...previous } = entry;
        return { ...previous, previousSavedPaths };
    }) };
}
