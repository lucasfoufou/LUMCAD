import { canEditEntity } from '~utils/drawingDocument';
import {
    blendDrawingEntities,
    chamferDrawingEntities,
    chamferDrawingPath,
    filletDrawingEntities,
    filletDrawingPath,
} from '~utils/drawingCornerOperations';
import { parseDrawingOperationOption } from '~utils/drawingOperationOptions';

const CORNER_COMMANDS = new Set(['fillet', 'chamfer', 'blend']);

export default function useDrawingCornerCommand({
    canvasRef,
    commandBarRef,
    history,
    interactiveOperation,
    lastOperationValuesRef,
    locale = 'en',
    setActiveTool,
    setInteractiveOperation,
    setMessage,
    setSelectedIds,
    t,
}) {
    const prompt = operation => {
        if (operation.type === 'fillet') {
            return t(operation.stage === 'corner-second'
                ? 'messages.filletSecondPrompt'
                : 'messages.filletFirstPrompt', { radius: operation.radius });
        }
        if (operation.type === 'chamfer') {
            return t(operation.stage === 'corner-second'
                ? 'messages.chamferSecondPrompt'
                : 'messages.chamferFirstPrompt', {
                distance1: operation.distance1,
                distance2: operation.distance2,
            });
        }
        return t(operation.stage === 'corner-second'
            ? 'messages.blendSecondPrompt'
            : 'messages.blendFirstPrompt');
    };

    const beginCornerOperation = (type, values = []) => {
        if (!CORNER_COMMANDS.has(type)) return false;
        canvasRef.current?.cancel();
        const defaults = lastOperationValuesRef.current;
        const operation = {
            type,
            stage: 'corner-first',
            keepSources: false,
            multiple: false,
            pathMode: false,
            ...(type === 'fillet' ? {
                radius: finiteNonNegative(values[0]) ?? finiteNonNegative(defaults.filletRadius) ?? 0,
            } : {}),
            ...(type === 'chamfer' ? {
                distance1: finiteNonNegative(values[0]) ?? finiteNonNegative(defaults.chamferDistance1) ?? 0,
                distance2: finiteNonNegative(values[1]) ?? finiteNonNegative(values[0])
                    ?? finiteNonNegative(defaults.chamferDistance2) ?? 0,
                angleDegrees: null,
            } : {}),
        };
        setInteractiveOperation(operation);
        setActiveTool(type);
        setMessage(prompt(operation));
        return true;
    };

    const finish = (operation, result, messageKey, values = {}) => {
        history.commit(result.content);
        setSelectedIds(result.selectedIds);
        if (operation.multiple && operation.type !== 'blend') {
            const next = {
                ...operation,
                stage: 'corner-first',
                firstId: undefined,
                firstPick: undefined,
                inputMode: undefined,
            };
            setInteractiveOperation(next);
            setActiveTool(operation.type);
            setMessage(`${t(messageKey, values)} ${prompt(next)}`);
        } else {
            setInteractiveOperation(null);
            setActiveTool('select');
            setMessage(t(messageKey, values));
        }
    };

    const handleCornerPoint = (operation = interactiveOperation, point, targetId) => {
        if (!CORNER_COMMANDS.has(operation?.type)) return false;
        const target = history.content.entities.find(entity => entity.id === targetId);
        if (!target || !canEditEntity(history.content, target)) {
            setMessage(t('messages.cornerEditableTargetRequired'));
            return true;
        }

        if (operation.pathMode && operation.type !== 'blend') {
            const result = operation.type === 'fillet'
                ? filletDrawingPath(history.content, target.id, operation.radius, { keepSources: operation.keepSources })
                : chamferDrawingPath(history.content, target.id, cornerOptions(operation));
            if (!result.changed) {
                setMessage(t('messages.cornerCannotApply', { reason: result.reason }));
                return true;
            }
            finish(operation, result, operation.type === 'fillet'
                ? 'messages.filletPathApplied'
                : 'messages.chamferPathApplied', {
                count: result.operationResult?.cornerCount || 0,
            });
            return true;
        }

        if (operation.stage !== 'corner-second' || !operation.firstId) {
            const next = { ...operation, stage: 'corner-second', firstId: target.id, firstPick: point, inputMode: undefined };
            setInteractiveOperation(next);
            setMessage(prompt(next));
            return true;
        }
        if (target.id === operation.firstId) {
            setMessage(t('messages.cornerDistinctTargets'));
            return true;
        }

        let result;
        if (operation.type === 'fillet') {
            result = filletDrawingEntities(
                history.content,
                operation.firstId,
                operation.firstPick,
                target.id,
                point,
                operation.radius,
                { keepSources: operation.keepSources },
            );
        } else if (operation.type === 'chamfer') {
            result = chamferDrawingEntities(
                history.content,
                operation.firstId,
                operation.firstPick,
                target.id,
                point,
                cornerOptions(operation),
            );
        } else {
            result = blendDrawingEntities(
                history.content,
                operation.firstId,
                operation.firstPick,
                target.id,
                point,
            );
        }
        if (!result.changed) {
            setMessage(t('messages.cornerCannotApply', { reason: result.reason }));
            return true;
        }
        finish(operation, result, {
            fillet: 'messages.filletApplied',
            chamfer: 'messages.chamferApplied',
            blend: 'messages.blendApplied',
        }[operation.type], { count: result.selectedIds.length });
        return true;
    };

    const submitCornerValue = (rawValue, operation = interactiveOperation) => {
        if (!CORNER_COMMANDS.has(operation?.type)) return false;
        const text = String(rawValue || '').trim();
        const numbers = parseNumbers(text);
        const parsed = parseDrawingOperationOption(operation, text);

        if (operation.inputMode) {
            if (!numbers.length) {
                setMessage(t(operation.inputMode === 'fillet-radius'
                    ? 'messages.filletRadiusPrompt'
                    : operation.inputMode === 'chamfer-angle'
                        ? 'messages.chamferAnglePrompt'
                        : 'messages.chamferDistancePrompt'));
                return true;
            }
            const next = applyNumericMode(operation, numbers);
            if (!next) {
                setMessage(t('messages.cornerNonNegativeValues'));
                return true;
            }
            rememberValues(next, lastOperationValuesRef);
            setInteractiveOperation(next);
            setMessage(prompt(next));
            return true;
        }

        if (!text) {
            setInteractiveOperation(null);
            setActiveTool('select');
            setMessage(t('messages.cornerCommandFinished'));
            return true;
        }

        const looksLikePoint = /[@<;]/.test(text) || (locale !== 'fr' && text.includes(','));
        if (!parsed && numbers.length && !looksLikePoint) {
            const inputMode = operation.type === 'fillet'
                ? 'fillet-radius'
                : operation.type === 'chamfer' ? 'chamfer-distance' : null;
            if (!inputMode) return false;
            const next = applyNumericMode({ ...operation, inputMode }, numbers);
            if (!next) {
                setMessage(t('messages.cornerNonNegativeValues'));
                return true;
            }
            rememberValues(next, lastOperationValuesRef);
            setInteractiveOperation(next);
            setMessage(prompt(next));
            return true;
        }
        if (!parsed) return false;

        let next = { ...operation, inputMode: undefined };
        if (parsed.option === 'radius' && operation.type === 'fillet') {
            if (!parsed.args.length) return requestInput(next, 'fillet-radius', 'messages.filletRadiusPrompt');
            next = applyNumericMode({ ...next, inputMode: 'fillet-radius' }, parsed.args);
        } else if (parsed.option === 'distance' && operation.type === 'chamfer') {
            if (!parsed.args.length) return requestInput(next, 'chamfer-distance', 'messages.chamferDistancePrompt');
            next = applyNumericMode({ ...next, inputMode: 'chamfer-distance' }, parsed.args);
        } else if (parsed.option === 'angle' && operation.type === 'chamfer') {
            if (parsed.args.length < 2) return requestInput(next, 'chamfer-angle', 'messages.chamferAnglePrompt');
            next = applyNumericMode({ ...next, inputMode: 'chamfer-angle' }, parsed.args);
        } else if (parsed.option === 'multiple') next.multiple = true;
        else if (parsed.option === 'polyline') next.pathMode = true;
        else if (parsed.option === 'trim') next.keepSources = false;
        else if (parsed.option === 'noTrim') next.keepSources = true;
        else return false;

        if (!next) {
            setMessage(t('messages.cornerNonNegativeValues'));
            return true;
        }
        rememberValues(next, lastOperationValuesRef);
        setInteractiveOperation(next);
        setMessage(prompt(next));
        return true;
    };

    const requestInput = (operation, inputMode, messageKey) => {
        setInteractiveOperation({ ...operation, inputMode });
        setMessage(t(messageKey));
        commandBarRef.current?.focus('');
        return true;
    };

    return { beginCornerOperation, handleCornerPoint, submitCornerValue };
}

