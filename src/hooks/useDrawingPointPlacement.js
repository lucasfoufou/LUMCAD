import { parseDrawingPlacementInput, placeDrawingPoints, setDrawingPointStyle } from '~utils/drawingPointCommands';

const COMMAND_MODES = { divide: 'divide', measure: 'measure' };

export default function useDrawingPointPlacement({ history, selectedIds, setSelectedIds, operation, setOperation, setActiveTool, setMessage, enabled, t }) {
    const report = key => setMessage(t(`pointPlacement.${key}`));
    const finish = (sourceId, options) => {
        const result = placeDrawingPoints(history.content, sourceId, options);
        if (result.error) { report(result.error); return; }
        history.commit(result.content);
        setSelectedIds(result.selectedIds);
        setOperation(null);
        setActiveTool('select');
        setMessage(t('pointPlacement.created', { count: result.selectedIds.length }));
    };
    const run = (command, input) => {
        if (command !== 'pointStyle' && !COMMAND_MODES[command]) return false;
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        if (command === 'pointStyle') {
            const result = setDrawingPointStyle(history.content, selectedIds, input);
            if (result.error) report(result.error);
            else { history.commit(result.content); report('styleUpdated'); }
            return true;
        }
        const mode = COMMAND_MODES[command];
        const options = input.trim() ? parseDrawingPlacementInput(input, mode) : null;
        if (input.trim() && !options) { report('syntax'); return true; }
        const sourceId = selectedIds.length === 1 ? selectedIds[0] : null;
        if (sourceId && options) finish(sourceId, options);
        else {
            setActiveTool('select');
            setOperation({ type: 'pointPlacement', stage: sourceId ? 'parameters' : 'pick', sourceId, mode, options });
            report(sourceId ? mode === 'divide' ? 'dividePrompt' : 'measurePrompt' : 'sourcePrompt');
        }
        return true;
    };
    const point = ({ targetId }) => {
        if (operation?.type !== 'pointPlacement') return false;
        if (operation.stage !== 'pick' || !targetId) { report('sourcePrompt'); return true; }
        if (operation.options) finish(targetId, operation.options);
        else {
            setSelectedIds([targetId]);
            setOperation({ ...operation, sourceId: targetId, stage: 'parameters' });
            report(operation.mode === 'divide' ? 'dividePrompt' : 'measurePrompt');
        }
        return true;
    };
    const input = value => {
        if (operation?.type !== 'pointPlacement') return false;
        const options = parseDrawingPlacementInput(value, operation.mode);
        if (!options) report('syntax');
        else if (operation.sourceId) finish(operation.sourceId, options);
        else { setOperation({ ...operation, options }); report('sourcePrompt'); }
        return true;
    };
    return { run, point, input };
}
