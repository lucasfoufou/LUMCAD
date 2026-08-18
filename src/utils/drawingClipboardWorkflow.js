import { parseDrawingNumbers } from './drawingCommands.js';
import {
    createDrawingClipboardPayload,
    pasteDrawingClipboardPayload,
} from './drawingClipboard.js';
import { drawingClipboardAdapter } from './drawingClipboardAdapter.js';
import { canEditEntity, deleteSelectedEntities } from './drawingDocument.js';

export function createDrawingClipboardWorkflow({
    assets = [],
    canvasRef = null,
    clipboardAdapter = drawingClipboardAdapter,
    document = null,
    history,
    interactiveOperation = null,
    selectedIds = [],
    setActiveTool = () => {},
    setAssets = () => {},
    setInteractiveOperation = () => {},
    setMessage = () => {},
    setSelectedIds = () => {},
    t = (key, values) => values ? `${key}:${JSON.stringify(values)}` : key,
} = {}) {
    if (!history?.content || typeof history.commit !== 'function') {
        throw new TypeError('Drawing clipboard workflow requires drawing history.');
    }

    const currentSelection = ({ editable = false } = {}) => {
        const requested = new Set(selectedIds || []);
        return history.content.entities
            .filter(entity => requested.has(entity.id) && (!editable || canEditEntity(history.content, entity)))
            .map(entity => entity.id);
    };

    const sourceDocument = () => ({
        id: document?.id || null,
        content: history.content,
        assets,
    });

    const setError = error => {
        const code = error?.drawingClipboardAdapterCode || error?.drawingClipboardCode || 'unknown';
        setMessage(t(`clipboard.error.${code}`));
    };

    const finishOperation = () => {
        setInteractiveOperation(null);
        setActiveTool('select');
    };

    const writeSelection = async (entityIds, basePoint = null) => {
        if (!entityIds.length) {
            setMessage(t('clipboard.selectionRequired'));
            return false;
        }
        try {
            const payload = createDrawingClipboardPayload(sourceDocument(), entityIds, { basePoint });
            await clipboardAdapter.write(payload);
            setMessage(t('messages.objectsCopied', { count: payload.selectionIds.length }));
            return true;
        } catch (error) {
            setError(error);
            return false;
        }
    };

    const applyPaste = (payload, mode, insertionPoint = null) => {
        try {
            const result = pasteDrawingClipboardPayload({ content: history.content, assets }, payload, {
                mode,
                insertionPoint,
            });
            history.commit(result.content);
            setAssets(result.assets);
            setSelectedIds(result.selectedIds);
            finishOperation();
            setMessage(t('messages.objectsPasted', { count: result.entities.length }));
            return true;
        } catch (error) {
            setError(error);
            return false;
        }
    };

    const readForInsertion = async mode => {
        try {
            const payload = await clipboardAdapter.read();
            canvasRef?.current?.cancel?.();
            setInteractiveOperation({
                type: mode === 'block' ? 'pasteBlock' : 'pasteClip',
                stage: 'insertion',
                payload,
            });
            setActiveTool('select');
            setMessage(t(mode === 'block' ? 'clipboard.pasteBlockPrompt' : 'clipboard.pastePrompt'));
            return true;
        } catch (error) {
            setError(error);
            return false;
        }
    };

    const copyClip = () => writeSelection(currentSelection());

    const cutClip = async () => {
        const entityIds = currentSelection({ editable: true });
        if (!entityIds.length) {
            setMessage(t('clipboard.selectionRequired'));
            return false;
        }
        try {
            const payload = createDrawingClipboardPayload(sourceDocument(), entityIds);
            await clipboardAdapter.write(payload);
            history.commit(deleteSelectedEntities(history.content, entityIds));
            setSelectedIds([]);
            finishOperation();
            setMessage(t('clipboard.objectsCut', { count: payload.selectionIds.length }));
            return true;
        } catch (error) {
            setError(error);
            return false;
        }
    };

    const beginCopyBase = () => {
        const entityIds = currentSelection();
        if (!entityIds.length) {
            setMessage(t('clipboard.selectionRequired'));
            return false;
        }
        canvasRef?.current?.cancel?.();
        setInteractiveOperation({ type: 'copyBase', stage: 'base', entityIds });
        setActiveTool('select');
        setMessage(t('clipboard.copyBasePrompt'));
        return true;
    };

    const beginPasteClip = () => readForInsertion('insert');
    const beginPasteBlock = () => readForInsertion('block');

    const pasteOriginal = async () => {
        try {
            const payload = await clipboardAdapter.read();
            canvasRef?.current?.cancel?.();
            return applyPaste(payload, 'original');
        } catch (error) {
            setError(error);
            return false;
        }
    };

    const handleClipboardPoint = async (operation, point) => {
        if (!isClipboardOperation(operation)) return false;
        if (!isFinitePoint(point)) {
            setMessage(t('messages.pointRequired'));
            return true;
        }
        if (operation.type === 'copyBase') {
            const copied = await writeSelection(operation.entityIds || [], point);
            if (copied) finishOperation();
            return true;
        }
        return applyPaste(operation.payload, operation.type === 'pasteBlock' ? 'block' : 'insert', point);
    };

    const submitClipboardValue = (rawValue, operation = interactiveOperation) => {
        if (!isClipboardOperation(operation)) return false;
        const values = parseDrawingNumbers(rawValue);
        if (values.length < 2) return false;
        void handleClipboardPoint(operation, { x: values[0], y: values[1] });
        return true;
    };

    return {
        beginCopyBase,
        beginPasteBlock,
        beginPasteClip,
        copyClip,
        cutClip,
        handleClipboardPoint,
        pasteOriginal,
        submitClipboardValue,
    };
}

export function isClipboardOperation(operation) {
    return ['copyBase', 'pasteClip', 'pasteBlock'].includes(operation?.type)
        && ['base', 'insertion'].includes(operation?.stage);
}

function isFinitePoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}
