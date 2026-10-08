import { createDrawingTolerance, editDrawingTolerance, parseDrawingTolerance } from '~utils/drawingToleranceCommands';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { runDrawingTableStyle } from '~utils/drawingTableCommands';
import { normalizeDrawingTableStyles } from '~utils/drawingTables';

export default function useDrawingTolerances({ history, selectedIds, setSelectedIds, operation, setOperation, setActiveTool, setMessage, enabled, t }) {
    const finish = result => {
        if (result.error) setMessage(t(`tolerance.${result.error}`));
        else { history.commit(result.content); setSelectedIds(result.selectedIds); setOperation(null); setActiveTool('select'); setMessage(t('tolerance.updated')); }
    };
    const run = (command, input) => {
        if (command !== 'tolerance') return false;
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        const tokens = tokenizeDrawingAttributeInput(input);
        if (!tokens?.length) { setMessage(t('tolerance.syntax')); return true; }
        const source = selectedIds.length === 1 && history.content.entities.find(entity => entity.id === selectedIds[0]);
        if (tokens[0].toUpperCase() === 'STYLE') {
            const action = tokens[1]?.toUpperCase();
            if (action === 'APPLY' && tokens.length === 3) {
                const style = normalizeDrawingTableStyles(history.content.tableStyles).find(style => style.name.toLowerCase() === tokens[2].toLowerCase());
                if (!style || !source?.tolerance) { setMessage(t('tolerance.selection')); return true; }
                finish(editDrawingTolerance(history.content, selectedIds, { ...source.tolerance, style }));
            } else if (['LIST', 'SET', 'DELETE'].includes(action)) {
                const result = runDrawingTableStyle(history.content, tokens.slice(1).map(token => JSON.stringify(token)).join(' '), selectedIds);
                if (result.names) setMessage(result.names.join(', '));
                else if (result.error) setMessage(t(`table.${result.error}`));
                else finish(result);
            } else setMessage(t('tolerance.syntax'));
            return true;
        }
        const editing = tokens[0].toUpperCase() === 'EDIT';
        if (editing) tokens.shift();
        const tolerance = parseDrawingTolerance(tokens.map(token => JSON.stringify(token)).join(' '), history.content.tableStyles, editing ? source?.tolerance?.style : undefined);
        if (!tolerance) setMessage(t('tolerance.syntax'));
        else if (editing) finish(editDrawingTolerance(history.content, selectedIds, tolerance));
        else { setActiveTool('select'); setOperation({ type: 'tolerance', stage: 'point', tolerance }); setMessage(t('tolerance.pointPrompt')); }
        return true;
    };
    const point = ({ point }) => {
        if (operation?.type !== 'tolerance') return false;
        finish(createDrawingTolerance(history.content, operation.tolerance, point)); return true;
    };
    return { run, point };
}
