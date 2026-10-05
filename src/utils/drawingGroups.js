import { isDrawingLayerVisible } from './drawingLayers.js';
import { isDrawingObjectHidden } from './drawingObjectVisibility.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';

export function normalizeDrawingGroups(groups, entities = []) {
    const entityIds = new Set(entities.map(entity => entity.id));
    const ids = new Set();
    const names = new Set();
    return (Array.isArray(groups) ? groups : []).slice(0, 10000).flatMap(group => {
        const name = typeof group?.name === 'string' ? group.name.trim().slice(0, 256) : '';
        if (!name || typeof group.id !== 'string' || !group.id || ids.has(group.id) || names.has(name.toLowerCase())) return [];
        const members = [...new Set(Array.isArray(group.entityIds) ? group.entityIds : [])].filter(id => entityIds.has(id));
        if (!members.length) return [];
        ids.add(group.id);
        names.add(name.toLowerCase());
        return [{ id: group.id, name, entityIds: members, selectable: group.selectable !== false }];
    });
}

export function expandDrawingGroupSelection(content, candidateIds) {
    const visibleLayers = new Set(content.layers.filter(layer => isDrawingLayerVisible(layer)).map(layer => layer.id));
    const available = new Set(content.entities.filter(entity => visibleLayers.has(entity.layerId) && !isDrawingObjectHidden(content, entity.id)).map(entity => entity.id));
    const selected = new Set(candidateIds.filter(id => available.has(id)));
    const groups = normalizeDrawingGroups(content.groups, content.entities).filter(group => group.selectable);
    const memberships = new Map();
    for (const group of groups) {
        for (const id of group.entityIds) {
            if (!memberships.has(id)) memberships.set(id, []);
            memberships.get(id).push(group);
        }
    }
    // Visit each membership once, including long chains of overlapping groups.
    const queue = [...selected];
    const visited = new Set();
    for (let index = 0; index < queue.length; index += 1) {
        for (const group of memberships.get(queue[index]) || []) {
            if (visited.has(group.id)) continue;
            visited.add(group.id);
            for (const id of group.entityIds) {
                if (available.has(id) && !selected.has(id)) { selected.add(id); queue.push(id); }
            }
        }
    }
    return [...selected];
}

export function runDrawingGroupCommand(content, selectedIds, command, input = '') {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return { error: 'syntax' };
    const groups = normalizeDrawingGroups(content.groups, content.entities);
    const members = [...new Set(selectedIds)].filter(id => content.entities.some(entity => entity.id === id));
    if (command === 'group' && tokens[0]?.toUpperCase() === 'LIST' && tokens.length === 1) {
        return { names: groups.map(group => `${group.name} (${group.entityIds.length})`).join(', ') };
    }
    if (command === 'group') {
        if (tokens.length !== 1 || !tokens[0].trim() || tokens[0].length > 256) return { error: 'syntax' };
        if (!members.length) return { error: 'selection' };
        if (groups.some(group => group.name.toLowerCase() === tokens[0].trim().toLowerCase())) return { error: 'duplicate' };
        return { content: { ...content, groups: [...groups, { id: `group-${crypto.randomUUID()}`, name: tokens[0].trim(), entityIds: members, selectable: true }] } };
    }
    if (command === 'ungroup') {
        if (tokens.length > 1) return { error: 'syntax' };
        const removed = groups.filter(group => tokens.length ? group.name.toLowerCase() === tokens[0].toLowerCase() : group.entityIds.some(id => members.includes(id)));
        if (!removed.length) return { error: 'missing' };
        return { content: { ...content, groups: groups.filter(group => !removed.includes(group)) } };
    }
    const [name, rawAction, value] = tokens;
    const action = rawAction?.toUpperCase();
    const group = groups.find(item => item.name.toLowerCase() === name?.toLowerCase());
    if (!group) return { error: 'missing' };
    if (action === 'SELECT' && tokens.length === 2) return { selectedIds: expandDrawingGroupSelection(content, group.entityIds) };
    if (!['ADD', 'REMOVE', 'RENAME', 'ON', 'OFF'].includes(action) || tokens.length !== (action === 'RENAME' ? 3 : 2)) return { error: 'syntax' };
    if (['ADD', 'REMOVE'].includes(action) && !members.length) return { error: 'selection' };
    if (action === 'RENAME' && (!value.trim() || value.length > 256)) return { error: 'syntax' };
    if (action === 'RENAME' && groups.some(item => item.id !== group.id && item.name.toLowerCase() === value.trim().toLowerCase())) return { error: 'duplicate' };
    const updated = { ...group };
    if (action === 'ADD') updated.entityIds = [...new Set([...group.entityIds, ...members])];
    if (action === 'REMOVE') updated.entityIds = group.entityIds.filter(id => !members.includes(id));
    if (action === 'RENAME') updated.name = value.trim();
    if (action === 'ON' || action === 'OFF') updated.selectable = action === 'ON';
    return { content: { ...content, groups: groups.flatMap(item => item.id === group.id ? updated.entityIds.length ? [updated] : [] : [item]) } };
}
