import { useRef, useState } from 'react';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { canSelectEntity, createDrawingId } from '~utils/drawingDocument';
import { drawingSelectionCandidates } from '~utils/drawingInteraction';
import { parseDrawingSelectionFilter, normalizeDrawingSelectionFilters, filterDrawingSelection, selectSimilarDrawingEntities, countDrawingEntities } from '~utils/drawingSelectionFilters';
import { createDrawingSchedule } from '~utils/drawingSchedule';
import { findDrawingCountDuplicates } from '~utils/drawingCountDuplicates';

const COMMANDS = new Set(['quickSelect', 'selectionFilter', 'selectSimilar', 'selectCount', 'countObjects', 'countArea', 'blockCount']);

export default function useDrawingSelectionQueries({ history, selectedIds, setSelectedIds, operation, setOperation, setActiveTool, present, setMessage, enabled, blockEditing, focusObjects, t }) {
    const [lastCount, setLastCount] = useState(null);
    const content = history.content;
    const duplicates = useRef(null);
    const counted = useRef(null);
    const navigateReport = (reference, target, duplicate) => {
        if (blockEditing || !enabled) {
            setMessage(t(blockEditing ? 'block.error.closeFirst' : 'namedView.modelRequired')); return;
        }
        const snapshot = reference.current;
        const key = duplicate ? 'duplicate' : 'occurrence';
        if (!snapshot || snapshot.content !== content) {
            setMessage(t(`selectionQuery.${key}Stale`)); return;
        }
        const { result } = snapshot;
        const size = duplicate ? result.groups.length : result.occurrences.length;
        if (!size) { setMessage(t(`selectionQuery.${key}Empty`)); return; }
        const activeKey = duplicate ? 'activeGroup' : 'activeOccurrence';
        const current = result[activeKey] ?? -1;
        const index = target === 'NEXT' ? (current + 1) % size
            : target === 'PREVIOUS' ? (current < 0 ? size - 1 : (current + size - 1) % size) : target;
        if (!Number.isInteger(index) || index < 0 || index >= size) {
            setMessage(t(`selectionQuery.${key}Syntax`)); return;
        }
        const selectedIds = duplicate ? [...result.groupRootIds[index]] : [result.occurrences[index].rootId];
        const bounds = duplicate ? result.groupBounds[index] : result.occurrences[index].bounds;
        const updated = { ...result, [activeKey]: index, selectedIds };
        reference.current = { ...snapshot, result: updated };
        setActiveTool('select'); setSelectedIds(selectedIds); focusObjects?.(selectedIds, bounds); present(updated);
    };
    const selectDuplicateGroup = target => navigateReport(duplicates, target, true);
    const selectCountOccurrence = target => navigateReport(counted, target, false);
    const report = (ids, nestedBlocks = false) => {
        const result = countDrawingEntities(content, ids, { nestedBlocks });
        if (!result) { setMessage(t('selectionQuery.limit')); return; }
        counted.current = { content, result };
        setLastCount(result); setSelectedIds(result.selectedIds); present(result);
    };
    const select = ids => { setSelectedIds(ids); setMessage(t('selectionQuery.selected', { count: ids.length })); };
    const run = (command, input) => {
        if (!COMMANDS.has(command)) return false;
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return true; }
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        const tokens = tokenizeDrawingAttributeInput(input);
        if (!tokens) { setMessage(t('selectionQuery.syntax')); return true; }
        if (command === 'countObjects' && ['NEXT', 'PREVIOUS', 'ITEM'].includes(tokens[0]?.toUpperCase())) {
            const action = tokens[0].toUpperCase();
            if (action === 'ITEM' ? tokens.length !== 2 || !/^[1-9]\d*$/.test(tokens[1]) : tokens.length !== 1) {
                setMessage(t('selectionQuery.occurrenceSyntax')); return true;
            }
            selectCountOccurrence(action === 'ITEM' ? Number(tokens[1]) - 1 : action); return true;
        }
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
        } else if (command === 'countObjects' && tokens[0]?.toUpperCase() === 'DUPLICATES') {
            const action = tokens[1]?.toUpperCase();
            if (['NEXT', 'PREVIOUS', 'GROUP'].includes(action)) {
                if (action === 'GROUP' ? tokens.length !== 3 || !/^[1-9]\d*$/.test(tokens[2]) : tokens.length !== 2) {
                    setMessage(t('selectionQuery.duplicateSyntax')); return true;
                }
                selectDuplicateGroup(action === 'GROUP' ? Number(tokens[2]) - 1 : action); return true;
            }
            const args = tokens.slice(1); let all = false; let nested = false; let tolerance = 1e-6;
            if (args[0]?.toUpperCase() === 'ALL') { all = true; args.shift(); }
            if (args[0]?.toUpperCase() === 'NESTED') { nested = true; args.shift(); }
            if (args.length) {
                if (args.length !== 2 || args[0].toUpperCase() !== 'TOLERANCE' || !Number.isFinite(Number(args[1]))) {
                    setMessage(t('selectionQuery.duplicateSyntax')); return true;
                }
                tolerance = Number(args[1]);
            }
            const ids = all || !selectedIds.length ? content.entities.map(entity => entity.id) : selectedIds;
            const result = findDrawingCountDuplicates(content, ids, { tolerance, nested });
            if (result.error) { setMessage(t(result.error === 'limit' ? 'selectionQuery.limit' : result.error === 'dependency' ? 'dataExtraction.dataExtractionDependency' : 'selectionQuery.duplicateSyntax')); return true; }
            duplicates.current = { content, result };
            setSelectedIds(result.selectedIds); present(result);
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
    return { run, point, selectDuplicateGroup, selectCountOccurrence };
}
