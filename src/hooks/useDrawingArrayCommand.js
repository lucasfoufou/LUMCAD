import { useI18n } from '~i18n/I18nProvider';
import { createRectangularArray, editArrayOperation } from '~utils/drawingCompoundOperations';
import { canEditEntity } from '~utils/drawingDocument';
import { parseDrawingNumbers } from '~utils/drawingCommands';
import { parseDrawingOperationOption } from '~utils/drawingOperationOptions';

const ARRAY_TYPES = new Set(['line', 'rectangle', 'circle', 'polyline']);
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
    const arraySources = entities => entities.filter(entity => (
        ARRAY_TYPES.has(entity.type) && canEditEntity(history.content, entity)
    ));

    const activateArraySelection = (operation, entities, reportInvalid = true) => {
        const sources = arraySources(entities);
        if (!sources.length) {
            if (reportInvalid) setMessage(t('array.selectionRequired'));
            return false;
        }
        setInteractiveOperation({
            ...operation,
            stage: 'base',
            entityIds: sources.map(entity => entity.id),
            defaultColumns: lastOperationValuesRef.current.arrayColumns || 2,
            defaultRows: lastOperationValuesRef.current.arrayRows || 2,
        });
        setActiveTool('array');
        setMessage(t('array.basePoint'));
        return true;
    };

    const beginArray = () => {
        canvasRef.current?.cancel();
        const operation = { type: 'array', stage: 'select' };
        if (activateArraySelection(operation, selectedEntities, false)) return;
        setInteractiveOperation(operation);
        setActiveTool('select');
        setMessage(t('array.selectPattern'));
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

    const handleArrayPoint = (operation, point, arrayHandle = null) => {
        if (operation?.type !== 'array' || operation.stage === 'select') return false;
        if (!point) return true;
        if (operation.stage === 'array-edit' && arrayHandle) {
            const nextOperation = editArrayOperation(operation, arrayHandle, point);
            setInteractiveOperation(nextOperation);
            setMessage(t('array.previewDrag', { columns: nextOperation.columns, rows: nextOperation.rows }));
            return true;
        }
        const stagedOption = ARRAY_OPTION_STAGES[operation.stage];
        if (stagedOption) return finishArrayOption(operation, stagedOption, point);
        if (operation.stage === 'base') {
            setInteractiveOperation({ ...operation, stage: 'array-horizontal', basePoint: point, sourceBasePoint: point });
            setMessage(t('array.horizontalPoint'));
            return true;
        }
        if (operation.stage === 'array-horizontal') {
            const horizontalPoint = { x: point.x, y: operation.basePoint.y };
            if (Math.abs(horizontalPoint.x - operation.basePoint.x) <= 1e-9) {
                setMessage(t('array.horizontalNonZero'));
                return true;
            }
            setInteractiveOperation({ ...operation, stage: 'array-vertical', horizontalPoint });
            setMessage(t('array.verticalPoint'));
            return true;
        }
        if (operation.stage === 'array-vertical') {
            const verticalPoint = { x: operation.basePoint.x, y: point.y };
            if (Math.abs(verticalPoint.y - operation.basePoint.y) <= 1e-9) {
                setMessage(t('array.verticalNonZero'));
                return true;
            }
            setInteractiveOperation({ ...operation, stage: 'array-columns', verticalPoint });
            setMessage(t('array.columnsPrompt', { value: operation.defaultColumns }));
            commandBarRef.current?.focus('');
            return true;
        }
        return true;
    };

    const submitArrayValue = (operation, rawValue) => {
        if (operation?.type !== 'array' || operation.stage === 'select') return false;
        const trimmed = String(rawValue).trim();
        const parsedOption = parseDrawingOperationOption(operation, trimmed);
        if (parsedOption) return activateArrayOption(operation, parsedOption);
        if (operation.stage === 'array-edit') {
            if (trimmed) {
                setMessage(t('array.optionsOrCreate'));
                return true;
            }
            const result = createRectangularArray(
                history.content,
                operation.entityIds,
                operation.basePoint,
                operation.horizontalPoint,
                operation.verticalPoint,
                operation.columns,
                operation.rows,
                { sourceBasePoint: operation.sourceBasePoint },
            );
            if (!result.changed) {
                setMessage(t('array.creationFailed'));
                return true;
            }
            lastOperationValuesRef.current.arrayColumns = operation.columns;
            lastOperationValuesRef.current.arrayRows = operation.rows;
            history.commit(result.content);
            setSelectedIds(result.selectedIds);
            setInteractiveOperation(null);
            setActiveTool('select');
            setMessage(t('array.created', { columns: operation.columns, rows: operation.rows }));
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
        if (operation.stage === 'array-horizontal' || operation.stage === 'array-vertical') {
            const spacing = parseDrawingNumbers(rawValue)[0];
            if (!Number.isFinite(spacing) || Math.abs(spacing) <= 1e-9) {
                setMessage(t('array.spacingNonZero', { axis: operation.stage === 'array-horizontal' ? 'X' : 'Y' }));
                return true;
            }
            const point = operation.stage === 'array-horizontal'
                ? { x: operation.basePoint.x + spacing, y: operation.basePoint.y }
                : { x: operation.basePoint.x, y: operation.basePoint.y + spacing };
            return handleArrayPoint(operation, point);
        }
        if (operation.stage !== 'array-columns' && operation.stage !== 'array-rows') {
            setMessage(t('array.pointRequired'));
            return true;
        }
        const values = parseDrawingNumbers(rawValue);
        const fallback = operation.stage === 'array-columns' ? operation.defaultColumns : operation.defaultRows;
        const quantity = values[0] ?? fallback;
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
            setMessage(t('array.quantityRange'));
            return true;
        }
        if (operation.stage === 'array-columns') {
            lastOperationValuesRef.current.arrayColumns = quantity;
            setInteractiveOperation({ ...operation, stage: 'array-rows', columns: quantity });
            setMessage(t('array.rowsPrompt', { value: operation.defaultRows }));
            commandBarRef.current?.focus('');
            return true;
        }

        setInteractiveOperation({ ...operation, stage: 'array-edit', rows: quantity });
        setMessage(arrayEditPrompt({ ...operation, rows: quantity }, t));
        return true;
    };

    return { activateArraySelection, beginArray, handleArrayPoint, submitArrayValue };
}

function arrayOptionPoint(operation, option, values) {
    if (option === 'base' && values.length >= 2) return { x: values[0], y: values[1] };
    if (option === 'xSpacing' && values.length) return { x: operation.basePoint.x + values[0], y: operation.basePoint.y };
    if (option === 'ySpacing' && values.length) return { x: operation.basePoint.x, y: operation.basePoint.y + values[0] };
    if (option === 'columns' && Number.isInteger(values[0]) && values[0] >= 1 && values[0] <= 100) {
        return { x: operation.basePoint.x + (operation.horizontalPoint.x - operation.basePoint.x) * (values[0] - 1), y: operation.basePoint.y };
    }
    if (option === 'rows' && Number.isInteger(values[0]) && values[0] >= 1 && values[0] <= 100) {
        return { x: operation.basePoint.x, y: operation.basePoint.y + (operation.verticalPoint.y - operation.basePoint.y) * (values[0] - 1) };
    }
    return null;
}

function arrayEditPrompt(operation, t) {
    return t('array.editPrompt', { columns: operation.columns, rows: operation.rows });
}

function arrayOptionPrompt(option, t) {
    return t(`array.option.${option}`);
}
