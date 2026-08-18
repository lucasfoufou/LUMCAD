import { useRef } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import {
    breakDrawingTarget,
    breakDrawingTargetAtPoint,
    lengthenDrawingTarget,
} from '~utils/drawingBreakLengthenOperations';
import { parseDrawingNumbers } from '~utils/drawingCommands';
import { canEditEntity } from '~utils/drawingDocument';
import { parseDrawingOperationOption } from '~utils/drawingOperationOptions';
import { stretchDrawingEntities } from '~utils/drawingStretchOperations';

const breakTypes = new Set(['break', 'breakAtPoint']);
const supportedTypes = new Set([...breakTypes, 'stretch', 'lengthen']);

export default function useDrawingBreakStretchLengthenCommand({
    canvasRef,
    commandBarRef,
    history,
    interactiveOperation,
    selectedEntities,
    selectedIds,
    setActiveTool,
    setInteractiveOperation,
    setMessage,
    setSelectedIds,
}) {
    const { formatNumber, locale, t } = useI18n();
    const lastLengthenValuesRef = useRef({ delta: 1, percent: 100, total: 1 });

    const editableSelectionIds = () => selectedEntities
        .filter(entity => canEditEntity(history.content, entity))
        .map(entity => entity.id);

    const finish = (nextSelection, message) => {
        setSelectedIds(nextSelection);
        setInteractiveOperation(null);
        setActiveTool('select');
        setMessage(message);
    };

    const beginBreakCommand = (atPoint = false) => {
        canvasRef.current?.cancel();
        const targetIds = editableSelectionIds();
        const type = atPoint ? 'breakAtPoint' : 'break';
        setInteractiveOperation({
            type,
            stage: atPoint ? 'break-at-point' : 'break-first',
            targetIds: targetIds.length ? targetIds : null,
        });
        setActiveTool('break');
        setMessage(t(atPoint ? 'break.atPointPrompt' : 'break.firstPrompt'));
    };

    const applyBreak = (operation, secondPoint = null) => {
        const result = operation.type === 'breakAtPoint'
            ? breakDrawingTargetAtPoint(history.content, operation.targetId, operation.firstPoint)
            : breakDrawingTarget(
                history.content,
                operation.targetId,
                operation.firstPoint,
                secondPoint,
            );
        if (!result.changed) {
            setMessage(t('break.cannot'));
            return true;
        }
        history.commit(result.content);
        finish(result.selectedIds, t(operation.type === 'breakAtPoint'
            ? 'break.atPointApplied'
            : 'break.applied', { count: result.replacements.length }));
        return true;
    };

    const beginStretchCommand = () => {
        canvasRef.current?.cancel();
        const targetIds = editableSelectionIds();
        setInteractiveOperation({
            type: 'stretch',
            stage: 'stretch-window-first',
            targetIds: targetIds.length ? targetIds : null,
        });
        setActiveTool('stretch');
        setMessage(t('stretch.windowFirst'));
    };

    const beginLengthenCommand = (requestedValue = null) => {
        canvasRef.current?.cancel();
        const targetIds = editableSelectionIds();
        const hasRequestedValue = Number.isFinite(requestedValue);
        setInteractiveOperation({
            type: 'lengthen',
            stage: 'lengthen-pick',
            targetIds: targetIds.length ? targetIds : null,
            mode: hasRequestedValue ? 'delta' : 'dynamic',
            ...(hasRequestedValue ? { value: requestedValue } : {}),
        });
        if (hasRequestedValue) lastLengthenValuesRef.current.delta = requestedValue;
        setActiveTool('lengthen');
        setMessage(t('lengthen.pickPrompt'));
    };

    const targetAllowed = (operation, targetId) => (
        targetId && (!operation.targetIds || operation.targetIds.includes(targetId))
    );

    const applyLengthen = (operation, dynamicPoint = null) => {
        const result = lengthenDrawingTarget(history.content, operation.targetId, operation.pickPoint, {
            mode: operation.mode,
            value: operation.value,
            dynamicPoint,
        });
        if (!result.changed) {
            setMessage(t('lengthen.cannot'));
            return true;
        }
        history.commit(result.content);
        setSelectedIds(result.selectedIds);
        setInteractiveOperation({
            ...operation,
            stage: 'lengthen-pick',
            targetId: null,
            pickPoint: null,
        });
        setActiveTool('lengthen');
        setMessage(t('lengthen.applied', {
            delta: formatNumber(result.delta, { maximumFractionDigits: 6 }),
            total: formatNumber(result.targetLength, { maximumFractionDigits: 6 }),
        }));
        return true;
    };

    const handleModificationPoint = (operation = interactiveOperation, point, targetId) => {
        if (!supportedTypes.has(operation?.type) || !point) return false;
        if (breakTypes.has(operation.type)) {
            if (operation.stage === 'break-second') return applyBreak(operation, point);
            if (!targetAllowed(operation, targetId)) {
                setMessage(t('break.targetRequired'));
                return true;
            }
            const target = history.content.entities.find(entity => entity.id === targetId);
            if (!canEditEntity(history.content, target)) {
                setMessage(t('break.targetRequired'));
                return true;
            }
            const next = { ...operation, targetId, firstPoint: point };
            if (operation.type === 'breakAtPoint') return applyBreak(next);
            setInteractiveOperation({ ...next, stage: 'break-second' });
            setMessage(t('break.secondPrompt'));
            return true;
        }

        if (operation.type === 'stretch') {
            if (operation.stage === 'stretch-window-first') {
                setInteractiveOperation({ ...operation, stage: 'stretch-window-second', windowStart: point });
                setMessage(t('stretch.windowSecond'));
                return true;
            }
            if (operation.stage === 'stretch-window-second') {
                const window = {
                    minX: Math.min(operation.windowStart.x, point.x),
                    minY: Math.min(operation.windowStart.y, point.y),
                    maxX: Math.max(operation.windowStart.x, point.x),
                    maxY: Math.max(operation.windowStart.y, point.y),
                    mode: 'crossing',
                };
                if (window.maxX - window.minX <= 1e-9 || window.maxY - window.minY <= 1e-9) {
                    setMessage(t('stretch.windowDistinct'));
                    return true;
                }
                setInteractiveOperation({ ...operation, stage: 'stretch-base', window });
                setMessage(t('stretch.basePrompt'));
                return true;
            }
            if (operation.stage === 'stretch-base') {
                setInteractiveOperation({ ...operation, stage: 'stretch-second', basePoint: point });
                setMessage(t('stretch.secondPrompt'));
                return true;
            }
            if (operation.stage === 'stretch-second') {
                const result = stretchDrawingEntities(history.content, {
                    targetIds: operation.targetIds,
                    window: operation.window,
                    basePoint: operation.basePoint,
                    secondPoint: point,
                });
                if (!result.changed) {
                    setMessage(t('stretch.cannot'));
                    return true;
                }
                history.commit(result.content);
                finish(result.selectedIds, t('stretch.applied', { count: result.changedCount }));
                return true;
            }
        }

        if (operation.type === 'lengthen') {
            if (operation.stage === 'lengthen-dynamic') return applyLengthen(operation, point);
            if (operation.stage !== 'lengthen-pick') return true;
            if (!targetAllowed(operation, targetId)) {
                setMessage(t('lengthen.targetRequired'));
                return true;
            }
            const target = history.content.entities.find(entity => entity.id === targetId);
            if (!canEditEntity(history.content, target)) {
                setMessage(t('lengthen.targetRequired'));
                return true;
            }
            const next = { ...operation, targetId, pickPoint: point };
            if (operation.mode === 'dynamic') {
                setInteractiveOperation({ ...next, stage: 'lengthen-dynamic' });
                setMessage(t('lengthen.dynamicPrompt'));
                return true;
            }
            return applyLengthen(next);
        }
        return true;
    };

    const setLengthenMode = (operation, mode, value = null) => {
        if (mode === 'dynamic') {
            const next = {
                ...operation,
                mode,
                stage: operation.targetId ? 'lengthen-dynamic' : 'lengthen-pick',
            };
            setInteractiveOperation(next);
            setMessage(t(operation.targetId ? 'lengthen.dynamicPrompt' : 'lengthen.pickPrompt'));
            return true;
        }
        if (!Number.isFinite(value)) {
            setInteractiveOperation({ ...operation, mode, stage: 'lengthen-value' });
            setMessage(t(`lengthen.${mode}Prompt`, { value: lastLengthenValuesRef.current[mode] }));
            commandBarRef.current?.focus('');
            return true;
        }
        if ((mode !== 'delta' && value <= 0) || (mode === 'delta' && Math.abs(value) <= 1e-12)) {
            setMessage(t('lengthen.valueInvalid'));
            return true;
        }
        lastLengthenValuesRef.current[mode] = value;
        const next = { ...operation, mode, value, stage: 'lengthen-pick' };
        if (operation.targetId && operation.pickPoint) return applyLengthen(next);
        setInteractiveOperation(next);
        setMessage(t('lengthen.pickPrompt'));
        return true;
    };

    const submitModificationValue = (rawValue, operation = interactiveOperation) => {
        if (!supportedTypes.has(operation?.type)) return false;
        const raw = String(rawValue || '').trim();
        if (operation.type !== 'lengthen') return false;
        if (!raw && operation.stage === 'lengthen-pick') {
            finish(selectedIds, t('lengthen.complete'));
            return true;
        }
        const parsedOption = parseDrawingOperationOption(operation, rawValue);
        const modeByOption = {
            deltaMode: 'delta',
            percentMode: 'percent',
            totalMode: 'total',
            dynamicMode: 'dynamic',
        };
        if (modeByOption[parsedOption?.option]) {
            return setLengthenMode(operation, modeByOption[parsedOption.option], parsedOption.args[0]);
        }
        const looksLikePoint = /[@<;]/.test(raw) || (locale !== 'fr' && raw.includes(','));
        const acceptsInlineValue = operation.stage === 'lengthen-pick' && !looksLikePoint && /^[-+]?\d/.test(raw);
        if (operation.stage === 'lengthen-value' || acceptsInlineValue) {
            const values = parseDrawingNumbers(rawValue);
            const value = values[0] ?? lastLengthenValuesRef.current[operation.mode];
            return setLengthenMode(operation, operation.mode === 'dynamic' ? 'delta' : operation.mode, value);
        }
        return false;
    };

    return {
        beginBreakCommand,
        beginLengthenCommand,
        beginStretchCommand,
        handleModificationPoint,
        submitModificationValue,
    };
}
