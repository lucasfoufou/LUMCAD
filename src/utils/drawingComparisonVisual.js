import { fitViewBox } from './drawingGeometry.js';

/** Match resource changes to model roots, including resources in nested blocks. */
export function drawingComparisonHighlights(document, report) {
    const explicit = new Set(report.changes.filter(change => change.scope === 'content.entities' && change.kind !== 'order')
        .map(change => change.key.startsWith('id:') ? change.key.slice(3) : null));
    const resources = new Map();
    for (const change of report.changes) {
        if (!resources.has(change.scope)) resources.set(change.scope, new Set());
        resources.get(change.scope).add(change.key);
    }
    const all = report.changes.some(change => change.scope === 'content' && change.key === 'settings'
        || change.scope === 'content.entities' && change.kind === 'order');
    const blocks = new Map((document.content.blocks || []).map(block => [block.id, block]));
    const fields = { layerId: 'content.layers', blockId: 'content.blocks', assetId: 'assets', textStyleId: 'content.textStyles',
        dimensionStyleId: 'content.dimensionStyles', multilineStyle: 'content.multilineStyles', tableStyle: 'content.tableStyles', leaderStyle: 'content.leaderStyles' };
    let visits = 0;
    const affected = (entity, ancestors) => {
        if (++visits > 100000 || ancestors.size > 32) throw new Error('comparisonLimit');
        for (const [field, scope] of Object.entries(fields)) {
            const value = entity[field];
            if (typeof value === 'string' && (resources.get(scope)?.has(`id:${value}`) || resources.get(scope)?.has(`name:${value}`))) return true;
        }
        if (entity.type !== 'blockReference') return false;
        const block = blocks.get(entity.blockId);
        if (!block || ancestors.has(block.id)) return false;
        return block.entities.some(child => affected(child, new Set([...ancestors, block.id])));
    };
    return document.content.entities.filter(entity => all || explicit.has(entity.id) || affected(entity, new Set())).map(entity => entity.id);
}

/** Both previews use identical world coordinates and scale, even for moved objects. */
export function drawingComparisonViewBox(before, after) {
    const boxes = [before, after].filter(document => document.content.entities.length).map(document => fitViewBox(document.content, 1.6, 0.15));
    if (!boxes.length) return fitViewBox(before.content, 1.6, 0.15);
    const x = Math.min(...boxes.map(box => box.x)); const y = Math.min(...boxes.map(box => box.y));
    const width = Math.max(...boxes.map(box => box.x + box.width)) - x;
    const height = Math.max(...boxes.map(box => box.y + box.height)) - y;
    const fittedWidth = Math.max(width, height * 1.6); const fittedHeight = Math.max(height, width / 1.6);
    return { x: x - (fittedWidth - width) / 2, y: y - (fittedHeight - height) / 2, width: fittedWidth, height: fittedHeight };
}
