import { DRAWING_CONSTRAINT_COMMANDS, runDrawingConstraintCommand } from '~utils/drawingConstraintCommands';
import { DRAWING_DIMENSIONAL_COMMANDS, runDrawingDimensionalCommand } from '~utils/drawingDimensionalCommands';

export default function useDrawingConstraints({ history, selectedIds, enabled, dimensionalEnabled = false, setMessage, t }) {
    const run = (command, input) => {
        const dimensional = ['dimConstraint', 'parameters', 'dcConvert'].includes(command) || Object.hasOwn(DRAWING_DIMENSIONAL_COMMANDS, command);
        if (dimensional) {
            if (!dimensionalEnabled) { setMessage(t('dimensional.modelOnly')); return true; }
            const result = runDrawingDimensionalCommand(history.content, command, input, selectedIds);
            if (result.error) setMessage(t(`dimensional.${result.error}`));
            else if (result.report !== undefined) setMessage(result.report);
            else { if (result.changed !== false) history.commit(result.content); setMessage(t('dimensional.updated')); }
            return true;
        }
        if (!['geomConstraint', 'autoConstrain'].includes(command) && !Object.hasOwn(DRAWING_CONSTRAINT_COMMANDS, command)) return false;
        if (!enabled) { setMessage(t('constraints.modelOnly')); return true; }
        const result = runDrawingConstraintCommand(history.content, command, input, selectedIds);
        if (result.error) setMessage(t(`constraints.${result.error}`));
        else if (result.report !== undefined) setMessage(result.report);
        else { if (result.changed !== false) history.commit(result.content); setMessage(t('constraints.updated', { count: result.count })); }
        return true;
    };
    return { run };
}
