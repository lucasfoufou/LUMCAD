import { createDrawingTable, editDrawingTable, parseDrawingTableCreation, parseDrawingTableEdit, runDrawingTableStyle } from '~utils/drawingTableCommands';

export default function useDrawingTables({ history, selectedIds, setSelectedIds, operation, setOperation, setActiveTool, setMessage, enabled, t }) {
    const report = key => setMessage(t(`table.${key}`));
    const commit = result => {
        if (result.error) report(result.error);
        else { history.commit(result.content); setSelectedIds(result.selectedIds); setOperation(null); setActiveTool('select'); report('updated'); }
    };
    const run = (command, input = '') => {
        if (!['table', 'tableEdit', 'tableStyle'].includes(command)) return false;
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        if (command === 'tableStyle') {
            const result = runDrawingTableStyle(history.content, input, selectedIds);
            if (result.names) setMessage(result.names.join(', ')); else commit(result);
            return true;
        }
        if (command === 'tableEdit') {
            const edit = parseDrawingTableEdit(input);
            if (!edit) report('editSyntax'); else commit(editDrawingTable(history.content, selectedIds, edit));
            return true;
        }
        const table = parseDrawingTableCreation(input || '3 3');
        if (!table) report('syntax');
        else { setActiveTool('select'); setOperation({ type: 'table', stage: 'point', table }); report('pointPrompt'); }
        return true;
    };
    const point = ({ point }) => {
        if (operation?.type !== 'table') return false;
        commit(createDrawingTable(history.content, operation.table, point)); return true;
    };
    return { run, point };
}
