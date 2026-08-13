import { useI18n } from '~i18n/I18nProvider';
import { canEditEntity } from '~utils/drawingDocument';
import { explodeDrawingEntities, joinDrawingEntities, mirrorDrawingEntities } from '~utils/drawingCompoundOperations';
import { parseDrawingOperationOption } from '~utils/drawingOperationOptions';

export default function useDrawingCompoundCommands({
    canvasRef,
    history,
    selectedIds,
    selectedEntities,
    setActiveTool,
    setInteractiveOperation,
    setMessage,
    setSelectedIds,
}) {
    const { t } = useI18n();
    const executeCompoundOperation = (type, entityIds = selectedIds) => {
        const result = type === 'join'
            ? joinDrawingEntities(history.content, entityIds)
            : explodeDrawingEntities(history.content, entityIds);
        setInteractiveOperation(null);
        setActiveTool('select');
        if (!result.changed) {
            setMessage(t(type === 'join' ? 'compound.joinRequired' : 'compound.explodeRequired'));
            return false;
        }
        history.commit(result.content);
        setSelectedIds(result.selectedIds);
        if (type === 'join') {
            const kind = t(result.entity.parts
                ? 'compound.polylineMultiPath'
                : result.entity.closed ? 'compound.polylineClosed' : 'compound.polylineOpen');
            setMessage(t('compound.joined', { count: entityIds.length, kind }));
        } else {
            setMessage(t('compound.exploded', { count: result.explodedCount, shapes: result.entities.length }));
        }
        return true;
    };

    const beginCompoundOperation = type => {
        canvasRef.current?.cancel();
        const editableIds = selectedEntities.filter(entity => canEditEntity(history.content, entity)).map(entity => entity.id);
        if (editableIds.length) {
            executeCompoundOperation(type, editableIds);
            return;
        }
        setInteractiveOperation({ type, stage: 'select' });
        setActiveTool('select');
        setMessage(t('compound.select', { operation: t(`operations.${type}`) }));
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

    return { beginCompoundOperation, completeMirrorChoice, executeCompoundOperation, handleMirrorPoint };
}
