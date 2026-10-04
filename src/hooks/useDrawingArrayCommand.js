import { beginPathArray, beginPathArrayEdit, choosePathArraySource, commitPathArray, editPathArrayPoint, normalizePathArray } from '~utils/drawingPathArray';
import { beginPolarArray, beginPolarArrayEdit, commitPolarArray, editPolarArrayPoint, normalizePolarArray } from '~utils/drawingPolarArray';
import { useI18n } from '~i18n/I18nProvider';
import { beginRectangularArrayEdit, beginRectangularArrayOperation, commitRectangularArrayOperation, editArrayOperation } from '~utils/drawingCompoundOperations';
import { parseDrawingNumbers } from '~utils/drawingCommands';
import { parseDrawingOperationOption } from '~utils/drawingOperationOptions';

const ARRAY_OPTION_HANDLES = { base: 'base', xSpacing: 'x-spacing', ySpacing: 'y-spacing', columns: 'columns', rows: 'rows' };
const ARRAY_OPTION_STAGES = Object.fromEntries(Object.keys(ARRAY_OPTION_HANDLES).map(option => [`array-option-${option}`, option]));

export default function useDrawingArrayCommand({
    canvasRef,
    commandBarRef,
    history,
    lastOperationValuesRef,
    selectedEntities,
    setActiveTool,
    setInteractiveOperation,
    setMessage,
    setSelectedIds,
}) {
    const { t } = useI18n();
    const activateArraySelection = (operation, entities, reportInvalid = true) => {
        const ids = entities.map(entity => entity.id);
        let nextOperation;
        if (operation.editExisting) {
            nextOperation = beginPathArrayEdit(history.content, ids) || beginPolarArrayEdit(history.content, ids) || beginRectangularArrayEdit(history.content, ids);
        } else if (operation.arrayKind === 'path') {
            nextOperation = beginPathArray(history.content, ids, { count: lastOperationValuesRef.current.pathArrayCount });
        } else if (operation.arrayKind === 'polar') {
            nextOperation = beginPolarArray(history.content, ids, { count: lastOperationValuesRef.current.polarArrayCount });
        } else {
            nextOperation = beginRectangularArrayOperation(history.content, ids, {
                columns: lastOperationValuesRef.current.arrayColumns,
                rows: lastOperationValuesRef.current.arrayRows,
            });
        }
        if (!nextOperation) {
            if (reportInvalid) setMessage(t(operation.editExisting ? 'array.editSelectionRequired' : 'array.selectionRequired'));
            return false;
        }
        setInteractiveOperation({ ...operation, ...nextOperation });
        setActiveTool('array');
        setMessage(nextOperation.stage === 'array-path' ? t('array.option.path')
            : nextOperation.stage === 'array-center' ? t('array.option.center') : arrayEditPrompt(nextOperation, t));
        return true;
    };

    const beginArray = (editExisting = false, arrayKind = 'rectangular') => {
        canvasRef.current?.cancel();
        const operation = { type: 'array', stage: 'select', arrayKind, editExisting: editExisting === true };
        if (activateArraySelection(operation, selectedEntities, false)) return;
        setInteractiveOperation(operation);
        setActiveTool('select');
        setMessage(t(editExisting === true ? 'array.editSelectionRequired' : 'array.selectPattern'));
    };

    const finishArrayOption = (operation, option, point) => {
        const editable = { ...operation, stage: 'array-edit' };
        const nextOperation = editArrayOperation(editable, ARRAY_OPTION_HANDLES[option], point);
        setInteractiveOperation(nextOperation);
        setMessage(arrayEditPrompt(nextOperation, t));
        return true;
    };

    const activateArrayOption = (operation, parsedOption) => {
        const option = parsedOption.option;
        const point = arrayOptionPoint(operation, option, parsedOption.args);
        if (point) return finishArrayOption(operation, option, point);
        setInteractiveOperation({ ...operation, stage: `array-option-${option}` });
        setMessage(arrayOptionPrompt(option, t));
        if (['columns', 'rows'].includes(option)) commandBarRef.current?.focus('');
        return true;
    };

    const submitPolarOption = (operation, option, values) => {
        if (option === 'center' && values.length >= 2) {
            return handleArrayPoint({ ...operation, stage: 'array-option-center' }, { x: values[0], y: values[1] });
        }
        const next = { ...operation, stage: 'array-edit' };
        if (option === 'count') next.count = values[0];
        if (option === 'angle') next.angle = values[0];
        if (option === 'rotateItems') next.rotateItems = values.length ? values[0] !== 0 : !operation.rotateItems;
        const validToggle = option !== 'rotateItems' || !values.length || [0, 1].includes(values[0]);
        if (validToggle && option !== 'center' && (values.length || option === 'rotateItems') && normalizePolarArray({ ...next, kind: 'polar' })) {
            setInteractiveOperation(next);
            setMessage(arrayEditPrompt(next, t));
            return true;
        }
        setInteractiveOperation({ ...operation, stage: `array-option-${option}` });
        setMessage(arrayOptionPrompt(option, t));
        commandBarRef.current?.focus('');
        return true;
    };

    const submitPathOption = (operation, option, values) => {
        if (option === 'path') {
            setInteractiveOperation({ ...operation, stage: 'array-path' });
            setMessage(t('array.option.path'));
            return true;
        }
        if (option === 'base' && values.length >= 2) {
            return handleArrayPoint({ ...operation, stage: 'array-option-base' }, { x: values[0], y: values[1] });
        }
        const next = { ...operation, stage: 'array-edit', kind: 'path' };
        if (option === 'count') { next.count = values[0]; next.mode = 'divide'; }
        if (option === 'spacing') { next.spacing = values[0]; next.mode = 'measure'; }
        if (option === 'offset') next.offset = values[0];
        const toggle = ['alignItems', 'reverse'].includes(option);
        const key = option === 'alignItems' ? 'align' : option;
        if (toggle) next[key] = values.length ? values[0] !== 0 : !operation[key];
        const valid = (!toggle || !values.length || [0, 1].includes(values[0]))
            && (values.length || toggle) && option !== 'base' && normalizePathArray(next);
        if (valid) {
            setInteractiveOperation({ ...next, ...valid });
            setMessage(arrayEditPrompt(valid, t));
            return true;
        }
        setInteractiveOperation({ ...operation, stage: `array-option-${option}` });
        setMessage(arrayOptionPrompt(option, t));
        commandBarRef.current?.focus('');
        return true;
    };

    const handleArrayPoint = (operation, point, arrayHandle = null, targetId = null) => {
        if (operation?.type !== 'array' || operation.stage === 'select') return false;
        if (!point) return true;
        if (operation.arrayKind === 'path') {
            const handle = operation.stage === 'array-option-base' ? 'base' : arrayHandle;
            const next = operation.stage === 'array-path' ? choosePathArraySource(history.content, operation, targetId)
                : editPathArrayPoint(operation, handle, point);
            if (!next) { setMessage(t('array.option.path')); return true; }
            setInteractiveOperation(next);
            setMessage(arrayEditPrompt(next, t));
            return true;
        }
        if (operation.arrayKind === 'polar') {
            const handle = ['array-center', 'array-option-center'].includes(operation.stage) ? 'center' : arrayHandle;
            const next = editPolarArrayPoint(operation, handle, point);
            setInteractiveOperation(next);
            setMessage(arrayEditPrompt(next, t));
            return true;
        }
        if (operation.stage === 'array-edit' && arrayHandle) {
            const nextOperation = editArrayOperation(operation, arrayHandle, point);
            setInteractiveOperation(nextOperation);
            setMessage(t('array.previewDrag', { columns: nextOperation.columns, rows: nextOperation.rows }));
            return true;
        }
        const stagedOption = ARRAY_OPTION_STAGES[operation.stage];
        if (stagedOption) return finishArrayOption(operation, stagedOption, point);
        return true;
    };

    const submitArrayValue = (operation, rawValue) => {
        if (operation?.type !== 'array' || operation.stage === 'select') return false;
        const trimmed = String(rawValue).trim();
        const parsedOption = parseDrawingOperationOption(operation, trimmed);
        if (operation.arrayKind === 'path' && parsedOption) return submitPathOption(operation, parsedOption.option, parsedOption.args);
        if (operation.arrayKind === 'path' && operation.stage.startsWith('array-option-')) {
            return submitPathOption(operation, operation.stage.replace('array-option-', ''), parseDrawingNumbers(rawValue));
        }
        if (operation.arrayKind === 'polar' && parsedOption) return submitPolarOption(operation, parsedOption.option, parsedOption.args);
        if (operation.arrayKind === 'polar' && operation.stage.startsWith('array-option-')) {
            return submitPolarOption(operation, operation.stage.replace('array-option-', ''), parseDrawingNumbers(rawValue));
        }
        if (parsedOption) return activateArrayOption(operation, parsedOption);
        if (operation.stage === 'array-edit') {
            if (trimmed && !['ARRAYCLOSE', 'ARCLOSE'].includes(trimmed.toUpperCase())) {
                setMessage(t('array.optionsOrCreate'));
                return true;
            }
            const result = operation.arrayKind === 'path' ? commitPathArray(history.content, operation)
                : operation.arrayKind === 'polar' ? commitPolarArray(history.content, operation)
                : commitRectangularArrayOperation(history.content, operation);
            if (!result.changed) {
                setMessage(t('array.creationFailed'));
                return true;
            }
            if (operation.arrayKind === 'path') lastOperationValuesRef.current.pathArrayCount = result.entity.array.count;
            else if (operation.arrayKind === 'polar') lastOperationValuesRef.current.polarArrayCount = operation.count;
            else {
                lastOperationValuesRef.current.arrayColumns = operation.columns;
                lastOperationValuesRef.current.arrayRows = operation.rows;
            }
            history.commit(result.content);
            setSelectedIds(result.selectedIds);
            setInteractiveOperation(null);
            setActiveTool('select');
            setMessage(operation.arrayKind === 'path' ? t('array.pathCreated', { count: result.entity.array.count })
                : operation.arrayKind === 'polar' ? t('array.polarCreated', { count: operation.count })
                : t('array.created', { columns: operation.columns, rows: operation.rows }));
            return true;
        }
        const stagedOption = ARRAY_OPTION_STAGES[operation.stage];
        if (stagedOption) {
            const values = parseDrawingNumbers(rawValue);
            const point = arrayOptionPoint(operation, stagedOption, values);
            if (point) return finishArrayOption(operation, stagedOption, point);
            setMessage(arrayOptionPrompt(stagedOption, t));
            return true;
        }
        return true;
    };

    return { activateArraySelection, beginArray, handleArrayPoint, submitArrayValue };
}

