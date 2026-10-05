import { useState } from 'react';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { canSelectEntity, createDrawingId } from '~utils/drawingDocument';
import { drawingSelectionCandidates } from '~utils/drawingInteraction';
import { parseDrawingSelectionFilter, normalizeDrawingSelectionFilters, filterDrawingSelection, selectSimilarDrawingEntities, countDrawingEntities } from '~utils/drawingSelectionFilters';
import { createDrawingSchedule } from '~utils/drawingSchedule';

const COMMANDS = new Set(['quickSelect', 'selectionFilter', 'selectSimilar', 'selectCount', 'countObjects', 'countArea', 'blockCount']);

export default function useDrawingSelectionQueries({ history, selectedIds, setSelectedIds, operation, setOperation, setActiveTool, present, setMessage, enabled, blockEditing, t }) {
    const [lastCount, setLastCount] = useState(null);
    const content = history.content;
    const report = (ids, nestedBlocks = false) => {
        const result = countDrawingEntities(content, ids, { nestedBlocks });
        if (!result) { setMessage(t('selectionQuery.limit')); return; }
        setLastCount(result); setSelectedIds(result.selectedIds); present(result);
    };
    const select = ids => { setSelectedIds(ids); setMessage(t('selectionQuery.selected', { count: ids.length })); };
    const run = (command, input) => {
        if (!COMMANDS.has(command)) return false;
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return true; }
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        const tokens = tokenizeDrawingAttributeInput(input);
        if (!tokens) { setMessage(t('selectionQuery.syntax')); return true; }
        if (command === 'quickSelect') {
            const criteria = parseDrawingSelectionFilter(input);
            if (criteria) select(filterDrawingSelection(content, criteria));
            else setMessage(t('selectionQuery.syntax'));
        } else if (command === 'selectSimilar') {
            const ids = selectSimilarDrawingEntities(content, selectedIds, tokens.length ? tokens.map(token => token.toUpperCase()) : undefined);
            if (ids) select(ids); else setMessage(t('selectionQuery.syntax'));
        } else if (command === 'selectionFilter') {
            const filters = normalizeDrawingSelectionFilters(content.selectionFilters);
            const [rawAction = 'LIST', name, ...rest] = tokens;
            const action = rawAction.toUpperCase();
            const existing = filters.find(filter => filter.name.toLowerCase() === name?.trim().toLowerCase());
            if (action === 'LIST' && tokens.length <= 1) { setMessage(t('selectionQuery.filters', { names: filters.map(filter => filter.name).join(', ') })); return true; }
            if (action === 'SAVE' && name?.trim() && name.length <= 128) {
                const criteria = parseDrawingSelectionFilter(rest.map(token => JSON.stringify(token)).join(' '));
                if (!criteria || !existing && filters.length >= 128) { setMessage(t('selectionQuery.syntax')); return true; }
                const filter = { id: existing?.id || createDrawingId('filter'), name: name.trim(), criteria };
                history.commit({ ...content, selectionFilters: existing ? filters.map(item => item.id === existing.id ? filter : item) : [...filters, filter] });
            } else if (action === 'APPLY' && tokens.length === 2 && existing) select(filterDrawingSelection(content, existing.criteria));
            else if (action === 'DELETE' && tokens.length === 2 && existing) history.commit({ ...content, selectionFilters: filters.filter(filter => filter.id !== existing.id) });
            else { setMessage(t('selectionQuery.syntax')); return true; }
            if (action !== 'APPLY') setMessage(t('selectionQuery.updated'));
        } else if (command === 'countArea') {
            if (tokens.length !== 0 && (tokens.length !== 4 || !tokens.every(token => Number.isFinite(Number(token))))) { setMessage(t('selectionQuery.syntax')); return true; }
            if (tokens.length) {
                const [x1, y1, x2, y2] = tokens.map(Number);
                report(drawingSelectionCandidates(content, { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2), mode: 'window' }));
            } else {
                setActiveTool('select'); setOperation({ type: 'countArea', stage: 'pick', points: [] }); setMessage(t('selectionQuery.areaPrompt'));
            }
        } else if (command === 'countObjects' && tokens[0]?.toUpperCase() === 'TABLE') {
            if (!lastCount?.rows.length || tokens.length !== 3 || !tokens.slice(1).every(token => Number.isFinite(Number(token)))) { setMessage(t('selectionQuery.tableSyntax')); return true; }
            const cells = [[t('selectionQuery.type'), t('selectionQuery.layer'), t('selectionQuery.block'), t('selectionQuery.count')],
                ...lastCount.rows.map(row => [t(`entity.${row.type}`), row.layer, row.block, String(row.count)])];
            const result = createDrawingSchedule(content, cells, { x: Number(tokens[1]), y: Number(tokens[2]) }, t('selectionQuery.table'));
            if (!result) { setMessage(t('selectionQuery.limit')); return true; }
            history.commit(result.content); setSelectedIds(result.selectedIds); setMessage(t('selectionQuery.tableCreated'));
        } else {
            if (tokens.length && (tokens.length !== 1 || tokens[0].toUpperCase() !== 'ALL')) { setMessage(t('selectionQuery.syntax')); return true; }
            const ids = command === 'selectCount' ? selectedIds : tokens.length || !selectedIds.length
                ? content.entities.filter(entity => canSelectEntity(content, entity)).map(entity => entity.id) : selectedIds;
            report(ids, command === 'blockCount');
        }
        return true;
    };
    const point = point => {
        if (operation?.type !== 'countArea') return false;
        if (!point) return true;
        if (!operation.points.length) { setOperation({ ...operation, points: [point] }); setMessage(t('selectionQuery.areaPrompt')); }
        else {
            const first = operation.points[0];
            report(drawingSelectionCandidates(content, { minX: Math.min(first.x, point.x), minY: Math.min(first.y, point.y), maxX: Math.max(first.x, point.x), maxY: Math.max(first.y, point.y), mode: 'window' }));
        }
        return true;
    };
    return { run, point };
}
