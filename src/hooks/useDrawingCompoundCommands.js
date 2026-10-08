import { useI18n } from '~i18n/I18nProvider';
import { canEditEntity } from '~utils/drawingDocument';
import { explodeDrawingEntities, joinDrawingEntities, mirrorDrawingEntities, xplodeDrawingEntities } from '~utils/drawingCompoundOperations';
import { parseDrawingOperationOption } from '~utils/drawingOperationOptions';

export default function useDrawingCompoundCommands({
    canvasRef,
    commandBarRef,
    history,
    interactiveOperation,
    selectedIds,
    selectedEntities,
    setActiveTool,
    setInteractiveOperation,
    setMessage,
    setSelectedIds,
}) {
    const { locale, t } = useI18n();
    const executeCompoundOperation = (type, entityIds = selectedIds, options = {}) => {
        const result = type === 'join'
            ? joinDrawingEntities(history.content, entityIds)
            : type === 'xplode'
                ? xplodeDrawingEntities(history.content, entityIds, { ...options, locale })
                : explodeDrawingEntities(history.content, entityIds, { ...options, locale });
        setInteractiveOperation(null);
        setActiveTool('select');
        if (result.error) { setMessage(t(`constraints.${result.error}`)); return false; }
        if (!result.changed) {
            setMessage(t(type === 'join' ? 'compound.joinRequired' : 'compound.explodeRequired'));
            return false;
        }
        history.commit(result.content);
        setSelectedIds(result.selectedIds);
        if (type === 'join') {
            const kind = t(result.entity.closed ? 'compound.polylineClosed' : 'compound.polylineOpen');
            setMessage(t('compound.joined', { count: entityIds.length, kind }));
        } else {
            setMessage(t(type === 'xplode' ? 'compound.xploded' : 'compound.exploded', {
                count: result.explodedCount,
                shapes: result.entities.length,
                mode: t(options.appearanceMode === 'parent'
                    ? 'compound.appearanceParent'
                    : 'compound.appearanceParts'),
            }));
        }
        return true;
    };

    const beginCompoundOperation = type => {
        canvasRef.current?.cancel();
        const editableIds = selectedEntities.filter(entity => canEditEntity(history.content, entity)).map(entity => entity.id);
        if (editableIds.length) {
            if (type === 'xplode') {
                setInteractiveOperation({ type, stage: 'xplode-choice', entityIds: editableIds, appearanceMode: 'parts' });
                setActiveTool('select');
                setMessage(t('compound.xplodeOptions'));
                commandBarRef.current?.focus('');
                return;
            }
            executeCompoundOperation(type, editableIds);
            return;
        }
        setInteractiveOperation({ type, stage: 'select', ...(type === 'xplode' ? { appearanceMode: 'parts' } : {}) });
        setActiveTool('select');
        setMessage(t('compound.select', { operation: t(`operations.${type}`) }));
    };

    const activateCompoundSelection = (operation = interactiveOperation, entities = selectedEntities) => {
        if (!['join', 'explode', 'xplode'].includes(operation?.type)) return false;
        const entityIds = entities.filter(entity => canEditEntity(history.content, entity)).map(entity => entity.id);
        if (!entityIds.length) {
            setMessage(t(operation.type === 'join' ? 'compound.joinRequired' : 'compound.explodeRequired'));
            return true;
        }
        if (operation.type !== 'xplode') return executeCompoundOperation(operation.type, entityIds);
        setInteractiveOperation({ ...operation, stage: 'xplode-choice', entityIds });
        setActiveTool('select');
        setMessage(t('compound.xplodeOptions'));
        commandBarRef.current?.focus('');
        return true;
    };

    const submitCompoundValue = (rawValue, operation = interactiveOperation) => {
        if (operation?.type !== 'xplode') return false;
        if (operation.stage === 'select') return activateCompoundSelection(operation, selectedEntities);
        if (operation.stage !== 'xplode-choice') return false;
        const parsed = parseDrawingOperationOption(operation, rawValue);
        let appearanceMode = operation.appearanceMode || 'parts';
        if (parsed?.option === 'inheritParent') appearanceMode = 'parent';
        else if (parsed?.option === 'keepParts') appearanceMode = 'parts';
        else if (String(rawValue || '').trim()) {
            setMessage(t('compound.xplodeChoiceInvalid'));
            return true;
        }
        executeCompoundOperation('xplode', operation.entityIds, { appearanceMode });
        return true;
    };

    const completeMirrorChoice = (operation, rawValue) => {
        const parsedOption = parseDrawingOperationOption(operation, rawValue);
        if (parsedOption?.option === 'base' || parsedOption?.option === 'axis') {
            if (parsedOption.args.length >= 2) {
                return handleMirrorPoint(operation, {
                    x: parsedOption.args[0],
                    y: parsedOption.args[1],
                }, parsedOption.option);
            }
            setInteractiveOperation({ ...operation, stage: `mirror-option-${parsedOption.option}` });
            setMessage(t(parsedOption.option === 'base' ? 'mirror.newBase' : 'mirror.newAxis'));
            return true;
        }
        const choice = parsedOption?.option === 'copyMode'
            ? 'COPY'
            : parsedOption?.option === 'replaceMode'
                ? 'REPLACE'
                : String(rawValue || '').trim().toUpperCase();
        const replaceChoices = new Set(['O', 'OUI', 'Y', 'YES', 'REMPLACER', 'REPLACE']);
        const copyChoices = new Set(['', 'N', 'NON', 'NO', 'COPIER', 'COPY']);
        if (!replaceChoices.has(choice) && !copyChoices.has(choice)) {
            setMessage(t('mirror.choiceInvalid'));
            return false;
        }
        const replace = replaceChoices.has(choice);
        const result = mirrorDrawingEntities(
            history.content,
            operation.entityIds,
            operation.basePoint,
            operation.axisSecond,
            { replace, mirrorTextGlyphs: operation.mirrorTextGlyphs },
        );
        if (result.error) { setMessage(t(`constraints.${result.error}`)); return true; }
        if (result.changed) history.commit(result.content);
        setSelectedIds(result.selectedIds);
        setInteractiveOperation(null);
        setActiveTool('select');
        setMessage(t(replace ? 'mirror.replaced' : 'mirror.copied'));
        return true;
    };

    const handleMirrorPoint = (operation, point, requestedOption = null) => {
        if (operation?.type !== 'mirror' || !point) return false;
        const option = requestedOption || ({
            'mirror-option-base': 'base',
            'mirror-option-axis': 'axis',
        })[operation.stage];
        if (!option) return false;
        if (option === 'base') {
            const dx = point.x - operation.basePoint.x;
            const dy = point.y - operation.basePoint.y;
            setInteractiveOperation({
                ...operation,
                stage: 'mirror-choice',
                basePoint: point,
                axisSecond: { x: operation.axisSecond.x + dx, y: operation.axisSecond.y + dy },
            });
        } else {
            if (Math.hypot(point.x - operation.basePoint.x, point.y - operation.basePoint.y) <= 1e-9) {
                setMessage(t('messages.mirrorAxisDistinct'));
                return true;
            }
            setInteractiveOperation({ ...operation, stage: 'mirror-choice', axisSecond: point });
        }
        setMessage(t('messages.mirrorOptions'));
        return true;
    };

    return {
        activateCompoundSelection,
        beginCompoundOperation,
        completeMirrorChoice,
        executeCompoundOperation,
        handleMirrorPoint,
        submitCompoundValue,
    };
}
