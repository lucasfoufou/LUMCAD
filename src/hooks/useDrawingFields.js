import { parseDrawingFieldInput, editDrawingField, createDrawingFieldText, updateDrawingFields } from '~utils/drawingFieldCommands';
import { createDrawingFieldEvaluator } from '~utils/drawingFields';

export default function useDrawingFields({ document, history, selectedIds, setSelectedIds, workspaceMode, activeLayoutId,
    getPaperSelection, blockEditing, operation, setOperation, setActiveTool, setMessage, t }) {
    const finish = result => {
        if (result.error) { setMessage(t(`field.${result.error}`)); return; }
        if (result.definition) { setMessage(JSON.stringify(result.definition)); return; }
        if (result.document !== document) history.commitDocument(current => ({ ...current, content: result.document.content, layouts: result.document.layouts }), { applyCreationStyles: false });
        if (workspaceMode === 'model') setSelectedIds(result.selectedIds.filter(id => result.document.content.entities.some(entity => entity.id === id)));
        setOperation(null); setActiveTool('select'); setMessage(t('field.updated'));
    };
    const run = (command, input) => {
        if (!['field', 'updateField'].includes(command)) return false;
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return true; }
        const layoutId = workspaceMode === 'layout' ? activeLayoutId : null;
        const ids = layoutId ? [getPaperSelection()].filter(Boolean) : selectedIds;
        if (command === 'updateField') {
            const scope = input.trim().toUpperCase() || 'ALL';
            if (!['ALL', 'SELECTED'].includes(scope)) setMessage(t('field.updateSyntax'));
            else finish(updateDrawingFields(document, { selectedIds: scope === 'SELECTED' ? ids : null, layoutId, evaluationLayoutId: activeLayoutId }));
            return true;
        }
        const request = parseDrawingFieldInput(input);
        if (!request) { setMessage(t('field.syntax')); return true; }
        if (request.field?.kind === 'page' && !request.field.layoutId && !layoutId && activeLayoutId) request.field = { ...request.field, layoutId: activeLayoutId };
        if (ids.length || request.action !== 'set' || layoutId) finish(editDrawingField(document, ids, request, { layoutId, evaluationLayoutId: activeLayoutId }));
        else {
            const field = request.field.kind === 'page' && !request.field.layoutId && activeLayoutId ? { ...request.field, layoutId: activeLayoutId } : request.field;
            const result = createDrawingFieldEvaluator(document, { layoutId: activeLayoutId }).evaluate(field);
            setActiveTool('select'); setOperation({ type: 'field', stage: 'point', field, text: result.error || result.value }); setMessage(t('field.pointPrompt'));
        }
        return true;
    };
    const point = ({ point }) => {
        if (operation?.type !== 'field') return false;
        finish(createDrawingFieldText(document, operation.field, point, { layoutId: activeLayoutId }));
        return true;
    };
    return { run, point };
}