function cornerOptions(operation) {
    return {
        distance1: operation.distance1,
        distance2: operation.distance2,
        ...(Number.isFinite(operation.angleDegrees) ? { angleDegrees: operation.angleDegrees } : {}),
        keepSources: operation.keepSources,
    };
}

function applyNumericMode(operation, values) {
    if (operation.inputMode === 'fillet-radius') {
        const radius = finiteNonNegative(values[0]);
        return radius === null ? null : { ...operation, radius, inputMode: undefined };
    }
    if (operation.inputMode === 'chamfer-distance') {
        const first = finiteNonNegative(values[0]);
        const second = finiteNonNegative(values[1] ?? values[0]);
        return first === null || second === null ? null : {
            ...operation,
            distance1: first,
            distance2: second,
            angleDegrees: null,
            inputMode: undefined,
        };
    }
    if (operation.inputMode === 'chamfer-angle') {
        const distance = finiteNonNegative(values[0]);
        const angleDegrees = Number(values[1]);
        return distance === null || !Number.isFinite(angleDegrees) || angleDegrees <= 0 || angleDegrees >= 180
            ? null
            : { ...operation, distance1: distance, angleDegrees, inputMode: undefined };
    }
    return null;
}

function rememberValues(operation, ref) {
    if (operation.type === 'fillet') ref.current.filletRadius = operation.radius;
    if (operation.type === 'chamfer') {
        ref.current.chamferDistance1 = operation.distance1;
        ref.current.chamferDistance2 = operation.distance2;
    }
}

function finiteNonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseNumbers(value) {
    return String(value || '')
        .trim()
        .split(/[;\s]+/)
        .filter(Boolean)
        .map(part => Number.parseFloat(part.replace(',', '.')))
        .filter(Number.isFinite);
}
