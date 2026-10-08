import { runDrawingDynamicBlockCommand } from '~utils/drawingDynamicBlockCommands';

export default function useDrawingDynamicBlocks({ history, selectedIds, blockEditor, enabled, setMessage, t }) {
    const run = (command, input) => {
        if (!['blockParameter', 'blockAction', 'resetBlock', 'blockLookupTable', 'blockTable', 'blockVisibility'].includes(command)) return false;
        if (!enabled || blockEditor.session?.referenceSource) { setMessage(t('dynamicBlock.editor')); return true; }
        const result = runDrawingDynamicBlockCommand(history.content, command, input, selectedIds, { editing: Boolean(blockEditor.session) });
        if (result.error) setMessage(t(`dynamicBlock.${result.error}`));
        else if (result.report) setMessage(result.report);
        else { if (result.changed !== false) history.commit(result.content); setMessage(t('dynamicBlock.updated')); }
        return true;
    };
    return { run };
}
