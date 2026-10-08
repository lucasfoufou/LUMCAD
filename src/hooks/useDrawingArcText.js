import { parseDrawingArcText, runDrawingArcText } from '~utils/drawingArcTextCommands';

export default function useDrawingArcText({ history, selectedIds, setSelectedIds, operation, setOperation, setActiveTool, setMessage, enabled, t }) {
    const finish = result => {
        if (result.error) setMessage(t(`arcText.${result.error}`));
        else { history.commit(result.content); setSelectedIds(result.selectedIds); setOperation(null); setActiveTool('select'); setMessage(t('arcText.updated')); }
    };
    const run = (command, input) => {
        if (command !== 'arcText') return false;
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        const parsed = parseDrawingArcText(input);
        if (!parsed) { setMessage(t('arcText.syntax')); return true; }
        const arc = selectedIds.length === 1 && history.content.entities.find(entity => entity.id === selectedIds[0] && entity.type === 'arc');
        if (parsed.editing || parsed.detach || arc) finish(runDrawingArcText(history.content, selectedIds, input));
        else { setActiveTool('select'); setOperation({ type: 'arcText', stage: 'arc', input }); setMessage(t('arcText.pick')); }
        return true;
    };
    const point = ({ targetId }) => {
        if (operation?.type !== 'arcText') return false;
        finish(runDrawingArcText(history.content, targetId ? [targetId] : [], operation.input));
        return true;
    };
    return { run, point };
}
