import { normalizeDrawingGroups } from './drawingGroups.js';

/** Reuse archive group rules, retaining raw records for every membership/catalog repair. */
export function repairDrawingGroupCatalog(content) {
    if (!Array.isArray(content.groups)) return { groups: content.groups, repairs: [] };
    const normalized = normalizeDrawingGroups(content.groups, content.entities.filter(Boolean));
    const byId = new Map(normalized.map(group => [group.id, group]));
    const entityIds = new Set(content.entities.filter(Boolean).map(entity => entity.id));
    const used = new Set();
    const groups = []; const repairs = [];
    for (const [index, group] of content.groups.entries()) {
        const replacement = byId.get(group?.id);
        const eligible = replacement && !used.has(group.id) && typeof group.name === 'string'
            && group.name.trim().slice(0, 256) === replacement.name
            && Array.isArray(group.entityIds) && group.entityIds.some(id => entityIds.has(id));
        const next = eligible ? { ...group, ...replacement } : null;
        if (next) { used.add(group.id); groups.push(next); }
        // An omitted selectable flag has the established true default, not a defect.
        if (!next || group.name !== next.name || JSON.stringify(group.entityIds) !== JSON.stringify(next.entityIds)
            || group.selectable !== undefined && group.selectable !== next.selectable) {
            repairs.push({ code: 'repairedGroup', path: `content.groups[${index}]`, previous: structuredClone(group), next: structuredClone(next) });
        }
    }
    return { groups: repairs.length ? groups : content.groups, repairs };
}