function arrayOptionPoint(operation, option, values) {
    if (option === 'base' && values.length >= 2) return { x: values[0], y: values[1] };
    if (['xSpacing', 'ySpacing', 'columns', 'rows'].includes(option) && values.length) {
        const horizontal = ['xSpacing', 'columns'].includes(option);
        const target = horizontal ? operation.horizontalPoint : operation.verticalPoint;
        const vector = { x: target.x - operation.basePoint.x, y: target.y - operation.basePoint.y };
        const count = ['columns', 'rows'].includes(option);
        if (count && (!Number.isInteger(values[0]) || values[0] < 1 || values[0] > 100)) return null;
        const length = Math.hypot(vector.x, vector.y);
        const factor = count ? values[0] - 1 : values[0] / length;
        if (!Number.isFinite(factor)) return null;
        return { x: operation.basePoint.x + vector.x * factor, y: operation.basePoint.y + vector.y * factor };
    }
    return null;
}

function arrayEditPrompt(operation, t) {
    if (operation.arrayKind === 'path') return t('array.pathEditPrompt', { count: operation.count });
    if (operation.arrayKind === 'polar') return t('array.polarEditPrompt', { count: operation.count, angle: operation.angle });
    return t('array.editPrompt', { columns: operation.columns, rows: operation.rows });
}

function arrayOptionPrompt(option, t) {
    return t(`array.option.${option}`);
}
