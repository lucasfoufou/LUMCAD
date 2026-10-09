export function validateMcpPath(path, extension) {
    if (typeof path !== 'string' || !path || path.includes('\0')
        || !(/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(path))
        || !path.toLowerCase().endsWith(`.${extension}`)) {
        throw new Error(`Expected an absolute .${extension} path.`);
    }
    return path;
}

export function selectMcpPdfLayouts(layouts, ids) {
    if (ids == null) {
        if (!layouts?.length) throw new Error('The document has no layouts to publish.');
        return layouts;
    }
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) {
        throw new Error('layoutIds must be a nonempty array of unique layout IDs.');
    }
    return ids.map(id => {
        const layout = layouts.find(item => item.id === id);
        if (!layout) throw new Error(`Unknown layout ID: ${id}`);
        return layout;
    });
}
