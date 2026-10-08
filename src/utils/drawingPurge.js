import { createDefaultDrawingContent } from './drawingDocument.js';

const CATALOGS = ['blocks', 'layers', 'textStyles', 'dimensionStyles', 'multilineStyles', 'tableStyles', 'leaderStyles'];
const catalogSelected = (catalog, scope) => scope === 'ALL' || (scope === 'BLOCKS' ? catalog === 'blocks' : scope === 'LAYERS' ? catalog === 'layers' : !['blocks', 'layers'].includes(catalog));

export function parseDrawingPurgeInput(input = '') {
    const tokens = String(input).trim().toUpperCase().split(/\s+/).filter(Boolean);
    let scope = 'ALL'; let preview = false; let scoped = false;
    for (const token of tokens) {
        if (token === 'PREVIEW' && !preview) preview = true;
        else if (['ALL', 'BLOCKS', 'LAYERS', 'STYLES'].includes(token) && !scoped) { scope = token; scoped = true; }
        else return null;
    }
    return { scope, preview };
}

/** Resource reachability across the entire document, including paper space and nested blocks. */
export function purgeDrawingDefinitions(document, { scope = 'ALL', maxVisits = 500000 } = {}) {
    if (!document?.content || !['ALL', 'BLOCKS', 'LAYERS', 'STYLES'].includes(scope)
        || !Number.isInteger(maxVisits) || maxVisits < 1) return { error: 'invalid' };
    const content = document.content;
    const nodes = CATALOGS.flatMap(catalog => (content[catalog] || []).map((value, index) => ({ catalog, value, index })));
    const lookup = new Map();
    for (const node of nodes) for (const key of [node.value.id, node.value.name]) {
        if (typeof key !== 'string') continue;
        const normalized = key.toLowerCase();
        if (!lookup.has(normalized)) lookup.set(normalized, new Set());
        lookup.get(normalized).add(node);
    }
    const reachable = new Set(); const queue = [];
    const keep = node => {
        if (reachable.has(node)) return;
        reachable.add(node);
        queue.push(Object.fromEntries(Object.entries(node.value).filter(([key]) => !['id', 'name'].includes(key))));
    };
    const defaults = createDefaultDrawingContent();
    for (const node of nodes) {
        const system = (defaults[node.catalog] || []).some(value => value.id ? value.id === node.value.id : value.name?.toLowerCase() === node.value.name?.toLowerCase());
        if (system || !catalogSelected(node.catalog, scope)) keep(node);
    }
    queue.push(Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'content')));
    queue.push(Object.fromEntries(Object.entries(content).filter(([key]) => !CATALOGS.includes(key))));
    const seen = new WeakSet(); let visits = 0;
    while (queue.length) {
        if (++visits > maxVisits) return { error: 'limit' };
        const value = queue.pop();
        if (typeof value === 'string') {
            for (const node of lookup.get(value.toLowerCase()) || []) keep(node);
        } else if (value && typeof value === 'object' && !seen.has(value) && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
            seen.add(value);
            const additional = Array.isArray(value) ? value.length : Object.keys(value).length * 2;
            if (visits + queue.length + additional > maxVisits) return { error: 'limit' };
            if (Array.isArray(value)) { for (const child of value) queue.push(child); }
            else for (const [key, child] of Object.entries(value)) queue.push(key, child);
        }
    }
    const removed = nodes.filter(node => !reachable.has(node));
    const report = { removed: removed.length, retained: nodes.length - removed.length,
        definitions: removed.map(node => ({ catalog: node.catalog, id: node.value.id || null, name: node.value.name || null })) };
    if (!removed.length) return { content, changed: false, report };
    const next = { ...content };
    for (const catalog of CATALOGS) {
        if (!content[catalog]) continue;
        const indices = new Set(removed.filter(node => node.catalog === catalog).map(node => node.index));
        if (indices.size) next[catalog] = content[catalog].filter((_, index) => !indices.has(index));
    }
    return { content: next, changed: true, report };
}
