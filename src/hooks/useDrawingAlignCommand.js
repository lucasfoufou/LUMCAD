import { canEditEntity } from '~utils/drawingDocument';
import {
    alignDrawingEntities,
    resolveAlignTransform,
} from '~utils/drawingAlignOperations';
import {
    advanceAlignOperationPoint,
    beginAlignPointCollection,
    chooseAlignOperation,
    createAlignSelectionOperation,
    getAlignPromptDescriptor,
    isAlignPointStage,
    retryLastAlignPair,
} from '~utils/drawingAlignCommand';

export default function useDrawingAlignCommand({
    canvasRef,
    commandBarRef,
    history,
    selectedEntities = [],
    selectedIds = [],
    interactiveOperation,
    setActiveTool,
    setInteractiveOperation,
    setMessage,
    setSelectedIds,
    t = key => key,
}) {
    const setAlignPrompt = operation => {
        const prompt = getAlignPromptDescriptor(operation);
        if (prompt) setMessage(t(prompt.key, prompt.values));
    };

    const selectionEntities = () => {
        if (selectedEntities.length) return selectedEntities;
        const selected = new Set(selectedIds);
        return history.content.entities.filter(entity => selected.has(entity.id));
    };

    const activateAlignSelection = (
        operation = interactiveOperation || createAlignSelectionOperation(),
        entities = selectionEntities(),
        reportInvalid = true,
    ) => {
        const entityIds = entities
            .filter(entity => canEditEntity(history.content, entity))
            .map(entity => entity.id);
        if (!entityIds.length) {
            if (reportInvalid) setMessage(t('messages.alignSelectionRequired'));
            return false;
        }
        const nextOperation = beginAlignPointCollection(entityIds);
        setInteractiveOperation(nextOperation);
        setActiveTool('align');
        setAlignPrompt(nextOperation);
        return true;
    };

    const beginAlign = () => {
        canvasRef.current?.cancel();
        const operation = createAlignSelectionOperation();
        if (activateAlignSelection(operation, selectionEntities(), false)) return true;
        setInteractiveOperation(operation);
        setActiveTool('select');
        setAlignPrompt(operation);
        return true;
    };

    const handleAlignPoint = (operation = interactiveOperation, point) => {
        if (operation?.type !== 'align' || !isAlignPointStage(operation)) return false;
        const advanced = advanceAlignOperationPoint(operation, point);
        if (!advanced.accepted) {
            if (advanced.reason === 'non-finite') setMessage(t('messages.alignPointInvalid'));
            return advanced.reason === 'non-finite';
        }
        let nextOperation = advanced.operation;
        if (advanced.pairCompleted && [2, 3].includes(nextOperation.pairs.length)) {
            const validation = resolveAlignTransform(nextOperation.pairs);
            if (!validation.valid) {
                nextOperation = retryLastAlignPair(nextOperation);
                setInteractiveOperation(nextOperation);
                setMessage(t('messages.alignPairsInvalid', { reason: validation.reason }));
                return true;
            }
        }
        setInteractiveOperation(nextOperation);
        setAlignPrompt(nextOperation);
        if (nextOperation.stage === 'align-choice') commandBarRef.current?.focus('');
        return true;
    };

    const submitAlignValue = (rawValue, operation = interactiveOperation) => {
        if (operation?.type !== 'align') return false;
        if (operation.stage === 'select') {
            activateAlignSelection(operation, selectionEntities());
            return true;
        }
        if (isAlignPointStage(operation)) return false;
        if (operation.stage !== 'align-choice') return false;
        const choice = chooseAlignOperation(operation, rawValue);
        if (!choice.accepted) {
            setMessage(t(choice.reason === 'third-complete'
                ? 'messages.alignThirdAlreadySet'
                : 'messages.alignChoiceInvalid'));
            return true;
        }
        if (choice.action === 'continue') {
            setInteractiveOperation(choice.operation);
            setAlignPrompt(choice.operation);
            return true;
        }

        const result = alignDrawingEntities(
            history.content,
            operation.entityIds,
            operation.pairs,
            { scale: choice.scale },
        );
        if (!result.changed) {
            setMessage(t(result.reason === 'empty-selection'
                ? 'messages.alignNoLongerEditable'
                : 'messages.alignPairsInvalid', { reason: result.reason }));
            return true;
        }
        history.commit(result.content);
        setSelectedIds(result.selectedIds);
        setInteractiveOperation(null);
        setActiveTool('select');
        setMessage(t(choice.scale ? 'messages.alignScaled' : 'messages.alignApplied', {
            count: result.selectedIds.length,
            error: formatAlignmentError(result.transform.rmsError),
        }));
        return true;
    };

    return {
        activateAlignSelection,
        beginAlign,
        handleAlignPoint,
        submitAlignValue,
    };
}

function formatAlignmentError(value) {
    const error = Number(value);
    if (!Number.isFinite(error)) return '0';
    if (Math.abs(error) < 1e-9) return '0';
    return Number(error.toPrecision(6)).toString();
}
