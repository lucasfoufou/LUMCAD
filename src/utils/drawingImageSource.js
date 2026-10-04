// Linked images keep a last-good embedded snapshot; reading a path is always explicit.
export function normalizeImageSource(value) {
    if (value?.mode !== 'linked' || typeof value.path !== 'string') return null;
    const path = value.path;
    if (!path || path.length > 4096 || /[\u0000-\u001f]/.test(path)
        || !(/^[\/]/.test(path) || /^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path))) return null;
    return { mode: 'linked', path };
}

export function replaceImageSource(entity, assetId, source) {
    if (entity?.type !== 'image' || !assetId) return entity;
    const next = { ...entity, assetId };
    delete next.link;
    const normalized = normalizeImageSource(source);
    if (normalized) next.imageSource = normalized;
    else delete next.imageSource;
    return next;
}

export function parseImageSourceInput(input) {
    const match = String(input || '').trim().match(/^(LINK|RELINK|RELOAD|EMBED)(?:\s+([\s\S]+))?$/i);
    if (!match) return null;
    const action = match[1].toLowerCase();
    let path = (match[2] || '').trim();
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    if (['reload', 'embed'].includes(action) && path) return null;
    if (path && !normalizeImageSource({ mode: 'linked', path })) return null;
    return { action, path: path || null };
}
