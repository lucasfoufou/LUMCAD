import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';

export function normalizeNamedDrawingViews(input) {
    const names = new Set();
    const ids = new Set();
    return (Array.isArray(input) ? input : []).slice(0, 256).flatMap(view => {
        const name = typeof view?.name === 'string' ? view.name.trim().slice(0, 128) : '';
        if (!name || typeof view.id !== 'string' || !view.id || names.has(name.toLowerCase()) || ids.has(view.id)
            || !validView(view)) return [];
        names.add(name.toLowerCase()); ids.add(view.id);
        return [{ id: view.id, name, x: view.x, y: view.y, width: view.width, height: view.height }];
    });
}

function validView(view) {
    return ['x', 'y', 'width', 'height'].every(key => typeof view?.[key] === 'number' && Number.isFinite(view[key]) && Math.abs(view[key]) <= 1e9)
        && view.width >= 1e-6 && view.height >= 1e-6;
}

export function namedDrawingViewBox(view, canvasSize) {
    if (!validView(view)) return null;
    const aspect = canvasSize?.width > 0 && canvasSize?.height > 0 ? canvasSize.width / canvasSize.height : view.width / view.height;
    const width = Math.max(view.width, view.height * aspect);
    const height = Math.max(view.height, view.width / aspect);
    return { x: view.x - width / 2, y: view.y - height / 2, width, height };
}

export function runNamedDrawingViewCommand(content, viewport, input = '', restoreOnly = false) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return { error: 'syntax' };
    const [rawAction = 'LIST', name, newName] = restoreOnly ? ['RESTORE', ...tokens] : tokens;
    const action = rawAction.toUpperCase();
    const views = normalizeNamedDrawingViews(content.namedViews);
    const count = restoreOnly ? tokens.length + 1 : tokens.length;
    if (action === 'LIST' && count <= 1) return { names: views.map(view => view.name).join(', ') };
    if (!['SAVE', 'RESTORE', 'DELETE', 'RENAME'].includes(action) || count !== (action === 'RENAME' ? 3 : 2)
        || !name?.trim() || name.length > 128) return { error: 'syntax' };
    const existing = views.find(view => view.name.toLowerCase() === name.trim().toLowerCase());
    if (action === 'SAVE') {
        if (!validView(viewport) || !existing && views.length >= 256) return { error: 'limit' };
        const view = { id: existing?.id || `view-${crypto.randomUUID()}`, name: name.trim(), x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height };
        return { content: { ...content, namedViews: existing ? views.map(item => item.id === existing.id ? view : item) : [...views, view] } };
    }
    if (!existing) return { error: 'missing' };
    if (action === 'RESTORE') return { view: existing };
    if (action === 'DELETE') return { content: { ...content, namedViews: views.filter(view => view.id !== existing.id) } };
    if (!newName.trim() || newName.length > 128 || views.some(view => view.id !== existing.id && view.name.toLowerCase() === newName.trim().toLowerCase())) return { error: 'name' };
    return { content: { ...content, namedViews: views.map(view => view.id === existing.id ? { ...view, name: newName.trim() } : view) } };
}

export function importNamedDrawingViews(content, incoming) {
    const namedViews = normalizeNamedDrawingViews(content.namedViews);
    const imported = normalizeNamedDrawingViews(incoming);
    if (namedViews.length + imported.length > 256) return { error: 'limit' };
    const names = new Set(namedViews.map(view => view.name.toLowerCase()));
    for (const view of imported) {
        let name = view.name;
        for (let suffix = 2; names.has(name.toLowerCase()); suffix += 1) name = `${view.name.slice(0, 118)} (${suffix})`;
        names.add(name.toLowerCase());
        namedViews.push({ ...view, id: `view-${crypto.randomUUID()}`, name });
    }
    return { content: { ...content, namedViews }, count: imported.length };
}
